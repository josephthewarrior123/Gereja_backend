const { auth, db } = require('../config/firebase');

const SETUP_KEY = process.env.SUPER_ADMIN_SETUP_KEY;

function normalizeGroups(groups) {
  if (!Array.isArray(groups)) return [];
  return groups
    .map((g) => String(g || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''))
    .filter(Boolean);
}

class SuperAdminController {
  // ─────────────────────────────────────────────────────────────────────────────
  // POST /api/super-admin/setup
  // Buat atau promote user menjadi super_admin.
  // Diamankan dengan SUPER_ADMIN_SETUP_KEY di header X-Setup-Key.
  // ─────────────────────────────────────────────────────────────────────────────
  async createSuperAdmin(req, res) {
    try {
      const providedKey = req.headers['x-setup-key'];
      if (!SETUP_KEY) {
        return res.status(500).json({ success: false, error: 'SUPER_ADMIN_SETUP_KEY is not configured on the server' });
      }
      if (!providedKey || providedKey !== SETUP_KEY) {
        return res.status(401).json({ success: false, error: 'Invalid or missing X-Setup-Key header' });
      }

      const { uid, email, name, phone_number } = req.body;
      if (!uid && !email) {
        return res.status(400).json({ success: false, error: 'uid or email is required' });
      }

      let userRecord;
      if (uid) userRecord = await auth.getUser(uid);
      else userRecord = await auth.getUserByEmail(email);

      const userUid = userRecord.uid;
      const now = new Date().toISOString();

      await db.collection('users').doc(userUid).set(
        {
          name: name || userRecord.displayName || '',
          email: userRecord.email || email || '',
          phone_number: phone_number || userRecord.phoneNumber || '',
          role: 'super_admin',
          groups: [],
          managed_groups: [],
          is_active: true,
          updated_at: now,
          created_at: now,
        },
        { merge: true }
      );

      await auth.setCustomUserClaims(userUid, { role: 'super_admin', managed_groups: [] });

      return res.status(200).json({
        success: true,
        message: 'Super admin created. Ask the user to re-login to refresh their token.',
        data: { uid: userUid, role: 'super_admin' },
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /api/super-admin/admins
  // Buat atau promote user menjadi admin.
  // ─────────────────────────────────────────────────────────────────────────────
  async createOrPromoteAdmin(req, res) {
    try {
      const { uid, email, name, phone_number, managed_groups = [] } = req.body;
      if (!uid && !email) {
        return res.status(400).json({ success: false, error: 'uid or email is required' });
      }

      let userRecord;
      if (uid) userRecord = await auth.getUser(uid);
      else userRecord = await auth.getUserByEmail(email);

      const cleanManagedGroups = normalizeGroups(managed_groups);
      const userUid = userRecord.uid;
      const now = new Date().toISOString();

      await db.collection('users').doc(userUid).set(
        {
          name: name || userRecord.displayName || '',
          email: userRecord.email || email || '',
          phone_number: phone_number || userRecord.phoneNumber || '',
          role: 'admin',
          groups: [],
          managed_groups: cleanManagedGroups,
          is_active: true,
          updated_at: now,
          created_at: now,
        },
        { merge: true }
      );

      try {
        await auth.setCustomUserClaims(userUid, { role: 'admin', managed_groups: cleanManagedGroups });
      } catch (authErr) {
        console.warn(`[createOrPromoteAdmin] Could not set claims for ${userUid} (no Firebase auth record):`, authErr.message);
      }

      return res.status(200).json({
        success: true,
        message: 'Admin account updated',
        data: { uid: userUid, role: 'admin', managed_groups: cleanManagedGroups },
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /api/super-admin/gembala
  // Buat atau promote user menjadi gembala.
  // Body: { uid?, email?, name?, phone_number?, managed_groups: [] }
  // ─────────────────────────────────────────────────────────────────────────────
  async createOrPromoteGembala(req, res) {
    try {
      const { username, managed_groups = [] } = req.body;
      if (!username) {
        return res.status(400).json({ success: false, error: 'username is required' });
      }

      const userDAO = require('../dao/userDAO');
      const existingUser = await userDAO.findByUsername(username);

      if (!existingUser) {
        return res.status(404).json({ success: false, error: 'User not found in Firestore' });
      }

      const cleanManagedGroups = normalizeGroups(managed_groups);
      const userUid = existingUser.id; // userDAO returns the document ID mapped to id
      const now = new Date().toISOString();

      await db.collection('users').doc(userUid).set(
        {
          role: 'gembala',
          groups: [],         // gembala tidak punya "groups" user biasa
          managedGroups: cleanManagedGroups,
          managed_groups: cleanManagedGroups,
          is_active: true,
          updated_at: now,
        },
        { merge: true }
      );

      try {
        await auth.setCustomUserClaims(userUid, { role: 'gembala', managed_groups: cleanManagedGroups });
      } catch (authErr) {
        console.warn(`[createOrPromoteGembala] Could not set claims for ${username} (no Firebase auth record):`, authErr.message);
      }

      return res.status(200).json({
        success: true,
        message: 'Gembala account updated. Ask the user to re-login to refresh their token.',
        data: { username, uid: userUid, role: 'gembala', managed_groups: cleanManagedGroups },
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PATCH /api/super-admin/admins/:uid/permissions
  // Update permissions admin yang sudah ada.
  // ─────────────────────────────────────────────────────────────────────────────
  async setAdminPermissions(req, res) {
    try {
      const { uid } = req.params;
      const { managed_groups = [], is_active } = req.body;
      const cleanManagedGroups = normalizeGroups(managed_groups);

      const ref = db.collection('users').doc(uid);
      const snap = await ref.get();
      if (!snap.exists) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      const existing = snap.data();
      if (existing.role !== 'admin') {
        return res.status(400).json({ success: false, error: 'Target user is not admin' });
      }

      await ref.update({
        managed_groups: cleanManagedGroups,
        is_active: typeof is_active === 'boolean' ? is_active : existing.is_active,
        updated_at: new Date().toISOString(),
      });
      try {
        await auth.setCustomUserClaims(uid, { role: 'admin', managed_groups: cleanManagedGroups });
      } catch (authErr) {
        console.warn(`[setAdminPermissions] Could not set claims for ${uid} (no Firebase auth record):`, authErr.message);
      }

      return res.status(200).json({ success: true, message: 'Admin permissions updated' });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PATCH /api/super-admin/gembala/:uid/permissions
  // Update managed_groups / is_active gembala yang sudah ada.
  // ─────────────────────────────────────────────────────────────────────────────
  async setGembalaPermissions(req, res) {
    try {
      const { uid } = req.params;
      const { managed_groups = [], is_active } = req.body;
      const cleanManagedGroups = normalizeGroups(managed_groups);

      const ref = db.collection('users').doc(uid);
      const snap = await ref.get();
      if (!snap.exists) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      const existing = snap.data();
      if (existing.role !== 'gembala') {
        return res.status(400).json({ success: false, error: 'Target user is not gembala' });
      }

      await ref.update({
        managed_groups: cleanManagedGroups,
        is_active: typeof is_active === 'boolean' ? is_active : existing.is_active,
        updated_at: new Date().toISOString(),
      });
      try {
        await auth.setCustomUserClaims(uid, { role: 'gembala', managed_groups: cleanManagedGroups });
      } catch (authErr) {
        console.warn(`[setGembalaPermissions] Could not set claims for ${uid} (no Firebase auth record):`, authErr.message);
      }

      return res.status(200).json({ success: true, message: 'Gembala permissions updated' });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }
}

module.exports = new SuperAdminController();