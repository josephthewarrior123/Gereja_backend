// authorization.js — middleware helpers
// VALID_GROUPS dihapus karena group sekarang dinamis dari DB (Firestore)

function hasIntersection(a = [], b = []) {
  const set = new Set(a);
  return b.some((item) => set.has(item));
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    return next();
  };
}

function requireAdminManagedGroups(req, res, next) {
  if (req.user.role === 'super_admin') return next();

  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }

  const managed = req.user.managedGroups || req.user.managed_groups || [];
  if (!managed.length) {
    return res.status(403).json({ success: false, error: 'Admin has no assigned groups' });
  }

  return next();
}

// Normalisasi group — tidak lagi filter by hardcoded list
// Validasi apakah group valid dilakukan di controller via groupDAO.getActiveGroupKeys()
function normalizeGroups(groups) {
  if (!Array.isArray(groups)) return [];
  return groups
    .map((g) => String(g || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''))
    .filter(Boolean);
}

module.exports = {
  hasIntersection,
  requireRole,
  requireAdminManagedGroups,
  normalizeGroups,
};