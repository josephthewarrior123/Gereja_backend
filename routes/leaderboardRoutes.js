const express = require('express');
const leaderboardController = require('../controllers/leaderboardController');
const authMiddleware = require('../middlewares/authMiddleware');

const router = express.Router();

// ── All-time ──────────────────────────────────────────────────────────────────
router.get('/leaderboard',
    authMiddleware,
    (req, res) => leaderboardController.getGlobalLeaderboard(req, res)
);

// Monthly GLOBAL — harus didaftarkan SEBELUM /:group agar 'monthly'
// tidak ditangkap sebagai nilai group param.
router.get('/leaderboard/monthly',
    authMiddleware,
    (req, res) => leaderboardController.getMonthlyGlobalLeaderboard(req, res)
);

// All-time per group + top3
router.get('/leaderboard/:group/top3',
    authMiddleware,
    (req, res) => leaderboardController.getGroupTop3(req, res)
);

// Monthly per group — diletakkan sebelum /:group agar 'monthly' tidak conflict
router.get('/leaderboard/:group/monthly',
    authMiddleware,
    (req, res) => leaderboardController.getMonthlyGroupLeaderboard(req, res)
);

router.get('/leaderboard/:group',
    authMiddleware,
    (req, res) => leaderboardController.getGroupLeaderboard(req, res)
);

module.exports = router;