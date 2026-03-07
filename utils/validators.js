const FIELD_TYPES = new Set(['text', 'textarea', 'number', 'dropdown', 'date', 'boolean']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateActivityFieldsConfig(fields) {
  if (!Array.isArray(fields)) {
    return 'fields must be an array';
  }

  for (const field of fields) {
    if (!isPlainObject(field)) {
      return 'each field config must be an object';
    }
    if (!field.name || typeof field.name !== 'string') {
      return 'each field must have string name';
    }
    if (!FIELD_TYPES.has(field.type)) {
      return `invalid field type for ${field.name}`;
    }
    if (field.type === 'dropdown' && field.source !== 'bible_books') {
      if (!Array.isArray(field.options) || field.options.length === 0) {
        return `dropdown field ${field.name} must have options or source=bible_books`;
      }
    }
  }

  return null;
}

function validateEntryDataByConfig(fields, data) {
  if (!isPlainObject(data)) {
    return 'data must be an object';
  }

  for (const field of fields) {
    const value = data[field.name];
    const hasValue = value !== undefined && value !== null && value !== '';

    if (field.required && !hasValue) {
      return `${field.name} is required`;
    }
    if (!hasValue) {
      continue;
    }

    if (field.type === 'number') {
      if (typeof value !== 'number' || Number.isNaN(value)) {
        return `${field.name} must be number`;
      }
      if (typeof field.min === 'number' && value < field.min) {
        return `${field.name} must be >= ${field.min}`;
      }
      if (typeof field.max === 'number' && value > field.max) {
        return `${field.name} must be <= ${field.max}`;
      }
    }

    if (field.type === 'boolean' && typeof value !== 'boolean') {
      return `${field.name} must be boolean`;
    }

    if ((field.type === 'text' || field.type === 'textarea' || field.type === 'dropdown') && typeof value !== 'string') {
      return `${field.name} must be string`;
    }

    if (field.type === 'dropdown' && Array.isArray(field.options) && field.source !== 'bible_books') {
      if (!field.options.includes(value)) {
        return `${field.name} has invalid option`;
      }
    }
  }

  return null;
}

module.exports = {
  validateActivityFieldsConfig,
  validateEntryDataByConfig,
  isPlainObject,
};
