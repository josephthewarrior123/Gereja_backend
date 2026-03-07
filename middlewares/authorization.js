const VALID_GROUPS = ['ranting', 'pemuda'];

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
  if (req.user.role === 'super_admin') {
    return next();
  }

  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }

  const managed = req.user.managed_groups || [];
  if (!managed.length) {
    return res.status(403).json({ success: false, error: 'Admin has no assigned groups' });
  }

  return next();
}

function normalizeGroups(groups) {
  if (!Array.isArray(groups)) {
    return [];
  }
  return groups.filter((group) => VALID_GROUPS.includes(group));
}

module.exports = {
  VALID_GROUPS,
  hasIntersection,
  requireRole,
  requireAdminManagedGroups,
  normalizeGroups,
};
