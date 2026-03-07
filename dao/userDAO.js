const { db } = require('../config/firebase');

class UserDAO {
  constructor() {
    this.usersRef = db.ref('users');
  }

  async findByUsername(username) {
    const snap = await this.usersRef.child(username).once('value');
    if (!snap.exists()) return null;
    return { id: username, ...snap.val() };
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
    const toSave = {
      ...userData,
      createdAt: now,
      updatedAt: now,
    };

    await this.usersRef.child(username).set(toSave);
    return { id: username, ...toSave };
  }

  async updateUser(username, patch) {
    await this.usersRef.child(username).update({
      ...patch,
      updatedAt: Date.now(),
    });
    return this.findByUsername(username);
  }

  async getAllUsers() {
    const snap = await this.usersRef.once('value');
    return snap.val() || {};
  }
}

module.exports = new UserDAO();
