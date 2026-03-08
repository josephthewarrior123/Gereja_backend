const { db } = require('../config/firebase');
const { validateEntryDataByConfig } = require('../utils/validators');
const groupDAO = require('../dao/groupDAO');

function hasIntersection(a, b) {
  const setB = new Set(b);
  return a.some((x) => setB.has(x));
}

class JournalController {
  constructor() {
    this.activitiesRef   = db.ref('activities');
    this.entriesRef      = db.ref('journal_entries');
    this.ledgerRef       = db.ref('points_ledger');
    this.userStatsRef    = db.ref('user_stats');
  }

  async submitEntry(req, res) {
    try {
      const { activity_id, data = {}, timestamp } = req.body;
      if (!activity_id) {
        return res.status(400).json({ success: false, error: 'activity_id is required' });
      }

      // load activity dari Realtime DB
      const actSnap = await this.activitiesRef.child(activity_id).once('value');
      if (!actSnap.exists()) {
        return res.status(404).json({ success: false, error: 'Activity not found' });
      }
      const activity = actSnap.val();
      if (!activity.is_active) {
        return res.status(400).json({ success: false, error: 'Activity is inactive' });
      }

      const userId     = req.user.username;
      const userGroups = req.user.groups || [];

      if (!hasIntersection(userGroups, activity.groups || [])) {
        return res.status(403).json({ success: false, error: 'User not in activity group' });
      }

      const fieldsError = validateEntryDataByConfig(activity.fields || [], data);
      if (fieldsError) {
        return res.status(400).json({ success: false, error: fieldsError });
      }

      const now            = Date.now();
      const entryTimestamp = timestamp || now;
      const entryRef       = this.entriesRef.push();
      const entryId        = entryRef.key;

      const entryData = {
        id: entryId,
        user_id: userId,
        user_groups: userGroups,
        activity_id,
        activity_name_snapshot: activity.name,
        data,
        timestamp: entryTimestamp,
        submitted_at: now,
        submitted_by: userId,
        points_awarded: activity.points,
        status: 'approved',
      };

      // Realtime DB tidak punya transaction lintas node yang atomic seperti Firestore,
      // tapi kita tulis secara sequential — cukup untuk use case ini
      await entryRef.set(entryData);

      // update points ledger
      const ledgerRef = this.ledgerRef.push();
      await ledgerRef.set({
        id: ledgerRef.key,
        user_id: userId,
        entry_id: entryId,
        points_delta: activity.points,
        reason: 'activity_submission',
        created_at: now,
      });

      // update user stats (increment)
      const statsRef = this.userStatsRef.child(userId);
      const statsSnap = await statsRef.once('value');
      const current   = statsSnap.val() || { total_points: 0, entry_count: 0 };
      await statsRef.set({
        user_id: userId,
        total_points: (current.total_points || 0) + activity.points,
        entry_count:  (current.entry_count  || 0) + 1,
        updated_at: now,
      });

      return res.status(201).json({
        success: true,
        message: 'Journal entry submitted',
        data: { entry_id: entryId, points_awarded: activity.points },
      });
    } catch (error) {
      console.error('[submitEntry]', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  async getMyEntries(req, res) {
    try {
      const userId = req.user.username;

      // Realtime DB: query by user_id
      const snap = await this.entriesRef
        .orderByChild('user_id')
        .equalTo(userId)
        .limitToLast(100)
        .once('value');

      const data = snap.val() || {};
      const entries = Object.values(data)
        .sort((a, b) => (b.submitted_at || 0) - (a.submitted_at || 0));

      return res.status(200).json({
        success: true,
        count: entries.length,
        data: entries,
      });
    } catch (error) {
      console.error('[getMyEntries]', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  async getGroupEntries(req, res) {
    try {
      const { group } = req.params;

      const activeGroupKeys = await groupDAO.getActiveGroupKeys();
      if (!activeGroupKeys.includes(group)) {
        return res.status(400).json({
          success: false,
          error: `Invalid group. Valid: ${activeGroupKeys.join(', ')}`,
        });
      }

      const managedGroups = req.user.managedGroups || [];
      if (req.user.role !== 'super_admin' && !managedGroups.includes(group)) {
        return res.status(403).json({ success: false, error: 'No access for this group' });
      }

      // Realtime DB tidak support array-contains,
      // jadi kita fetch semua lalu filter di app layer
      const snap = await this.entriesRef
        .orderByChild('submitted_at')
        .limitToLast(200)
        .once('value');

      const data = snap.val() || {};
      const entries = Object.values(data)
        .filter((e) => Array.isArray(e.user_groups) && e.user_groups.includes(group))
        .sort((a, b) => (b.submitted_at || 0) - (a.submitted_at || 0));

      return res.status(200).json({
        success: true,
        count: entries.length,
        data: entries,
      });
    } catch (error) {
      console.error('[getGroupEntries]', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }
}

module.exports = new JournalController();