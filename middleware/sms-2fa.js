/**
 * SMS Two-Factor Authentication Middleware
 * Uses Twilio to send verification codes for portal login.
 */
const { pool } = require('../lib/db');
const logger = require('../lib/logger');
const { trySendSMS } = require('../lib/sms');
const crypto = require('crypto');

const CODE_EXPIRY_MINUTES = 10;
const MAX_ATTEMPTS = 5;

/**
 * Generate and send a 2FA code to a customer's phone.
 * @param {number} customerId
 * @returns {Object} { success, message, expiresAt }
 */
async function send2FACode(customerId) {
  // Get customer phone
  const custResult = await pool.query(
    'SELECT phone, name FROM customers WHERE id = $1',
    [customerId]
  );

  if (!custResult.rows.length || !custResult.rows[0].phone) {
    return { success: false, message: 'No phone number on file' };
  }

  const { phone, name } = custResult.rows[0];
  
  // Generate 6-digit code
  const code = crypto.randomInt(100000, 999999).toString();
  const expiresAt = new Date(Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000);

  // Store code in database (upsert)
  await pool.query(
    `INSERT INTO two_factor_codes (customer_id, code, expires_at, attempts, created_at)
     VALUES ($1, $2, $3, 0, NOW())
     ON CONFLICT (customer_id) DO UPDATE SET
       code = $2, expires_at = $3, attempts = 0, created_at = NOW()`,
    [customerId, code, expiresAt]
  );

  // Send SMS
  const sent = await trySendSMS(
    phone,
    `Scarlet Technical: Your verification code is ${code}. Expires in ${CODE_EXPIRY_MINUTES} minutes.`
  );

  if (!sent) {
    return { success: false, message: 'Failed to send SMS' };
  }

  logger.info({ customerId, phone: phone.slice(-4) }, '2FA code sent');
  return { success: true, message: 'Verification code sent', expiresAt };
}

/**
 * Verify a 2FA code.
 * @param {number} customerId
 * @param {string} code
 * @returns {Object} { valid, message }
 */
async function verify2FACode(customerId, code) {
  const result = await pool.query(
    `SELECT code, expires_at, attempts FROM two_factor_codes
     WHERE customer_id = $1`,
    [customerId]
  );

  if (!result.rows.length) {
    return { valid: false, message: 'No verification code found. Request a new one.' };
  }

  const record = result.rows[0];

  // Check attempts
  if (record.attempts >= MAX_ATTEMPTS) {
    await pool.query('DELETE FROM two_factor_codes WHERE customer_id = $1', [customerId]);
    return { valid: false, message: 'Too many attempts. Request a new code.' };
  }

  // Increment attempts
  await pool.query(
    'UPDATE two_factor_codes SET attempts = attempts + 1 WHERE customer_id = $1',
    [customerId]
  );

  // Check expiry
  if (new Date() > new Date(record.expires_at)) {
    await pool.query('DELETE FROM two_factor_codes WHERE customer_id = $1', [customerId]);
    return { valid: false, message: 'Code expired. Request a new one.' };
  }

  // Check code
  if (record.code !== code) {
    return { valid: false, message: 'Invalid code' };
  }

  // Valid! Clean up
  await pool.query('DELETE FROM two_factor_codes WHERE customer_id = $1', [customerId]);
  logger.info({ customerId }, '2FA code verified');
  return { valid: true, message: 'Verified' };
}

/**
 * Migration SQL for the two_factor_codes table.
 */
const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS two_factor_codes (
  customer_id INTEGER PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  code VARCHAR(6) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  attempts INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);
`;

module.exports = {
  send2FACode,
  verify2FACode,
  MIGRATION_SQL,
};
