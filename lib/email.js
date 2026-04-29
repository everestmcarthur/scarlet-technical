/**
 * Email sending — supports Resend (primary) or Polsia (legacy).
 * Set RESEND_API_KEY to use Resend, or POLSIA_API_KEY for the legacy API.
 * Both can be configured; Resend takes priority.
 *
 * Env vars:
 *   RESEND_API_KEY    — Resend API key (re_...)
 *   EMAIL_FROM        — From address (default: noreply@jarviscli.dev)
 *   POLSIA_API_KEY    — Legacy Polsia API key (fallback)
 */
const logger = require('./logger');

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const POLSIA_API_KEY = process.env.POLSIA_API_KEY || '';
const EMAIL_FROM = process.env.EMAIL_FROM || process.env.POLSIA_EMAIL_FROM || 'noreply@jarviscli.dev';
const SITE_URL = process.env.SITE_URL || process.env.RENDER_EXTERNAL_URL || 'https://scarlet-technical.onrender.com';

// ─── Email wrapper (shared HTML chrome) ──────────────────────────────────────
function emailWrapper(title, bodyHtml) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6fa;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:24px">
    <div style="background:#C41E3A;padding:20px 24px;border-radius:12px 12px 0 0;text-align:center">
      <h1 style="margin:0;color:#fff;font-size:1.2rem;letter-spacing:1px">SCARLET TECHNICAL</h1>
      <p style="margin:4px 0 0;color:rgba(255,255,255,.8);font-size:.8rem">Low Cost IT Support &amp; Development</p>
    </div>
    <div style="background:#fff;padding:32px 24px;border-radius:0 0 12px 12px;line-height:1.6;color:#1a1a2e">
      ${title ? `<h2 style="margin:0 0 16px;color:#1a1a2e;font-size:1.1rem">${title}</h2>` : ''}
      ${bodyHtml}
    </div>
    <p style="text-align:center;color:#999;font-size:.75rem;margin-top:16px">
      Scarlet Technical &mdash; Muncie, Indiana<br>
      <a href="${SITE_URL}" style="color:#C41E3A">${SITE_URL.replace('https://', '')}</a>
    </p>
  </div>
</body>
</html>`;
}

// ─── Send email via Resend ───────────────────────────────────────────────────
async function sendViaResend(to, subject, html, text) {
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      text: text || subject,
    }),
  });
  if (resp.ok) {
    const data = await resp.json();
    logger.info({ to, subject, id: data.id }, 'Email sent via Resend');
    return { ok: true, id: data.id };
  }
  const errText = await resp.text().catch(() => 'Unknown error');
  logger.error({ to, subject, status: resp.status, body: errText }, 'Resend API error');
  return { ok: false, error: errText };
}

// ─── Send email via Polsia (legacy) ──────────────────────────────────────────
async function sendViaPolsia(to, subject, html, text) {
  const resp = await fetch('https://polsia.app/api/v1/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${POLSIA_API_KEY}` },
    body: JSON.stringify({ from: EMAIL_FROM, to, subject, html, text: text || '' }),
  });
  if (resp.ok) {
    logger.info({ to, subject }, 'Email sent via Polsia');
    return { ok: true };
  }
  const errText = await resp.text().catch(() => 'Unknown error');
  logger.error({ to, subject, status: resp.status, body: errText }, 'Polsia API error');
  return { ok: false, error: errText };
}

// ─── Send email (auto-selects provider) ──────────────────────────────────────
async function sendEmail(to, subject, html, text) {
  if (!RESEND_API_KEY && !POLSIA_API_KEY) {
    logger.warn({ to, subject }, 'Email skipped — no RESEND_API_KEY or POLSIA_API_KEY configured');
    return { ok: false, error: 'No email API key configured' };
  }
  try {
    if (RESEND_API_KEY) {
      return await sendViaResend(to, subject, html, text);
    }
    return await sendViaPolsia(to, subject, html, text);
  } catch (err) {
    logger.error({ err, to, subject }, 'Email send failed');
    return { ok: false, error: err.message };
  }
}

// ─── Email Templates ─────────────────────────────────────────────────────────

function statusLabel(s) {
  const labels = {
    intake: 'Checked In', diagnosis: 'Diagnosing', in_progress: 'Repair In Progress',
    waiting_parts: 'Waiting for Parts', complete: 'Complete — Ready for Pickup',
    picked_up: 'Picked Up', cancelled: 'Cancelled',
  };
  return labels[s] || s;
}

