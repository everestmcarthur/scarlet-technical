/**
 * Support & Communication Routes
 * Handles: Tickets (enhanced), Knowledge Base, Canned Responses, Notifications
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../../lib/db');
const logger = require('../../lib/logger');
const { sendTemplateEmail, sendEmail, createNotification } = require('../../lib/email');
const { trySendSMS } = require('../../lib/sms');

function requireAdmin(req, res, next) {
  if (!req.session?.adminId) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ─── Enhanced Tickets ───────────────────────────────────────────────────────
router.get('/admin/api/tickets', requireAdmin, async (req, res) => {
  try {
    const { status, priority, assigned, search, page = 1, limit = 50 } = req.query;
    let where = ['1=1'], params = [];
    let idx = 1;

    if (status) { where.push(`t.status = $${idx++}`); params.push(status); }
    if (priority) { where.push(`t.priority = $${idx++}`); params.push(priority); }
    if (assigned) { where.push(`t.assigned_to = $${idx++}`); params.push(assigned); }
    if (search) { where.push(`(t.subject ILIKE $${idx} OR t.message ILIKE $${idx})`); params.push(`%${search}%`); idx++; }

    const offset = (page - 1) * limit;
    params.push(limit, offset);

    const result = await pool.query(`
      SELECT t.*, c.first_name, c.last_name, c.email, c.phone,
             au.name as assigned_name,
             (SELECT COUNT(*) FROM ticket_messages WHERE ticket_id = t.id) as message_count
      FROM support_tickets t
      LEFT JOIN customers c ON t.customer_id = c.id
      LEFT JOIN admin_users au ON t.assigned_to = au.id
      WHERE ${where.join(' AND ')}
      ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
               t.updated_at DESC
      LIMIT $${idx++} OFFSET $${idx}
    `, params);

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM support_tickets t WHERE ${where.join(' AND ')}`,
      params.slice(0, -2)
    );

    res.json({ tickets: result.rows, total: parseInt(countResult.rows[0].count) });
  } catch (err) {
    logger.error({ err }, 'Failed to load tickets');
    res.status(500).json({ error: 'Failed to load tickets' });
  }
});

// Ticket detail with conversation
router.get('/admin/api/tickets/:id', requireAdmin, async (req, res) => {
  try {
    const ticket = await pool.query(`
      SELECT t.*, c.first_name, c.last_name, c.email, c.phone
      FROM support_tickets t
      LEFT JOIN customers c ON t.customer_id = c.id
      WHERE t.id = $1
    `, [req.params.id]);

    if (ticket.rows.length === 0) return res.status(404).json({ error: 'Not found' });

    const messages = await pool.query(`
      SELECT tm.*, au.name as admin_name
      FROM ticket_messages tm
      LEFT JOIN admin_users au ON tm.sender_id = au.id
      WHERE tm.ticket_id = $1
      ORDER BY tm.created_at ASC
    `, [req.params.id]);

    res.json({ ...ticket.rows[0], messages: messages.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load ticket' });
  }
});

// Reply to ticket (supports email, SMS, or portal reply)
router.post('/admin/api/tickets/:id/reply', requireAdmin, async (req, res) => {
  const { message, channel = 'portal' } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });

  try {
    const ticket = await pool.query(`
      SELECT t.*, c.first_name, c.email, c.phone, c.comm_pref
      FROM support_tickets t
      LEFT JOIN customers c ON t.customer_id = c.id
      WHERE t.id = $1
    `, [req.params.id]);

    if (ticket.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const t = ticket.rows[0];

    // Add message to thread
    await pool.query(
      `INSERT INTO ticket_messages (ticket_id, sender_type, sender_id, message, created_at) VALUES ($1, $2, $3, $4, NOW())`,
      [req.params.id, `admin_${channel}`, req.session.adminId, message]
    );

    // Update ticket
    await pool.query(
      `UPDATE support_tickets SET status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END, 
       admin_response = $1, responded_by = $2, responded_at = NOW(), updated_at = NOW() WHERE id = $3`,
      [message, req.session.adminId, req.params.id]
    );

    // Send via appropriate channel
    if (channel === 'email' && t.email) {
      await sendEmail({
        to: t.email,
        subject: `Re: Ticket #${t.id} - ${t.subject}`,
        html: `<p>Hi ${t.first_name || ''},</p><p>${message.replace(/\n/g, '<br>')}</p><p>— Scarlet Technical Support</p>`,
      });
    } else if (channel === 'sms' && (t.phone || t.sms_phone)) {
      await trySendSMS(t.phone || t.sms_phone, `Scarlet Technical re: Ticket #${t.id}: ${message}`);
    }

    // Notification for customer portal
    if (t.customer_id) {
      await createNotification({
        customerId: t.customer_id,
        type: 'ticket_reply',
        title: `Reply on Ticket #${t.id}`,
        message: message.substring(0, 100),
        link: `/portal/tickets/${t.id}`,
      });
    }

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, 'Ticket reply failed');
    res.status(500).json({ error: 'Reply failed' });
  }
});

// Update ticket (assign, change priority/status)
router.put('/admin/api/tickets/:id', requireAdmin, async (req, res) => {
  const { status, priority, assigned_to, category } = req.body;
  try {
    const sets = [], params = [];
    let idx = 1;
    if (status) { sets.push(`status = $${idx++}`); params.push(status); }
    if (priority) { sets.push(`priority = $${idx++}`); params.push(priority); }
    if (assigned_to !== undefined) { sets.push(`assigned_to = $${idx++}`); params.push(assigned_to || null); }
    if (category) { sets.push(`category = $${idx++}`); params.push(category); }
    sets.push(`updated_at = NOW()`);
    params.push(req.params.id);

    await pool.query(`UPDATE support_tickets SET ${sets.join(', ')} WHERE id = $${idx}`, params);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Update failed' });
  }
});

// ─── Knowledge Base ─────────────────────────────────────────────────────────
router.get('/admin/api/kb', requireAdmin, async (req, res) => {
  try {
    const articles = await pool.query(
      `SELECT id, title, slug, category, is_public, is_internal, view_count, published_at, updated_at
       FROM kb_articles ORDER BY updated_at DESC`
    );
    res.json(articles.rows);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.get('/admin/api/kb/:id', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM kb_articles WHERE id = $1', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/admin/api/kb', requireAdmin, async (req, res) => {
  const { title, content, category, is_public = true, is_internal = false } = req.body;
  if (!title || !content) return res.status(400).json({ error: 'Title and content required' });
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  try {
    const r = await pool.query(
      `INSERT INTO kb_articles (title, slug, content, category, is_public, is_internal, author_id, published_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), NOW()) RETURNING id`,
      [title, slug, content, category, is_public, is_internal, req.session.adminId]
    );
    res.json({ id: r.rows[0].id });
  } catch (err) { res.status(500).json({ error: 'Failed to create article' }); }
});

router.put('/admin/api/kb/:id', requireAdmin, async (req, res) => {
  const { title, content, category, is_public, is_internal } = req.body;
  try {
    await pool.query(
      `UPDATE kb_articles SET title = COALESCE($1, title), content = COALESCE($2, content), 
       category = COALESCE($3, category), is_public = COALESCE($4, is_public), 
       is_internal = COALESCE($5, is_internal), updated_at = NOW() WHERE id = $6`,
      [title, content, category, is_public, is_internal, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.delete('/admin/api/kb/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM kb_articles WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ─── Canned Responses ───────────────────────────────────────────────────────
router.get('/admin/api/canned-responses', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM canned_responses ORDER BY use_count DESC');
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/admin/api/canned-responses', requireAdmin, async (req, res) => {
  const { title, content, category } = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO canned_responses (title, content, category, created_by) VALUES ($1, $2, $3, $4) RETURNING id`,
      [title, content, category, req.session.adminId]
    );
    res.json({ id: r.rows[0].id });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ─── Notifications ──────────────────────────────────────────────────────────
router.get('/admin/api/notifications', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT * FROM notifications WHERE admin_id = $1 OR admin_id IS NULL ORDER BY created_at DESC LIMIT 50`,
      [req.session.adminId]
    );
    const unread = await pool.query(
      `SELECT COUNT(*) FROM notifications WHERE (admin_id = $1 OR admin_id IS NULL) AND read = false`,
      [req.session.adminId]
    );
    res.json({ notifications: r.rows, unread: parseInt(unread.rows[0].count) });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/admin/api/notifications/mark-read', requireAdmin, async (req, res) => {
  const { ids } = req.body;
  try {
    if (ids && ids.length) {
      await pool.query('UPDATE notifications SET read = true WHERE id = ANY($1)', [ids]);
    } else {
      await pool.query('UPDATE notifications SET read = true WHERE admin_id = $1 OR admin_id IS NULL', [req.session.adminId]);
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

module.exports = router;

// ─── Ad-hoc Email Send ──────────────────────────────────────────────────────
router.post('/admin/api/email/send', requireAdmin, async (req, res) => {
  const { to, subject, html } = req.body;
  if (!to || !subject || !html) return res.status(400).json({ error: 'to, subject, and html required' });
  try {
    const email = require('../../lib/email');
    const result = await email.sendEmail({ to, subject, html });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
