/**
 * Customer portal routes — authentication, profile, repairs, plans, tickets, notifications.
 * CONSOLIDATED: Removed duplicate route definitions (BUG FIX #9).
 */
const { Router } = require('express');
const bcrypt = require('bcrypt');
const path = require('path');
const { pool } = require('../../lib/db');
const { requireCustomer } = require('../../middleware/auth');
const { authLimiter } = require('../../middleware/security');
const { sendEmail, emailWrapper, emailTemplates } = require('../../lib/email');
const { generateContractHTML, generateInvoiceHTML } = require('../../lib/documents');
const { generateToken } = require('../../lib/utils');
const logger = require('../../lib/logger');

const router = Router();

// ─── Portal Pages ────────────────────────────────────────────────────────────
router.get('/portal', requireCustomer, (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/portal/index.html'));
});

router.get('/portal/login', (req, res) => {
  if (req.session?.customerId) return res.redirect('/portal');
  res.sendFile(path.join(__dirname, '../../public/portal/login.html'));
});

router.get('/portal/register', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/portal/register.html'));
});

router.get('/portal/forgot-password', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/portal/forgot-password.html'));
});

router.get('/portal/reset-password', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/portal/reset-password.html'));
});

// ─── Portal Auth ─────────────────────────────────────────────────────────────
router.post('/portal/api/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  try {
    const r = await pool.query('SELECT * FROM customers WHERE LOWER(email)=LOWER($1) AND deleted_at IS NULL', [email]);
    if (!r.rows.length) return res.status(401).json({ error: 'Invalid credentials' });
    const customer = r.rows[0];
    if (customer.status === 'suspended') return res.status(403).json({ error: 'Account suspended. Contact support.' });
    if (!customer.portal_password_hash) return res.status(401).json({ error: 'Portal access not set up. Contact Scarlet Technical.' });
    const match = await bcrypt.compare(password, customer.portal_password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });
    req.session.customerId = customer.id;
    req.session.customerName = customer.name;
    res.json({ success: true, name: customer.name });
  } catch (err) {
    logger.error({ err }, 'Portal login error');
    res.status(500).json({ error: 'Login failed' });
  }
});

