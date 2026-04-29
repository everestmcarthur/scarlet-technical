/**
 * Email Service — Powered by Resend
 * 
 * Handles all outbound email: transactional, notifications, marketing.
 * Uses templates from the email_templates table with variable substitution.
 */
const { pool } = require('./db');
const logger = require('./logger');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || 'Scarlet Technical <noreply@jarviscli.dev>';

/**
 * Send a raw email via Resend API
 */
async function sendEmail({ to, subject, html, text, from, replyTo, tags }) {
  if (!RESEND_API_KEY) {
    logger.warn('RESEND_API_KEY not set — email not sent');
    return { ok: false, error: 'Email not configured' };
  }

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: from || EMAIL_FROM,
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
        text: text || stripHtml(html),
        reply_to: replyTo,
        tags: tags || [],
      }),
    });

    const data = await resp.json();

    if (resp.ok) {
      logger.info({ to, subject, resendId: data.id }, 'Email sent');
      return { ok: true, resendId: data.id };
    }

    logger.error({ to, subject, status: resp.status, error: data }, 'Email API error');
    return { ok: false, error: data.message || 'Send failed' };
  } catch (err) {
    logger.error({ err, to, subject }, 'Email send failed');
    return { ok: false, error: err.message };
  }
}

/**
 * Send email using a template from the database
 */
async function sendTemplateEmail({ templateName, to, customerId, variables = {}, replyTo }) {
  try {
    const tmplResult = await pool.query(
      'SELECT * FROM email_templates WHERE name = $1 AND is_active = true',
      [templateName]
    );

    if (tmplResult.rows.length === 0) {
      logger.warn({ templateName }, 'Email template not found');
      return { ok: false, error: 'Template not found' };
    }

    const template = tmplResult.rows[0];

    // Substitute variables
    let subject = template.subject;
    let html = template.html_body;

    // Add common variables
    const vars = {
      ...variables,
      support_phone: process.env.SUPPORT_PHONE || '(877) 239-9667',
      portal_url: `${process.env.SITE_URL || 'https://scarlet-technical.onrender.com'}/portal`,
      site_url: process.env.SITE_URL || 'https://scarlet-technical.onrender.com',
      company_name: 'Scarlet Technical',
    };

    for (const [key, value] of Object.entries(vars)) {
      const pattern = new RegExp(`\\{${key}\\}`, 'g');
      subject = subject.replace(pattern, value || '');
      html = html.replace(pattern, value || '');
    }

    // Wrap in email layout
    html = wrapInLayout(html);

    const result = await sendEmail({ to, subject, html, replyTo });

    // Log the email
    if (result.ok) {
      await pool.query(
        `INSERT INTO email_log (customer_id, to_email, from_email, subject, template_id, resend_id, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'sent', NOW())`,
        [customerId, to, EMAIL_FROM, subject, template.id, result.resendId]
      ).catch(err => logger.error({ err }, 'Failed to log email'));
    }

    return result;
  } catch (err) {
    logger.error({ err, templateName }, 'Template email failed');
    return { ok: false, error: err.message };
  }
}

/**
 * Send bulk marketing email
 */
async function sendBulkEmail({ subject, html, customerIds, filter }) {
  let recipients;

  if (customerIds && customerIds.length > 0) {
    const result = await pool.query(
      `SELECT id, first_name, last_name, email FROM customers 
       WHERE id = ANY($1) AND email IS NOT NULL AND comm_pref IN ('email', 'both')`,
      [customerIds]
    );
    recipients = result.rows;
  } else {
    const result = await pool.query(
      `SELECT id, first_name, last_name, email FROM customers 
       WHERE email IS NOT NULL AND status != 'inactive' AND comm_pref IN ('email', 'both')`
    );
    recipients = result.rows;
  }

  let sent = 0, failed = 0;
  for (const customer of recipients) {
    const personalizedHtml = html
      .replace(/{first_name}/g, customer.first_name || 'Customer')
      .replace(/{last_name}/g, customer.last_name || '');

    const result = await sendEmail({
      to: customer.email,
      subject: subject.replace(/{first_name}/g, customer.first_name || 'Customer'),
      html: wrapInLayout(personalizedHtml),
      tags: [{ name: 'campaign', value: 'bulk' }],
    });

    if (result.ok) {
      sent++;
      await pool.query(
        `INSERT INTO email_log (customer_id, to_email, from_email, subject, status, created_at)
         VALUES ($1, $2, $3, $4, 'sent', NOW())`,
        [customer.id, customer.email, EMAIL_FROM, subject]
      ).catch(() => {});
    } else {
      failed++;
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 200));
  }

  return { sent, failed, total: recipients.length };
}

