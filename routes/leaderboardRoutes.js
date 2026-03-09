const express = require('express');
const leaderboardController = require('../controllers/leaderboardController');
const authMiddleware = require('../middlewares/authMiddleware');

const router = express.Router();

router.get('/leaderboard', authMiddleware, (req, res) => leaderboardController.getGlobalLeaderboard(req, res));
router.get('/leaderboard/:group', authMiddleware, (req, res) => leaderboardController.getGroupLeaderboard(req, res));

module.exports = router;
