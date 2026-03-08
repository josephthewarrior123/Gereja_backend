const groupDAO = require('../dao/groupDAO');

class GroupController {
  // GET /api/groups
  async listGroups(req, res) {
    try {
      const groups = await groupDAO.listGroups();
      return res.status(200).json({
        success: true,
        count: groups.length,
        groups,
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // POST /api/groups
  async createGroup(req, res) {
    try {
      const { name } = req.body;
      if (!name || !String(name).trim()) {
        return res.status(400).json({ success: false, error: 'name wajib diisi' });
      }

      const created = await groupDAO.upsertGroup(name, req.user?.username || null);
      return res.status(201).json({
        success: true,
        message: 'Group berhasil disimpan',
        group: created,
      });
    } catch (error) {
      return res.status(400).json({ success: false, error: error.message });
    }
  }

  // PATCH /api/groups/:id — rename group
  async updateGroup(req, res) {
    try {
      const { id } = req.params;
      const { name } = req.body;

      if (!name || !String(name).trim()) {
        return res.status(400).json({ success: false, error: 'name wajib diisi' });
      }

      const updated = await groupDAO.updateGroup(id, { name });
      return res.status(200).json({
        success: true,
        message: 'Group berhasil diupdate',
        group: updated,
      });
    } catch (error) {
      const status = error.message === 'Group tidak ditemukan' ? 404 : 400;
      return res.status(status).json({ success: false, error: error.message });
    }
  }

  // PATCH /api/groups/:id/toggle — soft delete (toggle isActive)
  async toggleActive(req, res) {
    try {
      const { id } = req.params;
      const { isActive } = req.body;

      if (typeof isActive !== 'boolean') {
        return res.status(400).json({ success: false, error: 'isActive harus boolean' });
      }

      const updated = await groupDAO.setActive(id, isActive);
      return res.status(200).json({
        success: true,
        message: `Group berhasil ${isActive ? 'diaktifkan' : 'dinonaktifkan'}`,
        group: updated,
      });
    } catch (error) {
      const status = error.message === 'Group tidak ditemukan' ? 404 : 400;
      return res.status(status).json({ success: false, error: error.message });
    }
  }

  // DELETE /api/groups/:id — hard delete
  async deleteGroup(req, res) {
    try {
      const { id } = req.params;
      await groupDAO.deleteGroup(id);
      return res.status(200).json({
        success: true,
        message: 'Group berhasil dihapus permanen',
        id,
      });
    } catch (error) {
      const status = error.message === 'Group tidak ditemukan' ? 404 : 500;
      return res.status(status).json({ success: false, error: error.message });
    }
  }
}

module.exports = new GroupController();