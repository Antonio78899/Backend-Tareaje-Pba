const authService = require('../services/authServices');

const register = async (req, res) => {
  try {
    const { dni, nombre, password, cargo } = req.body;
    const user = await authService.register({ dni, nombre, password, cargo });
    res.status(201).json(user);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};

const login = async (req, res) => {
  try {
    const { dni, password } = req.body;
    const data = await authService.login({ dni, password });
    res.json(data);
  } catch (e) {
    res.status(401).json({ error: e.message });
  }
};

const changePassword = async (req, res) => {
  try {
    const { dni, password } = req.body; 
    const user = await authService.changePassword({ dni, password }); 
    res.status(200).json(user);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};

module.exports = { changePassword, register, login };
