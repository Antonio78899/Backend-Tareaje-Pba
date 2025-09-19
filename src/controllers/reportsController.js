// src/controllers/reports.controller.js
const dayjs = require('dayjs');
const { listEmployees } = require('../repositories/employeesRepo');
const { listByEmployee } = require('../repositories/sessionsRepo');
const { computeFromSessions } = require('../services/overtimeService');
const { buildWorkbook } = require('../services/excelService');

const toYMD = (v) => (v ? dayjs(v).format('YYYY-MM-DD') : null);

const normalizeSessions = (rows = []) =>
  rows.map(r => ({
    id: r.id,
    employeeId: r.employeeId,
    workDate: toYMD(r.workDate),                 // 'YYYY-MM-DD'
    startTime: String(r.startTime || '').trim(), // 'HH:mm'
    endTime:   String(r.endTime   || '').trim(),
    hadLunch:  !!r.hadLunch,
    lunchMinutes: r.lunchMinutes
  }));

// ---------- Helpers ----------
const eachDateYMD = (from, to) => {
  const start = dayjs(from).startOf('day');
  const end   = dayjs(to).startOf('day');
  const days = [];
  for (let d = start; !d.isAfter(end); d = d.add(1, 'day')) {
    days.push(d.format('YYYY-MM-DD'));
  }
  return days;
};

const fillMissingDays = (calc = {}, from, to) => {
  const allDays = eachDateYMD(from, to);
  const existing = new Map((calc.days || []).map(x => [x.date, x]));
  const filledDays = allDays.map(date => existing.get(date) || { date, worked: 0, overtime: 0 });
  filledDays.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { ...calc, days: filledDays };
};

// Lunes de la semana (0=Dom,1=Lun,...)
const mondayOf = (dateStr) => {
  const d = dayjs(dateStr);
  const dow = d.day();
  const diffToMonday = (dow + 6) % 7;
  return d.subtract(diffToMonday, 'day').format('YYYY-MM-DD');
};

// HH:MM (negativos con prefijo '-')
const decToHHMM = (hDec) => {
  if (hDec == null || isNaN(hDec)) return '00:00';
  const sign = hDec < 0 ? '-' : '';
  let abs = Math.abs(hDec);
  const hh = Math.floor(abs);
  let mm = Math.round((abs - hh) * 60);
  if (mm === 60) { mm = 0; abs = hh + 1; }
  return `${sign}${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
};
// --------------------------------

async function preview(req, res) {
  try {
    const { employeeIds, from, to, baseHoursPerDay, lunchMinutesDefault } = req.body;

    const all = await listEmployees();
    const selected = (employeeIds?.length ? all.filter(e => employeeIds.includes(e.id)) : all);

    const out = [];
    for (const emp of selected) {
      const raw = await listByEmployee(emp.id, from, to);
      const sessions = normalizeSessions(raw);

      // Cálculo base del servicio (devuelve worked / overtime por día)
      const calcBase = computeFromSessions(sessions, { baseHoursPerDay, lunchMinutesDefault });
      // Rellenar días del rango
      const calcFilled = fillMissingDays(calcBase, from, to);

      // Base diaria (para owed diario informativo)
      const base = Number.isFinite(Number(calcFilled?.baseHoursPerDay))
        ? Number(calcFilled.baseHoursPerDay)
        : (Number.isFinite(Number(baseHoursPerDay)) ? Number(baseHoursPerDay) : 8);

      // Enriquecer días (displays) y mantener numéricos
      const days = (calcFilled.days || []).map(d => {
        const worked = Number(d?.worked) || 0;
        const overtime = Number(d?.overtime) || 0;

        const workedDisplay   = worked === 0 ? 'DESCANSO' : decToHHMM(worked);
        const overtimeDisplay = worked === 0 ? 'DESCANSO' : decToHHMM(overtime);
        const owedDay = (worked > 0 && worked < base) ? (base - worked) : 0;
        const owedDisplay = worked === 0 ? 'DESCANSO' : decToHHMM(owedDay);

        return {
          ...d,
          worked,
          overtime,
          owed: owedDay,
          workedDisplay,
          overtimeDisplay,
          owedDisplay,
        };
      });

      // ---- Resumen semanal con excepción: última semana parcial usa regla diaria
      const weeksMap = new Map();
      for (const d of days) {
        const wk = mondayOf(d.date);
        if (!weeksMap.has(wk)) weeksMap.set(wk, []);
        weeksMap.get(wk).push(d);
      }
      const weekStarts = Array.from(weeksMap.keys()).sort();
      const lastWeekStart = weekStarts[weekStarts.length - 1];

      const WEEK_TARGET = 48; // h por semana completa
      const weekly = [];
      let totalOvertimeDec = 0; // suma de extras semanales (según regla)
      let totalOwedDec = 0;     // suma de deudas semanales (según regla)

      for (const weekStart of weekStarts) {
        const arr = weeksMap.get(weekStart).sort((a,b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
        const workedSum = arr.reduce((acc, x) => acc + (Number(x.worked) || 0), 0);

        const isFullWeek = arr.length === 7;
        const isLastWeek = weekStart === lastWeekStart;

        let extraWeek = 0;
        let owedWeek = 0;

        if (isLastWeek && !isFullWeek) {
          // Última semana parcial -> regla diaria (base 8h por día)
          extraWeek = arr.reduce((acc, x) => acc + Math.max(0, (Number(x.worked) || 0) - base), 0);
          owedWeek  = arr.reduce((acc, x) => acc + Math.max(0, base - (Number(x.worked) || 0)), 0);
        } else {
          // Semanas completas (o cualquier otra no última parcial) -> regla 48h
          extraWeek = Math.max(0, workedSum - WEEK_TARGET);
          owedWeek  = Math.max(0, WEEK_TARGET - workedSum);
        }

        weekly.push({
          weekStart,
          weekEnd: dayjs(weekStart).add(6, 'day').format('YYYY-MM-DD'),
          workedDec: workedSum,
          overtimeDec: extraWeek,
          owedDec: owedWeek,
          worked: decToHHMM(workedSum),
          overtime: decToHHMM(extraWeek),
          owed: decToHHMM(owedWeek),
          net: decToHHMM(extraWeek - owedWeek),
        });

        totalOvertimeDec += extraWeek;
        totalOwedDec += owedWeek;
      }

      const totalNetDec = totalOvertimeDec - totalOwedDec;

      const calc = {
        ...calcFilled,
        baseHoursPerDay: base,
        days,
        weekly,
        totals: {
          totalOvertimeDec,
          totalOwedDec,
          totalNetDec,
          totalOvertime: decToHHMM(totalOvertimeDec),
          totalOwed: decToHHMM(totalOwedDec),
          totalNet: decToHHMM(totalNetDec),
        },
      };

      out.push({ employee: emp, calc });
    }

    res.json({ ok: true, data: out });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
}

async function excel(req, res) {
  try {
    const { employeeIds, from, to, baseHoursPerDay, lunchMinutesDefault } = req.body;

    const all = await listEmployees();
    const selected = (employeeIds?.length ? all.filter(e => employeeIds.includes(e.id)) : all);

    const blocks = [];
    for (const emp of selected) {
      const raw = await listByEmployee(emp.id, from, to);
      const sessions = normalizeSessions(raw);
      const calcBase = computeFromSessions(sessions, { baseHoursPerDay, lunchMinutesDefault });
      const calc = fillMissingDays(calcBase, from, to);
      blocks.push({ employee: emp, calc });
    }

    const wb = await buildWorkbook(blocks);
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition','attachment; filename="horas_overtime.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
}

module.exports = { preview, excel };
