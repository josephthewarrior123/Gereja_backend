const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const userDAO = require('../dao/userDAO');
const groupDAO = require('../dao/groupDAO');

const JWT_SECRET     = process.env.JWT_SECRET || 'change-this-secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const VALID_ROLES    = ['super_admin', 'admin', 'user'];

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
      username:      user.username,
      role:          user.role,
      groups:        user.groups        || [],
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

      const hashed      = await bcrypt.hash(password, 10);
      const cleanGroups = groups.length > 0 ? await normalizeGroups(groups) : [];

      const newUser = await userDAO.createUser({
        fullName:     String(fullName).trim(),
        username:     String(username).trim(),
        password:     hashed,
        email:        String(email || '').trim(),
        phone_number: String(phone_number || '').trim(),
        role:         'user',
        groups:       cleanGroups,
        managedGroups: [],
        isActive:     true,
      });

      const token = buildToken(newUser);
      return res.status(201).json({
        success: true,
        message: 'Signup berhasil',
        token,
        user: { username: newUser.username, fullName: newUser.fullName, role: newUser.role, groups: newUser.groups },
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
          username:      user.username,
          fullName:      user.fullName,
          role:          user.role,
          groups:        user.groups        || [],
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
        username:      user.username,
        fullName:      user.fullName,
        email:         user.email         || '',
        phone_number:  user.phone_number  || '',
        role:          user.role,
        groups:        user.groups        || [],
        managedGroups: user.managedGroups || [],
        createdAt:     user.createdAt,
      },
    });
  }

  // PATCH /api/users/me/groups — user update groups diri sendiri
  async updateMyGroups(req, res) {
    try {
      const { groups } = req.body;

      if (!Array.isArray(groups) || groups.length === 0) {
        return res.status(400).json({ success: false, error: 'Pilih minimal 1 grup' });
      }

      // Validasi — hanya grup aktif yang boleh dipilih
      const validGroups = await normalizeGroups(groups);
      if (validGroups.length === 0) {
        return res.status(400).json({ success: false, error: 'Grup yang dipilih tidak valid' });
      }

      await userDAO.updateUser(req.user.username, { groups: validGroups });

      return res.status(200).json({
        success: true,
        message: 'Grup berhasil diperbarui',
        groups: validGroups,
      });
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
      const existing  = await userDAO.findByUsername(username);

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

      const hashed  = await bcrypt.hash(password, 10);
      const created = await userDAO.createUser({
        fullName: String(fullName).trim(), username: String(username).trim(),
        password: hashed, email: String(email || '').trim(),
        phone_number: String(phone_number || '').trim(),
        role: 'super_admin', groups: [], managedGroups: allGroups, isActive: true,
      });

      const token = buildToken(created);
      return res.status(201).json({ success: true, message: 'Super admin berhasil dibuat', token, user: { username: created.username, role: created.role, managedGroups: created.managedGroups } });
    } catch (error) {
      return res.status(400).json({ success: false, error: error.message });
    }
  }

  async setUserRole(req, res) {
    try {
      const { username } = req.params;
      const { role, groups = [], managedGroups = [] } = req.body;

      if (!VALID_ROLES.includes(role)) return res.status(400).json({ success: false, error: 'Role tidak valid' });

      const existing = await userDAO.findByUsername(username);
      if (!existing) return res.status(404).json({ success: false, error: 'User tidak ditemukan' });

      if (req.user.role !== 'super_admin' && role === 'super_admin') {
        return res.status(403).json({ success: false, error: 'Hanya super_admin yang bisa set super_admin' });
      }

      const cleanUserGroups    = await normalizeGroups(groups);
      const cleanManagedGroups = await normalizeGroups(managedGroups);
      const patch = {
        role,
        groups:        role === 'user'                            ? cleanUserGroups    : [],
        managedGroups: role === 'admin' || role === 'super_admin' ? cleanManagedGroups : [],
      };

      const updated = await userDAO.updateUser(username, patch);
      return res.status(200).json({ success: true, message: 'Role user diupdate', user: { username: updated.username, role: updated.role, groups: updated.groups || [], managedGroups: updated.managedGroups || [] } });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  async getAllUsers(req, res) {
    try {
      const raw   = await userDAO.getAllUsers();
      const users = Object.entries(raw).map(([username, value]) => ({
        username,
        fullName:      value.fullName,
        email:         value.email         || '',
        phone_number:  value.phone_number  || '',
        role:          value.role,
        groups:        value.groups        || [],
        managedGroups: value.managedGroups || [],
        isActive:      value.isActive !== false,
        createdAt:     value.createdAt     || null,
      }));
      return res.status(200).json({ success: true, count: users.length, users });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }
}

module.exports = new UserController();