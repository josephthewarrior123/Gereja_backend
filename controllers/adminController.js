const { db } = require('../config/firebase');
const { validateActivityFieldsConfig } = require('../utils/validators');
const userDAO = require('../dao/userDAO');
const groupDAO = require('../dao/groupDAO');
const bcrypt = require('bcryptjs');

const COLLECTION = 'activities';
const JOURNAL_ENTRIES = 'journal_entries';
const POINTS_LEDGER = 'points_ledger';
const USER_STATS = 'user_stats';
const USER_GROUP_STATS = 'user_group_stats';

// Role yang punya managedGroups (selain super_admin)
const MANAGED_ROLES = new Set(['admin', 'gembala']);

function toKey(name) {
  return String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function normalizeGroups(groups) {
  if (!Array.isArray(groups)) return [];
  return groups.map(toKey).filter(Boolean);
}

function isSubset(subset, superset) {
  const set = new Set(superset);
  return subset.every((x) => set.has(x));
}

function hasIntersection(a, b) {
  const setB = new Set(b);
  return a.some((x) => setB.has(x));
}

async function deleteByQueryInBatches(query, maxBatchSize = 450) {
  // Firestore batch limit: 500 ops. We keep buffer for safety.
  let deleted = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const snap = await query.limit(maxBatchSize).get();
    if (snap.empty) break;

    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    deleted += snap.size;
  }
  return deleted;
}

async function deleteUserRelatedData(username) {
  const userId = String(username || '').trim();
  if (!userId) return { entries_deleted: 0, ledger_deleted: 0, stats_deleted: 0, group_stats_deleted: 0 };

  const entriesDeleted = await deleteByQueryInBatches(
    db.collection(JOURNAL_ENTRIES).where('user_id', '==', userId)
  );

  const ledgerDeleted = await deleteByQueryInBatches(
    db.collection(POINTS_LEDGER).where('user_id', '==', userId)
  );

  let statsDeleted = 0;
  // Normal case: stats doc id = username
  const statsDocRef = db.collection(USER_STATS).doc(userId);
  const statsSnap = await statsDocRef.get();
  if (statsSnap.exists) {
    await statsDocRef.delete();
    statsDeleted += 1;
  }
  // Defensive: if some docs created with random id but have user_id field
  statsDeleted += await deleteByQueryInBatches(
    db.collection(USER_STATS).where('user_id', '==', userId)
  );

  const groupStatsDeleted = await deleteByQueryInBatches(
    db.collection(USER_GROUP_STATS).where('user_id', '==', userId)
  );

  return {
    entries_deleted: entriesDeleted,
    ledger_deleted: ledgerDeleted,
    stats_deleted: statsDeleted,
    group_stats_deleted: groupStatsDeleted,
  };
}

