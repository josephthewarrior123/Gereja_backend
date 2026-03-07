require('dotenv').config();
const express = require('express');
const cors = require('cors');

require('./config/firebase');

const userRoutes = require('./routes/userRoutes');

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
