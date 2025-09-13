const repo = require('../repositories/employeesRepo');

async function list(_, res) {
  try {
    const data = await repo.listEmployees();
    res.json({ ok: true, data });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
}

async function create(req, res) {
  try {
    const { fullName, document, fechaIngreso, fechaNacimiento, cargo } = req.body;
    const emp = await repo.createEmployee({ fullName, document, fechaIngreso, fechaNacimiento, cargo });
    res.json({ ok: true, data: emp });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
}

module.exports = { list, create };
