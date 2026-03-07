const express = require('express');
const controller = require('../controllers/journalController');
const firebaseAuth = require('../middlewares/firebaseAuth');
const { requireRole } = require('../middlewares/authorization');

const router = express.Router();

router.use(firebaseAuth);

router.post('/journal/entries', requireRole('user', 'admin', 'super_admin'), (req, res) =>
  controller.submitEntry(req, res)
);
router.get('/journal/my-entries', requireRole('user', 'admin', 'super_admin'), (req, res) =>
  controller.getMyEntries(req, res)
);
router.get('/journal/groups/:group/entries', requireRole('admin', 'super_admin'), (req, res) =>
  controller.getGroupEntries(req, res)
);

module.exports = router;
