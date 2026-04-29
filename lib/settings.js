/**
 * Business settings helpers — cached reads from business_settings table.
 */
const { pool } = require('./db');
const logger = require('./logger');

const DEFAULTS = {
  business_name: 'Scarlet Technical',
  business_address: 'Muncie, Indiana',
  business_phone: '',
  business_email: '',
  late_fee_amount: '10.00',
  late_fee_grace_days: '3',
  lockout_days_overdue: '14',
  reminder_schedule: '3,0,-3,-7',
};

/**
 * Fetch one or more settings keys. Returns an object of { key: value }.
 * Falls back to DEFAULTS for missing keys.
 */
async function getSettings(keys) {
  const result = {};
  try {
    const r = await pool.query(
      'SELECT key, value FROM business_settings WHERE key = ANY($1)',
      [keys]
    );
    for (const row of r.rows) result[row.key] = row.value;
  } catch (err) {
    logger.warn({ err, keys }, 'Failed to read settings, using defaults');
  }
  // Fill in defaults for missing keys
  for (const key of keys) {
    if (!(key in result) && key in DEFAULTS) {
      result[key] = DEFAULTS[key];
    }
  }
  return result;
}

module.exports = { getSettings, DEFAULTS };
