/**
 * Authentication routes — admin login, setup, password recovery.
 */
const { Router } = require('express');
const bcrypt = require('bcrypt');
const path = require('path');
const { pool } = require('../lib/db');
const { auditLog } = require('../lib/audit');
const { requireAdmin } = require('../middleware/auth');
const { authLimiter } = require('../middleware/security');
const logger = require('../lib/logger');

const crypto = require('crypto');
const router = Router();

// ─── Admin Login ─────────────────────────────────────────────────────────────
router.get('/admin/login', (req, res) => {
  if (req.session?.adminId) return res.redirect('/admin');
  res.sendFile(path.join(__dirname, '..', 'public/admin/login.html'));
});

router.post('/admin/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  try {
    const result = await pool.query('SELECT * FROM admin_users WHERE LOWER(email) = LOWER($1)', [email]);
    if (!result.rows.length) return res.status(401).json({ error: 'Invalid credentials' });
    const admin = result.rows[0];
    if (admin.is_active === false) return res.status(401).json({ error: 'Account disabled' });
    const match = await bcrypt.compare(password, admin.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });
    req.session.adminId = admin.id;
    req.session.adminName = admin.display_name || admin.name || admin.email;
    req.session.adminRole = admin.role || 'admin';
    logger.info({ adminId: admin.id, email: admin.email }, 'Admin logged in');
    res.json({ success: true, role: admin.role || 'admin' });
  } catch (err) {
    logger.error({ err }, 'Admin login error');
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/admin/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// ─── Admin Setup (first-time only) ──────────────────────────────────────────
router.post('/admin/setup', authLimiter, async (req, res) => {
  const { email, password, name, setup_key } = req.body;
  const expectedKey = process.env.ADMIN_SETUP_KEY;
  if (!expectedKey) return res.status(503).json({ error: 'Setup not configured. Set ADMIN_SETUP_KEY environment variable.' });
  if (setup_key !== expectedKey) return res.status(403).json({ error: 'Invalid setup key' });
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  try {
    const count = await pool.query('SELECT COUNT(*) FROM admin_users');
    if (parseInt(count.rows[0].count) > 0) return res.status(400).json({ error: 'Admin already exists' });
    const hash = await bcrypt.hash(password, 12);
    await pool.query('INSERT INTO admin_users (email, password_hash, name, role) VALUES ($1,$2,$3,$4)', [email, hash, name || email, 'admin']);
    logger.info({ email }, 'Admin account created via setup');
    res.json({ success: true, message: 'Admin account created' });
  } catch (err) {
    logger.error({ err }, 'Setup error');
    res.status(500).json({ error: 'Setup failed' });
  }
});

// ─── Forgot Password (email-based) ──────────────────────────────────────────
router.get('/admin/forgot-password', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public/admin/forgot-password.html'));
});

