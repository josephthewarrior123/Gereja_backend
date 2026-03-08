const express = require('express');
const controller = require('../controllers/publicController');
const authMiddleware = require('../middlewares/authMiddleware');

const router = express.Router();

router.use(authMiddleware);

router.get('/me', (req, res) => controller.getMe(req, res));
router.get('/activities', (req, res) => controller.listActivities(req, res));

module.exports = router;