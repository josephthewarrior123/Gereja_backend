const express = require('express');
const controller = require('../controllers/journalController');
const authMiddleware = require('../middlewares/authMiddleware');
const { requireRole } = require('../middlewares/roleMiddleware');

const router = express.Router();

// Submit entry
router.post(
  '/journal/entries',
  authMiddleware,
  requireRole('user', 'admin', 'super_admin'),
  (req, res) => controller.submitEntry(req, res)
);

// Entry milik sendiri + filter group/activity/date + cursor pagination
// GET /journal/my-entries?group=pemuda&activity_id=xxx&date_from=...&date_to=...&limit=50&cursor=...
router.get(
  '/journal/my-entries',
  authMiddleware,
  requireRole('user', 'admin', 'super_admin'),
  (req, res) => controller.getMyEntries(req, res)
);

// Entry per group (admin/super_admin) + filter user/activity/date + cursor pagination
// GET /journal/groups/:group/entries?user_id=budi&activity_id=xxx&date_from=...&date_to=...&limit=100&cursor=...
router.get(
  '/journal/groups/:group/entries',
  authMiddleware,
  requireRole('admin', 'super_admin'),
  (req, res) => controller.getGroupEntries(req, res)
);

// History semua entry lintas group/user (admin/super_admin)
// GET /journal/history?group=pemuda&user_id=budi&activity_id=xxx&date_from=...&date_to=...&limit=200&cursor=...
// Response include summary: total points, breakdown per user & per activity
router.get(
  '/journal/history',
  authMiddleware,
  requireRole('admin', 'super_admin'),
  (req, res) => controller.getHistory(req, res)
);

module.exports = router;