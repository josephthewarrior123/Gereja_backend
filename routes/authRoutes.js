// routes/authRoutes.js
const express = require('express');
const router  = express.Router();
const jwt     = require('jsonwebtoken');
const userDAO = require('../dao/userDAO');

const JWT_SECRET     = process.env.JWT_SECRET     || 'change-this-secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

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

// POST /api/auth/google
router.post('/auth/google', async (req, res) => {
  try {
    const { accessToken } = req.body;
    if (!accessToken) {
      return res.status(400).json({ success: false, error: 'accessToken wajib' });
    }

    // Verify & ambil info user dari Google
    const googleRes = await fetch(
      `https://www.googleapis.com/oauth2/v3/userinfo`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!googleRes.ok) {
      return res.status(401).json({ success: false, error: 'Token Google tidak valid' });
    }

    const googleUser = await googleRes.json();
    const email      = googleUser.email;

    if (!email) {
      return res.status(401).json({ success: false, error: 'Tidak dapat mengambil email dari Google' });
    }

    // Cari user berdasarkan email di database
    const allUsers = await userDAO.getAllUsers();
    const found    = Object.entries(allUsers).find(([, v]) => v.email === email);

    // ── Email belum ada → auto register ──────────────────────────────────────
    if (!found) {
      // Buat username dari email, pastikan unik
      let baseUsername = email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '_');
      const taken      = !!allUsers[baseUsername];
      const finalUsername = taken
        ? `${baseUsername}_${Date.now().toString().slice(-4)}`
        : baseUsername;

      await userDAO.createUser({
        username:      finalUsername,
        fullName:      googleUser.name || finalUsername,
        email,
        phone_number:  '',
        password:      '',   // kosong — login via Google
        role:          'user',
        groups:        [],
        managedGroups: [],
        isActive:      true,
      });

      const newUser = await userDAO.findByUsername(finalUsername);
      const token   = buildToken(newUser);

      return res.status(201).json({
        success: true,
        message: 'Akun baru berhasil dibuat via Google',
        token,
        user: {
          username:      newUser.username,
          fullName:      newUser.fullName,
          role:          newUser.role,
          email:         newUser.email,
          groups:        newUser.groups        || [],
          managedGroups: newUser.managedGroups || [],
        },
      });
    }

    // ── Email sudah ada → login biasa ─────────────────────────────────────────
    const [username, userData] = found;

    if (userData.isActive === false) {
      return res.status(403).json({ success: false, error: 'Akun tidak aktif' });
    }

    const user  = { username, ...userData };
    const token = buildToken(user);

    return res.status(200).json({
      success: true,
      message: 'Login berhasil',
      token,
      user: {
        username:      user.username,
        fullName:      user.fullName      || googleUser.name || '',
        role:          user.role,
        email:         user.email         || email,
        groups:        user.groups        || [],
        managedGroups: user.managedGroups || [],
      },
    });

  } catch (err) {
    console.error('[auth/google]', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;