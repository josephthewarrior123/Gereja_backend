const express = require('express');
const controller = require('../controllers/superAdminController');
const authMiddleware = require('../middlewares/authMiddleware');
const { requireRole } = require('../middlewares/roleMiddleware');

const router = express.Router();

// ── Bootstrap (pakai X-Setup-Key, tidak butuh login) ───────────────────────
router.post('/super-admin/setup', (req, res) => controller.createSuperAdmin(req, res));

// Route di bawah ini butuh JWT Token + role super_admin
router.use(authMiddleware, requireRole('super_admin'));

// ── Admin ────────────────────────────────────────────────────────────────────
router.post('/super-admin/admins', (req, res) => controller.createOrPromoteAdmin(req, res));
router.patch('/super-admin/admins/:uid/permissions', (req, res) => controller.setAdminPermissions(req, res));

// ── Gembala ──────────────────────────────────────────────────────────────────
router.post('/super-admin/gembala', (req, res) => controller.createOrPromoteGembala(req, res));
router.patch('/super-admin/gembala/:uid/permissions', (req, res) => controller.setGembalaPermissions(req, res));

module.exports = router;