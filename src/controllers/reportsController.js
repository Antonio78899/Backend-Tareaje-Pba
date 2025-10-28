// src/controllers/reports.controller.js
const dayjs = require('dayjs');
const { listEmployees } = require('../repositories/employeesRepo');
const { listByEmployee } = require('../repositories/sessionsRepo');

// ⚠️ Ajusta estas rutas según tus nombres reales de archivo:
//   - '../services/overtime.service'  o  '../services/overtimeService'
const { computeFromSessions } = require('../services/overtimeService');
//   - '../services/excelService'     o  '../services/excelService'
const { buildWorkbook } = require('../services/excelService');

const toYMD = (v) => (v ? dayjs(v).format('YYYY-MM-DD') : null);

const normalizeSessions = (rows = []) =>
  rows.map(r => ({
    id: r.id,
    employeeId: r.employeeId,
    workDate: toYMD(r.workDate),                 // 'YYYY-MM-DD'
    startTime: String(r.startTime || '').trim(), // 'HH:mm'
    endTime: String(r.endTime || '').trim(),
    hadLunch: !!r.hadLunch,
    lunchMinutes: r.lunchMinutes
  }));

// ---------- Helpers ----------
const eachDateYMD = (from, to) => {
  const start = dayjs(from).startOf('day');
  const end = dayjs(to).startOf('day');
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
  return { ...calc, days: filledDays, rangeStart: from, rangeEnd: to };
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
  if (mm === 60) { mm = 0; }
  return `${sign}${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};

const addDays = (dateStr, n) => dayjs(dateStr).add(n, 'day').format('YYYY-MM-DD');
const minDate = (a, b) => (a < b ? a : b);
const maxDate = (a, b) => (a > b ? a : b);
// --------------------------------

async function preview(req, res) {
  try {
    const { employeeIds, from, to, baseHoursPerDay, lunchMinutesDefault } = req.body;
    if (!from || !to) {
      return res.status(400).json({ ok: false, error: 'Faltan from/to (YYYY-MM-DD)' });
    }

    const all = await listEmployees();
    const selected = (employeeIds?.length ? all.filter(e => employeeIds.includes(e.id)) : all);

    const out = [];
    for (const emp of selected) {
      const raw = await listByEmployee(emp.id, from, to);
      const sessions = normalizeSessions(raw);

      // ⬅️ PASAR RANGO para que el servicio no se salga
      const calcBase = computeFromSessions(sessions, {
        baseHoursPerDay,
        lunchMinutesDefault,
        rangeStart: from,
        rangeEnd: to,
      });

      // Rellenar días del rango (0h donde falte)
      const calcFilled = fillMissingDays(calcBase, from, to);

      // Base diaria (para 'owed' diario)
      const base = Number.isFinite(Number(calcFilled?.baseHoursPerDay))
        ? Number(calcFilled.baseHoursPerDay)
        : (Number.isFinite(Number(baseHoursPerDay)) ? Number(baseHoursPerDay) : 8);

      // Enriquecer días
      const days = (calcFilled.days || []).map(d => {
        const worked = Number(d?.worked) || 0;
        const overtime = Number(d?.overtime) || 0;

        const workedDisplay = worked === 0 ? 'DESCANSO' : decToHHMM(worked);
        const overtimeDisplay = worked === 0 ? 'DESCANSO' : decToHHMM(overtime);
        const owedDay = worked < base ? (base - worked) : 0; // domingo incluido
        const owedDisplay = decToHHMM(owedDay);

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

      // ---- Resumen semanal *recortado al rango* y con regla diaria en semanas parciales
      const weeksMap = new Map();
      for (const d of days) {
        const wk = mondayOf(d.date);
        if (!weeksMap.has(wk)) weeksMap.set(wk, []);
        weeksMap.get(wk).push(d);
      }
      const weekStarts = Array.from(weeksMap.keys()).sort();

      const WEEK_TARGET = 48;
      const weekly = [];
      let totalOvertimeDec = 0;
      let totalOwedDec = 0;

      for (const weekStart of weekStarts) {
        const arr = weeksMap.get(weekStart).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

        // Semana “canónica”
        const canonicalStart = weekStart;
        const canonicalEnd = addDays(weekStart, 6);

        // Recortar al rango
        const clipStart = maxDate(canonicalStart, from);
        const clipEnd = minDate(canonicalEnd, to);

        // Suma trabajada (sólo días presentes)
        const workedSum = arr.reduce((acc, x) => acc + (Number(x.worked) || 0), 0);

        // ¿La semana está completamente dentro del rango?
        const isFullInsideRange = (clipStart === canonicalStart) && (clipEnd === canonicalEnd);

        let extraWeek = 0;
        let owedWeek = 0;

        if (isFullInsideRange) {
          // Semana completa -> 48h
          extraWeek = Math.max(0, workedSum - WEEK_TARGET);
          owedWeek = Math.max(0, WEEK_TARGET - workedSum);
        } else {
          // Semana parcial (inicio o fin) -> regla diaria con excepción del domingo
          // 1) Detectar si existe OTRO día de descanso en la semana parcial
          let hasOtherRest = false;
          {
            let cur = clipStart;
            while (cur <= clipEnd) {
              const d = arr.find(x => x.date === cur);
              const w = d ? Number(d.worked) || 0 : 0;
              const dow = dayjs(cur).day(); // 0=Domingo
              if (dow !== 0 && w === 0) { // descanso distinto de domingo
                hasOtherRest = true;
                break;
              }
              cur = addDays(cur, 1);
            }
          }

          // 2) Calcular extra/owed día a día considerando la excepción
          let cur = clipStart;
          let workedSumDisplay = 0; // para mostrar "Trabajadas" coherente en semana parcial
          while (cur <= clipEnd) {
            const d = arr.find(x => x.date === cur);
            const w = d ? Number(d.worked) || 0 : 0;
            const dow = dayjs(cur).day(); // 0=Domingo

            if (dow === 0 && w > 0 && hasOtherRest) {
              // Excepción: domingo trabajado pasa a considerarse DESCANSO
              // (no suma extra, suma a deber base, y no suma a trabajadas de la semana)
              owedWeek += Math.max(0, base - 0); // = base
              // workedSumDisplay no suma nada
            } else {
              // Regla diaria normal
              extraWeek += Math.max(0, w - base);
              owedWeek += Math.max(0, base - w);
              workedSumDisplay += w;
            }

            cur = addDays(cur, 1);
          }

          // Sobrescribe workedDec para semanas parciales con el display calculado
          workedSumForPartial = workedSumDisplay;
        }


        weekly.push({
          // Etiquetas recortadas
          weekStart: clipStart,
          weekEnd: clipEnd,
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
    if (!from || !to) {
      return res.status(400).json({ ok: false, error: 'Faltan from/to (YYYY-MM-DD)' });
    }

    const all = await listEmployees();
    const selected = (employeeIds?.length ? all.filter(e => employeeIds.includes(e.id)) : all);

    const blocks = [];
    for (const emp of selected) {
      const raw = await listByEmployee(emp.id, from, to);
      const sessions = normalizeSessions(raw);

      // ⬅️ PASAR RANGO
      const calcBase = computeFromSessions(sessions, {
        baseHoursPerDay,
        lunchMinutesDefault,
        rangeStart: from,
        rangeEnd: to,
      });

      const calc = fillMissingDays(calcBase, from, to);
      blocks.push({ employee: emp, calc });
    }

    const wb = await buildWorkbook(blocks);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="horas_overtime.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
}

module.exports = { preview, excel };