class AdminController {
  _col() {
    return db.collection(COLLECTION);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /admin/users/:username/stats
  // super_admin   : lihat stats siapa aja
  // admin/gembala : hanya user yang ada di managedGroups-nya
  // ─────────────────────────────────────────────────────────────────────────────
  async getUserStats(req, res) {
    try {
      const { username } = req.params;

      const existing = await userDAO.findByUsername(username);
      if (!existing) {
        return res.status(404).json({ success: false, error: 'User tidak ditemukan' });
      }

      if (req.user.role !== 'super_admin') {
        const managedGroups = req.user.managedGroups || [];
        const userGroups = existing.groups || [];
        const userManaged = existing.managedGroups || [];
        if (!hasIntersection(userGroups, managedGroups) && !hasIntersection(userManaged, managedGroups)) {
          return res.status(403).json({ success: false, error: 'Tidak ada akses untuk user ini' });
        }
      }

      const statsSnap = await db.collection(USER_STATS).doc(username).get();
      const stats = statsSnap.exists ? statsSnap.data() : {};

      return res.status(200).json({
        success: true,
        data: {
          username,
          fullName: existing.fullName || '',
          groups: existing.groups || [],
          total_points: stats.total_points || 0,
          entry_count: stats.entry_count || 0,
          updated_at: stats.updated_at || null,
        },
      });
    } catch (error) {
      console.error('[getUserStats]', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /admin/users
  // super_admin   : lihat semua
  // admin/gembala : hanya user yang ada di managedGroups-nya
  // ─────────────────────────────────────────────────────────────────────────────
  async listUsers(req, res) {
    try {
      const raw = await userDAO.getAllUsers();
      const all = Object.entries(raw).map(([username, value]) => ({
        username,
        fullName: value.fullName || '',
        email: value.email || '',
        phone_number: value.phone_number || '',
        role: value.role,
        groups: value.groups || [],
        managedGroups: value.managedGroups || [],
        isActive: value.isActive !== false,
        createdAt: value.createdAt || null,
      }));

      const users = all.filter((u) => {
        if (req.user.role === 'super_admin') return true;
        // admin & gembala: tampilkan user (cek groups) DAN gembala/admin (cek managedGroups)
        const userGroups = u.groups || [];
        const userManagedGroups = u.managedGroups || [];
        return hasIntersection(userGroups, req.user.managedGroups || [])
          || hasIntersection(userManagedGroups, req.user.managedGroups || []);
      });

      // Join user_stats (total_points & entry_count) untuk setiap user
      const statsSnap = await db.collection('user_stats').get();
      const statsMap = {};
      statsSnap.docs.forEach((doc) => {
        const d = doc.data();
        const uid = d.user_id || doc.id;
        statsMap[uid] = { total_points: d.total_points || 0, entry_count: d.entry_count || 0 };
      });

      const usersWithStats = users.map((u) => ({
        ...u,
        total_points: statsMap[u.username]?.total_points || 0,
        entry_count: statsMap[u.username]?.entry_count || 0,
      }));

      return res.status(200).json({ success: true, count: usersWithStats.length, data: usersWithStats });
    } catch (error) {
      console.error('[listUsers]', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /admin/users — upsert user (create atau update by username)
  // Catatan: gembala TIDAK bisa create/update user — hanya admin & super_admin.
  // Endpoint ini tetap diproteksi di route level dengan requireRole('admin','super_admin').
  // ─────────────────────────────────────────────────────────────────────────────
  async upsertUser(req, res) {
    try {
      const { username, fullName, email, phone_number, groups = [], role, is_active } = req.body;

      if (!username) {
        return res.status(400).json({ success: false, error: 'username wajib' });
      }

      const VALID_ROLES = ['super_admin', 'admin', 'gembala', 'user'];
      if (role && !VALID_ROLES.includes(role)) {
        return res.status(400).json({ success: false, error: 'Role tidak valid' });
      }

      // admin biasa tidak boleh promote ke super_admin
      if (req.user.role !== 'super_admin' && role === 'super_admin') {
        return res.status(403).json({ success: false, error: 'Hanya super_admin yang bisa set role ini' });
      }

      const cleanGroups = normalizeGroups(groups);
      const managedGroups = req.user.managedGroups || [];

      // admin biasa hanya bisa assign user ke managedGroups-nya
      if (req.user.role !== 'super_admin' && cleanGroups.length > 0) {
        if (!isSubset(cleanGroups, managedGroups)) {
          return res.status(403).json({ success: false, error: 'Hanya bisa assign user ke group yang Anda kelola' });
        }
      }

      const existing = await userDAO.findByUsername(username);

      if (existing) {
        // UPDATE — admin biasa hanya boleh edit user yang ada di managedGroups-nya
        if (req.user.role !== 'super_admin') {
          if (!hasIntersection(existing.groups || [], managedGroups)) {
            return res.status(403).json({ success: false, error: 'Tidak ada akses untuk user ini' });
          }
        }

        const patch = { updatedAt: Date.now() };
        if (typeof fullName === 'string') patch.fullName = fullName.trim();
        if (typeof email === 'string') patch.email = email.trim();
        if (typeof phone_number === 'string') patch.phone_number = phone_number.trim();
        if (Array.isArray(groups)) patch.groups = cleanGroups;
        if (role) patch.role = role;
        if (typeof is_active === 'boolean') patch.isActive = is_active;

        const updated = await userDAO.updateUser(username, patch);
        return res.status(200).json({
          success: true,
          message: 'User berhasil diupdate',
          data: {
            username: updated.username,
            fullName: updated.fullName,
            email: updated.email || '',
            phone_number: updated.phone_number || '',
            role: updated.role,
            groups: updated.groups || [],
            isActive: updated.isActive !== false,
          },
        });
      }

      // CREATE — hanya super_admin yang bisa buat user baru via admin panel
      if (req.user.role !== 'super_admin') {
        return res.status(403).json({ success: false, error: 'Hanya super_admin yang bisa membuat user baru' });
      }
      if (!req.body.password) {
        return res.status(400).json({ success: false, error: 'password wajib untuk user baru' });
      }

      const bcrypt = require('bcryptjs');
      const hashed = await bcrypt.hash(req.body.password, 10);
      const created = await userDAO.createUser({
        username: String(username).trim(),
        fullName: String(fullName || '').trim(),
        email: String(email || '').trim(),
        phone_number: String(phone_number || '').trim(),
        password: hashed,
        role: role || 'user',
        groups: cleanGroups,
        managedGroups: [],
        isActive: is_active !== false,
      });

      return res.status(201).json({
        success: true,
        message: 'User berhasil dibuat',
        data: { username: created.username, fullName: created.fullName, role: created.role, groups: created.groups || [] },
      });
    } catch (error) {
      console.error('[upsertUser]', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /admin/activities
  // super_admin   : semua activity
  // admin/gembala : hanya activity yang group-nya intersection dengan managedGroups
  // ─────────────────────────────────────────────────────────────────────────────
  async listAdminActivities(req, res) {
    try {
      const snap = await this._col().orderBy('created_at', 'desc').get();
      const all = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

      const activities = all.filter((item) => {
        if (req.user.role === 'super_admin') return true;
        return hasIntersection(item.groups || [], req.user.managedGroups || []);
      });

      return res.status(200).json({ success: true, count: activities.length, data: activities });
    } catch (error) {
      console.error('[listAdminActivities]', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /admin/activities — create activity
  // super_admin   : bisa buat activity untuk group apa pun
  // admin/gembala : hanya bisa buat activity untuk managedGroups-nya
  // ─────────────────────────────────────────────────────────────────────────────
  async createActivity(req, res) {
    try {
      const { name, points, fields = [], groups = [], is_active = true } = req.body;

      if (!name || typeof name !== 'string') {
        return res.status(400).json({ success: false, error: 'name is required' });
      }
      const parsedPoints = Number(points);
      if (isNaN(parsedPoints) || parsedPoints < 0) {
        return res.status(400).json({ success: false, error: 'points must be a non-negative number' });
      }
      if (fields.length > 0) {
        const fieldsError = validateActivityFieldsConfig(fields);
        if (fieldsError) return res.status(400).json({ success: false, error: fieldsError });
      }

      const cleanGroups = normalizeGroups(groups);
      if (!cleanGroups.length) {
        return res.status(400).json({ success: false, error: 'Pilih minimal 1 group' });
      }

      if (req.user.role !== 'super_admin') {
        const managedGroups = req.user.managedGroups || [];
        if (!isSubset(cleanGroups, managedGroups)) {
          return res.status(403).json({ success: false, error: 'Hanya bisa assign ke group yang Anda kelola' });
        }
      }

      const now = Date.now();
      const newRef = this._col().doc();
      await newRef.set({
        id: newRef.id,
        name: name.trim(),
        points: parsedPoints,
        fields,
        groups: cleanGroups,
        created_by_admin: req.user.username,
        is_active,
        created_at: now,
        updated_at: now,
      });

      return res.status(201).json({ success: true, message: 'Activity created', data: { id: newRef.id } });
    } catch (error) {
      console.error('[createActivity]', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PATCH /admin/activities/:activityId
  // super_admin   : bisa update activity apa pun
  // admin/gembala : hanya activity yang group-nya subset dari managedGroups-nya
  // ─────────────────────────────────────────────────────────────────────────────
  async updateActivity(req, res) {
    try {
      const { activityId } = req.params;
      const { name, points, fields, groups, is_active } = req.body;

      const ref = this._col().doc(activityId);
      const snap = await ref.get();
      if (!snap.exists) {
        return res.status(404).json({ success: false, error: 'Activity not found' });
      }

      const current = snap.data();
      const nextGroups = groups ? normalizeGroups(groups) : current.groups;

      if (req.user.role !== 'super_admin') {
        const managedGroups = req.user.managedGroups || [];
        if (!isSubset(current.groups, managedGroups)) {
          return res.status(403).json({ success: false, error: 'Tidak ada akses untuk activity di group ini' });
        }
        if (!isSubset(nextGroups, managedGroups)) {
          return res.status(403).json({ success: false, error: 'Hanya bisa assign ke group yang Anda kelola' });
        }
      }

      if (fields) {
        const fieldsError = validateActivityFieldsConfig(fields);
        if (fieldsError) return res.status(400).json({ success: false, error: fieldsError });
      }

      const patch = { updated_at: Date.now() };
      if (typeof name === 'string') patch.name = name.trim();
      if (points !== undefined) {
        const p = Number(points);
        if (!isNaN(p) && p >= 0) patch.points = p;
      }
      if (Array.isArray(fields)) patch.fields = fields;
      if (Array.isArray(groups)) patch.groups = nextGroups;
      if (typeof is_active === 'boolean') patch.is_active = is_active;

      await ref.update(patch);
      return res.status(200).json({ success: true, message: 'Activity updated' });
    } catch (error) {
      console.error('[updateActivity]', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // DELETE /admin/activities/:activityId
  // super_admin   : bisa hapus activity apa aja
  // admin/gembala : hanya activity yang group-nya subset dari managedGroups-nya
  // ─────────────────────────────────────────────────────────────────────────────
  async deleteActivity(req, res) {
    try {
      const { activityId } = req.params;
      const ref = this._col().doc(activityId);
      const snap = await ref.get();
      if (!snap.exists) {
        return res.status(404).json({ success: false, error: 'Activity not found' });
      }

      const current = snap.data();

      if (req.user.role !== 'super_admin') {
        const managedGroups = req.user.managedGroups || [];
        if (!isSubset(current.groups || [], managedGroups)) {
          return res.status(403).json({ success: false, error: 'Tidak ada akses untuk activity di group ini' });
        }
      }

      await ref.delete();
      return res.status(200).json({ success: true, message: 'Activity berhasil dihapus' });
    } catch (error) {
      console.error('[deleteActivity]', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PATCH /admin/users/:username/password
  //
  // super_admin : bisa reset password siapa aja (kecuali super_admin lain)
  // admin       : hanya user yang ada di managedGroups-nya, tidak bisa reset admin/gembala/super_admin
  // ─────────────────────────────────────────────────────────────────────────────
  async resetUserPassword(req, res) {
    try {
      const { username } = req.params;
      const { password } = req.body || {};

      if (!password || typeof password !== 'string') {
        return res.status(400).json({ success: false, error: 'password wajib' });
      }
      if (password.length < 6) {
        return res.status(400).json({ success: false, error: 'password minimal 6 karakter' });
      }

      if (req.user.username === username) {
        return res.status(400).json({ success: false, error: 'Gunakan endpoint profile untuk ganti password sendiri' });
      }

      const existing = await userDAO.findByUsername(username);
      if (!existing) {
        return res.status(404).json({ success: false, error: 'User tidak ditemukan' });
      }

      // Jangan izinkan reset password super_admin via endpoint ini
      if (existing.role === 'super_admin') {
        return res.status(403).json({ success: false, error: 'Tidak bisa reset password super_admin' });
      }

      if (req.user.role !== 'super_admin') {
        const managedGroups = req.user.managedGroups || [];
        if (!hasIntersection(existing.groups || [], managedGroups)) {
          return res.status(403).json({ success: false, error: 'Tidak ada akses untuk user ini' });
        }
        // Admin biasa tidak boleh reset password admin/gembala lain
        if (existing.role === 'admin' || existing.role === 'gembala') {
          return res.status(403).json({ success: false, error: 'Admin tidak bisa reset password admin atau gembala lain' });
        }
      }

      const hashed = await bcrypt.hash(password, 10);
      await userDAO.updateUser(username, { password: hashed });

      return res.status(200).json({ success: true, message: 'Password user berhasil direset' });
    } catch (error) {
      console.error('[resetUserPassword]', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // DELETE /admin/users/:username
  // super_admin   : bisa hapus siapa aja kecuali super_admin lain
  // admin         : hanya user di managedGroups-nya, tidak bisa hapus admin lain
  // gembala       : TIDAK bisa hapus user — diproteksi di route level
  // ─────────────────────────────────────────────────────────────────────────────
  async deleteUser(req, res) {
    try {
      const { username } = req.params;

      if (req.user.username === username) {
        return res.status(400).json({ success: false, error: 'Tidak bisa menghapus akun sendiri' });
      }

      const existing = await userDAO.findByUsername(username);
      if (!existing) {
        return res.status(404).json({ success: false, error: 'User tidak ditemukan' });
      }

      if (existing.role === 'super_admin') {
        return res.status(403).json({ success: false, error: 'Tidak bisa menghapus super_admin' });
      }

      if (req.user.role !== 'super_admin') {
        const managedGroups = req.user.managedGroups || [];
        if (!hasIntersection(existing.groups || [], managedGroups)) {
          return res.status(403).json({ success: false, error: 'Tidak ada akses untuk menghapus user ini' });
        }
        if (existing.role === 'admin' || existing.role === 'gembala') {
          return res.status(403).json({ success: false, error: 'Admin tidak bisa menghapus admin atau gembala lain' });
        }
      }

      const deletedRelated = await deleteUserRelatedData(username);
      await userDAO.deleteUser(username);
      return res.status(200).json({
        success: true,
        message: 'User berhasil dihapus',
        deleted_related: deletedRelated,
      });
    } catch (error) {
      console.error('[deleteUser]', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }
}

module.exports = new AdminController();