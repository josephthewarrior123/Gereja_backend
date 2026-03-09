const { db } = require('../config/firebase');

const COLLECTION = 'users';

class UserDAO {
  _col() {
    return db.collection(COLLECTION);
  }

  async findByUsername(username) {
    const snap = await this._col()
      .where('username', '==', username)
      .limit(1)
      .get();

    if (snap.empty) return null;
    const doc = snap.docs[0];
    return { id: doc.id, ...doc.data() };
  }

  async usernameExists(username) {
    const user = await this.findByUsername(username);
    return user !== null;
  }

  async createUser(userData) {
    const { username } = userData;
    if (await this.usernameExists(username)) {
      throw new Error('Username already exists');
    }

    const now = Date.now();
    const toSave = { ...userData, createdAt: now, updatedAt: now };

    // Pakai username sebagai doc ID supaya lookup by username tetap bisa pakai .doc(username)
    const ref = this._col().doc(username);
    await ref.set(toSave);
    return { id: username, ...toSave };
  }

  async updateUser(username, patch) {
    const ref = this._col().doc(username);
    await ref.update({ ...patch, updatedAt: Date.now() });
    return this.findByUsername(username);
  }

  async getAllUsers() {
    const snap = await this._col().get();
    const result = {};
    snap.docs.forEach((doc) => {
      result[doc.id] = doc.data();
    });
    return result;
  }

  async deleteUser(username) {
    const ref = this._col().doc(username);
    await ref.delete();
    return true;
  }
}

module.exports = new UserDAO();