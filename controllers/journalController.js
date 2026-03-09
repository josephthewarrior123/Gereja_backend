const { db } = require('../config/firebase');
const { validateEntryDataByConfig } = require('../utils/validators');
const groupDAO = require('../dao/groupDAO');

const ACTIVITIES   = 'activities';
const ENTRIES      = 'journal_entries';
const LEDGER       = 'points_ledger';
const USER_STATS   = 'user_stats';

function hasIntersection(a, b) {
  const setB = new Set(b);
  return a.some((x) => setB.has(x));
}

function parseLimit(raw, defaultVal = 100, maxVal = 500) {
  const n = parseInt(raw, 10);
  if (isNaN(n) || n <= 0) return defaultVal;
  return Math.min(n, maxVal);
}

class JournalController {

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /journal/entries
  // ─────────────────────────────────────────────────────────────────────────────
  async submitEntry(req, res) {
    try {
      const { activity_id, data = {}, timestamp } = req.body;
      if (!activity_id) {
        return res.status(400).json({ success: false, error: 'activity_id is required' });
      }

      // Load activity dari Firestore
      const actDoc = await db.collection(ACTIVITIES).doc(activity_id).get();
      if (!actDoc.exists) {
        return res.status(404).json({ success: false, error: 'Activity not found' });
      }
      const activity = actDoc.data();
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

      // Pakai Firestore batch supaya entry + ledger + stats atomic
      const entryRef  = db.collection(ENTRIES).doc();
      const ledgerRef = db.collection(LEDGER).doc();
      const statsRef  = db.collection(USER_STATS).doc(userId);

      const entryData = {
        id: entryRef.id,
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

      // Gunakan transaction untuk stats (biar increment aman)
      await db.runTransaction(async (t) => {
        const statsSnap = await t.get(statsRef);
        const current   = statsSnap.exists ? statsSnap.data() : { total_points: 0, entry_count: 0 };

        t.set(entryRef, entryData);
        t.set(ledgerRef, {
          id: ledgerRef.id,
          user_id: userId,
          entry_id: entryRef.id,
          points_delta: activity.points,
          reason: 'activity_submission',
          created_at: now,
        });
        t.set(statsRef, {
          user_id: userId,
          total_points: (current.total_points || 0) + activity.points,
          entry_count:  (current.entry_count  || 0) + 1,
          updated_at: now,
        });
      });

      return res.status(201).json({
        success: true,
        message: 'Journal entry submitted',
        data: { entry_id: entryRef.id, points_awarded: activity.points },
      });
    } catch (error) {
      console.error('[submitEntry]', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /journal/my-entries
  //
  // Query params (semua opsional):
  //   group        — filter by group (harus group milik user)
  //   activity_id  — filter by activity
  //   date_from    — timestamp ms atau ISO string (inklusif)
  //   date_to      — timestamp ms atau ISO string (inklusif)
  //   limit        — default 100, max 500
  //   cursor       — submitted_at timestamp untuk pagination (lanjut dari sini ke belakang)
  // ─────────────────────────────────────────────────────────────────────────────
  async getMyEntries(req, res) {
    try {
      const userId     = req.user.username;
      const userGroups = req.user.groups || [];
      const { group, activity_id, date_from, date_to, limit: limitRaw, cursor } = req.query;
      const limit = parseLimit(limitRaw, 100, 500);

      // Validasi filter group — user hanya bisa lihat group miliknya
      if (group && !userGroups.includes(group)) {
        return res.status(403).json({ success: false, error: 'Kamu tidak terdaftar di group tersebut' });
      }

      // Base query: Firestore bisa filter user_id + orderBy + limit langsung
      let q = db.collection(ENTRIES)
        .where('user_id', '==', userId)
        .orderBy('submitted_at', 'desc');

      // Filter date range
      if (date_from) {
        const from = Number(date_from) || new Date(date_from).getTime();
        if (!isNaN(from)) q = q.where('submitted_at', '>=', from);
      }
      if (date_to) {
        const to = Number(date_to) || new Date(date_to).getTime();
        if (!isNaN(to)) q = q.where('submitted_at', '<=', to);
      }

      // Filter activity_id
      if (activity_id) {
        q = q.where('activity_id', '==', activity_id);
      }

      // Cursor pagination
      if (cursor) {
        const cursorTs = Number(cursor);
        if (!isNaN(cursorTs)) q = q.startAfter(cursorTs);
      }

      q = q.limit(limit);

      const snap   = await q.get();
      let entries  = snap.docs.map((d) => d.data());

      // Filter group di app layer (Firestore tidak support array-contains + equality bersamaan)
      if (group) {
        entries = entries.filter(
          (e) => Array.isArray(e.user_groups) && e.user_groups.includes(group)
        );
      }

      const nextCursor = entries.length === limit
        ? entries[entries.length - 1].submitted_at
        : null;

      return res.status(200).json({
        success: true,
        count: entries.length,
        next_cursor: nextCursor,
        filters: {
          group: group || null,
          activity_id: activity_id || null,
          date_from: date_from || null,
          date_to: date_to || null,
        },
        data: entries,
      });
    } catch (error) {
      console.error('[getMyEntries]', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /journal/groups/:group/entries   (admin / super_admin)
  //
  // Query params:
  //   user_id      — filter by username
  //   activity_id  — filter by activity
  //   date_from / date_to
  //   limit        — default 200, max 1000
  //   cursor       — pagination cursor (submitted_at)
  // ─────────────────────────────────────────────────────────────────────────────
  async getGroupEntries(req, res) {
    try {
      const { group } = req.params;
      const { user_id, activity_id, date_from, date_to, limit: limitRaw, cursor } = req.query;
      const limit = parseLimit(limitRaw, 200, 1000);

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

      // Query Firestore: filter by user_groups array-contains
      let q = db.collection(ENTRIES)
        .where('user_groups', 'array-contains', group)
        .orderBy('submitted_at', 'desc');

      if (date_from) {
        const from = Number(date_from) || new Date(date_from).getTime();
        if (!isNaN(from)) q = q.where('submitted_at', '>=', from);
      }
      if (date_to) {
        const to = Number(date_to) || new Date(date_to).getTime();
        if (!isNaN(to)) q = q.where('submitted_at', '<=', to);
      }

      if (user_id) {
        q = q.where('user_id', '==', user_id);
      }

      if (activity_id) {
        q = q.where('activity_id', '==', activity_id);
      }

      if (cursor) {
        const cursorTs = Number(cursor);
        if (!isNaN(cursorTs)) q = q.startAfter(cursorTs);
      }

      q = q.limit(limit);

      const snap    = await q.get();
      const entries = snap.docs.map((d) => d.data());

      const nextCursor = entries.length === limit
        ? entries[entries.length - 1].submitted_at
        : null;

      return res.status(200).json({
        success: true,
        count: entries.length,
        next_cursor: nextCursor,
        group,
        filters: {
          user_id: user_id || null,
          activity_id: activity_id || null,
          date_from: date_from || null,
          date_to: date_to || null,
        },
        data: entries,
      });
    } catch (error) {
      console.error('[getGroupEntries]', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /journal/history   (admin / super_admin)
  //
  // History semua entry. Admin scope ke group yang dia manage.
  // Super_admin bisa lihat semua.
  //
  // Query params:
  //   group        — filter by group tertentu
  //   user_id      — filter by username
  //   activity_id  — filter by activity
  //   date_from / date_to
  //   limit        — default 200, max 1000
  //   cursor       — pagination cursor (submitted_at)
  // ─────────────────────────────────────────────────────────────────────────────
  async getHistory(req, res) {
    try {
      const { group, user_id, activity_id, date_from, date_to, limit: limitRaw, cursor } = req.query;
      const limit         = parseLimit(limitRaw, 200, 1000);
      const isSuperAdmin  = req.user.role === 'super_admin';
      const managedGroups = req.user.managedGroups || [];

      // Validasi akses group
      if (group) {
        const activeGroupKeys = await groupDAO.getActiveGroupKeys();
        if (!activeGroupKeys.includes(group)) {
          return res.status(400).json({ success: false, error: `Group '${group}' tidak valid` });
        }
        if (!isSuperAdmin && !managedGroups.includes(group)) {
          return res.status(403).json({ success: false, error: 'Tidak punya akses ke group tersebut' });
        }
      }

      let q = db.collection(ENTRIES).orderBy('submitted_at', 'desc');

      // Scope ke satu group spesifik (pakai array-contains — paling efisien)
      if (group) {
        q = db.collection(ENTRIES)
          .where('user_groups', 'array-contains', group)
          .orderBy('submitted_at', 'desc');
      } else if (!isSuperAdmin && managedGroups.length === 1) {
        // Admin dengan 1 group — bisa pakai array-contains
        q = db.collection(ENTRIES)
          .where('user_groups', 'array-contains', managedGroups[0])
          .orderBy('submitted_at', 'desc');
      }
      // Admin dengan banyak group tanpa filter spesifik → filter di app layer setelah fetch

      // Filter tambahan
      if (user_id)      q = q.where('user_id',      '==', user_id);
      if (activity_id)  q = q.where('activity_id',  '==', activity_id);

      if (date_from) {
        const from = Number(date_from) || new Date(date_from).getTime();
        if (!isNaN(from)) q = q.where('submitted_at', '>=', from);
      }
      if (date_to) {
        const to = Number(date_to) || new Date(date_to).getTime();
        if (!isNaN(to)) q = q.where('submitted_at', '<=', to);
      }

      if (cursor) {
        const cursorTs = Number(cursor);
        if (!isNaN(cursorTs)) q = q.startAfter(cursorTs);
      }

      q = q.limit(limit);

      const snap   = await q.get();
      let entries  = snap.docs.map((d) => d.data());

      // Admin multi-group tanpa filter group spesifik → filter di app layer
      if (!isSuperAdmin && !group && managedGroups.length > 1) {
        entries = entries.filter(
          (e) => Array.isArray(e.user_groups) && hasIntersection(e.user_groups, managedGroups)
        );
      }

      // Summary
      const summaryByUser     = {};
      const summaryByActivity = {};
      let   totalPoints       = 0;
      for (const e of entries) {
        summaryByUser[e.user_id] = (summaryByUser[e.user_id] || 0) + (e.points_awarded || 0);
        summaryByActivity[e.activity_name_snapshot] = (summaryByActivity[e.activity_name_snapshot] || 0) + 1;
        totalPoints += (e.points_awarded || 0);
      }

      const nextCursor = entries.length === limit
        ? entries[entries.length - 1].submitted_at
        : null;

      return res.status(200).json({
        success: true,
        count: entries.length,
        next_cursor: nextCursor,
        filters: {
          group: group || null,
          user_id: user_id || null,
          activity_id: activity_id || null,
          date_from: date_from || null,
          date_to: date_to || null,
        },
        summary: {
          total_points_awarded: totalPoints,
          by_user: summaryByUser,
          by_activity: summaryByActivity,
        },
        data: entries,
      });
    } catch (error) {
      console.error('[getHistory]', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }
}

module.exports = new JournalController();