const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('../config/firebase');
const userDAO = require('../dao/userDAO');
const groupDAO = require('../dao/groupDAO');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const USER_STATS = 'user_stats';
const USERS = 'users';
const POINTS_LEDGER = 'points_ledger';
const ENTRIES = 'journal_entries';

// Semua role valid di sistem
const VALID_ROLES = ['super_admin', 'admin', 'gembala', 'user'];

function normalizeGroupInput(groups) {
  if (!Array.isArray(groups)) return [];
  return groups
    .map((g) => String(g || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''))
    .filter(Boolean);
}

async function normalizeGroups(groups) {
  const activeKeys = await groupDAO.getActiveGroupKeys();
  const active = new Set(activeKeys);
  return normalizeGroupInput(groups).filter((g) => active.has(g));
}

async function getAllActiveGroups() {
  return groupDAO.getActiveGroupKeys();
}

function buildToken(user) {
  return jwt.sign(
    {
      username: user.username,
      role: user.role,
      groups: user.groups || [],
      managedGroups: user.managedGroups || [],
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

class UserController {
  async signUp(req, res) {
    try {
      const { fullName, username, password, phone_number = '', email = '', groups = [] } = req.body;
      if (!fullName || !username || !password) {
        return res.status(400).json({ success: false, error: 'fullName, username, password wajib' });
      }
      if (password.length < 6) {
        return res.status(400).json({ success: false, error: 'password minimal 6 karakter' });
      }

      const hashed = await bcrypt.hash(password, 10);
      const cleanGroups = groups.length > 0 ? await normalizeGroups(groups) : [];

      const newUser = await userDAO.createUser({
        fullName: String(fullName).trim(),
        username: String(username).trim(),
        password: hashed,
        email: String(email || '').trim(),
        phone_number: String(phone_number || '').trim(),
        role: 'user',
        groups: cleanGroups,
        managedGroups: [],
        isActive: true,
      });

      const token = buildToken(newUser);
      return res.status(201).json({
        success: true,
        message: 'Signup berhasil',
        token,
        user: {
          username: newUser.username,
          fullName: newUser.fullName,
          role: newUser.role,
          groups: newUser.groups,
          managedGroups: newUser.managedGroups || [],
        },
      });
    } catch (error) {
      return res.status(400).json({ success: false, error: error.message });
    }
  }

  async login(req, res) {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ success: false, error: 'username dan password wajib' });
      }

      const user = await userDAO.findByUsername(String(username).trim());
      if (!user) return res.status(401).json({ success: false, error: 'Username/password salah' });

      const ok = await bcrypt.compare(password, user.password);
      if (!ok) return res.status(401).json({ success: false, error: 'Username/password salah' });

      const token = buildToken(user);
      return res.status(200).json({
        success: true,
        message: 'Login berhasil',
        token,
        user: {
          username: user.username,
          fullName: user.fullName,
          role: user.role,
          groups: user.groups || [],
          managedGroups: user.managedGroups || [],
        },
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  async getProfile(req, res) {
    const user = await userDAO.findByUsername(req.user.username);
    if (!user) return res.status(404).json({ success: false, error: 'User tidak ditemukan' });
    return res.status(200).json({
      success: true,
      user: {
        username: user.username,
        fullName: user.fullName,
        email: user.email || '',
        phone_number: user.phone_number || '',
        role: user.role,
        groups: user.groups || [],
        managedGroups: user.managedGroups || [],
        createdAt: user.createdAt,
      },
    });
  }

  // GET /api/users/me/stats — ambil total point & entry count user sendiri
  async getMyStats(req, res) {
    try {
      const uid = req.user.username;
      const snap = await db.collection(USER_STATS).doc(uid).get();
      const data = snap.exists ? snap.data() : {};
      const myPoints = data.total_points || 0;

      // rank = 1 + jumlah user dengan total_points lebih besar (dense rank)
      let rank = 1;
      try {
        const q = db.collection(USER_STATS).where('total_points', '>', myPoints);
        // Prefer aggregation count if available
        // eslint-disable-next-line no-underscore-dangle
        if (typeof q.count === 'function') {
          const agg = await q.count().get();
          const greater = agg.data().count || 0;
          rank = greater + 1;
        } else {
          const greaterSnap = await q.get();
          rank = (greaterSnap.size || 0) + 1;
        }
      } catch (e) {
        // Fallback: compute rank from leaderboard top N (best effort)
        rank = null;
      }

      const userSnap = await db.collection(USERS).doc(uid).get();
      const user = userSnap.exists ? userSnap.data() : {};
      return res.status(200).json({
        success: true,
        data: {
          username: uid,
          fullName: user.fullName || '',
          groups: user.groups || [],
          total_points: myPoints,
          entry_count: data.entry_count || 0,
          rank,
          updated_at: data.updated_at || null,
        },
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /api/users/me/monthly-stats?year=2026&month=3
  // Mengembalikan total poin & entry count user untuk bulan tertentu.
  // Default: bulan & tahun berjalan (WIB UTC+7).
  // Query ke journal_entries menggunakan submitted_at (sudah ada composite index).
  // ─────────────────────────────────────────────────────────────────────────────
  async getMyMonthlyStats(req, res) {
    try {
      const uid = req.user.username;

      // Tentukan tahun & bulan (default = bulan ini di WIB UTC+7)
      const nowWIB = new Date(Date.now() + 7 * 60 * 60 * 1000);
      const year = parseInt(req.query.year, 10) || nowWIB.getUTCFullYear();
      const month = parseInt(req.query.month, 10) || (nowWIB.getUTCMonth() + 1);

      if (month < 1 || month > 12) {
        return res.status(400).json({ success: false, error: 'month harus antara 1–12' });
      }

      // Hitung batas awal & akhir bulan dalam ms (WIB = UTC+7)
      // startMs = 1 [month] [year] 00:00:00 WIB  →  UTC - 7 jam
      // endMs   = 1 [month+1] [year] 00:00:00 WIB - 1 ms
      const startMs = Date.UTC(year, month - 1, 1) - 7 * 60 * 60 * 1000;
      const endMs = Date.UTC(year, month, 1) - 7 * 60 * 60 * 1000 - 1;

      // Query journal_entries — sudah ada composite index (user_id, submitted_at)
      const snap = await db.collection(ENTRIES)
        .where('user_id', '==', uid)
        .where('submitted_at', '>=', startMs)
        .where('submitted_at', '<=', endMs)
        .orderBy('submitted_at', 'desc')
        .get();

      const entries = snap.docs.map((d) => d.data());

      // Hitung total poin & breakdown per activity
      let totalPoints = 0;
      const breakdownMap = {};
      for (const e of entries) {
        const pts = e.points_awarded || 0;
        const actName = e.activity_name_snapshot || e.activity_id || 'Unknown';
        totalPoints += pts;
        if (!breakdownMap[actName]) {
          breakdownMap[actName] = { activity_name: actName, count: 0, points: 0 };
        }
        breakdownMap[actName].count += 1;
        breakdownMap[actName].points += pts;
      }

      return res.status(200).json({
        success: true,
        data: {
          username: uid,
          year,
          month,
          total_points: totalPoints,
          entry_count: entries.length,
          breakdown_by_activity: Object.values(breakdownMap),
        },
      });
    } catch (error) {
      console.error('[getMyMonthlyStats]', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // PATCH /api/users/me/groups — user update groups diri sendiri
  async updateMyGroups(req, res) {
    try {
      const { groups } = req.body;
      if (!Array.isArray(groups) || groups.length === 0) {
        return res.status(400).json({ success: false, error: 'Pilih minimal 1 grup' });
      }

      const validGroups = await normalizeGroups(groups);
      if (validGroups.length === 0) {
        return res.status(400).json({ success: false, error: 'Grup yang dipilih tidak valid' });
      }

      await userDAO.updateUser(req.user.username, { groups: validGroups });
      return res.status(200).json({ success: true, message: 'Grup berhasil diperbarui', groups: validGroups });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  async setupSuperAdmin(req, res) {
    try {
      const providedKey = req.headers['x-setup-key'] || req.body.setupKey;
      const expectedKey = process.env.SUPER_ADMIN_SETUP_KEY;
      if (!expectedKey) return res.status(500).json({ success: false, error: 'SUPER_ADMIN_SETUP_KEY belum diset' });
      if (providedKey !== expectedKey) return res.status(403).json({ success: false, error: 'Setup key salah' });

      const { username, fullName, password, email = '', phone_number = '' } = req.body;
      if (!username || !fullName || !password) {
        return res.status(400).json({ success: false, error: 'username, fullName, password wajib' });
      }

      const allGroups = await getAllActiveGroups();
      const existing = await userDAO.findByUsername(username);

      if (existing) {
        const updated = await userDAO.updateUser(username, {
          role: 'super_admin', managedGroups: allGroups, groups: [], isActive: true,
          email: String(email || existing.email || '').trim(),
          phone_number: String(phone_number || existing.phone_number || '').trim(),
          fullName: String(fullName || existing.fullName).trim(),
        });
        const token = buildToken(updated);
        return res.status(200).json({ success: true, message: 'User dipromosikan jadi super_admin', token, user: { username: updated.username, role: updated.role, managedGroups: updated.managedGroups } });
      }

      const hashed = await bcrypt.hash(password, 10);
      const created = await userDAO.createUser({
        fullName: String(fullName).trim(),
        username: String(username).trim(),
        password: hashed,
        email: String(email || '').trim(),
        phone_number: String(phone_number || '').trim(),
        role: 'super_admin',
        groups: [],
        managedGroups: allGroups,
        isActive: true,
      });

      const token = buildToken(created);
      return res.status(201).json({ success: true, message: 'Super admin berhasil dibuat', token, user: { username: created.username, role: created.role, managedGroups: created.managedGroups } });
    } catch (error) {
      return res.status(400).json({ success: false, error: error.message });
    }
  }

  // PUT /api/users/:username/role
  async setUserRole(req, res) {
    try {
      const { username } = req.params;
      const { role, groups = [], managedGroups = [] } = req.body;

      if (!VALID_ROLES.includes(role)) {
        return res.status(400).json({ success: false, error: `Role tidak valid. Pilihan: ${VALID_ROLES.join(', ')}` });
      }

      const existing = await userDAO.findByUsername(username);
      if (!existing) return res.status(404).json({ success: false, error: 'User tidak ditemukan' });

      // Hanya super_admin yang bisa set role super_admin
      if (req.user.role !== 'super_admin' && role === 'super_admin') {
        return res.status(403).json({ success: false, error: 'Hanya super_admin yang bisa set role ini' });
      }

      // Admin bisa set role gembala, tapi managedGroups harus subset dari managedGroups-nya sendiri
      if (req.user.role === 'admin' && role === 'gembala') {
        const adminManaged = req.user.managedGroups || [];
        const requestedManaged = Array.isArray(managedGroups) ? managedGroups : [];
        const normalizedRequested = requestedManaged
          .map((g) => String(g || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''))
          .filter(Boolean);
        const isSubset = normalizedRequested.every((g) => adminManaged.includes(g));
        if (!isSubset) {
          return res.status(403).json({ success: false, error: 'Admin hanya bisa assign managedGroups dalam scope-nya sendiri' });
        }
      }

      const cleanUserGroups = await normalizeGroups(groups);
      let cleanManagedGroups = await normalizeGroups(managedGroups);

      // Batasi admin/gembala hanya boleh 1 managed group
      if (['admin', 'gembala'].includes(role)) {
        if (cleanManagedGroups.length > 1) {
          return res.status(400).json({
            success: false,
            error: 'admin/gembala hanya boleh memiliki 1 managed group',
          });
        }
      }

      // Kalau promote ke gembala/admin tapi managedGroups kosong,
      // pakai groups lama user supaya tidak hilang (dari onboarding)
      if (['gembala', 'admin'].includes(role) && cleanManagedGroups.length === 0) {
        cleanManagedGroups = await normalizeGroups(existing.groups || []);
      }

      // Kalau downgrade ke user tapi groups tidak dikirim,
      // fallback ke managedGroups lama supaya group tidak hilang
      let finalUserGroups = cleanUserGroups;
      if (role === 'user' && finalUserGroups.length === 0) {
        finalUserGroups = await normalizeGroups(existing.managedGroups || []);
      }

      const patch = {
        role,
        groups: role === 'user'
          ? finalUserGroups
          : (['admin', 'gembala'].includes(role) ? cleanManagedGroups : []),
        managedGroups: ['admin', 'gembala', 'super_admin'].includes(role) ? cleanManagedGroups : [],
      };

      const updated = await userDAO.updateUser(username, patch);
      return res.status(200).json({
        success: true,
        message: 'Role user diupdate',
        user: {
          username: updated.username,
          role: updated.role,
          groups: updated.groups || [],
          managedGroups: updated.managedGroups || [],
        },
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  async getAllUsers(req, res) {
    try {
      const raw = await userDAO.getAllUsers();
      const users = Object.entries(raw).map(([username, value]) => ({
        username,
        fullName: value.fullName,
        email: value.email || '',
        phone_number: value.phone_number || '',
        role: value.role,
        groups: value.groups || [],
        managedGroups: value.managedGroups || [],
        isActive: value.isActive !== false,
        createdAt: value.createdAt || null,
      }));
      return res.status(200).json({ success: true, count: users.length, users });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }
}

module.exports = new UserController();