// ─── Phone Login (for quick access) ──────────────────────────────────────────
router.post('/portal/api/phone-login', authLimiter, async (req, res) => {
  const { phone, last_name } = req.body;
  if (!phone || !last_name) return res.status(400).json({ error: 'Phone and last name required' });
  try {
    // Normalize phone: strip non-digits
    const cleanPhone = phone.replace(/\D/g, '');
    const r = await pool.query(
      `SELECT * FROM customers WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone,' ',''),'-',''),'(',''),')',''),'+','')
       LIKE '%' || $1 AND LOWER(name) LIKE '%' || LOWER($2) AND deleted_at IS NULL`,
      [cleanPhone.slice(-7), last_name]
    );
    if (!r.rows.length) return res.status(401).json({ error: 'No matching customer found' });
    const customer = r.rows[0];
    if (customer.status === 'suspended') return res.status(403).json({ error: 'Account suspended' });
    req.session.customerId = customer.id;
    req.session.customerName = customer.name;
    res.json({ success: true, name: customer.name });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/portal/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// ─── Portal Registration ────────────────────────────────────────────────────
router.post('/portal/api/register', authLimiter, async (req, res) => {
  const { name, email, phone, password, confirm_password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email, and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (confirm_password && password !== confirm_password) return res.status(400).json({ error: 'Passwords do not match' });
  try {
    const existing = await pool.query('SELECT id FROM customers WHERE LOWER(email)=LOWER($1)', [email]);
    if (existing.rows.length) return res.status(409).json({ error: 'An account with this email already exists' });
    const hash = await bcrypt.hash(password, 12);
    const r = await pool.query(
      `INSERT INTO customers (name, email, phone, portal_password_hash, self_registered, status)
       VALUES ($1,$2,$3,$4,true,'active') RETURNING id, name`,
      [name, email, phone || null, hash]
    );
    req.session.customerId = r.rows[0].id;
    req.session.customerName = r.rows[0].name;
    res.json({ success: true, name: r.rows[0].name });
  } catch (err) {
    logger.error({ err }, 'Portal registration error');
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ─── Forgot Password ────────────────────────────────────────────────────────
router.post('/portal/api/forgot-password', authLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  // Always return success to prevent email enumeration
  try {
    const r = await pool.query('SELECT id, name FROM customers WHERE LOWER(email)=LOWER($1) AND deleted_at IS NULL', [email]);
    if (r.rows.length) {
      const token = generateToken(32);
      await pool.query(
        'UPDATE customers SET reset_token=$1, reset_token_expires=NOW()+INTERVAL \'1 hour\' WHERE id=$2',
        [token, r.rows[0].id]
      );
      const siteUrl = process.env.SITE_URL || 'https://jarviscli.dev';
      const resetUrl = `${siteUrl}/portal/reset-password?token=${token}`;
      await sendEmail(email, 'Password Reset — Scarlet Technical',
        emailWrapper('Reset Your Password', `
          <p>Hi ${(r.rows[0].name || '').split(' ')[0]},</p>
          <p>Click the link below to reset your password. This link expires in 1 hour.</p>
          <p style="text-align:center;margin:24px 0">
            <a href="${resetUrl}" style="display:inline-block;padding:12px 32px;background:#C41E3A;color:#fff;border-radius:8px;font-weight:600;text-decoration:none">Reset Password</a>
          </p>
          <p style="font-size:.85rem;color:#666">If you didn't request this, you can safely ignore this email.</p>`)
      );
    }
  } catch (err) {
    logger.error({ err }, 'Forgot password error');
  }
  res.json({ success: true, message: 'If an account with that email exists, a reset link has been sent.' });
});

// ─── Reset Password ──────────────────────────────────────────────────────────
router.post('/portal/api/reset-password', authLimiter, async (req, res) => {
  const { token, new_password } = req.body;
  if (!token || !new_password) return res.status(400).json({ error: 'Token and new_password required' });
  if (new_password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  try {
    const r = await pool.query(
      'SELECT id FROM customers WHERE reset_token=$1 AND reset_token_expires > NOW()', [token]);
    if (!r.rows.length) return res.status(400).json({ error: 'Invalid or expired token' });
    const hash = await bcrypt.hash(new_password, 12);
    await pool.query(
      'UPDATE customers SET portal_password_hash=$1, reset_token=NULL, reset_token_expires=NULL WHERE id=$2',
      [hash, r.rows[0].id]);
    res.json({ success: true, message: 'Password reset successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Reset failed' });
  }
});

// ─── Portal: Current User ────────────────────────────────────────────────────
router.get('/portal/api/me', requireCustomer, async (req, res) => {
  try {
    const r = await pool.query('SELECT id, name, email, phone, address, created_at FROM customers WHERE id=$1', [req.session.customerId]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Portal: Update Profile ──────────────────────────────────────────────────
router.put('/portal/api/me', requireCustomer, async (req, res) => {
  const { name, phone, address } = req.body;
  try {
    const r = await pool.query(
      'UPDATE customers SET name=COALESCE($1,name), phone=$2, address=$3, updated_at=NOW() WHERE id=$4 RETURNING id, name, email, phone, address',
      [name || null, phone ?? null, address ?? null, req.session.customerId]);
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Portal: Change Password ─────────────────────────────────────────────────
router.post('/portal/api/me/change-password', requireCustomer, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) return res.status(400).json({ error: 'Both passwords required' });
  if (new_password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  try {
    const r = await pool.query('SELECT portal_password_hash FROM customers WHERE id=$1', [req.session.customerId]);
    if (!r.rows.length || !r.rows[0].portal_password_hash) return res.status(400).json({ error: 'Password not set' });
    const match = await bcrypt.compare(current_password, r.rows[0].portal_password_hash);
    if (!match) return res.status(401).json({ error: 'Current password incorrect' });
    const hash = await bcrypt.hash(new_password, 12);
    await pool.query('UPDATE customers SET portal_password_hash=$1, updated_at=NOW() WHERE id=$2', [hash, req.session.customerId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Portal: Repairs ─────────────────────────────────────────────────────────
router.get('/portal/api/repairs', requireCustomer, async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT * FROM repairs WHERE customer_id=$1 ORDER BY created_at DESC', [req.session.customerId]);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/portal/api/repairs/:id', requireCustomer, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM repairs WHERE id=$1 AND customer_id=$2', [req.params.id, req.session.customerId]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/portal/api/repairs/:id/timeline', requireCustomer, async (req, res) => {
  try {
    const check = await pool.query('SELECT id FROM repairs WHERE id=$1 AND customer_id=$2', [req.params.id, req.session.customerId]);
    if (!check.rows.length) return res.status(404).json({ error: 'Not found' });
    const r = await pool.query('SELECT status, notes, changed_at FROM repair_status_history WHERE repair_id=$1 ORDER BY changed_at ASC', [req.params.id]);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/portal/api/repairs/:id/photos', requireCustomer, async (req, res) => {
  try {
    const check = await pool.query('SELECT id FROM repairs WHERE id=$1 AND customer_id=$2', [req.params.id, req.session.customerId]);
    if (!check.rows.length) return res.status(404).json({ error: 'Not found' });
    const r = await pool.query('SELECT id, stage, caption, uploaded_at FROM repair_photos WHERE repair_id=$1 ORDER BY uploaded_at ASC', [req.params.id]);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/portal/api/photos/:id', requireCustomer, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT rp.* FROM repair_photos rp JOIN repairs rep ON rep.id=rp.repair_id
       WHERE rp.id=$1 AND rep.customer_id=$2`, [req.params.id, req.session.customerId]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/portal/api/repairs/:id/checklist', requireCustomer, async (req, res) => {
  try {
    const check = await pool.query('SELECT id FROM repairs WHERE id=$1 AND customer_id=$2', [req.params.id, req.session.customerId]);
    if (!check.rows.length) return res.status(404).json({ error: 'Not found' });
    const r = await pool.query('SELECT * FROM intake_checklists WHERE repair_id=$1', [req.params.id]);
    res.json(r.rows[0] || null);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Portal: Submit Repair Request ───────────────────────────────────────────
router.post('/portal/api/repair-requests', requireCustomer, async (req, res) => {
  const { device_type, device_brand, issue_description, preferred_contact, service_type } = req.body;
  if (!issue_description) return res.status(400).json({ error: 'Issue description required' });
  try {
    const cust = await pool.query('SELECT name, email, phone FROM customers WHERE id=$1', [req.session.customerId]);
    const c = cust.rows[0] || {};
    const r = await pool.query(
      `INSERT INTO repair_requests (name, email, phone, device_type, device_brand, issue_description,
       preferred_contact, service_type, customer_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [c.name, c.email, c.phone, device_type||null, device_brand||null, issue_description,
       preferred_contact||'email', service_type||'in_person', req.session.customerId]);
    res.json({ success: true, id: r.rows[0].id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Portal: Payment Plans ───────────────────────────────────────────────────
router.get('/portal/api/payment-plans', requireCustomer, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT pp.*, r.device_brand, r.device_model, r.device_type
       FROM payment_plans pp LEFT JOIN repairs r ON r.id=pp.repair_id
       WHERE pp.customer_id=$1 ORDER BY pp.created_at DESC`, [req.session.customerId]);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/portal/api/payment-plans/:id', requireCustomer, async (req, res) => {
  try {
    const plan = await pool.query('SELECT * FROM payment_plans WHERE id=$1 AND customer_id=$2', [req.params.id, req.session.customerId]);
    if (!plan.rows.length) return res.status(404).json({ error: 'Not found' });
    const inst = await pool.query('SELECT * FROM installments WHERE payment_plan_id=$1 ORDER BY installment_number', [req.params.id]);
    res.json({ plan: plan.rows[0], installments: inst.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/portal/api/payment-plans/:id/contract', requireCustomer, async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT contract_html, signature_data_url, contract_signed_at, contract_signed FROM payment_plans WHERE id=$1 AND customer_id=$2',
      [req.params.id, req.session.customerId]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Portal: Invoices ────────────────────────────────────────────────────────
router.get('/portal/api/invoices', requireCustomer, async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT * FROM invoices WHERE customer_id=$1 AND status != 'draft' ORDER BY created_at DESC",
      [req.session.customerId]);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/portal/api/invoices/:id/html', requireCustomer, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT i.*, c.name as customer_name, c.email as customer_email, c.phone as customer_phone, c.address as customer_address
       FROM invoices i JOIN customers c ON c.id=i.customer_id
       WHERE i.id=$1 AND i.customer_id=$2 AND i.status != 'draft'`,
      [req.params.id, req.session.customerId]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    const inv = r.rows[0];
    const items = Array.isArray(inv.line_items) ? inv.line_items : JSON.parse(inv.line_items || '[]');
    res.setHeader('Content-Type', 'text/html');
    res.send(generateInvoiceHTML(inv, items));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Portal: Support Tickets ─────────────────────────────────────────────────
router.get('/portal/api/tickets', requireCustomer, async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT * FROM support_tickets WHERE customer_id=$1 ORDER BY created_at DESC', [req.session.customerId]);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/portal/api/tickets', requireCustomer, async (req, res) => {
  const { subject, message, category } = req.body;
  if (!subject || !message) return res.status(400).json({ error: 'Subject and message required' });
  try {
    const r = await pool.query(
      `INSERT INTO support_tickets (customer_id, subject, message, category) VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.session.customerId, subject, message, category || 'general']);
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/portal/api/tickets/:id/reply', requireCustomer, async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });
  try {
    const ticket = await pool.query('SELECT id FROM support_tickets WHERE id=$1 AND customer_id=$2',
      [req.params.id, req.session.customerId]);
    if (!ticket.rows.length) return res.status(404).json({ error: 'Not found' });
    const r = await pool.query(
      `INSERT INTO ticket_replies (ticket_id, author_type, author_id, author_name, message)
       VALUES ($1,'customer',$2,$3,$4) RETURNING *`,
      [req.params.id, req.session.customerId, req.session.customerName, message]);
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Portal: Notifications ───────────────────────────────────────────────────
router.get('/portal/api/notifications', requireCustomer, async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT * FROM customer_notifications WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 50',
      [req.session.customerId]);
    const unread = r.rows.filter(n => !n.is_read).length;
    res.json({ notifications: r.rows, unread });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/portal/api/notifications/:id/read', requireCustomer, async (req, res) => {
  try {
    await pool.query('UPDATE customer_notifications SET is_read=true WHERE id=$1 AND customer_id=$2',
      [req.params.id, req.session.customerId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/portal/api/notifications/read-all', requireCustomer, async (req, res) => {
  try {
    await pool.query('UPDATE customer_notifications SET is_read=true WHERE customer_id=$1', [req.session.customerId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Portal: Satisfaction Rating ─────────────────────────────────────────────
router.post('/portal/api/repairs/:id/satisfaction', requireCustomer, async (req, res) => {
  const { rating, comment } = req.body;
  if (!['thumbs_up', 'thumbs_down'].includes(rating)) return res.status(400).json({ error: 'Invalid rating' });
  try {
    const check = await pool.query('SELECT id FROM repairs WHERE id=$1 AND customer_id=$2', [req.params.id, req.session.customerId]);
    if (!check.rows.length) return res.status(404).json({ error: 'Not found' });
    await pool.query(
      `UPDATE repairs SET satisfaction_rating=$1, satisfaction_comment=$2, satisfaction_rated_at=NOW()
       WHERE id=$3 AND customer_id=$4`,
      [rating, comment || null, req.params.id, req.session.customerId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Portal: Impersonation Status ────────────────────────────────────────────
router.get('/portal/api/impersonation-status', (req, res) => {
  if (req.session?.impersonating && req.session.impersonating_admin_id) {
    res.json({ impersonating: true, admin_name: req.session.impersonating_admin_name });
  } else {
    res.json({ impersonating: false });
  }
});

module.exports = router;
