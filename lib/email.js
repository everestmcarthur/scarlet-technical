/**
 * Email sending via Polsia API + HTML templates.
 */
const logger = require('./logger');

const POLSIA_API_KEY = process.env.POLSIA_API_KEY || '';
const POLSIA_FROM = process.env.POLSIA_EMAIL_FROM || 'noreply@jarviscli.dev';

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
      <a href="https://jarviscli.dev" style="color:#C41E3A">jarviscli.dev</a>
    </p>
  </div>
</body>
</html>`;
}

// ─── Send email via Polsia ───────────────────────────────────────────────────
async function sendEmail(to, subject, html, text) {
  if (!POLSIA_API_KEY) {
    logger.warn({ to, subject }, 'Email skipped — no POLSIA_API_KEY configured');
    return { ok: false, error: 'No API key' };
  }
  try {
    const resp = await fetch('https://polsia.app/api/v1/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${POLSIA_API_KEY}` },
      body: JSON.stringify({ from: POLSIA_FROM, to, subject, html, text: text || '' }),
    });
    if (resp.ok) {
      logger.info({ to, subject }, 'Email sent');
      return { ok: true };
    }
    const errText = await resp.text().catch(() => 'Unknown error');
    logger.error({ to, subject, status: resp.status, body: errText }, 'Email API error');
    return { ok: false, error: errText };
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
        <p>Log in to your <a href="https://jarviscli.dev/portal" style="color:#C41E3A;font-weight:600">customer portal</a> for full details.</p>
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
        <p>View your full payment history in the <a href="https://jarviscli.dev/portal" style="color:#C41E3A;font-weight:600">customer portal</a>.</p>
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
        <p>View your contract anytime in the <a href="https://jarviscli.dev/portal" style="color:#C41E3A;font-weight:600">customer portal</a>.</p>
        <p>— Scarlet Technical</p>`),
    };
  },

  reminder3day(customer, installment) {
    return {
      subject: 'Payment Reminder — Due in 3 Days',
      html: emailWrapper('Upcoming Payment Reminder', `
        <p>Hi ${(customer.name || '').split(' ')[0]},</p>
        <p>This is a friendly reminder that your payment of <strong>$${parseFloat(installment.amount).toFixed(2)}</strong> is due on <strong>${new Date(installment.due_date).toLocaleDateString()}</strong>.</p>
        <p>Log in to your <a href="https://jarviscli.dev/portal" style="color:#C41E3A;font-weight:600">portal</a> for details.</p>
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
};

module.exports = { sendEmail, emailWrapper, emailTemplates, statusLabel };
