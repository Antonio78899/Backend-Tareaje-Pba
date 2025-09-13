// src/services/overtime.service.js
const dayjs = require('dayjs');

const BASE_HOURS = Number(process.env.BASE_HOURS_PER_DAY || 8);
const DEFAULT_LUNCH = Number(process.env.DEFAULT_LUNCH_MINUTES || 60);

const safeNum = (x, def = 0) => Number.isFinite(Number(x)) ? Number(x) : def;

// Normaliza "H:mm" / "HH:m" → "HH:mm" y valida rango
function normalizeTime(t) {
  if (!t) return null;
  const m = String(t).trim().match(/^(\d{1,2}):(\d{1,2})$/);
  if (!m) return null;
  let [ , h, mi ] = m;
  h = h.padStart(2, '0'); mi = mi.padStart(2, '0');
  const H = Number(h), M = Number(mi);
  if (H < 0 || H > 23 || M < 0 || M > 59) return null;
  return `${h}:${mi}`;
}

const dt = (ymd, hhmm) => dayjs(`${ymd}T${hhmm}`);
const diffHours = (a, b) => {
  const mins = b.diff(a, 'minute');
  return Number.isFinite(mins) && mins > 0 ? mins / 60 : 0;
};

function computeFromSessions(sessions, opts = {}) {
  const base = safeNum(opts.baseHoursPerDay, BASE_HOURS);
  const lunchDef = safeNum(opts.lunchMinutesDefault, DEFAULT_LUNCH);
  const byDate = new Map(); // clave: 'YYYY-MM-DD'

  for (const s of (sessions || [])) {
    const ymd = s?.workDate ? dayjs(s.workDate).format('YYYY-MM-DD') : null;
    if (!ymd) continue;

    const st = normalizeTime(s.startTime);
    const et = normalizeTime(s.endTime);
    if (!st || !et) continue; // ignora filas mal formateadas

    let start = dt(ymd, st);
    let end   = dt(ymd, et);
    if (!end.isAfter(start)) end = end.add(1, 'day'); // cruza medianoche

    let worked = diffHours(start, end);
    const lunchMin = s.hadLunch ? safeNum(s.lunchMinutes, lunchDef) : 0;
    worked = Math.max(0, worked - lunchMin / 60);

    byDate.set(ymd, (byDate.get(ymd) || 0) + worked);
  }

  const days = [];
  let totalOvertime = 0;

  [...byDate.entries()].sort(([a],[b]) => a < b ? -1 : 1)
    .forEach(([ymd, w]) => {
      const worked = safeNum(w, 0);
      const overtime = Math.max(0, worked - base);
      totalOvertime += overtime;
      days.push({ date: ymd, worked: Number(worked.toFixed(2)), overtime: Number(overtime.toFixed(2)) });
    });

  return {
    days,
    totalOvertime: Number(safeNum(totalOvertime, 0).toFixed(2)),
    baseHoursPerDay: base
  };
}

module.exports = { computeFromSessions };
