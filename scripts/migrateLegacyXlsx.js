/* eslint-disable no-console */
const path = require('path');
const xlsx = require('xlsx');
const { db } = require('../config/firebase');

const USERS = 'users';
const ACTIVITIES = 'activities';
const ENTRIES = 'journal_entries';
const LEDGER = 'points_ledger';
const USER_STATS = 'user_stats';

function excelDateToMillis(value) {
  if (value == null || value === '') return null;

  // If already a Date
  if (value instanceof Date && !isNaN(value.getTime())) return value.getTime();

  // Excel serial date (number)
  if (typeof value === 'number' && !Number.isNaN(value)) {
    const parsed = xlsx.SSF.parse_date_code(value);
    if (parsed && parsed.y && parsed.m && parsed.d) {
      return new Date(parsed.y, parsed.m - 1, parsed.d, parsed.H || 0, parsed.M || 0, parsed.S || 0).getTime();
    }
  }

  // String date
  const n = Number(value);
  if (!Number.isNaN(n) && n > 10000) {
    // could be epoch ms
    return n;
  }

  const dt = new Date(String(value));
  if (!isNaN(dt.getTime())) return dt.getTime();

  // Try MM/DD/YYYY
  const s = String(value).trim();
  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (mdy) {
    const mm = parseInt(mdy[1], 10);
    const dd = parseInt(mdy[2], 10);
    const yyyy = parseInt(mdy[3], 10);
    return new Date(yyyy, mm - 1, dd).getTime();
  }

  return null;
}

async function findUserByEmail(emailRaw) {
  const email = String(emailRaw || '').trim().toLowerCase();
  if (!email) return null;
  const snap = await db.collection(USERS).where('email', '==', email).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() };
}

async function findActivityByName(nameRaw, group) {
  const name = String(nameRaw || '').trim();
  if (!name) return null;

  // Fast path: exact match
  const snap = await db.collection(ACTIVITIES).where('name', '==', name).limit(10).get();
  if (snap.empty) return null;

  const candidates = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (!group) return candidates[0];
  const inGroup = candidates.find((a) => Array.isArray(a.groups) && a.groups.includes(group));
  return inGroup || candidates[0];
}

function makeCaches() {
  return {
    usersByEmail: new Map(),      // email -> user | null
    activitiesByName: new Map(),  // name -> activity | null
  };
}

async function findUserByEmailCached(emailRaw, cache) {
  const email = String(emailRaw || '').trim().toLowerCase();
  if (!email) return null;
  if (cache.usersByEmail.has(email)) return cache.usersByEmail.get(email);
  const user = await findUserByEmail(email);
  cache.usersByEmail.set(email, user);
  return user;
}

async function findActivityByNameCached(nameRaw, group, cache) {
  const name = String(nameRaw || '').trim();
  if (!name) return null;
  // group-specific activity names should still be unique in this app; cache by exact name.
  if (cache.activitiesByName.has(name)) return cache.activitiesByName.get(name);
  const activity = await findActivityByName(name, group);
  cache.activitiesByName.set(name, activity);
  return activity;
}

