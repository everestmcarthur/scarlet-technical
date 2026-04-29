/**
 * Audit logging — writes to admin_audit_log table.
 * Never throws — audit failures are logged but never break the request.
 */
const { pool } = require('./db');
const logger = require('./logger');

async function auditLog(req, action, entityType, entityId, details) {
  try {
    await pool.query(
      `INSERT INTO admin_audit_log (admin_id, admin_name, action, entity_type, entity_id, details, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        req.session?.adminId || null,
        req.session?.adminName || 'system',
        action,
        entityType || null,
        entityId || null,
        JSON.stringify(details || {}),
        req.ip || req.headers['x-forwarded-for'] || null,
      ]
    );
  } catch (err) {
    logger.warn({ err, action, entityType, entityId }, 'Audit log write failed');
  }
}

module.exports = { auditLog };
