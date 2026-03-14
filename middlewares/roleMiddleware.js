// roleMiddleware.js
// Semua role yang valid di sistem:
//   super_admin  — akses penuh
//   admin        — kelola user & activity dalam managedGroups-nya
//   gembala      — bisa bulk-award ke user dalam managedGroups-nya
//   user         — submit entry untuk diri sendiri

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    return next();
  };
}

module.exports = { requireRole };