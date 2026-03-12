const leaderboardDAO = require('../dao/leaderboardDAO');
const groupDAO = require('../dao/groupDAO');

class LeaderboardController {
    async getGlobalLeaderboard(req, res) {
        try {
            const { limit: limitRaw } = req.query;
            const limit = parseInt(limitRaw, 10) > 0 ? parseInt(limitRaw, 10) : 100;

            const leaderboard = await leaderboardDAO.getGlobalLeaderboard(limit);

            return res.status(200).json({
                success: true,
                count: leaderboard.length,
                data: leaderboard
            });
        } catch (error) {
            console.error('[getGlobalLeaderboard]', error);
            return res.status(500).json({ success: false, error: error.message });
        }
    }

    async getGroupTop3(req, res) {
        try {
            const { group } = req.params;

            // Validate group
            const activeGroupKeys = await groupDAO.getActiveGroupKeys();
            if (!activeGroupKeys.includes(group)) {
                return res.status(404).json({ success: false, error: `Group '${group}' tidak valid atau tidak ditemukan` });
            }

            // Check access
            const userGroups = req.user.groups || [];
            const managedGroups = req.user.managedGroups || [];
            const isSuperAdmin = req.user.role === 'super_admin';
            const hasAccess = isSuperAdmin || userGroups.includes(group) || managedGroups.includes(group);

            if (!hasAccess) {
                return res.status(403).json({ success: false, error: 'Kamu tidak memiliki akses ke leaderboard grup ini' });
            }

            const top3 = await leaderboardDAO.getGroupTop3(group);

            return res.status(200).json({
                success: true,
                group,
                count: top3.length,
                data: top3
            });
        } catch (error) {
            console.error('[getGroupTop3]', error);
            return res.status(500).json({ success: false, error: error.message });
        }
    }

    async getGroupLeaderboard(req, res) {
        try {
            const { group } = req.params;
            const { limit: limitRaw } = req.query;
            const limit = Math.min(parseInt(limitRaw, 10) || 100, 500);

            // Validate group
            const activeGroupKeys = await groupDAO.getActiveGroupKeys();
            if (!activeGroupKeys.includes(group)) {
                return res.status(404).json({ success: false, error: `Group '${group}' tidak valid atau tidak ditemukan` });
            }

            // Check access permission (user must be in the group, or is admin/super_admin managing it)
            const userGroups = req.user.groups || [];
            const managedGroups = req.user.managedGroups || [];
            const isSuperAdmin = req.user.role === 'super_admin';

            const hasAccess = isSuperAdmin || userGroups.includes(group) || managedGroups.includes(group);

            if (!hasAccess) {
                return res.status(403).json({ success: false, error: 'Kamu tidak memiliki akses ke leaderboard grup ini' });
            }

            const leaderboard = await leaderboardDAO.getGroupLeaderboard(group, limit);

            return res.status(200).json({
                success: true,
                group: group,
                count: leaderboard.length,
                data: leaderboard
            });

        } catch (error) {
            console.error('[getGroupLeaderboard]', error);
            return res.status(500).json({ success: false, error: error.message });
        }
    }
}

module.exports = new LeaderboardController();