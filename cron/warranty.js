/**
 * Warranty expiration notifications cron.
 * Notifies customers when their repair warranty is about to expire.
 */
const { pool } = require('../lib/db');
const { sendEmail, emailWrapper } = require('../lib/email');
const logger = require('../lib/logger');

async function runWarrantyChecks() {
  logger.info('Running warranty expiration checks');
  try {
    // Notify 7 days before warranty expires
    const result = await pool.query(`
      SELECT r.id, r.device_brand, r.device_model, r.device_type,
        r.warranty_end_date, r.warranty_type,
        c.name as customer_name, c.email as customer_email
      FROM repairs r
      JOIN customers c ON c.id = r.customer_id
      WHERE r.warranty_end_date IS NOT NULL
        AND r.warranty_end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
        AND r.warranty_notified IS NOT TRUE
        AND c.email IS NOT NULL
        AND c.deleted_at IS NULL
    `);

    for (const row of result.rows) {
      const device = [row.device_brand, row.device_model, row.device_type].filter(Boolean).join(' ') || 'your device';
      const daysLeft = Math.ceil((new Date(row.warranty_end_date) - Date.now()) / (1000 * 60 * 60 * 24));

      const html = emailWrapper('Warranty Expiring Soon', `
        <p>Hi ${(row.customer_name || '').split(' ')[0] || 'there'},</p>
        <p>This is a friendly reminder that the warranty for your <strong>${device}</strong> repair expires in <strong>${daysLeft} day${daysLeft !== 1 ? 's' : ''}</strong> (on ${new Date(row.warranty_end_date).toLocaleDateString()}).</p>
        <div style="background:#fef3c7;padding:16px;border-radius:8px;border-left:4px solid #f59e0b;margin:16px 0">
          <strong>⚠️ What this means:</strong> After the warranty period, any repairs for the same issue would be charged at standard rates.
        </div>
        <p>If you're experiencing any issues with the repair, please contact us before the warranty expires.</p>
        <p style="text-align:center;margin:24px 0">
          <a href="${process.env.SITE_URL || 'https://jarviscli.dev'}/portal" style="display:inline-block;padding:12px 32px;background:#C41E3A;color:#fff;border-radius:8px;font-weight:600;text-decoration:none">Open Customer Portal</a>
        </p>
      `);

      const sendResult = await sendEmail(row.customer_email, 'Warranty Expiring Soon — Scarlet Technical', html);
      if (sendResult.ok) {
        await pool.query('UPDATE repairs SET warranty_notified=true WHERE id=$1', [row.id]);
      }
    }
    logger.info({ count: result.rows.length }, 'Warranty checks complete');
  } catch (err) {
    logger.error({ err }, 'Warranty check cron error');
  }
}

module.exports = { runWarrantyChecks };
