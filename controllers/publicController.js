const { db } = require('../config/firebase');
const { hasIntersection } = require('../middlewares/authorization');

class PublicController {
  async getMe(req, res) {
    return res.status(200).json({
      success: true,
      data: {
        uid: req.user.uid,
        email: req.user.email,
        role: req.user.role,
        groups: req.user.groups,
        managed_groups: req.user.managed_groups,
        profile: req.user.profile,
      },
    });
  }

  async listActivities(req, res) {
    try {
      const snap = await db
        .collection('activities')
        .where('is_active', '==', true)
        .limit(200)
        .get();

      const activities = snap.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .filter((item) => {
          if (req.user.role === 'super_admin') {
            return true;
          }
          if (req.user.role === 'admin') {
            return hasIntersection(item.groups || [], req.user.managed_groups || []);
          }
          return hasIntersection(item.groups || [], req.user.groups || []);
        });

      return res.status(200).json({
        success: true,
        count: activities.length,
        data: activities,
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }
}

module.exports = new PublicController();