const emailTemplates = {
  repairStatus(customer, repair) {
    return {
      subject: `Repair Update — ${statusLabel(repair.status)}`,
      html: emailWrapper('Repair Status Update', `
        <p>Hi ${(customer.name || '').split(' ')[0] || 'there'},</p>
        <p>Your <strong>${[repair.device_brand, repair.device_model, repair.device_type].filter(Boolean).join(' ') || 'device'}</strong> repair is now: <strong style="color:#C41E3A">${statusLabel(repair.status)}</strong></p>
        ${repair.diagnosis_notes && repair.status === 'diagnosis' ? `<div style="background:#f9fafb;padding:12px;border-radius:8px;margin:12px 0"><strong>Diagnosis:</strong> ${repair.diagnosis_notes}</div>` : ''}
        <p>Log in to your <a href="${SITE_URL}/portal" style="color:#C41E3A;font-weight:600">customer portal</a> for full details.</p>
        <p>Questions? Reply to this email or call us.</p>
        <p>— Scarlet Technical, Muncie</p>`),
    };
  },

  paymentConfirm(customer, installment, plan) {
    return {
      subject: `Payment Received — $${parseFloat(installment.paid_amount).toFixed(2)}`,
      html: emailWrapper('Payment Confirmation', `
        <p>Hi ${(customer.name || '').split(' ')[0] || 'there'},</p>
        <p>We've received your payment of <strong>$${parseFloat(installment.paid_amount).toFixed(2)}</strong>. Thank you!</p>
        <div style="background:#f0fdf4;border:1px solid #86efac;padding:16px;border-radius:8px;margin:16px 0">
          <p style="margin:0"><strong>Remaining Balance:</strong> $${parseFloat(plan.remaining_balance).toFixed(2)}</p>
          ${installment.next_due_date ? `<p style="margin:8px 0 0"><strong>Next Payment Due:</strong> ${new Date(installment.next_due_date).toLocaleDateString()}</p>` : ''}
        </div>
        <p>View your full payment history in the <a href="${SITE_URL}/portal" style="color:#C41E3A;font-weight:600">customer portal</a>.</p>
        <p>— Scarlet Technical</p>`),
    };
  },

  contractCopy(customer, plan, repair) {
    const device = repair ? [repair.device_brand, repair.device_model].filter(Boolean).join(' ') : 'Device';
    return {
      subject: 'Your Signed Service Agreement — Scarlet Technical',
      html: emailWrapper('Service Agreement Signed', `
        <p>Hi ${(customer.name || '').split(' ')[0] || 'there'},</p>
        <p>Your service agreement for <strong>${device}</strong> has been signed and is now active.</p>
        <div style="background:#f9fafb;padding:16px;border-radius:8px;margin:16px 0">
          <p style="margin:0"><strong>Total:</strong> $${parseFloat(plan.total_amount).toFixed(2)}</p>
          <p style="margin:4px 0 0"><strong>Payments:</strong> ${plan.num_installments} ${plan.frequency} installments of $${parseFloat(plan.installment_amount).toFixed(2)}</p>
          <p style="margin:4px 0 0"><strong>Signed:</strong> ${new Date(plan.contract_signed_at || Date.now()).toLocaleDateString()}</p>
        </div>
        <p>View your contract anytime in the <a href="${SITE_URL}/portal" style="color:#C41E3A;font-weight:600">customer portal</a>.</p>
        <p>— Scarlet Technical</p>`),
    };
  },

  reminder3day(customer, installment) {
    return {
      subject: 'Payment Reminder — Due in 3 Days',
      html: emailWrapper('Upcoming Payment Reminder', `
        <p>Hi ${(customer.name || '').split(' ')[0]},</p>
        <p>This is a friendly reminder that your payment of <strong>$${parseFloat(installment.amount).toFixed(2)}</strong> is due on <strong>${new Date(installment.due_date).toLocaleDateString()}</strong>.</p>
        <p>Log in to your <a href="${SITE_URL}/portal" style="color:#C41E3A;font-weight:600">portal</a> for details.</p>
        <p>— Scarlet Technical</p>`),
    };
  },

  dueToday(customer, installment) {
    return {
      subject: 'Payment Due Today',
      html: emailWrapper('Payment Due Today', `
        <p>Hi ${(customer.name || '').split(' ')[0]},</p>
        <p>Your payment of <strong>$${parseFloat(installment.amount).toFixed(2)}</strong> is <strong>due today</strong>.</p>
        <p>Please arrange payment at your earliest convenience.</p>
        <p>— Scarlet Technical</p>`),
    };
  },

  overdue3day(customer, installment) {
    return {
      subject: '⚠️ Payment 3 Days Overdue',
      html: emailWrapper('Overdue Payment Notice', `
        <p>Hi ${(customer.name || '').split(' ')[0]},</p>
        <p>Your payment of <strong>$${parseFloat(installment.amount).toFixed(2)}</strong> was due on ${new Date(installment.due_date).toLocaleDateString()} and is now <strong style="color:#C41E3A">3 days overdue</strong>.</p>
        <p>Please contact us if you need to arrange alternative payment. Late fees may apply.</p>
        <p>— Scarlet Technical</p>`),
    };
  },

  overdue7day(customer, installment) {
    return {
      subject: '🚨 Final Notice — Payment 7 Days Overdue',
      html: emailWrapper('Final Payment Notice', `
        <p>Hi ${(customer.name || '').split(' ')[0]},</p>
        <p>Your payment of <strong>$${parseFloat(installment.amount).toFixed(2)}</strong> is now <strong style="color:#C41E3A">7 days overdue</strong>.</p>
        <p>This is a final notice. Continued non-payment may result in additional fees and service restrictions as outlined in your agreement.</p>
        <p>Please contact Scarlet Technical immediately to resolve this.</p>
        <p>— Scarlet Technical</p>`),
    };
  },

  // ── New: Device lock/unlock notifications ────────────────────────────────
  deviceLocked(customer, device) {
    return {
      subject: '🔒 Device Locked — Action Required',
      html: emailWrapper('Device Locked', `
        <p>Hi ${(customer.name || '').split(' ')[0] || 'there'},</p>
        <p>Your device <strong>${device.hostname || 'enrolled device'}</strong> has been locked due to an outstanding balance or missed payment.</p>
        <div style="background:#fef2f2;border:1px solid #fca5a5;padding:16px;border-radius:8px;margin:16px 0">
          <p style="margin:0"><strong>What you can do:</strong></p>
          <ul style="margin:8px 0 0;padding-left:20px">
            <li>Make a payment in the <a href="${SITE_URL}/portal" style="color:#C41E3A">customer portal</a></li>
            <li>Enter an override PIN if provided by your technician</li>
            <li>Request an unlock directly from the lock screen</li>
            <li>Call us at <strong>${process.env.SUPPORT_PHONE || '(765) 555-0100'}</strong></li>
          </ul>
        </div>
        <p>— Scarlet Technical</p>`),
    };
  },

  deviceUnlocked(customer, device) {
    return {
      subject: '🔓 Device Unlocked',
      html: emailWrapper('Device Unlocked', `
        <p>Hi ${(customer.name || '').split(' ')[0] || 'there'},</p>
        <p>Your device <strong>${device.hostname || 'enrolled device'}</strong> has been unlocked. Thank you for resolving your balance!</p>
        <p>If you have any questions, don't hesitate to reach out.</p>
        <p>— Scarlet Technical</p>`),
    };
  },

  unlockRequestReceived(customer, request) {
    return {
      subject: 'Unlock Request Received',
      html: emailWrapper('Unlock Request Received', `
        <p>Hi ${(customer.name || '').split(' ')[0] || 'there'},</p>
        <p>We've received your unlock request. A technician will review it shortly.</p>
        <div style="background:#f9fafb;padding:12px;border-radius:8px;margin:12px 0">
          <p style="margin:0"><strong>Request #:</strong> ${request.id}</p>
          ${request.reason ? `<p style="margin:4px 0 0"><strong>Reason:</strong> ${request.reason}</p>` : ''}
        </div>
        <p>We'll notify you when a decision has been made.</p>
        <p>— Scarlet Technical</p>`),
    };
  },

  overridePinGenerated(customer, pin, expiresAt) {
    return {
      subject: '🔑 Your Override PIN — Scarlet Technical',
      html: emailWrapper('Override PIN', `
        <p>Hi ${(customer.name || '').split(' ')[0] || 'there'},</p>
        <p>Here is your one-time override PIN to unlock your device:</p>
        <div style="background:#f0fdf4;border:2px solid #86efac;padding:24px;border-radius:12px;margin:16px 0;text-align:center">
          <p style="margin:0;font-size:2rem;font-weight:bold;letter-spacing:0.3em;color:#1a1a2e;font-family:monospace">${pin}</p>
        </div>
        <p><strong>⏰ Expires:</strong> ${new Date(expiresAt).toLocaleString()}</p>
        <p>Enter this PIN on the lock screen of your device. This PIN can only be used once.</p>
        <p>— Scarlet Technical</p>`),
    };
  },
};

module.exports = { sendEmail, emailWrapper, emailTemplates, statusLabel };
