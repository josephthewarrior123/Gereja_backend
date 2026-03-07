const express = require('express');
const controller = require('../controllers/superAdminController');
const firebaseAuth = require('../middlewares/firebaseAuth');
const { requireRole } = require('../middlewares/authorization');

const router = express.Router();

// ⚠️  Endpoint ini TIDAK pakai firebaseAuth — diamankan oleh X-Setup-Key header.
// Digunakan untuk bootstrap super_admin pertama kali.
router.post('/super-admin/setup', (req, res) => controller.createSuperAdmin(req, res));

// Semua endpoint di bawah butuh Firebase auth + role super_admin
router.use(firebaseAuth, requireRole('super_admin'));
router.post('/super-admin/admins', (req, res) => controller.createOrPromoteAdmin(req, res));
router.patch('/super-admin/admins/:uid/permissions', (req, res) => controller.setAdminPermissions(req, res));

module.exports = router;