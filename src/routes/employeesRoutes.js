const router = require('express').Router();
const ctl = require('../controllers/employeesController');
router.get('/', ctl.list);
router.post('/', ctl.create);
module.exports = router;
