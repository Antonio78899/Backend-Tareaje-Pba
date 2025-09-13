const { createSession, listByEmployee } = require('../repositories/sessionsRepo');

async function create(req, res) {
  try {
    const { employeeId, workDate, startTime, endTime, hadLunch = true, lunchMinutes = null } = req.body;
    if (!employeeId || !workDate || !startTime || !endTime) {
      return res.status(400).json({ ok:false, error:'Campos incompletos' });
    }
    const row = await createSession({ employeeId, workDate, startTime, endTime, hadLunch, lunchMinutes });
    res.json({ ok:true, data: row });
  } catch (e) {
    const status = e.status || 400;
    res.status(status).json({ ok:false, error: e.message });
  }
}

async function listByEmp(req, res) {
  try {
    const { employeeId } = req.params;
    const { from, to } = req.query;
    const rows = await listByEmployee(Number(employeeId), from, to);
    res.json({ ok:true, data: rows });
  } catch (e) {
    res.status(400).json({ ok:false, error: e.message });
  }
}

module.exports = { create, listByEmployee: listByEmp };
