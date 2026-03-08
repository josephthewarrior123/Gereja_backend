const { auth, db } = require('../config/firebase');
const { hasIntersection, normalizeGroups } = require('../middlewares/authorization');
const { validateActivityFieldsConfig } = require('../utils/validators');
const groupDAO = require('../dao/groupDAO');

class AdminController {
  async upsertUser(req, res) {
    try {
      const { uid, email, name, phone_number, groups = [], role = 'user', is_active = true } = req.body;
      if (!uid && !email) {
        return res.status(400).json({ success: false, error: 'uid or email is required' });
      }
      if (!['user'].includes(role)) {
        return res.status(400).json({ success: false, error: 'admin can only assign user role' });
      }

      let userRecord;
      if (uid) {
        userRecord = await auth.getUser(uid);
      } else {
        userRecord = await auth.getUserByEmail(email);
      }

      const targetUid = userRecord.uid;
      const cleanGroups = normalizeGroups(groups);
      if (!hasIntersection(cleanGroups, req.user.managed_groups)) {
        return res.status(403).json({ success: false, error: 'No permission for selected groups' });
      }

      const now = new Date().toISOString();
      await db.collection('users').doc(targetUid).set(
        {
          name: name || userRecord.displayName || '',
          email: userRecord.email || email || '',
          phone_number: phone_number || userRecord.phoneNumber || '',
          role: 'user',
          groups: cleanGroups,
          managed_groups: [],
          is_active,
          updated_at: now,
          created_at: now,
        },
        { merge: true }
      );

      await auth.setCustomUserClaims(targetUid, { role: 'user', managed_groups: [] });

      return res.status(200).json({
        success: true,
        message: 'User saved',
        data: { uid: targetUid, groups: cleanGroups, role: 'user' },
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  async createActivity(req, res) {
    try {
      const { name, points, fields = [], groups = [], is_active = true } = req.body;
      if (!name || typeof name !== 'string') {
        return res.status(400).json({ success: false, error: 'name is required' });
      }
      if (typeof points !== 'number' || points < 0) {
        return res.status(400).json({ success: false, error: 'points must be a non-negative number' });
      }

      const fieldsError = validateActivityFieldsConfig(fields);
      if (fieldsError) {
        return res.status(400).json({ success: false, error: fieldsError });
      }

      const cleanGroups = normalizeGroups(groups);
      if (!cleanGroups.length) {
        // ✅ FIX: Pesan error dinamis dari DB, tidak hardcode nama group
        const activeGroups = await groupDAO.getActiveGroupKeys();
        const groupList = activeGroups.length > 0 ? activeGroups.join(', ') : 'belum ada group aktif';
        return res.status(400).json({ success: false, error: `groups harus berisi minimal satu group aktif: ${groupList}` });
      }

      if (!hasIntersection(cleanGroups, req.user.managed_groups)) {
        return res.status(403).json({ success: false, error: 'No permission for selected groups' });
      }

      const now = new Date().toISOString();
      const doc = await db.collection('activities').add({
        name: name.trim(),
        points,
        fields,
        groups: cleanGroups,
        created_by_admin: req.user.uid,
        is_active,
        created_at: now,
        updated_at: now,
      });

      return res.status(201).json({
        success: true,
        message: 'Activity created',
        data: { id: doc.id },
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  async updateActivity(req, res) {
    try {
      const { activityId } = req.params;
      const { name, points, fields, groups, is_active } = req.body;
      const ref = db.collection('activities').doc(activityId);
      const snap = await ref.get();

      if (!snap.exists) {
        return res.status(404).json({ success: false, error: 'Activity not found' });
      }

      const current = snap.data();
      const nextGroups = groups ? normalizeGroups(groups) : current.groups;
      if (!hasIntersection(nextGroups, req.user.managed_groups)) {
        return res.status(403).json({ success: false, error: 'No permission for selected groups' });
      }

      if (fields) {
        const fieldsError = validateActivityFieldsConfig(fields);
        if (fieldsError) {
          return res.status(400).json({ success: false, error: fieldsError });
        }
      }

      const patch = {
        updated_at: new Date().toISOString(),
      };
      if (typeof name === 'string') patch.name = name.trim();
      if (typeof points === 'number' && points >= 0) patch.points = points;
      if (Array.isArray(fields)) patch.fields = fields;
      if (Array.isArray(groups)) patch.groups = nextGroups;
      if (typeof is_active === 'boolean') patch.is_active = is_active;

      await ref.update(patch);
      return res.status(200).json({ success: true, message: 'Activity updated' });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }
}

module.exports = new AdminController();