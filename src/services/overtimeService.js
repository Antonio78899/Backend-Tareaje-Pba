// src/services/overtime.service.js
const dayjs = require('dayjs');

const BASE_HOURS = Number(process.env.BASE_HOURS_PER_DAY || 8);
const DEFAULT_LUNCH = Number(process.env.DEFAULT_LUNCH_MINUTES || 60);

const safeNum = (x, def = 0) => (Number.isFinite(Number(x)) ? Number(x) : def);

// Normaliza "H:mm" / "HH:m" → "HH:mm" y valida rango
function normalizeTime(t) {
  if (!t) return null;
  const m = String(t).trim().match(/^(\d{1,2}):(\d{1,2})$/);
  if (!m) return null;
  let [, h, mi] = m;
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

// utilidades de rango
const ymd = d => dayjs(d).format('YYYY-MM-DD');
const addDays = (dateStr, n) => dayjs(dateStr).add(n, 'day').format('YYYY-MM-DD');

function computeFromSessions(sessions, opts = {}) {
  const base = safeNum(opts.baseHoursPerDay, BASE_HOURS);
  const lunchDef = safeNum(opts.lunchMinutesDefault, DEFAULT_LUNCH);

  // Rango obligatorio para no salirnos (inclusive)
  const rangeStart = opts.rangeStart ? ymd(opts.rangeStart) : null;
  const rangeEnd   = opts.rangeEnd   ? ymd(opts.rangeEnd)   : null;

  if (!rangeStart || !rangeEnd || dayjs(rangeEnd).isBefore(dayjs(rangeStart))) {
    throw new Error('computeFromSessions: rango inválido. Provee { rangeStart, rangeEnd } (YYYY-MM-DD).');
  }

  // Acumular horas trabajadas por día dentro del rango únicamente
  const byDate = new Map(); // clave: 'YYYY-MM-DD' → horas decimales

  for (const s of (sessions || [])) {
    const ymdStr = s?.workDate ? dayjs(s.workDate).format('YYYY-MM-DD') : null;
    if (!ymdStr) continue;

    // Ignorar fuera de rango
    if (ymdStr < rangeStart || ymdStr > rangeEnd) continue;

    const st = normalizeTime(s.startTime);
    const et = normalizeTime(s.endTime);
    if (!st || !et) continue; // ignora filas mal formateadas

    let start = dt(ymdStr, st);
    let end   = dt(ymdStr, et);
    if (!end.isAfter(start)) end = end.add(1, 'day'); // cruza medianoche

    let worked = diffHours(start, end);
    const lunchMin = s.hadLunch ? safeNum(s.lunchMinutes, lunchDef) : 0;
    worked = Math.max(0, worked - lunchMin / 60);

    byDate.set(ymdStr, (byDate.get(ymdStr) || 0) + worked);
  }

  // Rellenar todos los días del rango: 0 h donde no hay sesiones
  const days = [];
  let cursor = rangeStart;
  while (cursor <= rangeEnd) {
    const worked = safeNum(byDate.get(cursor), 0);
    const overtime = Math.max(0, worked - base);
    days.push({
      date: cursor,
      worked: Number(worked.toFixed(2)),
      overtime: Number(overtime.toFixed(2)),
    });
    cursor = addDays(cursor, 1);
  }

  // Total de horas extra (sólo suma extras diarias; el neto semanal se calcula en Excel)
  const totalOvertime = Number(
    days.reduce((acc, d) => acc + safeNum(d.overtime, 0), 0).toFixed(2)
  );

  return {
    days,
    totalOvertime,
    baseHoursPerDay: base,
    rangeStart,
    rangeEnd,
  };
}

module.exports = { computeFromSessions };