async function migrateRow({ id, timestamp, activityName, email, group, dryRun, cache }) {
  const entryId = String(id || '').trim();
  if (!entryId) return { status: 'skipped', reason: 'missing_id' };

  const user = await findUserByEmailCached(email, cache);
  if (!user) return { status: 'skipped', reason: 'user_not_found', entryId, email };

  const activity = await findActivityByNameCached(activityName, group, cache);
  if (!activity) return { status: 'skipped', reason: 'activity_not_found', entryId, activityName };

  const userId = user.username || user.id;
  const tsMillis = excelDateToMillis(timestamp) || Date.now();
  const now = Date.now();

  const entryRef = db.collection(ENTRIES).doc(entryId);
  const ledgerRef = db.collection(LEDGER).doc(`mig_${entryId}`);
  const statsRef = db.collection(USER_STATS).doc(userId);

  if (dryRun) {
    return {
      status: 'dry_run',
      entryId,
      userId,
      activity_id: activity.id,
      points: Number(activity.points) || 0,
      timestamp_ms: tsMillis,
    };
  }

  const points = Number(activity.points) || 0;

  // Legacy path (kept for reference): per-row transaction.
  // We now migrate in bulk in main() for performance.
  await db.runTransaction(async (t) => {
    const existingEntry = await t.get(entryRef);
    if (existingEntry.exists) return;

    const statsSnap = await t.get(statsRef);
    const current = statsSnap.exists ? statsSnap.data() : { total_points: 0, entry_count: 0 };

    t.create(entryRef, {
      id: entryId,
      user_id: userId,
      user_groups: Array.isArray(user.groups) ? user.groups : [],
      activity_id: activity.id,
      activity_name_snapshot: activity.name,
      data: {},
      timestamp: tsMillis,
      submitted_at: tsMillis,
      submitted_by: 'migration',
      points_awarded: points,
      status: 'approved',
      awarded_by: null,
      bulk_award: false,
      migrated_from: 'xlsx',
      migrated_at: now,
    });

    t.create(ledgerRef, {
      id: ledgerRef.id,
      user_id: userId,
      entry_id: entryId,
      points_delta: points,
      reason: 'migration_xlsx',
      created_at: now,
    });

    t.set(statsRef, {
      user_id: userId,
      total_points: (current.total_points || 0) + points,
      entry_count: (current.entry_count || 0) + 1,
      updated_at: now,
    }, { merge: true });
  });

  return { status: 'migrated', entryId, userId };
}

function usage() {
  console.log('Usage: node scripts/migrateLegacyXlsx.js --file <path.xlsx> [--sheet <name>] [--group pemuda] [--dry-run] [--print-headers]');
  process.exit(1);
}

function parseArgs(argv) {
  const args = { file: null, sheet: null, group: 'pemuda', dryRun: false, printHeaders: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--file') args.file = argv[i + 1];
    if (a === '--sheet') args.sheet = argv[i + 1];
    if (a === '--group') args.group = argv[i + 1];
    if (a === '--dry-run') args.dryRun = true;
    if (a === '--print-headers') args.printHeaders = true;
  }
  return args;
}

