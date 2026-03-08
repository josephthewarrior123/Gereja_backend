const express = require('express');
const groupController = require('../controllers/groupController');
const authMiddleware = require('../middlewares/authMiddleware');
const { requireRole } = require('../middlewares/roleMiddleware');

const router = express.Router();

router.get('/groups', authMiddleware, (req, res) => groupController.listGroups(req, res));
router.post('/groups', authMiddleware, requireRole('super_admin', 'admin'), (req, res) =>
  groupController.createGroup(req, res)
);

module.exports = router;
