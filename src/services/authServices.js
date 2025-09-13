const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { crearUsuario, buscarUsuarioPorDni, setUltimoLogin, actualizarPasswordPorDni } = require('../db/usuarioModel');

const JWT_SECRET = process.env.JWT_SECRET || 'cambia-esto';

async function register({ dni, nombre, password, cargo }) {
  if (!dni || !nombre || !password || !cargo) throw new Error('Campos incompletos');
  const existente = await buscarUsuarioPorDni(dni);
  if (existente) throw new Error('Usuario ya existe');
  const hash = await bcrypt.hash(password, 10);
  return await crearUsuario({ dni, nombre, password: hash, cargo });
}

async function login({ dni, password }) {
  const user = await buscarUsuarioPorDni(dni);
  if (!user) throw new Error('Credenciales inválidas');
  const ok = await bcrypt.compare(password, user.password);
  if (!ok) throw new Error('Credenciales inválidas');

  await setUltimoLogin(user.id);

  const token = jwt.sign({ sub: user.id, dni: user.dni }, JWT_SECRET, { expiresIn: '12h' });

  return { token, usuario: { id: user.id, dni: user.dni, nombre: user.nombre } };
}

async function changePassword({ dni, password }) {
  const user = await buscarUsuarioPorDni(dni);
  if (!user) throw new Error('Usuario no encontrado');

  const hash = await bcrypt.hash(password, 10);

  await actualizarPasswordPorDni(dni, hash);

  await setUltimoLogin(user.id);

  const token = jwt.sign({ sub: user.id, dni: user.dni }, JWT_SECRET, { expiresIn: '12h' });

  return { token, usuario: { id: user.id, dni: user.dni, nombre: user.nombre } };
}

module.exports = { changePassword, register, login };
