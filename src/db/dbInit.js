// src/db/initDb.js
const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const { ensureSchema } = require('./schema'); // <— importamos
const { crearTablaUsuarios, buscarUsuarioPorDni, crearUsuario } = require('../db/usuarioModel');

async function seedAdminIfNeeded() {
  const DNI   = process.env.ADMIN_DNI  || '';
  const PASS  = process.env.ADMIN_PASS || '';
  const NAME  = process.env.ADMIN_NAME || 'Administrador';
  const CARGO = process.env.ADMIN_CARGO || 'ADMIN';

  if (!DNI || !PASS) return; // seeding opcional por env

  const existing = await buscarUsuarioPorDni(DNI);
  if (existing) return;

  const hash = await bcrypt.hash(PASS, 10);
  await crearUsuario({ dni: DNI, nombre: NAME, password: hash, cargo: CARGO });
  console.log(`👤 Usuario admin creado: ${DNI}`);
}

async function initDb() {
  // 1) Tablas de dominio (employees, work_sessions, índices)
  await ensureSchema(); // idempotente

  // 2) Tabla de usuarios + seed admin
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await crearTablaUsuarios();     // idempotente
    await seedAdminIfNeeded();      // opcional por ENV
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { initDb };
