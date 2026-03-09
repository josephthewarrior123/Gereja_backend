const { db } = require('../config/firebase');

// Firestore collection
const COLLECTION = 'groups';

function toKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

class GroupDAO {
  _col() {
    return db.collection(COLLECTION);
  }

  async listGroups() {
    const snap = await this._col().orderBy('createdAt', 'asc').get();
    return snap.docs.map((doc) => ({
      id: doc.id,
      name: doc.data().name || doc.id,
      isActive: doc.data().isActive !== false,
      createdAt: doc.data().createdAt || null,
      createdBy: doc.data().createdBy || null,
      updatedAt: doc.data().updatedAt || null,
    }));
  }

  async getActiveGroupKeys() {
    const snap = await this._col().where('isActive', '==', true).get();
    return snap.docs.map((doc) => doc.id);
  }

  async findById(id) {
    const doc = await this._col().doc(id).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  }

  async upsertGroup(name, createdBy = null) {
    const id = toKey(name);
    if (!id) throw new Error('Nama group tidak valid');

    const now = Date.now();
    const ref = this._col().doc(id);
    const snap = await ref.get();

    if (snap.exists) {
      await ref.update({ name: String(name).trim(), isActive: true, updatedAt: now });
    } else {
      await ref.set({
        name: String(name).trim(),
        isActive: true,
        createdBy,
        createdAt: now,
        updatedAt: now,
      });
    }

    const fresh = await ref.get();
    return { id, ...fresh.data() };
  }

  async updateGroup(id, { name }) {
    const ref = this._col().doc(id);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('Group tidak ditemukan');

    const patch = { updatedAt: Date.now() };
    if (name !== undefined) {
      const trimmed = String(name).trim();
      if (!trimmed) throw new Error('Nama group tidak boleh kosong');
      patch.name = trimmed;
    }

    await ref.update(patch);
    const fresh = await ref.get();
    return { id, ...fresh.data() };
  }

  // Soft delete — toggle isActive
  async setActive(id, isActive) {
    const ref = this._col().doc(id);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('Group tidak ditemukan');

    await ref.update({ isActive, updatedAt: Date.now() });
    const fresh = await ref.get();
    return { id, ...fresh.data() };
  }

  // Hard delete — hapus permanen
  async deleteGroup(id) {
    const ref = this._col().doc(id);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('Group tidak ditemukan');

    await ref.delete();
    return { id };
  }
}

module.exports = new GroupDAO();