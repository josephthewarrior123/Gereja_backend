const { db } = require('../config/firebase');

const USER_STATS = 'user_stats';
const USERS = 'users';

class LeaderboardDAO {
  async getGlobalLeaderboard(limit = 100) {
    // Kurangi data yang diambil menjadi ID dan total_points
    const statsSnap = await db.collection(USER_STATS)
      .orderBy('total_points', 'desc')
      .limit(limit)
      .get();
      
    if (statsSnap.empty) return [];

    const statsData = statsSnap.docs.map(doc => ({
      user_id: doc.id,
      total_points: doc.data().total_points || 0,
      entry_count: doc.data().entry_count || 0
    }));

    // Ambil data user untuk melengkapi profile (nama dan grup)
    // Karena max in clause adalah 30, kalau limitnya lebih dari 30 kita pecah (atau ambil satu per satu)
    // Untuk simpelnya, karena ini realtime app, mari kita ambil manual atau split batch
    const userIds = statsData.map(s => s.user_id);
    const usersMap = {};

    // split array into batches of 30 for firestore query IN clause
    for (let i = 0; i < userIds.length; i += 30) {
      const batchIds = userIds.slice(i, i + 30);
      const userSnap = await db.collection(USERS).where('__name__', 'in', batchIds).get();
      userSnap.forEach(doc => {
        usersMap[doc.id] = doc.data();
      });
    }

    // Gabungkan
    return statsData.map((stat, index) => {
      const user = usersMap[stat.user_id] || {};
      return {
        rank: index + 1,
        username: stat.user_id,
        fullName: user.fullName || 'Unknown',
        total_points: stat.total_points,
        entry_count: stat.entry_count,
        groups: user.groups || []
      };
    });
  }

  async getGroupTop3(group) {
    // 1. Ambil semua users di grup
    const usersSnap = await db.collection(USERS)
      .where('groups', 'array-contains', group)
      .get();

    if (usersSnap.empty) return [];

    const usersMap = {};
    const userIds = [];
    usersSnap.forEach(doc => {
      usersMap[doc.id] = doc.data();
      userIds.push(doc.id);
    });

    // 2. Ambil stats batch
    const statsMap = {};
    for (let i = 0; i < userIds.length; i += 30) {
      const batchIds = userIds.slice(i, i + 30);
      const statsSnap = await db.collection(USER_STATS).where('__name__', 'in', batchIds).get();
      statsSnap.forEach(doc => {
        statsMap[doc.id] = doc.data();
      });
    }

    // 3. Sort di memory, ambil top 3
    return userIds
      .map(uid => {
        const stat = statsMap[uid] || {};
        const user = usersMap[uid];
        return {
          username: uid,
          fullName: user.fullName || 'Unknown',
          total_points: stat.total_points || 0,
          entry_count: stat.entry_count || 0,
          groups: user.groups || []
        };
      })
      .sort((a, b) => b.total_points - a.total_points)
      .slice(0, 3)
      .map((user, index) => ({ rank: index + 1, ...user }));
  }

  async getGroupLeaderboard(group, limit = 100) {
    // 1. Ambil semua users di dalam grup tersebut
    const usersSnap = await db.collection(USERS)
      .where('groups', 'array-contains', group)
      .get();

    if (usersSnap.empty) return [];

    const usersMap = {};
    const userIds = [];
    usersSnap.forEach(doc => {
      usersMap[doc.id] = doc.data();
      userIds.push(doc.id);
    });

    // 2. Ambil statistik untuk para user tersebut
    const statsMap = {};
    for (let i = 0; i < userIds.length; i += 30) {
      const batchIds = userIds.slice(i, i + 30);
      const statsSnap = await db.collection(USER_STATS).where('__name__', 'in', batchIds).get();
      statsSnap.forEach(doc => {
        statsMap[doc.id] = doc.data();
      });
    }

    // 3. Gabungkan dan urutkan di memory berdasarkan total_points, lalu potong sesuai limit
    const leaderboard = userIds.map(uid => {
      const stat = statsMap[uid] || { total_points: 0, entry_count: 0 };
      const user = usersMap[uid];
      return {
        username: uid,
        fullName: user.fullName || 'Unknown',
        total_points: stat.total_points || 0,
        entry_count: stat.entry_count || 0,
        groups: user.groups || []
      };
    });

    // Sort descending by points
    leaderboard.sort((a, b) => b.total_points - a.total_points);

    // Potong, map rank
    return leaderboard.slice(0, limit).map((user, index) => ({
      rank: index + 1,
      ...user
    }));
  }
}

module.exports = new LeaderboardDAO();