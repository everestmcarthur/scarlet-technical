/**
 * SMS Webhook — Inbound SMS from Twilio
 * 
 * Twilio sends POST to /api/sms/incoming when customers text the business number.
 * 
 * Commands:
 *   STATUS          → Returns latest repair status
 *   PAY             → Sends Stripe payment link for outstanding balance
 *   HOURS           → Returns business hours
 *   HELP            → Lists available commands
 *   STOP            → Opt-out of SMS marketing
 *   START           → Opt-in to SMS marketing
 *   APPT / SCHEDULE → Returns next appointment or booking link
 *   (free text)     → Creates/updates support ticket
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../lib/db');
const logger = require('../lib/logger');
const { trySendSMS } = require('../lib/sms');
const { postDiscordNotification } = require('../lib/discord-webhook');

// Twilio signature validation middleware
function validateTwilioSignature(req, res, next) {
  // In production, validate X-Twilio-Signature header
  // For now, check that the request has expected Twilio fields
  if (!req.body || !req.body.From || !req.body.Body) {
    return res.status(400).send('<Response><Message>Invalid request</Message></Response>');
  }
  next();
}

// Format phone for consistent matching (strip +1, spaces, dashes)
function normalizePhone(phone) {
  if (!phone) return '';
  return phone.replace(/[^0-9]/g, '').replace(/^1(\d{10})$/, '$1');
}

// ─── Inbound SMS Webhook ────────────────────────────────────────────────────
router.post('/api/sms/incoming', validateTwilioSignature, async (req, res) => {
  const fromPhone = req.body.From || '';
  const body = (req.body.Body || '').trim();
  const messageSid = req.body.MessageSid || '';
  const numMedia = parseInt(req.body.NumMedia || '0', 10);

  logger.info({ from: fromPhone, body: body.substring(0, 100), messageSid }, 'Inbound SMS received');

  try {
    // Look up customer by phone
    const normalizedPhone = normalizePhone(fromPhone);
    const customerResult = await pool.query(
      `SELECT id, first_name, last_name, email, phone, sms_opt_in 
       FROM customers 
       WHERE REPLACE(REPLACE(REPLACE(REPLACE(phone, '-', ''), ' ', ''), '(', ''), ')', '') LIKE $1
       LIMIT 1`,
      [`%${normalizedPhone.slice(-10)}`]
    );
    const customer = customerResult.rows[0] || null;

    // Log inbound message
    await pool.query(
      `INSERT INTO sms_messages (direction, phone, customer_id, body, twilio_sid, media_count, created_at)
       VALUES ('inbound', $1, $2, $3, $4, $5, NOW())`,
      [fromPhone, customer?.id || null, body, messageSid, numMedia]
    );

    // Parse command
    const command = body.toUpperCase().split(/\s+/)[0];
    let replyText;

    switch (command) {
      case 'STATUS':
        replyText = await handleStatusCommand(customer, fromPhone);
        break;
      case 'PAY':
        replyText = await handlePayCommand(customer, fromPhone);
        break;
      case 'HOURS':
        replyText = await handleHoursCommand();
        break;
      case 'HELP':
        replyText = getHelpText();
        break;
      case 'STOP':
        replyText = await handleOptOut(customer, fromPhone);
        break;
      case 'START':
      case 'SUBSCRIBE':
        replyText = await handleOptIn(customer, fromPhone);
        break;
      case 'APPT':
      case 'SCHEDULE':
      case 'APPOINTMENT':
        replyText = await handleAppointmentCommand(customer, fromPhone);
        break;
      default:
        // Free text → create/update support ticket
        replyText = await handleFreeText(customer, fromPhone, body, numMedia);
        break;
    }

    // Log outbound reply
    if (replyText) {
      await pool.query(
        `INSERT INTO sms_messages (direction, phone, customer_id, body, created_at)
         VALUES ('outbound', $1, $2, $3, NOW())`,
        [fromPhone, customer?.id || null, replyText]
      );
    }

    // Reply as TwiML
    const twiml = replyText
      ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(replyText)}</Message></Response>`
      : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;

    res.type('text/xml').send(twiml);

  } catch (err) {
    logger.error({ err, from: fromPhone }, 'SMS webhook error');
    res.type('text/xml').send(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Message>Sorry, something went wrong. Please call us at ' +
      (process.env.SUPPORT_PHONE || 'our support number') + '.</Message></Response>'
    );
  }
});

// ─── Command Handlers ───────────────────────────────────────────────────────

async function handleStatusCommand(customer, phone) {
  if (!customer) {
    return `We don't have a customer on file with this number. Please call us at ${process.env.SUPPORT_PHONE || 'our office'} or reply with your name and issue.`;
  }

  const repairs = await pool.query(
    `SELECT id, device_type, device_model, status, created_at 
     FROM repairs 
     WHERE customer_id = $1 
     ORDER BY created_at DESC LIMIT 3`,
    [customer.id]
  );

  if (repairs.rows.length === 0) {
    return `Hi ${customer.first_name}! You don't have any active repairs on file. Need something? Reply with your issue and we'll create a ticket.`;
  }

  let reply = `Hi ${customer.first_name}! Your recent repairs:\n`;
  for (const r of repairs.rows) {
    const device = [r.device_type, r.device_model].filter(Boolean).join(' ') || 'Device';
    const statusEmoji = {
      'intake': '📋', 'diagnosed': '🔍', 'waiting_parts': '📦',
      'in_progress': '🔧', 'quality_check': '✅', 'ready': '🎉',
      'picked_up': '👍', 'cancelled': '❌'
    }[r.status] || '📋';
    reply += `\n${statusEmoji} #${r.id} ${device}: ${r.status.replace(/_/g, ' ').toUpperCase()}`;
  }
  reply += `\n\nReply PAY for payment options or HELP for more commands.`;
  return reply;
}

async function handlePayCommand(customer, phone) {
  if (!customer) {
    return `We don't have a customer on file with this number. Please call us at ${process.env.SUPPORT_PHONE || 'our office'}.`;
  }

  // Check for outstanding payment plans
  const plans = await pool.query(
    `SELECT pp.id, pp.total_amount, 
            COALESCE(SUM(CASE WHEN i.status = 'paid' THEN i.amount ELSE 0 END), 0) as paid,
            pp.total_amount - COALESCE(SUM(CASE WHEN i.status = 'paid' THEN i.amount ELSE 0 END), 0) as remaining
     FROM payment_plans pp
     LEFT JOIN installments i ON i.payment_plan_id = pp.id
     WHERE pp.customer_id = $1 AND pp.status IN ('active', 'overdue')
     GROUP BY pp.id
     ORDER BY pp.created_at DESC LIMIT 1`,
    [customer.id]
  );

  if (plans.rows.length === 0) {
    return `Hi ${customer.first_name}! You don't have any outstanding balances. 🎉`;
  }

  const plan = plans.rows[0];
  const siteUrl = process.env.SITE_URL || 'https://scarlet-technical.onrender.com';
  return `Hi ${customer.first_name}! You have $${parseFloat(plan.remaining).toFixed(2)} remaining on your payment plan.\n\nPay online: ${siteUrl}/portal\n\nOr call us at ${process.env.SUPPORT_PHONE || 'our office'} to pay by phone.`;
}

async function handleHoursCommand() {
  // Try to get from business_settings
  const result = await pool.query(
    "SELECT value FROM business_settings WHERE key = 'business_hours'"
  ).catch(() => ({ rows: [] }));

  if (result.rows.length > 0 && result.rows[0].value) {
    return `🕐 Scarlet Technical Hours:\n${result.rows[0].value}\n\nBook online: ${process.env.SITE_URL || 'https://scarlet-technical.onrender.com'}/book`;
  }

  return `🕐 Scarlet Technical Hours:\nMon-Fri: 9 AM - 6 PM\nSat: 10 AM - 4 PM\nSun: Closed\n\nBook online: ${process.env.SITE_URL || 'https://scarlet-technical.onrender.com'}/book`;
}

function getHelpText() {
  return `📱 Scarlet Technical SMS Commands:\n\nSTATUS — Check repair status\nPAY — Payment options\nHOURS — Business hours\nAPPT — Appointment info\nHELP — This menu\nSTOP — Opt-out of texts\n\nOr just text us your issue and we'll create a support ticket!`;
}

async function handleOptOut(customer, phone) {
  if (customer) {
    await pool.query('UPDATE customers SET sms_opt_in = false WHERE id = $1', [customer.id]);
  }
  // Also log in sms_preferences
  await pool.query(
    `INSERT INTO sms_preferences (phone, opted_in, updated_at)
     VALUES ($1, false, NOW())
     ON CONFLICT (phone) DO UPDATE SET opted_in = false, updated_at = NOW()`,
    [phone]
  );
  return 'You have been unsubscribed from Scarlet Technical texts. Reply START to re-subscribe. You will still receive repair status updates.';
}

async function handleOptIn(customer, phone) {
  if (customer) {
    await pool.query('UPDATE customers SET sms_opt_in = true WHERE id = $1', [customer.id]);
  }
  await pool.query(
    `INSERT INTO sms_preferences (phone, opted_in, updated_at)
     VALUES ($1, true, NOW())
     ON CONFLICT (phone) DO UPDATE SET opted_in = true, updated_at = NOW()`,
    [phone]
  );
  return '✅ You are now subscribed to Scarlet Technical texts! Reply STOP at any time to unsubscribe.';
}

async function handleAppointmentCommand(customer, phone) {
  if (!customer) {
    const siteUrl = process.env.SITE_URL || 'https://scarlet-technical.onrender.com';
    return `Book an appointment online: ${siteUrl}/book\n\nOr call us at ${process.env.SUPPORT_PHONE || 'our office'}.`;
  }

  const appt = await pool.query(
    `SELECT id, scheduled_at, service_type, notes 
     FROM appointments 
     WHERE customer_id = $1 AND scheduled_at > NOW() AND status != 'cancelled'
     ORDER BY scheduled_at ASC LIMIT 1`,
    [customer.id]
  );

  if (appt.rows.length > 0) {
    const a = appt.rows[0];
    const date = new Date(a.scheduled_at).toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
    return `📅 Your next appointment:\n${date}\n${a.service_type || ''}\n\nNeed to reschedule? Reply or call ${process.env.SUPPORT_PHONE || 'us'}.`;
  }

  const siteUrl = process.env.SITE_URL || 'https://scarlet-technical.onrender.com';
  return `Hi ${customer.first_name}! You don't have any upcoming appointments.\n\nBook one here: ${siteUrl}/book`;
}

async function handleFreeText(customer, phone, body, numMedia) {
  const customerName = customer
    ? `${customer.first_name} ${customer.last_name}`
    : `Unknown (${phone})`;

  // Check for recent open ticket from this phone/customer to add to it
  const recentTicket = await pool.query(
    `SELECT id, subject FROM support_tickets 
     WHERE (customer_id = $1 OR ($1 IS NULL AND sms_phone = $2))
       AND status IN ('open', 'in_progress')
       AND created_at > NOW() - INTERVAL '24 hours'
     ORDER BY created_at DESC LIMIT 1`,
    [customer?.id || null, phone]
  );

  if (recentTicket.rows.length > 0) {
    // Add to existing ticket
    const ticket = recentTicket.rows[0];
    await pool.query(
      `INSERT INTO ticket_messages (ticket_id, sender_type, sender_phone, message, created_at)
       VALUES ($1, 'customer_sms', $2, $3, NOW())`,
      [ticket.id, phone, body]
    );
    await pool.query(
      `UPDATE support_tickets SET updated_at = NOW() WHERE id = $1`,
      [ticket.id]
    );

    logger.info({ ticketId: ticket.id, phone }, 'SMS added to existing ticket');

    return `Thanks ${customer?.first_name || ''}! Your message has been added to ticket #${ticket.id}. We'll respond shortly.`;
  }

  // Create new ticket
  const subject = body.length > 80 ? body.substring(0, 77) + '...' : body;
  const ticketResult = await pool.query(
    `INSERT INTO support_tickets (customer_id, sms_phone, subject, message, source, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'sms', 'open', NOW(), NOW())
     RETURNING id`,
    [customer?.id || null, phone, `SMS: ${subject}`, body]
  );
  const ticketId = ticketResult.rows[0].id;

  // Also add as first ticket message
  await pool.query(
    `INSERT INTO ticket_messages (ticket_id, sender_type, sender_phone, message, created_at)
     VALUES ($1, 'customer_sms', $2, $3, NOW())`,
    [ticketId, phone, body]
  );

  // Discord notification
  postDiscordNotification('customer-activity', {
    title: `📱 New SMS Ticket #${ticketId}`,
    description: `From: ${customerName}\nPhone: ${phone}\n\n${body.substring(0, 200)}`,
    color: 0xFF4444
  }).catch(() => {});

  logger.info({ ticketId, phone, customerId: customer?.id }, 'SMS created new ticket');

  return `Thanks${customer ? ' ' + customer.first_name : ''}! We've created support ticket #${ticketId} from your message. A technician will respond soon.\n\nReply here to add details. Text STATUS for repair updates or HELP for commands.`;
}

// ─── Admin SMS Reply Endpoint ───────────────────────────────────────────────
// Allows admins to reply to SMS conversations from the admin panel
router.post('/admin/api/sms/reply', async (req, res) => {
  if (!req.session?.adminId) return res.status(401).json({ error: 'Unauthorized' });

  const { phone, message, ticketId } = req.body;
  if (!phone || !message) return res.status(400).json({ error: 'Phone and message required' });

  try {
    const result = await trySendSMS(phone, message);
    if (!result.ok) {
      return res.status(500).json({ error: result.error || 'SMS send failed' });
    }

    // Log outbound message
    const customerResult = await pool.query(
      `SELECT id FROM customers WHERE REPLACE(REPLACE(REPLACE(REPLACE(phone, '-', ''), ' ', ''), '(', ''), ')', '') LIKE $1 LIMIT 1`,
      [`%${normalizePhone(phone).slice(-10)}`]
    );

    await pool.query(
      `INSERT INTO sms_messages (direction, phone, customer_id, body, sent_by, created_at)
       VALUES ('outbound', $1, $2, $3, $4, NOW())`,
      [phone, customerResult.rows[0]?.id || null, message, req.session.adminId]
    );

    // Also add to ticket if specified
    if (ticketId) {
      await pool.query(
        `INSERT INTO ticket_messages (ticket_id, sender_type, sender_id, message, created_at)
         VALUES ($1, 'admin_sms', $2, $3, NOW())`,
        [ticketId, req.session.adminId, message]
      );
    }

    // Audit log
    await pool.query(
      `INSERT INTO admin_audit_log (admin_id, action, details, created_at) VALUES ($1, $2, $3, NOW())`,
      [req.session.adminId, 'sms_reply', JSON.stringify({ phone, ticketId })]
    );

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, 'Admin SMS reply failed');
    res.status(500).json({ error: 'Failed to send SMS' });
  }
});

// ─── SMS Conversation History ───────────────────────────────────────────────
router.get('/admin/api/sms/conversations', async (req, res) => {
  if (!req.session?.adminId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    // Get distinct conversations with last message
    const conversations = await pool.query(`
      SELECT DISTINCT ON (sm.phone) 
        sm.phone,
        sm.body as last_message,
        sm.direction as last_direction,
        sm.created_at as last_message_at,
        c.id as customer_id,
        c.first_name,
        c.last_name,
        (SELECT COUNT(*) FROM sms_messages WHERE phone = sm.phone AND direction = 'inbound' AND read = false) as unread_count
      FROM sms_messages sm
      LEFT JOIN customers c ON sm.customer_id = c.id
      ORDER BY sm.phone, sm.created_at DESC
    `);
    res.json(conversations.rows);
  } catch (err) {
    logger.error({ err }, 'Failed to load SMS conversations');
    res.status(500).json({ error: 'Failed to load conversations' });
  }
});

// ─── Single Conversation Thread ─────────────────────────────────────────────
router.get('/admin/api/sms/conversations/:phone', async (req, res) => {
  if (!req.session?.adminId) return res.status(401).json({ error: 'Unauthorized' });

  const { phone } = req.params;
  const { limit = 50, offset = 0 } = req.query;

  try {
    const messages = await pool.query(
      `SELECT sm.*, au.name as sent_by_name
       FROM sms_messages sm
       LEFT JOIN admin_users au ON sm.sent_by = au.id
       WHERE sm.phone = $1
       ORDER BY sm.created_at DESC
       LIMIT $2 OFFSET $3`,
      [phone, limit, offset]
    );

    // Mark as read
    await pool.query(
      `UPDATE sms_messages SET read = true WHERE phone = $1 AND direction = 'inbound' AND read = false`,
      [phone]
    );

    res.json(messages.rows.reverse());
  } catch (err) {
    logger.error({ err }, 'Failed to load conversation');
    res.status(500).json({ error: 'Failed to load conversation' });
  }
});

// ─── Bulk SMS (Marketing) ───────────────────────────────────────────────────
router.post('/admin/api/sms/bulk', async (req, res) => {
  if (!req.session?.adminId) return res.status(401).json({ error: 'Unauthorized' });

  const { message, filter, customerIds } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });

  try {
    let recipients;

    if (customerIds && customerIds.length > 0) {
      // Specific customers
      recipients = await pool.query(
        `SELECT id, first_name, phone FROM customers WHERE id = ANY($1) AND phone IS NOT NULL AND sms_opt_in = true`,
        [customerIds]
      );
    } else {
      // All opted-in customers
      recipients = await pool.query(
        `SELECT id, first_name, phone FROM customers WHERE phone IS NOT NULL AND sms_opt_in = true AND status != 'inactive'`
      );
    }

    let sent = 0, failed = 0;
    for (const c of recipients.rows) {
      const personalizedMsg = message.replace(/{first_name}/g, c.first_name || 'Customer');
      const result = await trySendSMS(c.phone, personalizedMsg);
      if (result.ok) {
        sent++;
        await pool.query(
          `INSERT INTO sms_messages (direction, phone, customer_id, body, sent_by, bulk_campaign_id, created_at)
           VALUES ('outbound', $1, $2, $3, $4, $5, NOW())`,
          [c.phone, c.id, personalizedMsg, req.session.adminId, null]
        );
      } else {
        failed++;
      }
      // Rate limit: 1 SMS per second to avoid Twilio throttling
      await new Promise(r => setTimeout(r, 1000));
    }

    await pool.query(
      `INSERT INTO admin_audit_log (admin_id, action, details, created_at) VALUES ($1, $2, $3, NOW())`,
      [req.session.adminId, 'bulk_sms', JSON.stringify({ sent, failed, total: recipients.rows.length })]
    );

    res.json({ ok: true, sent, failed, total: recipients.rows.length });
  } catch (err) {
    logger.error({ err }, 'Bulk SMS failed');
    res.status(500).json({ error: 'Bulk SMS failed' });
  }
});

// ─── Helper ─────────────────────────────────────────────────────────────────
function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

module.exports = router;