/**
 * Process automated email sequences (called by cron)
 */
async function processEmailSequences() {
  try {
    const due = await pool.query(`
      SELECT ese.*, es.name as sequence_name, ess.subject, ess.body, ess.template_id,
             c.email, c.first_name, c.last_name
      FROM email_sequence_enrollments ese
      JOIN email_sequences es ON ese.sequence_id = es.id
      JOIN email_sequence_steps ess ON ess.sequence_id = es.id AND ess.step_order = ese.current_step
      JOIN customers c ON ese.customer_id = c.id
      WHERE ese.status = 'active' AND ese.next_send_at <= NOW() AND es.is_active = true
    `);

    for (const enrollment of due.rows) {
      if (enrollment.template_id) {
        await sendTemplateEmail({
          templateName: enrollment.template_id,
          to: enrollment.email,
          customerId: enrollment.customer_id,
          variables: {
            first_name: enrollment.first_name,
            last_name: enrollment.last_name,
          },
        });
      } else if (enrollment.body) {
        const html = enrollment.body
          .replace(/{first_name}/g, enrollment.first_name || 'Customer');
        await sendEmail({
          to: enrollment.email,
          subject: (enrollment.subject || 'Update from Scarlet Technical').replace(/{first_name}/g, enrollment.first_name || ''),
          html: wrapInLayout(html),
        });
      }

      // Advance to next step
      const nextStep = await pool.query(
        `SELECT * FROM email_sequence_steps WHERE sequence_id = $1 AND step_order = $2`,
        [enrollment.sequence_id, enrollment.current_step + 1]
      );

      if (nextStep.rows.length > 0) {
        const delay = nextStep.rows[0].delay_hours || 24;
        await pool.query(
          `UPDATE email_sequence_enrollments SET current_step = current_step + 1, next_send_at = NOW() + INTERVAL '1 hour' * $1 WHERE id = $2`,
          [delay, enrollment.id]
        );
      } else {
        await pool.query(
          `UPDATE email_sequence_enrollments SET status = 'completed', completed_at = NOW() WHERE id = $1`,
          [enrollment.id]
        );
      }
    }

    if (due.rows.length > 0) {
      logger.info({ count: due.rows.length }, 'Processed email sequence steps');
    }
  } catch (err) {
    logger.error({ err }, 'Email sequence processing failed');
  }
}

/**
 * Create a notification
 */
async function createNotification({ adminId, customerId, type, title, message, link }) {
  try {
    await pool.query(
      `INSERT INTO notifications (admin_id, customer_id, type, title, message, link, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [adminId || null, customerId || null, type, title, message || null, link || null]
    );
  } catch (err) {
    logger.error({ err }, 'Failed to create notification');
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function stripHtml(html) {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function wrapInLayout(bodyHtml) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:20px;">
    <div style="background:#dc2626;padding:20px;border-radius:8px 8px 0 0;text-align:center;">
      <h1 style="margin:0;color:#fff;font-size:24px;">🔧 Scarlet Technical</h1>
    </div>
    <div style="background:#fff;padding:24px;border-radius:0 0 8px 8px;line-height:1.6;color:#1f2937;">
      ${bodyHtml}
    </div>
    <div style="text-align:center;padding:16px;color:#6b7280;font-size:12px;">
      <p>Scarlet Technical — IT Support & Device Repair</p>
      <p>${process.env.SUPPORT_PHONE || '(877) 239-9667'} | <a href="${process.env.SITE_URL || '#'}" style="color:#dc2626;">Visit Website</a></p>
      <p style="margin-top:8px;"><a href="{unsubscribe_url}" style="color:#9ca3af;">Unsubscribe</a></p>
    </div>
  </div>
</body>
</html>`;
}

module.exports = {
  sendEmail,
  sendTemplateEmail,
  sendBulkEmail,
  processEmailSequences,
  createNotification,
};
