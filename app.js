require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const { auth } = require('./src/middlewares/authMiddleware');

const authRoutes      = require('./src/routes/authRoutes');
const employeesRoutes = require('./src/routes/employeesRoutes');
const sessionsRoutes  = require('./src/routes/sessionsRoutes');
const reportsRoutes   = require('./src/routes/reportsRoutes');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));

app.get('/', (_, res) => res.send('Overtime MVC API OK'));

// rutas públicas de autenticación
app.use('/api/auth', authRoutes);

// rutas protegidas (requieren Bearer token)
app.use('/api/employees', auth(), employeesRoutes);
app.use('/api/sessions',  auth(), sessionsRoutes);
app.use('/api/reports',   auth(), reportsRoutes);

module.exports = app;
