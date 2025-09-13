const pool = require('../config/db');

async function crearTablaUsuarios() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      dni VARCHAR(20) UNIQUE NOT NULL, 
      nombre VARCHAR(100) NOT NULL,
      password VARCHAR(255) NOT NULL,
      estado BOOLEAN DEFAULT TRUE,
      ultimo_login TIMESTAMP,
      rendimiento INT DEFAULT 0,
      cargo VARCHAR(100),
      creado TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_usuarios_dni ON usuarios(dni);
  `);
}

const crearUsuario = async ({ dni, nombre, password, cargo }) => {
  const r = await pool.query(
    `INSERT INTO usuarios (dni, nombre, password, cargo)
     VALUES ($1,$2,$3,$4)
     RETURNING id, dni, nombre, estado, creado`,
    [dni, nombre, password, cargo]
  );
  return r.rows[0];
};

const buscarUsuarioPorDni = async (dni) => {
  const r = await pool.query(
    `SELECT * FROM usuarios WHERE dni = $1 AND estado = TRUE`,
    [dni]
  );
  return r.rows[0];
};

const setUltimoLogin = async (id) => {
  await pool.query(`UPDATE usuarios SET ultimo_login = NOW() WHERE id = $1`, [id]);
};

const actualizarPasswordPorDni = async (dni, newPasswordHash) => {
  await pool.query(
    `UPDATE usuarios SET password = $1 WHERE dni = $2 AND estado = TRUE`,
    [newPasswordHash, dni]
  );
};

module.exports = {
  crearTablaUsuarios,
  crearUsuario,
  buscarUsuarioPorDni,
  setUltimoLogin,
  actualizarPasswordPorDni,
};
