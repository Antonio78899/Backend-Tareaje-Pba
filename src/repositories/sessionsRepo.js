// src/repositories/sessions.repo.js
const pool = require('../config/db');

const mapRow = (r) => ({
  id: r.id,
  employeeId: r.employee_id,
  workDate: r.work_date,      // viene como 'YYYY-MM-DD' (tipo DATE en pg)
  startTime: r.start_time,    // 'HH:mm'
  endTime: r.end_time,        // 'HH:mm'
  hadLunch: r.had_lunch,
  lunchMinutes: r.lunch_minutes
});

async function createSession({ employeeId, workDate, startTime, endTime, hadLunch = true, lunchMinutes = null }) {
  try {
    const { rows } = await pool.query(
      `INSERT INTO work_sessions (employee_id, work_date, start_time, end_time, had_lunch, lunch_minutes)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, employee_id, work_date, start_time, end_time, had_lunch, lunch_minutes`,
      [employeeId, workDate, startTime, endTime, hadLunch, lunchMinutes]
    );
    return mapRow(rows[0]);
  } catch (e) {
    if (e.code === '23505') { // unique_violation
      const err = new Error('Ya existe una jornada para ese empleado en esa fecha.');
      err.status = 409; throw err;
    }
    throw e;
  }
}

async function listByEmployee(employeeId, from, to) {
  const params = [employeeId];
  let where = `WHERE employee_id = $1`;
  if (from && to) { params.push(from, to); where += ` AND work_date BETWEEN $2 AND $3`; }

  const { rows } = await pool.query(
    `SELECT id, employee_id, work_date, start_time, end_time, had_lunch, lunch_minutes
     FROM work_sessions
     ${where}
     ORDER BY work_date ASC, start_time ASC`,
    params
  );
  return rows.map(mapRow);
}

module.exports = { createSession, listByEmployee };
