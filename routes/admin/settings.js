/**
 * Admin business settings, email templates, bulk email, support tickets, SMS test.
 */
const { Router } = require('express');
const { pool } = require('../../lib/db');
const { requireAdmin } = require('../../middleware/auth');
const { auditLog } = require('../../lib/audit');
const { sendEmail, emailWrapper } = require('../../lib/email');
const { trySendSMS } = require('../../lib/sms');
const logger = require('../../lib/logger');

const router = Router();

// ─── Business Settings ───────────────────────────────────────────────────────
router.get('/admin/api/settings', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM business_settings ORDER BY key');
    const settings = {};
    for (const row of r.rows) settings[row.key] = row.value;
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/admin/api/settings', requireAdmin, async (req, res) => {
  const me = await pool.query('SELECT role FROM admin_users WHERE id=$1', [req.session.adminId]);
  if (me.rows[0]?.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  const { settings } = req.body;
  if (!settings || typeof settings !== 'object') return res.status(400).json({ error: 'settings object required' });
  try {
    for (const [key, value] of Object.entries(settings)) {
      await pool.query(
        `INSERT INTO business_settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()`,
        [key, String(value)]
      );
    }
    await auditLog(req, 'update_settings', 'settings', null, { keys: Object.keys(settings) });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Email Templates ─────────────────────────────────────────────────────────
router.get('/admin/api/email-templates', requireAdmin, async (req, res) => {
  try { res.json((await pool.query('SELECT * FROM email_templates ORDER BY template_key')).rows); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/admin/api/email-templates/:key', requireAdmin, async (req, res) => {
  const me = await pool.query('SELECT role FROM admin_users WHERE id=$1', [req.session.adminId]);
  if (me.rows[0]?.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  const { subject, body_html } = req.body;
  try {
    const r = await pool.query(
      `UPDATE email_templates SET subject=$1, body_html=$2, updated_at=NOW(), updated_by=$3
       WHERE template_key=$4 RETURNING *`,
      [subject, body_html, req.session.adminId, req.params.key]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Template not found' });
    await auditLog(req, 'update_email_template', 'email_template', req.params.key, { subject });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Bulk Email ──────────────────────────────────────────────────────────────
router.post('/admin/api/bulk-email', requireAdmin, async (req, res) => {
  const me = await pool.query('SELECT role FROM admin_users WHERE id=$1', [req.session.adminId]);
  if (me.rows[0]?.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  const { subject, body_html, filter, customer_ids } = req.body;
  if (!subject || !body_html) return res.status(400).json({ error: 'subject and body_html required' });
  try {
    let customers;
    if (customer_ids?.length) {
      customers = await pool.query(
        'SELECT id, name, email FROM customers WHERE id = ANY($1) AND email IS NOT NULL AND deleted_at IS NULL',
        [customer_ids]
      );
    } else {
      // BUG FIX: Include customers with NULL status (they were excluded before)
      let q = `SELECT id, name, email FROM customers WHERE email IS NOT NULL AND deleted_at IS NULL
        AND (status='active' OR status IS NULL)`;
      if (filter === 'overdue') {
        q = `SELECT DISTINCT c.id, c.name, c.email FROM customers c
          JOIN payment_plans pp ON pp.customer_id=c.id
          JOIN installments i ON i.payment_plan_id=pp.id
          WHERE c.email IS NOT NULL AND c.deleted_at IS NULL AND i.status='pending' AND i.due_date < CURRENT_DATE AND pp.status='active'`;
      }
      customers = await pool.query(q);
    }

    let sent = 0, failed = 0;
    for (const cust of customers.rows) {
      const personalizedHtml = emailWrapper(subject, body_html.replace(/\{\{name\}\}/g, cust.name || 'Valued Customer'));
      const result = await sendEmail(cust.email, subject, personalizedHtml);
      if (result.ok) sent++; else failed++;
    }
    await auditLog(req, 'bulk_email', null, null, { subject, total: customers.rows.length, sent, failed });
    res.json({ success: true, sent, failed, total: customers.rows.length });
  } catch (err) {
    logger.error({ err }, 'Bulk email error');
    res.status(500).json({ error: err.message });
  }
});

// ─── Support Tickets ─────────────────────────────────────────────────────────
router.get('/admin/api/tickets', requireAdmin, async (req, res) => {
  const { status } = req.query;
  let q = `SELECT t.*, c.name as customer_name, c.email as customer_email
    FROM support_tickets t LEFT JOIN customers c ON c.id=t.customer_id WHERE 1=1`;
  const params = [];
  if (status) { params.push(status); q += ` AND t.status=$${params.length}`; }
  q += ' ORDER BY t.created_at DESC';
  try { res.json((await pool.query(q, params)).rows); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/admin/api/tickets/:id', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT t.*, c.name as customer_name, c.email as customer_email, c.phone as customer_phone
       FROM support_tickets t LEFT JOIN customers c ON c.id=t.customer_id WHERE t.id=$1`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    const replies = await pool.query(
      'SELECT * FROM ticket_replies WHERE ticket_id=$1 ORDER BY created_at', [req.params.id]);
    res.json({ ...r.rows[0], replies: replies.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/admin/api/tickets/:id', requireAdmin, async (req, res) => {
  const { status, priority, assigned_to, notes } = req.body;
  try {
    const r = await pool.query(
      `UPDATE support_tickets SET status=COALESCE($1,status), priority=COALESCE($2,priority),
       assigned_to=COALESCE($3,assigned_to), admin_notes=COALESCE($4,admin_notes), updated_at=NOW()
       WHERE id=$5 RETURNING *`,
      [status||null, priority||null, assigned_to||null, notes||null, req.params.id]);
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/admin/api/tickets/:id/reply', requireAdmin, async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });
  try {
    const r = await pool.query(
      `INSERT INTO ticket_replies (ticket_id, author_type, author_id, author_name, message)
       VALUES ($1,'admin',$2,$3,$4) RETURNING *`,
      [req.params.id, req.session.adminId, req.session.adminName, message]);
    await pool.query("UPDATE support_tickets SET status='in_progress', updated_at=NOW() WHERE id=$1", [req.params.id]);
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── SMS Test ────────────────────────────────────────────────────────────────
router.post('/admin/api/settings/test-sms', requireAdmin, async (req, res) => {
  const me = await pool.query('SELECT role FROM admin_users WHERE id=$1', [req.session.adminId]);
  if (me.rows[0]?.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone required' });
  const result = await trySendSMS(phone, 'Scarlet Technical: SMS test message. Your configuration is working!');
  res.json(result);
});

module.exports = router;