async function main() {
  const { file, sheet, group, dryRun, printHeaders } = parseArgs(process.argv);
  if (!file) usage();

  const abs = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
  const wb = xlsx.readFile(abs, { cellDates: true });
  const sheetName = sheet || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) {
    console.error(`Sheet not found: ${sheetName}`);
    process.exit(1);
  }

  const rows = xlsx.utils.sheet_to_json(ws, { defval: '' });
  console.log(`Loaded ${rows.length} rows from sheet '${sheetName}'. dryRun=${dryRun}`);

  if (printHeaders) {
    const first = rows[0] || {};
    console.log('Headers:', Object.keys(first));
    process.exit(0);
  }

  const cache = makeCaches();

  let migrated = 0;
  let exists = 0;
  let skipped = 0;
  let ok = 0;
  let checked = 0;

  // DRY RUN: just validate mapping, count ok/skipped
  if (dryRun) {
    for (const r of rows) {
      checked += 1;
      const result = await migrateRow({
        id: r.ID || r.Id || r.id,
        timestamp: r.Timestamp || r.timestamp || r.DATE || r.Date,
        activityName: r.Activity || r.activity || r['Activity Name'] || r['activity_name'],
        email: r['Email Address'] || r.Email || r.email,
        group,
        dryRun: true,
        cache,
      });

      if (result.status === 'dry_run') ok += 1;
      else if (result.status === 'skipped') {
        skipped += 1;
        console.log('[SKIP]', result.reason, { entryId: result.entryId, email: result.email, activityName: result.activityName });
      }

      if (checked % 250 === 0) {
        console.log('Progress (dry-run):', { checked, ok, skipped });
      }
    }
  } else {
    // MIGRATE: bulk create entries+ledger, then update user_stats per user
    const bulk = db.bulkWriter();
    const perUserDelta = new Map(); // userId -> { points, count }
    const now = Date.now();

    function addUserDelta(userId, points) {
      const cur = perUserDelta.get(userId) || { points: 0, count: 0 };
      cur.points += points;
      cur.count += 1;
      perUserDelta.set(userId, cur);
    }

    bulk.onWriteError((err) => {
      // Ignore already exists (idempotent rerun)
      const code = err?.code || err?.status;
      if (code === 6 || code === 'ALREADY_EXISTS') {
        return false;
      }
      console.error('[BulkWriter error]', err);
      return true;
    });

    for (const r of rows) {
      checked += 1;
      const id = r.ID || r.Id || r.id;
      const timestamp = r.Timestamp || r.timestamp || r.DATE || r.Date;
      const activityName = r.Activity || r.activity || r['Activity Name'] || r['activity_name'];
      const email = r['Email Address'] || r.Email || r.email;

      const entryId = String(id || '').trim();
      if (!entryId) {
        skipped += 1;
        continue;
      }

      const user = await findUserByEmailCached(email, cache);
      if (!user) {
        skipped += 1;
        continue;
      }

      const activity = await findActivityByNameCached(activityName, group, cache);
      if (!activity) {
        skipped += 1;
        continue;
      }

      const userId = user.username || user.id;
      const tsMillis = excelDateToMillis(timestamp) || Date.now();
      const points = Number(activity.points) || 0;

      const entryRef = db.collection(ENTRIES).doc(entryId);
      const ledgerRef = db.collection(LEDGER).doc(`mig_${entryId}`);

      const entryData = {
        id: entryId,
        user_id: userId,
        user_groups: Array.isArray(user.groups) ? user.groups : [],
        activity_id: activity.id,
        activity_name_snapshot: activity.name,
        data: {},
        timestamp: tsMillis,
        submitted_at: tsMillis,
        submitted_by: 'migration',
        points_awarded: points,
        status: 'approved',
        awarded_by: null,
        bulk_award: false,
        migrated_from: 'xlsx',
        migrated_at: now,
      };

      const ledgerData = {
        id: ledgerRef.id,
        user_id: userId,
        entry_id: entryId,
        points_delta: points,
        reason: 'migration_xlsx',
        created_at: now,
      };

      // Create (fails if exists) keeps idempotency
      bulk.create(entryRef, entryData).then(
        () => {
          migrated += 1;
          addUserDelta(userId, points);
        },
        (e) => {
          const code = e?.code || e?.status;
          if (code === 6 || code === 'ALREADY_EXISTS') exists += 1;
          else skipped += 1;
        }
      );
      bulk.create(ledgerRef, ledgerData).catch(() => {});

      if (checked % 250 === 0) {
        console.log('Progress:', { checked, migrated, exists, skipped });
      }
    }

    await bulk.close();

    // Update stats per user (one transaction per user)
    const userIds = Array.from(perUserDelta.keys());
    console.log(`Updating user_stats for ${userIds.length} users...`);

    for (let i = 0; i < userIds.length; i += 1) {
      const userId = userIds[i];
      const delta = perUserDelta.get(userId);
      const statsRef = db.collection(USER_STATS).doc(userId);
      await db.runTransaction(async (t) => {
        const snap = await t.get(statsRef);
        const current = snap.exists ? snap.data() : { total_points: 0, entry_count: 0 };
        t.set(statsRef, {
          user_id: userId,
          total_points: (current.total_points || 0) + (delta.points || 0),
          entry_count: (current.entry_count || 0) + (delta.count || 0),
          updated_at: Date.now(),
        }, { merge: true });
      });

      if ((i + 1) % 100 === 0) {
        console.log('Stats progress:', { done: i + 1, total: userIds.length });
      }
    }
  }

  if (dryRun) {
    console.log('Done (dry-run):', { checked, ok, skipped, total: rows.length });
  } else {
    console.log('Done:', { migrated, exists, skipped, total: rows.length });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

