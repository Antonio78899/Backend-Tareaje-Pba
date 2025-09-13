// src/db/schema.js
const pool = require('../config/db');

async function ensureSchema() {
  // empleados
  await pool.query(`
    CREATE TABLE IF NOT EXISTS employees (
      id SERIAL PRIMARY KEY,
      full_name VARCHAR(120) NOT NULL UNIQUE,
      document  VARCHAR(32) NOT NULL UNIQUE,
      fecha_ingreso DATE NOT NULL,
      fecha_nacimiento DATE,
      cargo     VARCHAR(64) NOT NULL,
      regimen   VARCHAR(64)
    );
  `);

  // jornadas (work_sessions) con UNIQUE (employee_id, work_date)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS work_sessions (
      id SERIAL PRIMARY KEY,
      employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      work_date DATE NOT NULL,
      start_time VARCHAR(5) NOT NULL, -- 'HH:mm'
      end_time   VARCHAR(5) NOT NULL, -- 'HH:mm'
      had_lunch  BOOLEAN DEFAULT TRUE,
      lunch_minutes INT,
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now(),
      CONSTRAINT uniq_employee_date UNIQUE (employee_id, work_date)
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_sessions_emp_date
    ON work_sessions(employee_id, work_date);
  `);
}

module.exports = { ensureSchema };
