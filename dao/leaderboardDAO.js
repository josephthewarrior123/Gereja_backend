const { db } = require('../config/firebase');

const USER_STATS = 'user_stats';
const USER_GROUP_STATS = 'user_group_stats';
const USERS = 'users';
const ENTRIES = 'journal_entries';

class LeaderboardDAO {
  async getGlobalLeaderboard(limit = 100) {
    const statsSnap = await db.collection(USER_STATS)
      .orderBy('total_points', 'desc')
      .limit(limit)
      .get();

    if (statsSnap.empty) return [];

    const statsData = statsSnap.docs.map(doc => ({
      user_id: doc.id,
      total_points: doc.data().total_points || 0,
      entry_count: doc.data().entry_count || 0,
    }));

    const userIds = statsData.map(s => s.user_id);
    const usersMap = {};
    for (let i = 0; i < userIds.length; i += 30) {
      const batchIds = userIds.slice(i, i + 30);
      const userSnap = await db.collection(USERS).where('__name__', 'in', batchIds).get();
      userSnap.forEach(doc => { usersMap[doc.id] = doc.data(); });
    }

    return statsData.map((stat, index) => {
      const user = usersMap[stat.user_id] || {};
      return {
        rank: index + 1,
        username: stat.user_id,
        fullName: user.fullName || 'Unknown',
        total_points: stat.total_points,
        entry_count: stat.entry_count,
        groups: user.groups || [],
      };
    });
  }

  async getGroupTop3(group) {
    const full = await this.getGroupLeaderboard(group, 3);
    return full.slice(0, 3);
  }

  async getGroupLeaderboard(group, limit = 100) {
    const usersSnap = await db.collection(USERS)
      .where('groups', 'array-contains', group)
      .get();
    if (usersSnap.empty) return [];

    const usersMap = {};
    const userIds = [];
    usersSnap.forEach((doc) => {
      usersMap[doc.id] = doc.data();
      userIds.push(doc.id);
    });

    const statsSnap = await db.collection(USER_GROUP_STATS)
      .where('group', '==', group)
      .get();
    const statsMap = {};
    statsSnap.forEach((doc) => {
      const d = doc.data() || {};
      if (!d.user_id) return;
      statsMap[d.user_id] = d;
    });

    const leaderboard = userIds.map((uid) => {
      const stat = statsMap[uid] || {};
      const user = usersMap[uid] || {};
      return {
        username: uid,
        fullName: user.fullName || 'Unknown',
        total_points: stat.total_points || 0,
        entry_count: stat.entry_count || 0,
        groups: user.groups || [],
      };
    });

    leaderboard.sort((a, b) => b.total_points - a.total_points);
    return leaderboard.slice(0, limit).map((u, index) => ({ rank: index + 1, ...u }));
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Helper: range timestamp awal-akhir bulan (WIB UTC+7)
  // ─────────────────────────────────────────────────────────────────────────────
  _monthRange(year, month) {
    const startMs = Date.UTC(year, month - 1, 1) - 7 * 60 * 60 * 1000;
    const endMs = Date.UTC(year, month, 1) - 7 * 60 * 60 * 1000 - 1;
    return { startMs, endMs };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Leaderboard global bulan tertentu
  // Aggregate points_awarded dari journal_entries, sort desc.
  // ─────────────────────────────────────────────────────────────────────────────
  async getMonthlyGlobalLeaderboard(year, month, limit = 100) {
    const { startMs, endMs } = this._monthRange(year, month);

    const snap = await db.collection(ENTRIES)
      .where('submitted_at', '>=', startMs)
      .where('submitted_at', '<=', endMs)
      .get();

    const pointsMap = {};
    const countMap = {};
    snap.docs.forEach((d) => {
      const e = d.data();
      const uid = e.user_id;
      if (!uid) return;
      pointsMap[uid] = (pointsMap[uid] || 0) + (e.points_awarded || 0);
      countMap[uid] = (countMap[uid] || 0) + 1;
    });

    if (!Object.keys(pointsMap).length) return [];

    // Ambil profil user (fullName, groups) batch 30
    const userIds = Object.keys(pointsMap);
    const usersMap = {};
    for (let i = 0; i < userIds.length; i += 30) {
      const batch = userIds.slice(i, i + 30);
      const usersSnap = await db.collection(USERS).where('__name__', 'in', batch).get();
      usersSnap.forEach((doc) => { usersMap[doc.id] = doc.data(); });
    }

    return userIds
      .map((uid) => ({
        username: uid,
        fullName: usersMap[uid]?.fullName || 'Unknown',
        groups: usersMap[uid]?.groups || [],
        total_points: pointsMap[uid],
        entry_count: countMap[uid],
      }))
      .sort((a, b) => b.total_points - a.total_points)
      .slice(0, limit)
      .map((u, i) => ({ rank: i + 1, ...u }));
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Leaderboard group bulan tertentu
  // Semua member grup ditampilkan, termasuk yang 0 poin bulan ini.
  // ─────────────────────────────────────────────────────────────────────────────
  async getMonthlyGroupLeaderboard(group, year, month, limit = 100) {
    const { startMs, endMs } = this._monthRange(year, month);

    // 1) Semua member grup (biar yang 0 poin bulan ini tetap tampil)
    const usersSnap = await db.collection(USERS)
      .where('groups', 'array-contains', group)
      .get();
    if (usersSnap.empty) return [];

    const usersMap = {};
    usersSnap.forEach((doc) => { usersMap[doc.id] = doc.data(); });
    const userIds = Object.keys(usersMap);

    // 2) Entries bulan ini untuk group ini — pakai index (user_groups CONTAINS, submitted_at)
    const snap = await db.collection(ENTRIES)
      .where('user_groups', 'array-contains', group)
      .where('submitted_at', '>=', startMs)
      .where('submitted_at', '<=', endMs)
      .get();

    const pointsMap = {};
    const countMap = {};
    snap.docs.forEach((d) => {
      const e = d.data();
      const uid = e.user_id;
      if (!uid) return;
      pointsMap[uid] = (pointsMap[uid] || 0) + (e.points_awarded || 0);
      countMap[uid] = (countMap[uid] || 0) + 1;
    });

    // 3) Semua member, 0 poin jika tidak ada entry bulan ini
    return userIds
      .map((uid) => ({
        username: uid,
        fullName: usersMap[uid]?.fullName || 'Unknown',
        groups: usersMap[uid]?.groups || [],
        total_points: pointsMap[uid] || 0,
        entry_count: countMap[uid] || 0,
      }))
      .sort((a, b) => b.total_points - a.total_points)
      .slice(0, limit)
      .map((u, i) => ({ rank: i + 1, ...u }));
  }
}

module.exports = new LeaderboardDAO();