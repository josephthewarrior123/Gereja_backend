const express = require('express');
const userController = require('../controllers/userController');
const groupController = require('../controllers/groupController');
const authMiddleware = require('../middlewares/authMiddleware');
const { requireRole } = require('../middlewares/roleMiddleware');

const router = express.Router();

router.post('/users/setup-super-admin', (req, res) => userController.setupSuperAdmin(req, res));
router.post('/users/signup', (req, res) => userController.signUp(req, res));
router.post('/users/login', (req, res) => userController.login(req, res));
router.get('/groups', authMiddleware, (req, res) => groupController.listGroups(req, res));
router.post('/groups', authMiddleware, requireRole('super_admin', 'admin'), (req, res) =>
  groupController.createGroup(req, res)
);

router.get('/users/profile', authMiddleware, (req, res) => userController.getProfile(req, res));
router.get('/users', authMiddleware, requireRole('super_admin', 'admin'), (req, res) =>
  userController.getAllUsers(req, res)
);
router.put('/users/:username/role', authMiddleware, requireRole('super_admin', 'admin'), (req, res) =>
  userController.setUserRole(req, res)
);

module.exports = router;
