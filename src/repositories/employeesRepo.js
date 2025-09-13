// src/repositories/employees.repo.js
const pool = require('../config/db');

async function listEmployees() {
  const { rows } = await pool.query(
    `SELECT id, full_name AS "fullName", document
     FROM employees
     ORDER BY full_name ASC`
  );
  return rows;
}

async function createEmployee({ fullName, document, fechaIngreso, fechaNacimiento, cargo}) {
  try {
    const { rows } = await pool.query(
      `INSERT INTO employees (full_name, document, fecha_ingreso, fecha_nacimiento, cargo)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, full_name AS "fullName", document, fecha_ingreso AS "fechaIngreso", fecha_nacimiento AS "fechaNacimiento", cargo`,
      [fullName, document, fechaIngreso, fechaNacimiento, cargo]
    );
    return rows[0];
  } catch (e) {
    throw new Error('Error creating employee');
  }
}

module.exports = { listEmployees, createEmployee };
