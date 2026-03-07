const groupDAO = require('../dao/groupDAO');

class GroupController {
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
}

module.exports = new GroupController();
