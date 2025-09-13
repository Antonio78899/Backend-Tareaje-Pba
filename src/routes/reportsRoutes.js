const router = require('express').Router();
const ctl = require('../controllers/reportsController');

router.post('/preview', ctl.preview); // JSON
router.post('/excel',   ctl.excel);   // archivo .xlsx

module.exports = router;