router.post('/admin/forgot-password', authLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  try {
    const result = await pool.query('SELECT id, email FROM admin_users WHERE LOWER(email) = LOWER($1)', [email]);
    // Always return success to prevent email enumeration
    if (!result.rows.length) {
      logger.info({ email }, 'Forgot password attempt for non-existent email');
      return res.json({ success: true });
    }
    const admin = result.rows[0];
    // Generate a secure reset token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    // Store token in DB
    await pool.query(
      `UPDATE admin_users SET reset_token = $1, reset_token_expires = $2 WHERE id = $3`,
      [token, expiresAt, admin.id]
    );
    // Send reset email
    const siteUrl = process.env.SITE_URL || `${req.protocol}://${req.get('host')}`;
    const resetUrl = `${siteUrl}/admin/forgot-password?token=${token}`;
    try {
      const { sendEmail } = require('../lib/email');
      await sendEmail({
        to: admin.email,
        subject: 'Password Reset — Scarlet Technical',
        html: `
          <div style="font-family:sans-serif;max-width:500px;margin:0 auto">
            <h2 style="color:#C41E3A">Password Reset Request</h2>
            <p>You requested a password reset for your Scarlet Technical admin account.</p>
            <p><a href="${resetUrl}" style="display:inline-block;padding:12px 24px;background:#C41E3A;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">Reset Password</a></p>
            <p style="color:#6B7280;font-size:13px">This link expires in 1 hour. If you didn't request this, ignore this email.</p>
            <p style="color:#6B7280;font-size:12px">Or copy this link: ${resetUrl}</p>
          </div>
        `
      });
      logger.info({ email: admin.email }, 'Password reset email sent');
    } catch (emailErr) {
      logger.error({ err: emailErr }, 'Failed to send reset email');
      // Still return success — log the URL for debugging
      logger.info({ resetUrl }, 'Reset URL (email failed)');
    }
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, 'Forgot password error');
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/admin/reset-password', authLimiter, async (req, res) => {
  const { token, new_password } = req.body;
  if (!token || !new_password) return res.status(400).json({ error: 'Token and new_password required' });
  if (new_password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  try {
    const result = await pool.query(
      `SELECT id, email FROM admin_users WHERE reset_token = $1 AND reset_token_expires > NOW()`,
      [token]
    );
    if (!result.rows.length) return res.status(400).json({ error: 'Invalid or expired reset token' });
    const admin = result.rows[0];
    const hash = await bcrypt.hash(new_password, 12);
    await pool.query(
      `UPDATE admin_users SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL, last_password_change = NOW() WHERE id = $2`,
      [hash, admin.id]
    );
    logger.info({ email: admin.email }, 'Password reset via email token');
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, 'Reset password error');
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Admin Password Recovery (setup-key based, legacy) ──────────────────────
router.post('/admin/recover-password', authLimiter, async (req, res) => {
  const { email, new_password, setup_key } = req.body;
  const expectedKey = process.env.ADMIN_SETUP_KEY;
  if (!expectedKey) return res.status(503).json({ error: 'Recovery not configured. Set ADMIN_SETUP_KEY environment variable.' });
  if (setup_key !== expectedKey) return res.status(403).json({ error: 'Invalid setup key' });
  if (!email || !new_password) return res.status(400).json({ error: 'Email and new_password required' });
  if (new_password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  try {
    const existing = await pool.query('SELECT id FROM admin_users WHERE LOWER(email) = LOWER($1)', [email]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Admin user not found' });
    const hash = await bcrypt.hash(new_password, 12);
    await pool.query('UPDATE admin_users SET password_hash=$1 WHERE id=$2', [hash, existing.rows[0].id]);
    logger.info({ email }, 'Admin password recovered');
    res.json({ success: true, message: 'Password reset successfully' });
  } catch (err) {
    logger.error({ err }, 'Password recovery error');
    res.status(500).json({ error: 'Password recovery failed' });
  }
});

// ─── Admin: Current User Info ────────────────────────────────────────────────
router.get('/admin/api/me', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT id, email, name, display_name, role, is_active FROM admin_users WHERE id=$1',
      [req.session.adminId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ ...r.rows[0], sessionName: req.session.adminName });
  } catch {
    res.json({ name: req.session.adminName, role: req.session.adminRole || 'admin' });
  }
});

// ─── Admin: Change Own Password ─────────────────────────────────────────────
router.post('/admin/api/me/change-password', requireAdmin, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) return res.status(400).json({ error: 'current_password and new_password required' });
  if (new_password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  try {
    const r = await pool.query('SELECT * FROM admin_users WHERE id=$1', [req.session.adminId]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    const match = await bcrypt.compare(current_password, r.rows[0].password_hash);
    if (!match) return res.status(401).json({ error: 'Current password incorrect' });
    const hash = await bcrypt.hash(new_password, 12);
    await pool.query('UPDATE admin_users SET password_hash=$1, updated_at=NOW() WHERE id=$2', [hash, req.session.adminId]);
    await auditLog(req, 'change_own_password', 'admin_user', req.session.adminId, {});
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Admin: Update Own Profile ──────────────────────────────────────────────
router.put('/admin/api/me/profile', requireAdmin, async (req, res) => {
  const { display_name, title, bio, phone, avatar_color } = req.body;
  try {
    const r = await pool.query(
      `UPDATE admin_users SET display_name=COALESCE($1,display_name), title=COALESCE($2,title),
       bio=COALESCE($3,bio), phone=COALESCE($4,phone), avatar_color=COALESCE($5,avatar_color),
       updated_at=NOW() WHERE id=$6
       RETURNING id, email, name, display_name, title, bio, phone, avatar_color, role`,
      [display_name || null, title || null, bio || null, phone || null, avatar_color || null, req.session.adminId]
    );
    if (r.rows[0]?.display_name) req.session.adminName = r.rows[0].display_name;
    await auditLog(req, 'update_own_profile', 'admin_user', req.session.adminId, { display_name, title });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
