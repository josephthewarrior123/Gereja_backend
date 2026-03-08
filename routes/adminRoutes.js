const express = require('express');
const controller = require('../controllers/adminController');
const authMiddleware = require('../middlewares/authMiddleware');
const { requireRole } = require('../middlewares/roleMiddleware');

const router = express.Router();

// Semua admin routes pakai JWT auth (sama seperti userRoutes)
router.use(authMiddleware, requireRole('admin', 'super_admin'));

router.post('/admin/users', (req, res) => controller.upsertUser(req, res));
router.post('/admin/activities', (req, res) => controller.createActivity(req, res));
router.patch('/admin/activities/:activityId', (req, res) => controller.updateActivity(req, res));

module.exports = router;