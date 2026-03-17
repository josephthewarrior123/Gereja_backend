/* eslint-disable no-console */
const { db } = require('../config/firebase');

const ENTRIES = 'journal_entries';
const USER_GROUP_STATS = 'user_group_stats';

function groupStatsDocId(userId, group) {
  return `${userId}__${group}`;
}

function usage() {
  console.log('Usage: node scripts/rebuildUserGroupStats.js [--group pemuda]');
  process.exit(1);
}

function parseArgs(argv) {
  const args = { group: null };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--group') args.group = argv[i + 1];
    if (a === '--help' || a === '-h') usage();
  }
  return args;
}

async function main() {
  const { group } = parseArgs(process.argv);
  console.log('Rebuilding user_group_stats...', { group: group || 'ALL' });

  const aggregates = new Map(); // key = `${userId}__${group}` -> { user_id, group, total_points, entry_count }

  let processed = 0;
  let lastDoc = null;
  const pageSize = 500;

  while (true) {
    let q = db.collection(ENTRIES).orderBy('submitted_at', 'asc').limit(pageSize);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      const e = doc.data() || {};
      const userId = e.user_id;
      const points = Number(e.points_awarded) || 0;
      const groups = Array.isArray(e.user_groups) ? e.user_groups : [];

      if (!userId || groups.length === 0) continue;
      const relevant = group ? groups.filter((g) => g === group) : groups;
      if (relevant.length === 0) continue;

      for (const g of relevant) {
        const key = groupStatsDocId(userId, g);
        const cur = aggregates.get(key) || { user_id: userId, group: g, total_points: 0, entry_count: 0 };
        cur.total_points += points;
        cur.entry_count += 1;
        aggregates.set(key, cur);
      }
    }

    processed += snap.size;
    lastDoc = snap.docs[snap.docs.length - 1];
    if (processed % 2000 === 0) console.log('Progress:', { processed, aggregates: aggregates.size });
  }

  console.log('Writing user_group_stats...', { docs: aggregates.size });
  const bulk = db.bulkWriter();
  bulk.onWriteError((err) => {
    console.error('[BulkWriter error]', err);
    return true;
  });

  const now = Date.now();
  let written = 0;
  for (const [docId, data] of aggregates.entries()) {
    const ref = db.collection(USER_GROUP_STATS).doc(docId);
    bulk.set(ref, { ...data, updated_at: now }, { merge: true });
    written += 1;
    if (written % 2000 === 0) console.log('Write progress:', { written, total: aggregates.size });
  }

  await bulk.close();
  console.log('Done rebuild user_group_stats.', { processed_entries: processed, written_docs: aggregates.size });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

