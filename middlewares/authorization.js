// authorization.js — middleware helpers

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

// Dipakai untuk route yang butuh managedGroups (admin, gembala, super_admin)
function requireManagedGroups(req, res, next) {
  if (req.user.role === 'super_admin') return next();

  const allowed = ['admin', 'gembala'];
  if (!allowed.includes(req.user.role)) {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }

  const managed = req.user.managedGroups || [];
  if (!managed.length) {
    return res.status(403).json({ success: false, error: 'Kamu belum punya group yang dikelola' });
  }

  return next();
}

function normalizeGroups(groups) {
  if (!Array.isArray(groups)) return [];
  return groups
    .map((g) => String(g || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''))
    .filter(Boolean);
}

module.exports = {
  hasIntersection,
  requireRole,
  requireAdminManagedGroups: requireManagedGroups, // backward-compat alias
  requireManagedGroups,
  normalizeGroups,
};