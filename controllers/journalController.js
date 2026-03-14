const { db } = require('../config/firebase');
const { validateEntryDataByConfig } = require('../utils/validators');
const groupDAO = require('../dao/groupDAO');
const userDAO = require('../dao/userDAO');

const ACTIVITIES = 'activities';
const ENTRIES = 'journal_entries';
const LEDGER = 'points_ledger';
const USER_STATS = 'user_stats';

const MAX_BULK = 100;

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
  // POST /journal/entries  —  user submit entry untuk diri sendiri
  // ─────────────────────────────────────────────────────────────────────────────
  async submitEntry(req, res) {
    try {
      const { activity_id, data = {}, timestamp } = req.body;
      if (!activity_id) {
        return res.status(400).json({ success: false, error: 'activity_id is required' });
      }

      const actDoc = await db.collection(ACTIVITIES).doc(activity_id).get();
      if (!actDoc.exists) {
        return res.status(404).json({ success: false, error: 'Activity not found' });
      }
      const activity = actDoc.data();
      if (!activity.is_active) {
        return res.status(400).json({ success: false, error: 'Activity is inactive' });
      }

      const userId = req.user.username;
      const userGroups = req.user.groups || [];

      if (!hasIntersection(userGroups, activity.groups || [])) {
        return res.status(403).json({ success: false, error: 'User not in activity group' });
      }

      const fieldsError = validateEntryDataByConfig(activity.fields || [], data);
      if (fieldsError) {
        return res.status(400).json({ success: false, error: fieldsError });
      }

      const now = Date.now();
      const entryTimestamp = timestamp || now;

      const entryRef = db.collection(ENTRIES).doc();
      const ledgerRef = db.collection(LEDGER).doc();
      const statsRef = db.collection(USER_STATS).doc(userId);

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
        awarded_by: null,
        bulk_award: false,
      };

      await db.runTransaction(async (t) => {
        const statsSnap = await t.get(statsRef);
        const current = statsSnap.exists ? statsSnap.data() : { total_points: 0, entry_count: 0 };

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
          entry_count: (current.entry_count || 0) + 1,
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
  // POST /journal/bulk-award
  //
  // Dipakai oleh: gembala, admin, super_admin
  //
  // Body:
  //   activity_id  — string, required
  //   usernames    — string[], required, max 100 user
  //   data         — object, optional (field tambahan activity)
  //   timestamp    — number, optional (override timestamp entry)
  //   note         — string, optional (catatan dari awarder)
  //
  // Scope:
  //   gembala / admin  → activity harus ada di salah satu managedGroups-nya
  //                      target user harus ada di salah satu managedGroups-nya
  //   super_admin      → bebas, activity & user apa aja
  //
  // Response:
  //   awarded  — berhasil dapat award
  //   skipped  — diskip beserta alasannya
  // ─────────────────────────────────────────────────────────────────────────────
  async bulkAward(req, res) {
    try {
      const { activity_id, usernames, data = {}, timestamp, note = '' } = req.body;

      // ── Validasi input ────────────────────────────────────────────────────────
      if (!activity_id) {
        return res.status(400).json({ success: false, error: 'activity_id is required' });
      }
      if (!Array.isArray(usernames) || usernames.length === 0) {
        return res.status(400).json({ success: false, error: 'usernames harus array minimal 1 item' });
      }
      if (usernames.length > MAX_BULK) {
        return res.status(400).json({ success: false, error: `Maksimal ${MAX_BULK} user per bulk award` });
      }

      // ── Load activity ─────────────────────────────────────────────────────────
      const actDoc = await db.collection(ACTIVITIES).doc(activity_id).get();
      if (!actDoc.exists) {
        return res.status(404).json({ success: false, error: 'Activity not found' });
      }
      const activity = actDoc.data();
      if (!activity.is_active) {
        return res.status(400).json({ success: false, error: 'Activity is inactive' });
      }

      // ── Validasi fields ───────────────────────────────────────────────────────
      const fieldsError = validateEntryDataByConfig(activity.fields || [], data);
      if (fieldsError) {
        return res.status(400).json({ success: false, error: fieldsError });
      }

      // ── Scope check awarder ───────────────────────────────────────────────────
      const awarderRole = req.user.role;
      const awarderUsername = req.user.username;
      const managedGroups = req.user.managedGroups || [];
      const isSuperAdmin = awarderRole === 'super_admin';

      // Gembala & admin: activity harus ada di salah satu managedGroups-nya
      if (!isSuperAdmin) {
        if (!hasIntersection(activity.groups || [], managedGroups)) {
          return res.status(403).json({
            success: false,
            error: 'Activity ini tidak ada di group yang kamu kelola',
          });
        }
      }

      // ── Proses per user ───────────────────────────────────────────────────────
      const cleanUsernames = [...new Set(
        usernames.map((u) => String(u || '').trim()).filter(Boolean)
      )];

      const awarded = [];
      const skipped = [];
      const now = Date.now();
      const entryTs = typeof timestamp === 'number' ? timestamp : now;
      const noteStr = String(note || '').trim();

      for (const targetUsername of cleanUsernames) {
        // Load user target
        const targetUser = await userDAO.findByUsername(targetUsername);

        if (!targetUser) {
          skipped.push({ username: targetUsername, reason: 'User tidak ditemukan' });
          continue;
        }

        if (targetUser.isActive === false) {
          skipped.push({ username: targetUsername, reason: 'User tidak aktif' });
          continue;
        }

        const targetGroups = targetUser.groups || [];

        // Gembala & admin: target user harus ada di salah satu managedGroups-nya
        if (!isSuperAdmin) {
          if (!hasIntersection(targetGroups, managedGroups)) {
            skipped.push({ username: targetUsername, reason: 'User tidak ada di group yang kamu kelola' });
            continue;
          }
        }

        // user_groups untuk entry = irisan targetGroups & activity.groups
        // supaya entry tercatat di group yang relevan saja
        const entryUserGroups = targetGroups.filter((g) =>
          (activity.groups || []).includes(g)
        );

        const entryRef = db.collection(ENTRIES).doc();
        const ledgerRef = db.collection(LEDGER).doc();
        const statsRef = db.collection(USER_STATS).doc(targetUsername);

        const entryData = {
          id: entryRef.id,
          user_id: targetUsername,
          user_groups: entryUserGroups,
          activity_id,
          activity_name_snapshot: activity.name,
          data,
          timestamp: entryTs,
          submitted_at: now,
          submitted_by: awarderUsername,
          points_awarded: activity.points,
          status: 'approved',
          awarded_by: awarderUsername,
          bulk_award: true,
          note: noteStr,
        };

        try {
          await db.runTransaction(async (t) => {
            const statsSnap = await t.get(statsRef);
            const current = statsSnap.exists
              ? statsSnap.data()
              : { total_points: 0, entry_count: 0 };

            t.set(entryRef, entryData);
            t.set(ledgerRef, {
              id: ledgerRef.id,
              user_id: targetUsername,
              entry_id: entryRef.id,
              points_delta: activity.points,
              reason: 'bulk_award',
              awarded_by: awarderUsername,
              created_at: now,
            });
            t.set(statsRef, {
              user_id: targetUsername,
              total_points: (current.total_points || 0) + activity.points,
              entry_count: (current.entry_count || 0) + 1,
              updated_at: now,
            });
          });

          awarded.push({
            username: targetUsername,
            fullName: targetUser.fullName || '',
            entry_id: entryRef.id,
            points_awarded: activity.points,
          });
        } catch (txError) {
          console.error(`[bulkAward] tx error for ${targetUsername}:`, txError);
          skipped.push({ username: targetUsername, reason: 'Internal error saat menyimpan' });
        }
      }

      return res.status(200).json({
        success: true,
        message: `Bulk award selesai. Berhasil: ${awarded.length}, Dilewati: ${skipped.length}`,
        activity: { id: activity_id, name: activity.name, points: activity.points },
        awarded_by: awarderUsername,
        awarded,
        skipped,
      });
    } catch (error) {
      console.error('[bulkAward]', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /journal/my-entries
  // ─────────────────────────────────────────────────────────────────────────────
  async getMyEntries(req, res) {
    try {
      const userId = req.user.username;
      const userGroups = req.user.groups || [];
      const { group, activity_id, date_from, date_to, limit: limitRaw, cursor } = req.query;
      const limit = parseLimit(limitRaw, 100, 500);

      if (group && !userGroups.includes(group)) {
        return res.status(403).json({ success: false, error: 'Kamu tidak terdaftar di group tersebut' });
      }

      let q = db.collection(ENTRIES)
        .where('user_id', '==', userId)
        .orderBy('submitted_at', 'desc');

      if (date_from) {
        const from = Number(date_from) || new Date(date_from).getTime();
        if (!isNaN(from)) q = q.where('submitted_at', '>=', from);
      }
      if (date_to) {
        const to = Number(date_to) || new Date(date_to).getTime();
        if (!isNaN(to)) q = q.where('submitted_at', '<=', to);
      }
      if (activity_id) q = q.where('activity_id', '==', activity_id);
      if (cursor) {
        const cursorTs = Number(cursor);
        if (!isNaN(cursorTs)) q = q.startAfter(cursorTs);
      }
      q = q.limit(limit);

      const snap = await q.get();
      let entries = snap.docs.map((d) => d.data());

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
        filters: { group: group || null, activity_id: activity_id || null, date_from: date_from || null, date_to: date_to || null },
        data: entries,
      });
    } catch (error) {
      console.error('[getMyEntries]', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /journal/groups/:group/entries   (admin / super_admin / gembala)
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
      if (user_id) q = q.where('user_id', '==', user_id);
      if (activity_id) q = q.where('activity_id', '==', activity_id);
      if (cursor) {
        const cursorTs = Number(cursor);
        if (!isNaN(cursorTs)) q = q.startAfter(cursorTs);
      }
      q = q.limit(limit);

      const snap = await q.get();
      const entries = snap.docs.map((d) => d.data());

      const nextCursor = entries.length === limit
        ? entries[entries.length - 1].submitted_at
        : null;

      return res.status(200).json({
        success: true,
        count: entries.length,
        next_cursor: nextCursor,
        group,
        filters: { user_id: user_id || null, activity_id: activity_id || null, date_from: date_from || null, date_to: date_to || null },
        data: entries,
      });
    } catch (error) {
      console.error('[getGroupEntries]', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /journal/history   (admin / super_admin / gembala)
  // ─────────────────────────────────────────────────────────────────────────────
  async getHistory(req, res) {
    try {
      const { group, user_id, activity_id, date_from, date_to, limit: limitRaw, cursor } = req.query;
      const limit = parseLimit(limitRaw, 200, 1000);
      const isSuperAdmin = req.user.role === 'super_admin';
      const managedGroups = req.user.managedGroups || [];

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

      if (group) {
        q = db.collection(ENTRIES)
          .where('user_groups', 'array-contains', group)
          .orderBy('submitted_at', 'desc');
      } else if (!isSuperAdmin && managedGroups.length === 1) {
        q = db.collection(ENTRIES)
          .where('user_groups', 'array-contains', managedGroups[0])
          .orderBy('submitted_at', 'desc');
      }

      if (user_id) q = q.where('user_id', '==', user_id);
      if (activity_id) q = q.where('activity_id', '==', activity_id);
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

      const snap = await q.get();
      let entries = snap.docs.map((d) => d.data());

      // Admin / gembala multi-group tanpa filter spesifik → filter di app layer
      if (!isSuperAdmin && !group && managedGroups.length > 1) {
        entries = entries.filter(
          (e) => Array.isArray(e.user_groups) && hasIntersection(e.user_groups, managedGroups)
        );
      }

      // Summary
      const summaryByUser = {};
      const summaryByActivity = {};
      let totalPoints = 0;
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
        filters: { group: group || null, user_id: user_id || null, activity_id: activity_id || null, date_from: date_from || null, date_to: date_to || null },
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