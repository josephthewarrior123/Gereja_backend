const { db } = require('../config/firebase');

const COLLECTION = 'activities';

function hasIntersection(a, b) {
  const setB = new Set(b);
  return a.some((x) => setB.has(x));
}

class PublicController {
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
      // Hanya ambil activity yang aktif langsung dari Firestore
      const snap = await db.collection(COLLECTION)
        .where('is_active', '==', true)
        .orderBy('created_at', 'desc')
        .get();

      const all = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

      const activities = all.filter((item) => {
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