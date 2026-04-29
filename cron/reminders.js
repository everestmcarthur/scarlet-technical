/**
 * Daily cron: payment reminders + review prompts.
 * BUG FIX: Review prompts use DB column instead of setTimeout (survives restarts).
 */
const { pool } = require('../lib/db');
const { sendEmail, emailTemplates } = require('../lib/email');
const { trySendSMS } = require('../lib/sms');
const logger = require('../lib/logger');

async function runPaymentReminders() {
  logger.info('Running daily payment reminder check');
  try {
    // Find installments due in 3 days or overdue
    const result = await pool.query(`
      SELECT i.*, pp.customer_id, pp.status as plan_status,
        c.name as customer_name, c.email as customer_email, c.phone as customer_phone
      FROM installments i
      JOIN payment_plans pp ON pp.id = i.payment_plan_id
      JOIN customers c ON c.id = pp.customer_id
      WHERE i.status = 'pending'
        AND pp.status = 'active'
        AND (i.due_date = CURRENT_DATE + INTERVAL '3 days' OR i.due_date < CURRENT_DATE)
        AND c.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM reminder_logs rl
          WHERE rl.payment_plan_id = pp.id
            AND rl.installment_id = i.id
            AND rl.type = 'payment_reminder'
            AND rl.created_at > CURRENT_DATE - INTERVAL '1 day'
        )
    `);

    let sent = 0;
    for (const inst of result.rows) {
      const isOverdue = new Date(inst.due_date) < new Date();
      const customer = { name: inst.customer_name, email: inst.customer_email, phone: inst.customer_phone };

      // Email reminder
      if (customer.email) {
        const tpl = emailTemplates.reminder(customer, inst, isOverdue);
        const emailResult = await sendEmail(customer.email, tpl.subject, tpl.html);

        await pool.query(
          `INSERT INTO reminder_logs (payment_plan_id, installment_id, type, email_to, success, error_message)
           VALUES ($1,$2,'payment_reminder',$3,$4,$5)`,
          [inst.payment_plan_id, inst.id, customer.email, emailResult.ok, emailResult.ok ? null : 'email_failed']
        ).catch(() => {}); // Don't fail the whole cron on logging error

        if (emailResult.ok) sent++;
      }

      // SMS reminder for overdue
      if (isOverdue && customer.phone) {
        const daysOverdue = Math.ceil((Date.now() - new Date(inst.due_date).getTime()) / (1000 * 60 * 60 * 24));
        await trySendSMS(customer.phone,
          `Scarlet Technical: Your payment of $${parseFloat(inst.amount).toFixed(2)} was due ${daysOverdue} day(s) ago. Please make a payment at your earliest convenience.`
        );
      }

      // Escalation: Update plan escalation status if very overdue
      if (isOverdue) {
        const daysOverdue = Math.ceil((Date.now() - new Date(inst.due_date).getTime()) / (1000 * 60 * 60 * 24));
        let escalation = 'past_due';
        if (daysOverdue > 30) escalation = 'collections';
        else if (daysOverdue > 14) escalation = 'final_notice';
        await pool.query(
          `UPDATE payment_plans SET escalation_status=$1, updated_at=NOW() WHERE id=$2 AND escalation_status != $1`,
          [escalation, inst.payment_plan_id]
        ).catch(() => {});
      }
    }
    logger.info({ sent, total: result.rows.length }, 'Payment reminders complete');
  } catch (err) {
    logger.error({ err }, 'Payment reminder cron error');
  }
}

/**
 * BUG FIX: Review prompts now use a DB flag (review_prompt_due_at)
 * instead of in-memory setTimeout, which was lost on server restart.
 */
async function runReviewPrompts() {
  logger.info('Running review prompt check');
  try {
    const result = await pool.query(`
      SELECT r.id as repair_id, r.customer_id, c.name, c.email
      FROM repairs r
      JOIN customers c ON c.id = r.customer_id
      WHERE r.status = 'completed'
        AND r.review_prompt_due_at IS NOT NULL
        AND r.review_prompt_due_at <= NOW()
        AND r.review_prompt_sent IS NOT TRUE
        AND r.satisfaction_rating IS NULL
        AND c.email IS NOT NULL
        AND c.deleted_at IS NULL
    `);

    for (const row of result.rows) {
      const siteUrl = process.env.SITE_URL || 'https://jarviscli.dev';
      const { emailWrapper } = require('../lib/email');
      const html = emailWrapper('How Was Your Experience?', `
        <p>Hi ${(row.name || '').split(' ')[0] || 'there'},</p>
        <p>Your recent repair with Scarlet Technical has been completed. We'd love to hear how it went!</p>
        <p style="text-align:center;margin:24px 0">
          <a href="${siteUrl}/portal" style="display:inline-block;padding:12px 32px;background:#C41E3A;color:#fff;border-radius:8px;font-weight:600;text-decoration:none">Rate Your Experience</a>
        </p>
        <p style="font-size:.85rem;color:#666">Your feedback helps us improve our service.</p>
      `);
      const sendResult = await sendEmail(row.email, 'How was your repair? — Scarlet Technical', html);
      if (sendResult.ok) {
        await pool.query('UPDATE repairs SET review_prompt_sent=true WHERE id=$1', [row.repair_id]);
      }
    }
    logger.info({ count: result.rows.length }, 'Review prompts complete');
  } catch (err) {
    logger.error({ err }, 'Review prompt cron error');
  }
}

module.exports = { runPaymentReminders, runReviewPrompts };
