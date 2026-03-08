const express = require('express');
const groupController = require('../controllers/groupController');
const authMiddleware = require('../middlewares/authMiddleware');
const { requireRole } = require('../middlewares/roleMiddleware');

const router = express.Router();

// Public — siapapun bisa lihat list group (untuk signup page dll)
router.get('/groups', (req, res) =>
  groupController.listGroups(req, res)
);

// Protected — hanya super_admin & admin
router.post('/groups',
  authMiddleware, requireRole('super_admin', 'admin'),
  (req, res) => groupController.createGroup(req, res)
);

router.patch('/groups/:id',
  authMiddleware, requireRole('super_admin', 'admin'),
  (req, res) => groupController.updateGroup(req, res)
);

// Soft delete — toggle isActive
router.patch('/groups/:id/toggle',
  authMiddleware, requireRole('super_admin', 'admin'),
  (req, res) => groupController.toggleActive(req, res)
);

// Hard delete — super_admin & admin
router.delete('/groups/:id',
  authMiddleware, requireRole('super_admin', 'admin'),
  (req, res) => groupController.deleteGroup(req, res)
);

module.exports = router;