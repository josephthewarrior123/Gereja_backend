const jwt = require('jsonwebtoken');
const userDAO = require('../dao/userDAO');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';

async function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await userDAO.findByUsername(decoded.username);

    if (!user) {
      return res.status(401).json({ success: false, error: 'User not found' });
    }

    if (user.isActive === false) {
      return res.status(403).json({ success: false, error: 'User inactive' });
    }

    req.user = {
      id: user.id,
      username: user.username,
      role: user.role,
      groups: Array.isArray(user.groups) ? user.groups : [],
      managedGroups: Array.isArray(user.managedGroups) ? user.managedGroups : [],
    };
    return next();
  } catch (error) {
    return res.status(401).json({ success: false, error: 'Invalid token' });
  }
}

module.exports = authMiddleware;
