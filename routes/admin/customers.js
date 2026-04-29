/**
 * Admin customer management routes.
 */
const { Router } = require('express');
const bcrypt = require('bcrypt');
const { pool } = require('../../lib/db');
const { requireAdmin } = require('../../middleware/auth');
const { auditLog } = require('../../lib/audit');
const { paginate } = require('../../lib/utils');

const router = Router();

// ─── List Customers (with pagination) ────────────────────────────────────────
router.get('/admin/api/customers', requireAdmin, async (req, res) => {
  const { filter, search, include_deleted } = req.query;
  const { limit, offset, page, perPage } = paginate(req.query);

  let query = `
    SELECT c.*,
      COUNT(DISTINCT r.id) AS repair_count,
      COUNT(DISTINCT pp.id) AS plan_count,
      COALESCE(SUM(CASE WHEN i.status='pending' AND i.due_date < CURRENT_DATE THEN 1 ELSE 0 END),0) AS overdue_count
    FROM customers c
    LEFT JOIN repairs r ON r.customer_id=c.id
    LEFT JOIN payment_plans pp ON pp.customer_id=c.id
    LEFT JOIN installments i ON i.payment_plan_id=pp.id
  `;
  const params = [];
  const conditions = [];

  if (include_deleted !== 'true') {
    conditions.push(`(c.status IS NULL OR c.status != 'deleted')`);
  }
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(c.name ILIKE $${params.length} OR c.email ILIKE $${params.length} OR c.phone ILIKE $${params.length})`);
  }
  if (filter === 'suspended') conditions.push(`c.status = 'suspended'`);

  if (conditions.length) query += ` WHERE ${conditions.join(' AND ')}`;
  query += ' GROUP BY c.id ORDER BY c.created_at DESC';

  if (filter === 'overdue') query = `SELECT * FROM (${query}) sub WHERE overdue_count > 0`;
  if (filter === 'new') query = `SELECT * FROM (${query}) sub WHERE plan_count = 0`;

  // Add pagination
  params.push(limit, offset);
  query += ` LIMIT $${params.length - 1} OFFSET $${params.length}`;

  try {
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Create Customer ─────────────────────────────────────────────────────────
router.post('/admin/api/customers', requireAdmin, async (req, res) => {
  const { name, email, phone, address, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  try {
    const r = await pool.query(
      `INSERT INTO customers (name, email, phone, address, notes, status)
       VALUES ($1,$2,$3,$4,$5,'active') RETURNING *`,
      [name, email || null, phone || null, address || null, notes || null]
    );
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Get Customer Detail ─────────────────────────────────────────────────────
router.get('/admin/api/customers/:id', requireAdmin, async (req, res) => {
  try {
    const [customer, repairs, plans, devices] = await Promise.all([
      pool.query('SELECT * FROM customers WHERE id=$1', [req.params.id]),
      pool.query('SELECT * FROM repairs WHERE customer_id=$1 ORDER BY created_at DESC', [req.params.id]),
      pool.query(`SELECT pp.*,
        r.device_brand, r.device_model, r.device_type,
        COUNT(CASE WHEN i.status='paid' THEN 1 END) AS paid_count,
        COUNT(CASE WHEN i.status='pending' AND i.due_date < CURRENT_DATE THEN 1 END) AS overdue_count,
        COALESCE(SUM(CASE WHEN i.status='paid' THEN i.paid_amount ELSE 0 END),0) AS amount_paid
        FROM payment_plans pp
        LEFT JOIN repairs r ON r.id=pp.repair_id
        LEFT JOIN installments i ON i.payment_plan_id=pp.id
        WHERE pp.customer_id=$1 GROUP BY pp.id, r.device_brand, r.device_model, r.device_type
        ORDER BY pp.created_at DESC`, [req.params.id]),
      pool.query(
        `SELECT id, hostname, platform, lock_status, online_status, last_seen_at, notes, enrolled_at
         FROM enrolled_devices WHERE customer_id=$1 AND unenrolled_at IS NULL ORDER BY enrolled_at DESC`,
        [req.params.id]
      ).catch(() => ({ rows: [] })),
    ]);
    if (!customer.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ ...customer.rows[0], repairs: repairs.rows, payment_plans: plans.rows, devices: devices.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Update Customer ─────────────────────────────────────────────────────────
router.put('/admin/api/customers/:id', requireAdmin, async (req, res) => {
  const { name, email, phone, address, notes } = req.body;
  try {
    // Allow explicit null clearing for optional fields
    const r = await pool.query(
      `UPDATE customers SET name=COALESCE($1,name), email=$2, phone=$3, address=$4, notes=$5, updated_at=NOW()
       WHERE id=$6 RETURNING *`,
      [name || null, email ?? null, phone ?? null, address ?? null, notes ?? null, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Suspend / Unsuspend ─────────────────────────────────────────────────────
router.post('/admin/api/customers/:id/suspend', requireAdmin, async (req, res) => {
  const { reason } = req.body;
  try {
    const r = await pool.query(
      `UPDATE customers SET status='suspended', suspended_at=NOW(), suspended_reason=$1, updated_at=NOW()
       WHERE id=$2 AND (status='active' OR status IS NULL) RETURNING id, name, status`,
      [reason || 'Suspended by admin', req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Customer not found or already suspended' });
    await auditLog(req, 'suspend_customer', 'customer', req.params.id, { reason });
    res.json({ success: true, customer: r.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin/api/customers/:id/unsuspend', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE customers SET status='active', suspended_at=NULL, suspended_reason=NULL, updated_at=NOW()
       WHERE id=$1 AND status='suspended' RETURNING id, name, status`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Customer not found or not suspended' });
    await auditLog(req, 'unsuspend_customer', 'customer', req.params.id, {});
    res.json({ success: true, customer: r.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Delete Customer (soft) ──────────────────────────────────────────────────
router.delete('/admin/api/customers/:id', requireAdmin, async (req, res) => {
  const me = await pool.query('SELECT role FROM admin_users WHERE id=$1', [req.session.adminId]);
  if (me.rows[0]?.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  try {
    const r = await pool.query(
      `UPDATE customers SET status='deleted', deleted_at=NOW(), updated_at=NOW() WHERE id=$1 RETURNING id, name`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Customer not found' });
    await auditLog(req, 'delete_customer', 'customer', req.params.id, { name: r.rows[0].name });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Bulk Actions ────────────────────────────────────────────────────────────
router.post('/admin/api/customers/bulk', requireAdmin, async (req, res) => {
  const { action, customer_ids } = req.body;
  if (!action || !customer_ids?.length) return res.status(400).json({ error: 'action and customer_ids required' });
  if (!['suspend', 'unsuspend', 'delete'].includes(action)) return res.status(400).json({ error: 'Invalid action' });
  const me = await pool.query('SELECT role FROM admin_users WHERE id=$1', [req.session.adminId]);
  if (me.rows[0]?.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  try {
    let result;
    if (action === 'suspend') {
      result = await pool.query(
        `UPDATE customers SET status='suspended', suspended_at=NOW(), suspended_reason='Bulk suspended by admin', updated_at=NOW()
         WHERE id = ANY($1) AND (status='active' OR status IS NULL) RETURNING id`, [customer_ids]);
    } else if (action === 'unsuspend') {
      result = await pool.query(
        `UPDATE customers SET status='active', suspended_at=NULL, suspended_reason=NULL, updated_at=NOW()
         WHERE id = ANY($1) AND status='suspended' RETURNING id`, [customer_ids]);
    } else if (action === 'delete') {
      result = await pool.query(
        `UPDATE customers SET status='deleted', deleted_at=NOW(), updated_at=NOW()
         WHERE id = ANY($1) AND status != 'deleted' RETURNING id`, [customer_ids]);
    }
    await auditLog(req, `bulk_${action}_customers`, 'customer', null, { customer_ids, affected: result.rows.length });
    res.json({ success: true, affected: result.rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Set Customer Portal Password ────────────────────────────────────────────
router.post('/admin/api/customers/:id/set-portal-password', requireAdmin, async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  try {
    const hash = await bcrypt.hash(password, 12);
    await pool.query('UPDATE customers SET portal_password_hash=$1, updated_at=NOW() WHERE id=$2', [hash, req.params.id]);
    await auditLog(req, 'set_portal_password', 'customer', req.params.id, { note: 'password set by admin' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Impersonate Customer ────────────────────────────────────────────────────
router.post('/admin/api/impersonate/:id', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query('SELECT id, name, email, status FROM customers WHERE id=$1 AND deleted_at IS NULL', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Customer not found' });
    const cust = r.rows[0];
    if (cust.status === 'suspended') return res.status(403).json({ error: 'Cannot impersonate suspended customer' });
    await auditLog(req, 'impersonate_customer', 'customer', cust.id, { customer_name: cust.name });
    req.session.impersonating = true;
    req.session.impersonating_admin_id = req.session.adminId;
    req.session.impersonating_admin_name = req.session.adminName;
    req.session.customerId = cust.id;
    req.session.customerName = cust.name;
    res.json({ success: true, redirect: '/portal' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin/api/stop-impersonate', async (req, res) => {
  if (!req.session.impersonating) return res.status(400).json({ error: 'Not impersonating' });
  const adminId = req.session.impersonating_admin_id;
  const adminName = req.session.impersonating_admin_name;
  req.session.customerId = undefined;
  req.session.customerName = undefined;
  req.session.impersonating = false;
  req.session.impersonating_admin_id = undefined;
  req.session.impersonating_admin_name = undefined;
  req.session.adminId = adminId;
  req.session.adminName = adminName;
  res.json({ success: true, redirect: '/admin' });
});

module.exports = router;
