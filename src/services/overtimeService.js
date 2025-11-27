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

  const rangeStart = opts.rangeStart ? ymd(opts.rangeStart) : null;
  const rangeEnd   = opts.rangeEnd   ? ymd(opts.rangeEnd)   : null;

  if (!rangeStart || !rangeEnd || dayjs(rangeEnd).isBefore(dayjs(rangeStart))) {
    throw new Error('computeFromSessions: rango inválido. Provee { rangeStart, rangeEnd } (YYYY-MM-DD).');
  }

  // 🔹 Ahora guardamos por día: horas trabajadas + primera entrada + última salida
  const byDate = new Map(); // 'YYYY-MM-DD' -> { worked, firstStart, lastEnd }

  for (const s of (sessions || [])) {
    const ymdStr = s?.workDate ? dayjs(s.workDate).format('YYYY-MM-DD') : null;
    if (!ymdStr) continue;

    if (ymdStr < rangeStart || ymdStr > rangeEnd) continue;

    const st = normalizeTime(s.startTime);
    const et = normalizeTime(s.endTime);
    if (!st || !et) continue;

    let start = dt(ymdStr, st);
    let end   = dt(ymdStr, et);
    if (!end.isAfter(start)) end = end.add(1, 'day'); // cruza medianoche

    let worked = diffHours(start, end);
    const lunchMin = s.hadLunch ? safeNum(s.lunchMinutes, lunchDef) : 0;
    worked = Math.max(0, worked - lunchMin / 60);

    const prev = byDate.get(ymdStr) || {
      worked: 0,
      firstStart: null,
      lastEnd: null,
    };

    prev.worked += worked;

    // primera hora de entrada del día
    if (!prev.firstStart || start.isBefore(prev.firstStart)) {
      prev.firstStart = start;
    }
    // última hora de salida del día
    if (!prev.lastEnd || end.isAfter(prev.lastEnd)) {
      prev.lastEnd = end;
    }

    byDate.set(ymdStr, prev);
  }

  // 🔹 Rellenar todos los días del rango (y añadir startTime/endTime cuando existan)
  const days = [];
  let cursor = rangeStart;
  while (cursor <= rangeEnd) {
    const rec = byDate.get(cursor);
    const workedRaw = rec ? rec.worked : 0;
    const worked = Number(workedRaw.toFixed(2));
    const overtime = Number(Math.max(0, worked - base).toFixed(2));

    days.push({
      date: cursor,
      worked,
      overtime,
      // estas dos claves son las que luego usará excelService
      startTime: rec?.firstStart ? rec.firstStart.format('HH:mm') : null,
      endTime:   rec?.lastEnd   ? rec.lastEnd.format('HH:mm')   : null,
    });

    cursor = addDays(cursor, 1);
  }

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
