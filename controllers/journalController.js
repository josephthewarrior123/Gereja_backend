const { db, FieldValue } = require('../config/firebase');
const { hasIntersection } = require('../middlewares/authorization');
const { validateEntryDataByConfig } = require('../utils/validators');
const groupDAO = require('../dao/groupDAO');

async function findBibleBook(bookValue) {
  if (!bookValue || typeof bookValue !== 'string') {
    return null;
  }

  const lower = bookValue.trim().toLowerCase();
  const byId = await db.collection('bible_books').doc(lower.replace(/\s+/g, '_')).get();
  if (byId.exists) {
    return byId.data();
  }

  const byName = await db.collection('bible_books').where('name_lc', '==', lower).limit(1).get();
  if (!byName.empty) {
    return byName.docs[0].data();
  }

  return null;
}

class JournalController {
  async submitEntry(req, res) {
    try {
      const { activity_id, data = {}, timestamp } = req.body;
      if (!activity_id || typeof activity_id !== 'string') {
        return res.status(400).json({ success: false, error: 'activity_id is required' });
      }

      const activitySnap = await db.collection('activities').doc(activity_id).get();
      if (!activitySnap.exists) {
        return res.status(404).json({ success: false, error: 'Activity not found' });
      }
      const activity = activitySnap.data();
      if (!activity.is_active) {
        return res.status(400).json({ success: false, error: 'Activity is inactive' });
      }

      const userGroups = req.user.groups || [];
      if (!hasIntersection(userGroups, activity.groups || [])) {
        return res.status(403).json({ success: false, error: 'User not in activity group' });
      }

      const fieldsError = validateEntryDataByConfig(activity.fields || [], data);
      if (fieldsError) {
        return res.status(400).json({ success: false, error: fieldsError });
      }

      if (typeof data.chapter !== 'undefined') {
        if (typeof data.chapter !== 'number' || data.chapter < 1) {
          return res.status(400).json({ success: false, error: 'chapter must be number >= 1' });
        }
        const book = await findBibleBook(data.book);
        if (!book) {
          return res.status(400).json({ success: false, error: 'Invalid Bible book' });
        }
        if (data.chapter > book.total_chapters) {
          return res.status(400).json({
            success: false,
            error: `Invalid chapter. ${book.name} max chapter is ${book.total_chapters}`,
          });
        }
      }

      const entryRef = db.collection('journal_entries').doc();
      const ledgerRef = db.collection('points_ledger').doc();
      const userStatsRef = db.collection('user_stats').doc(req.user.uid);
      const now = new Date().toISOString();
      const entryTimestamp = timestamp || now;

      await db.runTransaction(async (tx) => {
        tx.set(entryRef, {
          id: entryRef.id,
          user_id: req.user.uid,
          user_groups: userGroups,
          activity_id,
          activity_name_snapshot: activity.name,
          data,
          timestamp: entryTimestamp,
          submitted_at: now,
          submitted_by: req.user.uid,
          points_awarded: activity.points,
          status: 'approved',
        });

        tx.set(ledgerRef, {
          id: ledgerRef.id,
          user_id: req.user.uid,
          entry_id: entryRef.id,
          points_delta: activity.points,
          reason: 'activity_submission',
          created_at: now,
        });

        tx.set(
          userStatsRef,
          {
            user_id: req.user.uid,
            total_points: FieldValue.increment(activity.points),
            entry_count: FieldValue.increment(1),
            updated_at: now,
          },
          { merge: true }
        );
      });

      return res.status(201).json({
        success: true,
        message: 'Journal entry submitted',
        data: {
          entry_id: entryRef.id,
          points_awarded: activity.points,
        },
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  async getMyEntries(req, res) {
    try {
      const snap = await db
        .collection('journal_entries')
        .where('user_id', '==', req.user.uid)
        .orderBy('submitted_at', 'desc')
        .limit(100)
        .get();

      return res.status(200).json({
        success: true,
        count: snap.size,
        data: snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  async getGroupEntries(req, res) {
    try {
      const { group } = req.params;

      // ✅ FIX: Validasi group dari DB, tidak hardcode ['ranting', 'pemuda']
      const activeGroupKeys = await groupDAO.getActiveGroupKeys();
      if (!activeGroupKeys.includes(group)) {
        return res.status(400).json({ success: false, error: `Invalid group. Valid groups: ${activeGroupKeys.join(', ')}` });
      }

      if (req.user.role !== 'super_admin' && !(req.user.managedGroups || req.user.managed_groups || []).includes(group)) {
        return res.status(403).json({ success: false, error: 'No access for this group' });
      }

      const snap = await db
        .collection('journal_entries')
        .where('user_groups', 'array-contains', group)
        .orderBy('submitted_at', 'desc')
        .limit(200)
        .get();

      return res.status(200).json({
        success: true,
        count: snap.size,
        data: snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }
}

module.exports = new JournalController();