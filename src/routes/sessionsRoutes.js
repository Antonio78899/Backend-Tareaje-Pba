const router = require('express').Router();
const ctl = require('../controllers/sessionsController');

router.post('/', ctl.create);                         // registrar jornada
router.get('/:employeeId', ctl.listByEmployee);       // listar por empleado (opcional ?from=YYYY-MM-DD&to=YYYY-MM-DD)

module.exports = router;