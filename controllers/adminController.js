const { db } = require('../config/firebase');
const { validateActivityFieldsConfig } = require('../utils/validators');
const userDAO = require('../dao/userDAO');
const groupDAO = require('../dao/groupDAO');

const COLLECTION = 'activities';

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

class AdminController {
  _col() {
    return db.collection(COLLECTION);
  }

  // GET /admin/users — list semua user
  // super_admin: lihat semua
  // admin: hanya lihat user yang punya intersection dengan managedGroups-nya
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
        // admin: hanya lihat user yang ada di salah satu managedGroups-nya
        return hasIntersection(u.groups || [], req.user.managedGroups || []);
      });

      return res.status(200).json({ success: true, count: users.length, data: users });
    } catch (error) {
      console.error('[listUsers]', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // POST /admin/users — upsert user (create atau update by username)
  // admin biasa hanya bisa assign user ke group yang dia kelola
  async upsertUser(req, res) {
    try {
      const { username, fullName, email, phone_number, groups = [], role, is_active } = req.body;

      if (!username) {
        return res.status(400).json({ success: false, error: 'username wajib' });
      }

      // Validasi role jika dikirim
      const VALID_ROLES = ['super_admin', 'admin', 'user'];
      if (role && !VALID_ROLES.includes(role)) {
        return res.status(400).json({ success: false, error: 'Role tidak valid' });
      }

      // admin biasa tidak boleh assign/promote ke super_admin
      if (req.user.role !== 'super_admin' && role === 'super_admin') {
        return res.status(403).json({ success: false, error: 'Hanya super_admin yang bisa set role super_admin' });
      }

      const cleanGroups = normalizeGroups(groups);

      // admin biasa hanya bisa assign user ke managedGroups-nya
      if (req.user.role !== 'super_admin' && cleanGroups.length > 0) {
        const managedGroups = req.user.managedGroups || [];
        if (!isSubset(cleanGroups, managedGroups)) {
          return res.status(403).json({ success: false, error: 'Hanya bisa assign user ke group yang Anda kelola' });
        }
      }

      const existing = await userDAO.findByUsername(username);

      if (existing) {
        // UPDATE — admin biasa hanya boleh edit user yang ada di managedGroups-nya
        if (req.user.role !== 'super_admin') {
          const managedGroups = req.user.managedGroups || [];
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
        data: {
          username: created.username,
          fullName: created.fullName,
          role: created.role,
          groups: created.groups || [],
        },
      });
    } catch (error) {
      console.error('[upsertUser]', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  async listAdminActivities(req, res) {
    try {
      const snap = await this._col().orderBy('created_at', 'desc').get();
      const all = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

      const activities = all.filter((item) => {
        if (req.user.role === 'super_admin') return true;
        // admin: hanya return activity yang punya intersection dengan managedGroups nya admin
        return hasIntersection(item.groups || [], req.user.managedGroups || []);
      });

      return res.status(200).json({
        success: true,
        count: activities.length,
        data: activities,
      });
    } catch (error) {
      console.error('[listAdminActivities]', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

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

      return res.status(201).json({
        success: true,
        message: 'Activity created',
        data: { id: newRef.id },
      });
    } catch (error) {
      console.error('[createActivity]', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

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
  // DELETE /admin/users/:username — hapus user
  // super_admin: bisa hapus siapa aja kecuali super_admin lain
  // admin: hanya bisa hapus user yang ada di managedGroups-nya
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

      // admin biasa hanya bisa hapus user yang ada di salah satu managedGroups-nya
      if (req.user.role !== 'super_admin') {
        const managedGroups = req.user.managedGroups || [];
        if (!hasIntersection(existing.groups || [], managedGroups)) {
          return res.status(403).json({ success: false, error: 'Tidak ada akses untuk menghapus user ini' });
        }
        // admin tidak bisa hapus admin lain
        if (existing.role === 'admin') {
          return res.status(403).json({ success: false, error: 'Admin tidak bisa menghapus admin lain' });
        }
      }

      await userDAO.deleteUser(username);
      return res.status(200).json({ success: true, message: 'User berhasil dihapus' });
    } catch (error) {
      console.error('[deleteUser]', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }
}

module.exports = new AdminController();