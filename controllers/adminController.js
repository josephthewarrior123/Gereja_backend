const { db } = require('../config/firebase');
const { validateActivityFieldsConfig } = require('../utils/validators');

function toKey(name) {
  return String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function normalizeGroups(groups) {
  if (!Array.isArray(groups)) return [];
  return groups.map(toKey).filter(Boolean);
}

function hasIntersection(a, b) {
  const setB = new Set(b);
  return a.some((x) => setB.has(x));
}

class AdminController {
  constructor() {
    this.activitiesRef = db.ref('activities');
  }

  async createActivity(req, res) {
    try {
      const { name, points, fields = [], groups = [], is_active = true } = req.body;

      if (!name || typeof name !== 'string') {
        return res.status(400).json({ success: false, error: 'name is required' });
      }
      const parsedPoints = Number(points);
      if (isNaN(parsedPoints) || parsedPoints < 0) {
        return res.status(400).json({ success: false, error: 'points must be a non-negative number' });
      }
      if (fields.length > 0) {
        const fieldsError = validateActivityFieldsConfig(fields);
        if (fieldsError) return res.status(400).json({ success: false, error: fieldsError });
      }

      const cleanGroups = normalizeGroups(groups);
      if (!cleanGroups.length) {
        return res.status(400).json({ success: false, error: 'Pilih minimal 1 group' });
      }

      if (req.user.role !== 'super_admin') {
        const managedGroups = req.user.managedGroups || [];
        if (!hasIntersection(cleanGroups, managedGroups)) {
          return res.status(403).json({ success: false, error: 'No permission for selected groups' });
        }
      }

      const now = Date.now();
      const newRef = this.activitiesRef.push();
      await newRef.set({
        id: newRef.key,
        name: name.trim(),
        points: parsedPoints,
        fields,
        groups: cleanGroups,
        created_by_admin: req.user.username,
        is_active,
        created_at: now,
        updated_at: now,
      });

      return res.status(201).json({
        success: true,
        message: 'Activity created',
        data: { id: newRef.key },
      });
    } catch (error) {
      console.error('[createActivity]', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  async updateActivity(req, res) {
    try {
      const { activityId } = req.params;
      const { name, points, fields, groups, is_active } = req.body;

      const ref = this.activitiesRef.child(activityId);
      const snap = await ref.once('value');
      if (!snap.exists()) {
        return res.status(404).json({ success: false, error: 'Activity not found' });
      }

      const current = snap.val();
      const nextGroups = groups ? normalizeGroups(groups) : current.groups;

      if (req.user.role !== 'super_admin') {
        const managedGroups = req.user.managedGroups || [];
        if (!hasIntersection(nextGroups, managedGroups)) {
          return res.status(403).json({ success: false, error: 'No permission for selected groups' });
        }
      }

      if (fields) {
        const fieldsError = validateActivityFieldsConfig(fields);
        if (fieldsError) return res.status(400).json({ success: false, error: fieldsError });
      }

      const patch = { updated_at: Date.now() };
      if (typeof name === 'string') patch.name = name.trim();
      if (points !== undefined) {
        const p = Number(points);
        if (!isNaN(p) && p >= 0) patch.points = p;
      }
      if (Array.isArray(fields)) patch.fields = fields;
      if (Array.isArray(groups)) patch.groups = nextGroups;
      if (typeof is_active === 'boolean') patch.is_active = is_active;

      await ref.update(patch);
      return res.status(200).json({ success: true, message: 'Activity updated' });
    } catch (error) {
      console.error('[updateActivity]', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }
}

module.exports = new AdminController();