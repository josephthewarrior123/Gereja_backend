const express = require('express');
const controller = require('../controllers/publicController');
const firebaseAuth = require('../middlewares/firebaseAuth');

const router = express.Router();

router.use(firebaseAuth);

router.get('/me', (req, res) => controller.getMe(req, res));
router.get('/activities', (req, res) => controller.listActivities(req, res));

module.exports = router;
