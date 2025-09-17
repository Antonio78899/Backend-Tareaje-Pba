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
    workDate: toYMD(r.workDate),     // 'YYYY-MM-DD'
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

// Formatea horas decimales a "HH:MM" (sin límite de 24h). Negativos con prefijo '-'.
const decToHHMM = (hDec) => {
  if (hDec == null || isNaN(hDec)) return '00:00';
  const sign = hDec < 0 ? '-' : '';
  let abs = Math.abs(hDec);
  const hh = Math.floor(abs);
  let mm = Math.round((abs - hh) * 60);
  if (mm === 60) { mm = 0; abs = hh + 1; }
  return `${sign}${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
};
// -----------------------------

async function preview(req, res) {
  try {
    const { employeeIds, from, to, baseHoursPerDay, lunchMinutesDefault } = req.body;

    const all = await listEmployees();
    const selected = (employeeIds?.length ? all.filter(e => employeeIds.includes(e.id)) : all);

    const out = [];
    for (const emp of selected) {
      const raw = await listByEmployee(emp.id, from, to);
      const sessions = normalizeSessions(raw);

      // cálculo base (worked / overtime por día)
      const calcBase = computeFromSessions(sessions, { baseHoursPerDay, lunchMinutesDefault });
      // rellenamos días faltantes del rango
      const calcFilled = fillMissingDays(calcBase, from, to);

      // base diaria (prioriza lo devuelto por compute; luego request; luego 8)
      const base = Number.isFinite(Number(calcFilled?.baseHoursPerDay))
        ? Number(calcFilled.baseHoursPerDay)
        : (Number.isFinite(Number(baseHoursPerDay)) ? Number(baseHoursPerDay) : 8);

      let totalOvertimeDec = 0;
      let totalOwedDec = 0;

      // enriquecemos cada día con displays y horas a deber
      const days = (calcFilled.days || []).map(d => {
        const worked = Number.isFinite(Number(d?.worked)) ? Number(d.worked) : 0;
        const overtime = Number.isFinite(Number(d?.overtime)) ? Number(d.overtime) : 0;

        let workedDisplay, overtimeDisplay, owedDec = 0, owedDisplay;

        if (worked === 0) {
          // Día de descanso: mostrar DESCANSO en las tres filas
          workedDisplay = 'DESCANSO';
          overtimeDisplay = 'DESCANSO';
          owedDisplay = 'DESCANSO';
        } else {
          workedDisplay = decToHHMM(worked);
          overtimeDisplay = decToHHMM(overtime);

          if (worked < base) {
            owedDec = base - worked;
            totalOwedDec += owedDec;
          }
          owedDisplay = decToHHMM(owedDec);

          totalOvertimeDec += overtime;
        }

        return {
          ...d,
          // mantenemos numéricos originales
          worked,
          overtime,
          // agregamos horas a deber numéricas
          owed: owedDec,
          // y versiones para mostrar
          workedDisplay,
          overtimeDisplay,
          owedDisplay,
        };
      });

      const netDec = totalOvertimeDec - totalOwedDec;

      const calc = {
        ...calcFilled,
        baseHoursPerDay: base,
        days,
        totals: {
          totalOvertimeDec,
          totalOwedDec,
          totalNetDec: netDec,
          totalOvertime: decToHHMM(totalOvertimeDec),
          totalOwed: decToHHMM(totalOwedDec),
          totalNet: netDec >= 0 ? decToHHMM(netDec) : decToHHMM(netDec), // ya trae '-'
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
