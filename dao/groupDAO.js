const { db } = require('../config/firebase');

function toKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

class GroupDAO {
  constructor() {
    this.groupsRef = db.ref('groups');
  }

  async listGroups() {
    const snap = await this.groupsRef.once('value');
    const data = snap.val() || {};
    return Object.entries(data).map(([id, value]) => ({
      id,
      name: value.name || id,
      isActive: value.isActive !== false,
      createdAt: value.createdAt || null,
      createdBy: value.createdBy || null,
      updatedAt: value.updatedAt || null,
    }));
  }

  async getActiveGroupKeys() {
    const groups = await this.listGroups();
    return groups.filter((g) => g.isActive).map((g) => g.id);
  }

  async findById(id) {
    const snap = await this.groupsRef.child(id).once('value');
    if (!snap.exists()) return null;
    return { id, ...snap.val() };
  }

  async upsertGroup(name, createdBy = null) {
    const id = toKey(name);
    if (!id) throw new Error('Nama group tidak valid');

    const now = Date.now();
    const ref = this.groupsRef.child(id);
    const snap = await ref.once('value');

    if (snap.exists()) {
      await ref.update({ name: String(name).trim(), isActive: true, updatedAt: now });
    } else {
      await ref.set({ name: String(name).trim(), isActive: true, createdBy, createdAt: now, updatedAt: now });
    }

    const fresh = await ref.once('value');
    return { id, ...fresh.val() };
  }

  async updateGroup(id, { name }) {
    const ref = this.groupsRef.child(id);
    const snap = await ref.once('value');
    if (!snap.exists()) throw new Error('Group tidak ditemukan');

    const patch = { updatedAt: Date.now() };
    if (name !== undefined) {
      const trimmed = String(name).trim();
      if (!trimmed) throw new Error('Nama group tidak boleh kosong');
      patch.name = trimmed;
    }

    await ref.update(patch);
    const fresh = await ref.once('value');
    return { id, ...fresh.val() };
  }

  // Soft delete — toggle isActive
  async setActive(id, isActive) {
    const ref = this.groupsRef.child(id);
    const snap = await ref.once('value');
    if (!snap.exists()) throw new Error('Group tidak ditemukan');

    await ref.update({ isActive, updatedAt: Date.now() });
    const fresh = await ref.once('value');
    return { id, ...fresh.val() };
  }

  // Hard delete — hapus permanen
  async deleteGroup(id) {
    const ref = this.groupsRef.child(id);
    const snap = await ref.once('value');
    if (!snap.exists()) throw new Error('Group tidak ditemukan');

    await ref.remove();
    return { id };
  }
}

module.exports = new GroupDAO();