/**
 * Admin user management — multi-admin, roles, team profiles.
 */
const { Router } = require('express');
const bcrypt = require('bcrypt');
const { pool } = require('../../lib/db');
const { requireAdmin } = require('../../middleware/auth');
const { auditLog } = require('../../lib/audit');

const router = Router();

// ─── List Admin Users ────────────────────────────────────────────────────────
router.get('/admin/api/users', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, email, name, display_name, role, is_active, title, bio, phone, avatar_color, created_at, updated_at
       FROM admin_users ORDER BY created_at`
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Create Admin User ──────────────────────────────────────────────────────
router.post('/admin/api/users', requireAdmin, async (req, res) => {
  const me = await pool.query('SELECT role FROM admin_users WHERE id=$1', [req.session.adminId]);
  if (me.rows[0]?.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  const { email, password, name, role, display_name } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const validRoles = ['admin', 'technician', 'receptionist', 'viewer'];
  if (role && !validRoles.includes(role)) return res.status(400).json({ error: `Invalid role. Valid: ${validRoles.join(', ')}` });
  try {
    const hash = await bcrypt.hash(password, 12);
    const r = await pool.query(
      `INSERT INTO admin_users (email, password_hash, name, display_name, role)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, email, name, display_name, role, is_active, created_at`,
      [email, hash, name || email, display_name || name || email, role || 'technician']
    );
    await auditLog(req, 'create_admin_user', 'admin_user', r.rows[0].id, { email, role: role || 'technician' });
    res.json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already exists' });
    res.status(500).json({ error: err.message });
  }
});

// ─── Update Admin User ──────────────────────────────────────────────────────
router.put('/admin/api/users/:id', requireAdmin, async (req, res) => {
  const me = await pool.query('SELECT role FROM admin_users WHERE id=$1', [req.session.adminId]);
  if (me.rows[0]?.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  const { name, display_name, role, is_active } = req.body;
  try {
    const r = await pool.query(
      `UPDATE admin_users SET name=COALESCE($1,name), display_name=COALESCE($2,display_name),
       role=COALESCE($3,role), is_active=COALESCE($4,is_active), updated_at=NOW()
       WHERE id=$5 RETURNING id, email, name, display_name, role, is_active`,
      [name || null, display_name || null, role || null, is_active != null ? is_active : null, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    await auditLog(req, 'update_admin_user', 'admin_user', req.params.id, { role, is_active });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Reset Admin User Password ───────────────────────────────────────────────
router.post('/admin/api/users/:id/reset-password', requireAdmin, async (req, res) => {
  const me = await pool.query('SELECT role FROM admin_users WHERE id=$1', [req.session.adminId]);
  if (me.rows[0]?.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  const { new_password } = req.body;
  if (!new_password || new_password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  try {
    const hash = await bcrypt.hash(new_password, 12);
    await pool.query('UPDATE admin_users SET password_hash=$1, updated_at=NOW() WHERE id=$2', [hash, req.params.id]);
    await auditLog(req, 'reset_user_password', 'admin_user', req.params.id, {});
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Deactivate Admin User (soft delete) ─────────────────────────────────────
router.delete('/admin/api/users/:id', requireAdmin, async (req, res) => {
  const me = await pool.query('SELECT role FROM admin_users WHERE id=$1', [req.session.adminId]);
  if (me.rows[0]?.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  if (parseInt(req.params.id) === req.session.adminId) return res.status(400).json({ error: 'Cannot deactivate your own account' });
  try {
    await pool.query('UPDATE admin_users SET is_active=false, updated_at=NOW() WHERE id=$1', [req.params.id]);
    await auditLog(req, 'deactivate_admin_user', 'admin_user', req.params.id, {});
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Team Profile (public-facing info for team page) ─────────────────────────
router.get('/admin/api/team', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, display_name, title, bio, avatar_color, role FROM admin_users WHERE is_active=true ORDER BY created_at`
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
