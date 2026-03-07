const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const { FieldValue } = admin.firestore;

function validateEntryDataByConfig(fields, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return 'data must be object';
  }
  for (const field of fields || []) {
    const value = data[field.name];
    const hasValue = value !== undefined && value !== null && value !== '';
    if (field.required && !hasValue) {
      return `${field.name} is required`;
    }
  }
  return null;
}

async function findBibleBook(bookValue) {
  const lower = String(bookValue || '').trim().toLowerCase();
  if (!lower) {
    return null;
  }

  const byId = await db.collection('bible_books').doc(lower.replace(/\s+/g, '_')).get();
  if (byId.exists) {
    return byId.data();
  }

  const q = await db.collection('bible_books').where('name_lc', '==', lower).limit(1).get();
  return q.empty ? null : q.docs[0].data();
}

exports.submitJournalEntry = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be authenticated.');
  }

  const uid = request.auth.uid;
  const { activity_id, data = {}, timestamp } = request.data || {};
  if (!activity_id) {
    throw new HttpsError('invalid-argument', 'activity_id is required');
  }

  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) {
    throw new HttpsError('permission-denied', 'User profile not found');
  }
  const user = userSnap.data();
  if (!user.is_active) {
    throw new HttpsError('permission-denied', 'User is inactive');
  }

  const activitySnap = await db.collection('activities').doc(activity_id).get();
  if (!activitySnap.exists) {
    throw new HttpsError('not-found', 'Activity not found');
  }
  const activity = activitySnap.data();
  if (!activity.is_active) {
    throw new HttpsError('failed-precondition', 'Activity is inactive');
  }

  const groups = Array.isArray(user.groups) ? user.groups : [];
  const allowed = (activity.groups || []).some((g) => groups.includes(g));
  if (!allowed) {
    throw new HttpsError('permission-denied', 'User not in allowed group');
  }

  const fieldsErr = validateEntryDataByConfig(activity.fields || [], data);
  if (fieldsErr) {
    throw new HttpsError('invalid-argument', fieldsErr);
  }

  if (typeof data.chapter !== 'undefined') {
    const chapter = data.chapter;
    if (typeof chapter !== 'number' || chapter < 1) {
      throw new HttpsError('invalid-argument', 'chapter must be >= 1');
    }
    const book = await findBibleBook(data.book);
    if (!book) {
      throw new HttpsError('invalid-argument', 'Invalid Bible book');
    }
    if (chapter > book.total_chapters) {
      throw new HttpsError(
        'invalid-argument',
        `Invalid chapter for ${book.name}. Max ${book.total_chapters}`
      );
    }
  }

  const now = new Date().toISOString();
  const entryRef = db.collection('journal_entries').doc();
  const ledgerRef = db.collection('points_ledger').doc();
  const statsRef = db.collection('user_stats').doc(uid);

  await db.runTransaction(async (tx) => {
    tx.set(entryRef, {
      id: entryRef.id,
      user_id: uid,
      user_groups: groups,
      activity_id,
      activity_name_snapshot: activity.name,
      data,
      timestamp: timestamp || now,
      submitted_at: now,
      submitted_by: uid,
      points_awarded: activity.points,
      status: 'approved',
    });

    tx.set(ledgerRef, {
      id: ledgerRef.id,
      user_id: uid,
      entry_id: entryRef.id,
      points_delta: activity.points,
      reason: 'activity_submission',
      created_at: now,
    });

    tx.set(
      statsRef,
      {
        user_id: uid,
        total_points: FieldValue.increment(activity.points),
        entry_count: FieldValue.increment(1),
        updated_at: now,
      },
      { merge: true }
    );
  });

  return {
    success: true,
    entry_id: entryRef.id,
    points_awarded: activity.points,
  };
});
