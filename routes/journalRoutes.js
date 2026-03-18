const express = require('express');
const controller = require('../controllers/journalController');
const authMiddleware = require('../middlewares/authMiddleware');
const { requireRole } = require('../middlewares/roleMiddleware');

const router = express.Router();

// ── Submit entry sendiri (semua role yang sudah login) ──────────────────────
router.post(
  '/journal/entries',
  authMiddleware,
  requireRole('user', 'gembala', 'admin', 'super_admin'),
  (req, res) => controller.submitEntry(req, res)
);

// ── Bulk award ke banyak user sekaligus ─────────────────────────────────────
// gembala : scope ke managedGroups-nya
// admin   : scope ke managedGroups-nya
// super_admin : bebas
router.post(
  '/journal/bulk-award',
  authMiddleware,
  requireRole('gembala', 'admin', 'super_admin'),
  (req, res) => controller.bulkAward(req, res)
);

// ── Entry milik sendiri + filter ────────────────────────────────────────────
router.get(
  '/journal/my-entries',
  authMiddleware,
  requireRole('user', 'gembala', 'admin', 'super_admin'),
  (req, res) => controller.getMyEntries(req, res)
);

// ── Entry per group (admin / super_admin / gembala) ─────────────────────────
router.get(
  '/journal/groups/:group/entries',
  authMiddleware,
  requireRole('gembala', 'admin', 'super_admin'),
  (req, res) => controller.getGroupEntries(req, res)
);

// ── Monthly Report per group (admin / super_admin / gembala) ─────────────────
router.get(
  '/journal/groups/:group/monthly-report',
  authMiddleware,
  requireRole('gembala', 'admin', 'super_admin'),
  (req, res) => controller.getGroupMonthlyReport(req, res)
);

// ── History lintas group (admin / super_admin / gembala) ────────────────────
router.get(
  '/journal/history',
  authMiddleware,
  requireRole('gembala', 'admin', 'super_admin'),
  (req, res) => controller.getHistory(req, res)
);

module.exports = router;