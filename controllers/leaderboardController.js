const leaderboardDAO = require('../dao/leaderboardDAO');
const groupDAO = require('../dao/groupDAO');

class LeaderboardController {

    // ─────────────────────────────────────────────────────────────────────────
    // GET /leaderboard — all-time global
    // ─────────────────────────────────────────────────────────────────────────
    async getGlobalLeaderboard(req, res) {
        try {
            const { limit: limitRaw } = req.query;
            const limit = parseInt(limitRaw, 10) > 0 ? parseInt(limitRaw, 10) : 100;
            const leaderboard = await leaderboardDAO.getGlobalLeaderboard(limit);
            return res.status(200).json({ success: true, count: leaderboard.length, data: leaderboard });
        } catch (error) {
            console.error('[getGlobalLeaderboard]', error);
            return res.status(500).json({ success: false, error: error.message });
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GET /leaderboard/:group/top3 — all-time top 3 per group
    // ─────────────────────────────────────────────────────────────────────────
    async getGroupTop3(req, res) {
        try {
            const { group } = req.params;
            const activeGroupKeys = await groupDAO.getActiveGroupKeys();
            if (!activeGroupKeys.includes(group)) {
                return res.status(404).json({ success: false, error: `Group '${group}' tidak valid atau tidak ditemukan` });
            }
            const userGroups = req.user.groups || [];
            const managedGroups = req.user.managedGroups || [];
            const isSuperAdmin = req.user.role === 'super_admin';
            const hasAccess = isSuperAdmin || userGroups.includes(group) || managedGroups.includes(group);
            if (!hasAccess) {
                return res.status(403).json({ success: false, error: 'Kamu tidak memiliki akses ke leaderboard grup ini' });
            }
            const top3 = await leaderboardDAO.getGroupTop3(group);
            return res.status(200).json({ success: true, group, count: top3.length, data: top3 });
        } catch (error) {
            console.error('[getGroupTop3]', error);
            return res.status(500).json({ success: false, error: error.message });
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GET /leaderboard/:group — all-time per group
    // ─────────────────────────────────────────────────────────────────────────
    async getGroupLeaderboard(req, res) {
        try {
            const { group } = req.params;
            const { limit: limitRaw } = req.query;
            const limit = Math.min(parseInt(limitRaw, 10) || 100, 500);

            const activeGroupKeys = await groupDAO.getActiveGroupKeys();
            if (!activeGroupKeys.includes(group)) {
                return res.status(404).json({ success: false, error: `Group '${group}' tidak valid atau tidak ditemukan` });
            }
            const userGroups = req.user.groups || [];
            const managedGroups = req.user.managedGroups || [];
            const isSuperAdmin = req.user.role === 'super_admin';
            const hasAccess = isSuperAdmin || userGroups.includes(group) || managedGroups.includes(group);
            if (!hasAccess) {
                return res.status(403).json({ success: false, error: 'Kamu tidak memiliki akses ke leaderboard grup ini' });
            }
            const leaderboard = await leaderboardDAO.getGroupLeaderboard(group, limit);
            return res.status(200).json({ success: true, group, count: leaderboard.length, data: leaderboard });
        } catch (error) {
            console.error('[getGroupLeaderboard]', error);
            return res.status(500).json({ success: false, error: error.message });
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GET /leaderboard/monthly?year=2026&month=3
    // Leaderboard global bulan tertentu. Default: bulan berjalan (WIB).
    // ─────────────────────────────────────────────────────────────────────────
    async getMonthlyGlobalLeaderboard(req, res) {
        try {
            const nowWIB = new Date(Date.now() + 7 * 60 * 60 * 1000);
            const year = parseInt(req.query.year, 10) || nowWIB.getUTCFullYear();
            const month = parseInt(req.query.month, 10) || (nowWIB.getUTCMonth() + 1);
            const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);

            if (month < 1 || month > 12) {
                return res.status(400).json({ success: false, error: 'month harus antara 1–12' });
            }
            const data = await leaderboardDAO.getMonthlyGlobalLeaderboard(year, month, limit);
            return res.status(200).json({ success: true, year, month, count: data.length, data });
        } catch (error) {
            console.error('[getMonthlyGlobalLeaderboard]', error);
            return res.status(500).json({ success: false, error: error.message });
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GET /leaderboard/:group/monthly?year=2026&month=3
    // Leaderboard group bulan tertentu. Default: bulan berjalan (WIB).
    // ─────────────────────────────────────────────────────────────────────────
    async getMonthlyGroupLeaderboard(req, res) {
        try {
            const { group } = req.params;
            const nowWIB = new Date(Date.now() + 7 * 60 * 60 * 1000);
            const year = parseInt(req.query.year, 10) || nowWIB.getUTCFullYear();
            const month = parseInt(req.query.month, 10) || (nowWIB.getUTCMonth() + 1);
            const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);

            if (month < 1 || month > 12) {
                return res.status(400).json({ success: false, error: 'month harus antara 1–12' });
            }
            const activeGroupKeys = await groupDAO.getActiveGroupKeys();
            if (!activeGroupKeys.includes(group)) {
                return res.status(404).json({ success: false, error: `Group '${group}' tidak valid` });
            }
            const userGroups = req.user.groups || [];
            const managedGroups = req.user.managedGroups || [];
            const isSuperAdmin = req.user.role === 'super_admin';
            const hasAccess = isSuperAdmin || userGroups.includes(group) || managedGroups.includes(group);
            if (!hasAccess) {
                return res.status(403).json({ success: false, error: 'Kamu tidak memiliki akses ke leaderboard grup ini' });
            }
            const data = await leaderboardDAO.getMonthlyGroupLeaderboard(group, year, month, limit);
            return res.status(200).json({ success: true, group, year, month, count: data.length, data });
        } catch (error) {
            console.error('[getMonthlyGroupLeaderboard]', error);
            return res.status(500).json({ success: false, error: error.message });
        }
    }
}

module.exports = new LeaderboardController();