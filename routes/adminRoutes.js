const express = require('express');
const controller = require('../controllers/adminController');
const authMiddleware = require('../middlewares/authMiddleware');
const { requireRole } = require('../middlewares/roleMiddleware');

const router = express.Router();

// ── Users ─────────────────────────────────────────────────────────────────────
// gembala boleh lihat list user di managedGroups-nya (untuk bulk award)
router.get('/admin/users',
    authMiddleware,
    requireRole('admin', 'super_admin', 'gembala'),
    (req, res) => controller.listUsers(req, res)
);

router.get('/admin/users/:username/stats',
    authMiddleware,
    requireRole('admin', 'super_admin', 'gembala'),
    (req, res) => controller.getUserStats(req, res)
);

// create & delete hanya admin & super_admin
router.post('/admin/users',
    authMiddleware,
    requireRole('admin', 'super_admin'),
    (req, res) => controller.upsertUser(req, res)
);

router.patch('/admin/users/:username/password',
    authMiddleware,
    requireRole('admin', 'super_admin'),
    (req, res) => controller.resetUserPassword(req, res)
);

router.delete('/admin/users/:username',
    authMiddleware,
    requireRole('admin', 'super_admin'),
    (req, res) => controller.deleteUser(req, res)
);

// ── Activities ────────────────────────────────────────────────────────────────
// gembala boleh lihat list activity di managedGroups-nya
router.get('/admin/activities',
    authMiddleware,
    requireRole('admin', 'super_admin', 'gembala'),
    (req, res) => controller.listAdminActivities(req, res)
);

// create, update & delete bisa dilakukan admin, super_admin, dan gembala
router.post('/admin/activities',
    authMiddleware,
    requireRole('admin', 'super_admin', 'gembala'),
    (req, res) => controller.createActivity(req, res)
);

router.patch('/admin/activities/:activityId',
    authMiddleware,
    requireRole('admin', 'super_admin', 'gembala'),
    (req, res) => controller.updateActivity(req, res)
);

router.delete('/admin/activities/:activityId',
    authMiddleware,
    requireRole('admin', 'super_admin', 'gembala'),
    (req, res) => controller.deleteActivity(req, res)
);

module.exports = router;