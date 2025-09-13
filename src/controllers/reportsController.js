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
    workDate: toYMD(r.workDate),                         // <-- siempre 'YYYY-MM-DD'
    startTime: String(r.startTime || '').trim(),         // <-- 'HH:mm'
    endTime:   String(r.endTime   || '').trim(),
    hadLunch:  !!r.hadLunch,
    lunchMinutes: r.lunchMinutes
  }));

async function preview(req, res) {
  try {
    const { employeeIds, from, to, baseHoursPerDay, lunchMinutesDefault } = req.body;

    const all = await listEmployees();
    const selected = (employeeIds?.length ? all.filter(e => employeeIds.includes(e.id)) : all);

    const out = [];
    for (const emp of selected) {
      const raw = await listByEmployee(emp.id, from, to);
      const sessions = normalizeSessions(raw);
      const calc = computeFromSessions(sessions, { baseHoursPerDay, lunchMinutesDefault });
      out.push({ employee: emp, calc });
    }

    res.json({ ok:true, data: out });
  } catch (e) {
    res.status(400).json({ ok:false, error: e.message });
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
      const calc = computeFromSessions(sessions, { baseHoursPerDay, lunchMinutesDefault });
      blocks.push({ employee: emp, calc });
    }

    const wb = await buildWorkbook(blocks);
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition','attachment; filename="horas_overtime.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    res.status(400).json({ ok:false, error: e.message });
  }
}

module.exports = { preview, excel };
