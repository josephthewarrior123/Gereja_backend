const express = require('express');
const controller = require('../controllers/journalController');
const authMiddleware = require('../middlewares/authMiddleware');
const { requireRole } = require('../middlewares/roleMiddleware');

const router = express.Router();

// Semua journal routes pakai JWT auth (sama seperti userRoutes)
router.post(
  '/journal/entries',
  authMiddleware,
  requireRole('user', 'admin', 'super_admin'),
  (req, res) => controller.submitEntry(req, res)
);

router.get(
  '/journal/my-entries',
  authMiddleware,
  requireRole('user', 'admin', 'super_admin'),
  (req, res) => controller.getMyEntries(req, res)
);

router.get(
  '/journal/groups/:group/entries',
  authMiddleware,
  requireRole('admin', 'super_admin'),
  (req, res) => controller.getGroupEntries(req, res)
);

module.exports = router;