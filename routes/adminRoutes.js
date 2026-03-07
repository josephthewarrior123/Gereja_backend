const express = require('express');
const controller = require('../controllers/adminController');
const firebaseAuth = require('../middlewares/firebaseAuth');
const { requireRole, requireAdminManagedGroups } = require('../middlewares/authorization');

const router = express.Router();

router.use(firebaseAuth, requireRole('admin', 'super_admin'));
router.use(requireAdminManagedGroups);

router.post('/admin/users', (req, res) => controller.upsertUser(req, res));
router.post('/admin/activities', (req, res) => controller.createActivity(req, res));
router.patch('/admin/activities/:activityId', (req, res) => controller.updateActivity(req, res));

module.exports = router;
