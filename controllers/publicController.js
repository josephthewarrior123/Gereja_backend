const { db } = require('../config/firebase');

function hasIntersection(a, b) {
  const setB = new Set(b);
  return a.some((x) => setB.has(x));
}

class PublicController {
  constructor() {
    this.activitiesRef = db.ref('activities');
  }

  async getMe(req, res) {
    return res.status(200).json({
      success: true,
      data: {
        username: req.user.username,
        role: req.user.role,
        groups: req.user.groups,
        managedGroups: req.user.managedGroups,
      },
    });
  }

  async listActivities(req, res) {
    try {
      const snap = await this.activitiesRef.once('value');
      const data = snap.val() || {};

      const all = Object.entries(data).map(([id, val]) => ({ id, ...val }));

      const activities = all.filter((item) => {
        // filter inactive
        if (!item.is_active) return false;
        if (req.user.role === 'super_admin') return true;
        if (req.user.role === 'admin') {
          return hasIntersection(item.groups || [], req.user.managedGroups || []);
        }
        // user: hanya activity yang overlap dengan groups user
        return hasIntersection(item.groups || [], req.user.groups || []);
      });

      return res.status(200).json({
        success: true,
        count: activities.length,
        data: activities,
      });
    } catch (error) {
      console.error('[listActivities]', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }
}

module.exports = new PublicController();