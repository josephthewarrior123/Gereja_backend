const { auth, db } = require('../config/firebase');

// firebaseAuth — Firebase ID Token auth (dipakai untuk superAdminRoutes)
// User data diambil dari Firestore collection 'users'
async function firebaseAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Missing bearer token' });
    }

    const idToken = authHeader.substring(7);
    const decoded = await auth.verifyIdToken(idToken, true);
    const userRef = db.collection('users').doc(decoded.uid);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      return res.status(403).json({ success: false, error: 'User profile not found' });
    }

    const profile = userSnap.data();
    if (!profile.is_active) {
      return res.status(403).json({ success: false, error: 'User is inactive' });
    }

    req.auth = decoded;
    req.user = {
      uid:            decoded.uid,
      email:          decoded.email || profile.email || null,
      role:           profile.role,
      groups:         Array.isArray(profile.groups)         ? profile.groups         : [],
      managedGroups:  Array.isArray(profile.managed_groups) ? profile.managed_groups : [],
      managed_groups: Array.isArray(profile.managed_groups) ? profile.managed_groups : [],
      profile,
    };
    return next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized',
      detail: error.message,
    });
  }
}

module.exports = firebaseAuth;