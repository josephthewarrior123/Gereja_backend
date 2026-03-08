require('dotenv').config();
const express = require('express');
const cors = require('cors');

require('./config/firebase');

const userRoutes = require('./routes/userRoutes');
const groupRoutes = require('./routes/groupRoutes');
const journalRoutes = require('./routes/journalRoutes');
const adminRoutes = require('./routes/adminRoutes');
const publicRoutes = require('./routes/publicRoutes');

const app = express();

app.use(
  cors({
    origin: process.env.FRONTEND_URL || true,
    credentials: true,
  })
);
app.use(express.json());

app.get('/', (req, res) => {
  return res.status(200).json({
    success: true,
    message: 'Gereja API (Realtime DB)',
    version: '1.0.0',
    endpoints: {
      setupSuperAdmin: 'POST /api/users/setup-super-admin',
      signup: 'POST /api/users/signup',
      login: 'POST /api/users/login',
      profile: 'GET /api/users/profile',
      listGroups: 'GET /api/groups',
      createGroup: 'POST /api/groups',
      listActivities: 'GET /api/activities',
      submitEntry: 'POST /api/journal/entries',
      myEntries: 'GET /api/journal/my-entries',
      groupEntries: 'GET /api/journal/groups/:group/entries',
      createActivity: 'POST /api/admin/activities',
      updateActivity: 'PATCH /api/admin/activities/:activityId',
    },
  });
});

app.get('/health', (req, res) => {
  return res.status(200).json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString(),
  });
});

app.use('/api', userRoutes);
app.use('/api', groupRoutes);
app.use('/api', publicRoutes);   // GET /api/activities, GET /api/me
app.use('/api', journalRoutes);  // POST /api/journal/entries, GET /api/journal/my-entries, etc
app.use('/api', adminRoutes);    // POST /api/admin/activities, PATCH /api/admin/activities/:id

app.use((req, res) => {
  return res.status(404).json({
    success: false,
    error: 'Route not found',
  });
});

app.use((error, req, res, next) => {
  return res.status(500).json({
    success: false,
    error: 'Internal server error',
    detail: error.message,
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

module.exports = app;