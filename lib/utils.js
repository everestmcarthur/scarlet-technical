/**
 * Shared utility functions.
 */
const crypto = require('crypto');
const { pool } = require('./db');

/**
 * Generate a cryptographically secure random token.
 */
function generateToken(length = 48) {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Generate a unique invoice number using database sequence.
 * Format: INV-YYYYMM-XXXX (sequential, collision-free).
 */
async function generateInvoiceNumber() {
  const now = new Date();
  const prefix = `INV-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  // Use a DB sequence to guarantee uniqueness
  try {
    await pool.query(`CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START 1000`);
    const r = await pool.query(`SELECT nextval('invoice_number_seq') as num`);
    return `${prefix}-${r.rows[0].num}`;
  } catch {
    // Fallback: timestamp + random (extremely unlikely collision)
    return `${prefix}-${Date.now().toString(36).slice(-4).toUpperCase()}${Math.floor(Math.random() * 900 + 100)}`;
  }
}

/**
 * Escape a value for CSV output.
 */
function csvEsc(val) {
  if (val == null) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Pagination helper — extracts page/limit from query params.
 * Returns { limit, offset, page, perPage }.
 */
function paginate(query, { maxPerPage = 200, defaultPerPage = 50 } = {}) {
  const page = Math.max(1, parseInt(query.page) || 1);
  const perPage = Math.min(maxPerPage, Math.max(1, parseInt(query.per_page || query.limit) || defaultPerPage));
  return { limit: perPage, offset: (page - 1) * perPage, page, perPage };
}

module.exports = { generateToken, generateInvoiceNumber, csvEsc, paginate };
