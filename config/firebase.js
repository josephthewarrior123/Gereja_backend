const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

function tryReadServiceAccountFromPath(rawPath) {
  if (!rawPath) return null;

  const normalized = path.isAbsolute(rawPath) ? rawPath : path.join(process.cwd(), rawPath);
  if (!fs.existsSync(normalized)) return null;

  return JSON.parse(fs.readFileSync(normalized, 'utf8'));
}

function getCredential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    if (parsed.private_key) {
      parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
    }
    return admin.credential.cert(parsed);
  }

  const fromFile =
    tryReadServiceAccountFromPath(process.env.FIREBASE_SERVICE_ACCOUNT_PATH) ||
    tryReadServiceAccountFromPath('serviceAccountKey.json');
  if (fromFile) {
    if (fromFile.private_key) {
      fromFile.private_key = fromFile.private_key.replace(/\\n/g, '\n');
    }
    return admin.credential.cert(fromFile);
  }

  if (
    process.env.FIREBASE_PRIVATE_KEY &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PROJECT_ID
  ) {
    return admin.credential.cert({
      project_id: process.env.FIREBASE_PROJECT_ID,
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    });
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return admin.credential.applicationDefault();
  }

  return null;
}

if (!admin.apps.length) {
  const credential = getCredential();

  if (!credential) {
    throw new Error(
      'Firebase credential missing. Set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_JSON.'
    );
  }

  admin.initializeApp({ credential });
}

const auth = admin.auth();
const db   = admin.firestore();

module.exports = { admin, auth, db };