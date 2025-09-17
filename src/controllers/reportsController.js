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
    workDate: toYMD(r.workDate),
    startTime: String(r.startTime || '').trim(),
    endTime:   String(r.endTime   || '').trim(),
    hadLunch:  !!r.hadLunch,
    lunchMinutes: r.lunchMinutes
  }));

// ---- Helpers rango [from,to] ----
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

// ---- Semana (lunes–domingo) ----
const mondayOf = (dateStr) => {
  const d = dayjs(dateStr);
  const dow = d.day(); // 0=Dom,1=Lun,...6=Sab
  const diffToMonday = (dow + 6) % 7;
  return d.subtract(diffToMonday, 'day').format('YYYY-MM-DD');
};

// HH:MM (acepta negativos con '-')
const decToHHMM = (hDec) => {
  if (hDec == null || isNaN(hDec)) return '00:00';
  const sign = hDec < 0 ? '-' : '';
  let abs = Math.abs(hDec);
  const hh = Math.floor(abs);
  let mm = Math.round((abs - hh) * 60);
  if (mm === 60) { mm = 0; abs = hh + 1; }
  return `${sign}${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
};

async function preview(req, res) {
  try {
    const { employeeIds, from, to, baseHoursPerDay, lunchMinutesDefault } = req.body;

    const all = await listEmployees();
    const selected = (employeeIds?.length ? all.filter(e => employeeIds.includes(e.id)) : all);

    const out = [];
    for (const emp of selected) {
      const raw = await listByEmployee(emp.id, from, to);
      const sessions = normalizeSessions(raw);

      // cálculo base
      const calcBase = computeFromSessions(sessions, { baseHoursPerDay, lunchMinutesDefault });
      const calcFilled = fillMissingDays(calcBase, from, to);

      // base diaria (para owed diario informativo)
      const base = Number.isFinite(Number(calcFilled?.baseHoursPerDay))
        ? Number(calcFilled.baseHoursPerDay)
        : (Number.isFinite(Number(baseHoursPerDay)) ? Number(baseHoursPerDay) : 8);

      // enriquecer días + acumular extra diaria
      let sumDailyOT = 0;
      const days = (calcFilled.days || []).map(d => {
        const worked = Number(d?.worked) || 0;
        const overtime = Number(d?.overtime) || 0;

        const workedDisplay   = worked === 0 ? 'DESCANSO' : decToHHMM(worked);
        const overtimeDisplay = worked === 0 ? 'DESCANSO' : decToHHMM(overtime);

        const owedDay = (worked > 0 && worked < base) ? (base - worked) : 0;
        const owedDisplay = worked === 0 ? 'DESCANSO' : decToHHMM(owedDay);

        sumDailyOT += overtime;

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

      // ---- Resumen semanal con BONO +8h si NO hay descansos ----
      const weeksMap = new Map();
      for (const d of days) {
        const wk = mondayOf(d.date);
        if (!weeksMap.has(wk)) weeksMap.set(wk, []);
        weeksMap.get(wk).push(d);
      }

      const WEEK_TARGET = 48;
      const weekly = [];
      let totalOvertimeWeeklyDec = 0; // suma de (extra diaria + bono si aplica)
      let totalOwedWeeklyDec = 0;

      for (const [weekStart, arr] of weeksMap.entries()) {
        arr.sort((a,b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

        const workedSum = arr.reduce((acc, x) => acc + (x.worked || 0), 0);
        const overtimeSumDaily = arr.reduce((acc, x) => acc + (x.overtime || 0), 0);

        const hasRest = arr.some(x => (x.worked || 0) === 0);
        const bonusExtra = hasRest ? 0 : 8;                 // <-- REGLA NUEVA
        const overtimeWeek = overtimeSumDaily + bonusExtra; // <-- extra semanal ajustada

        const owedWeek = Math.max(0, WEEK_TARGET - workedSum);

        weekly.push({
          weekStart,
          weekEnd: dayjs(weekStart).add(6,'day').format('YYYY-MM-DD'),
          workedDec: workedSum,
          overtimeDec: overtimeWeek,
          owedDec: owedWeek,
          worked: decToHHMM(workedSum),
          overtime: decToHHMM(overtimeWeek),
          owed: decToHHMM(owedWeek),
          net: decToHHMM(overtimeWeek - owedWeek),
          meta48_hasRest: hasRest ? 'sí' : 'no',           // opcional útil para debug
          meta48_bonusExtra: decToHHMM(bonusExtra),         // opcional
        });

        totalOvertimeWeeklyDec += overtimeWeek;
        totalOwedWeeklyDec += owedWeek;
      }

      const totalNetDec = totalOvertimeWeeklyDec - totalOwedWeeklyDec;

      const calc = {
        ...calcFilled,
        baseHoursPerDay: base,
        days,
        weekly,
        totals: {
          totalOvertimeDec: totalOvertimeWeeklyDec,
          totalOwedDec: totalOwedWeeklyDec,
          totalNetDec,
          totalOvertime: decToHHMM(totalOvertimeWeeklyDec),
          totalOwed: decToHHMM(totalOwedWeeklyDec),
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
