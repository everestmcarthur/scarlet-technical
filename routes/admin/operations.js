/**
 * Business Operations Routes
 * Handles: Customer Tags, Credits, Referrals, Coupons, Late Fees, Deposits,
 *          Expenses, Time Clock, Suppliers, Purchase Orders, Walk-in Queue,
 *          Commission, KPI Targets, Legal Templates
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../../lib/db');
const logger = require('../../lib/logger');

function requireAdmin(req, res, next) {
  if (!req.session?.adminId) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ─── Customer Tags ──────────────────────────────────────────────────────────
router.get('/admin/api/tags', requireAdmin, async (req, res) => {
  try {
    const tags = await pool.query(`
      SELECT ct.*, COUNT(cta.customer_id) as customer_count
      FROM customer_tags ct
      LEFT JOIN customer_tag_assignments cta ON ct.id = cta.tag_id
      GROUP BY ct.id ORDER BY ct.name
    `);
    res.json(tags.rows);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/admin/api/tags', requireAdmin, async (req, res) => {
  const { name, color, description } = req.body;
  try {
    const r = await pool.query(
      'INSERT INTO customer_tags (name, color, description) VALUES ($1, $2, $3) RETURNING *',
      [name, color || '#6B7280', description]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Failed to create tag' }); }
});

router.post('/admin/api/customers/:id/tags', requireAdmin, async (req, res) => {
  const { tagId } = req.body;
  try {
    await pool.query(
      'INSERT INTO customer_tag_assignments (customer_id, tag_id, assigned_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [req.params.id, tagId, req.session.adminId]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.delete('/admin/api/customers/:id/tags/:tagId', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM customer_tag_assignments WHERE customer_id = $1 AND tag_id = $2', [req.params.id, req.params.tagId]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// Get tags for a customer
router.get('/admin/api/customers/:id/tags', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT ct.* FROM customer_tags ct
      JOIN customer_tag_assignments cta ON ct.id = cta.tag_id
      WHERE cta.customer_id = $1
    `, [req.params.id]);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ─── Customer Credits ───────────────────────────────────────────────────────
router.get('/admin/api/customers/:id/credits', requireAdmin, async (req, res) => {
  try {
    const credits = await pool.query(
      'SELECT * FROM customer_credits WHERE customer_id = $1 ORDER BY created_at DESC',
      [req.params.id]
    );
    const balance = await pool.query(
      'SELECT COALESCE(SUM(amount), 0) as balance FROM customer_credits WHERE customer_id = $1',
      [req.params.id]
    );
    res.json({ credits: credits.rows, balance: parseFloat(balance.rows[0].balance) });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/admin/api/customers/:id/credits', requireAdmin, async (req, res) => {
  const { amount, reason, source } = req.body;
  try {
    await pool.query(
      'INSERT INTO customer_credits (customer_id, amount, reason, source, created_by) VALUES ($1, $2, $3, $4, $5)',
      [req.params.id, amount, reason, source || 'manual', req.session.adminId]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ─── Referrals ──────────────────────────────────────────────────────────────
router.get('/admin/api/referrals', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT r.*, c1.first_name as referrer_first, c1.last_name as referrer_last,
             c2.first_name as referred_first, c2.last_name as referred_last
      FROM referrals r
      LEFT JOIN customers c1 ON r.referrer_id = c1.id
      LEFT JOIN customers c2 ON r.referred_id = c2.id
      ORDER BY r.created_at DESC
    `);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/admin/api/referrals', requireAdmin, async (req, res) => {
  const { referrer_id, referred_name, referred_phone, referred_email, referrer_reward, referred_reward } = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO referrals (referrer_id, referred_name, referred_phone, referred_email, referrer_reward, referred_reward)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [referrer_id, referred_name, referred_phone, referred_email, referrer_reward || 10, referred_reward || 10]
    );
    res.json({ id: r.rows[0].id });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ─── Coupons ────────────────────────────────────────────────────────────────
router.get('/admin/api/coupons', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM coupons ORDER BY created_at DESC');
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/admin/api/coupons', requireAdmin, async (req, res) => {
  const { code, description, discount_type, discount_value, min_purchase, max_uses, expires_at } = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO coupons (code, description, discount_type, discount_value, min_purchase, max_uses, expires_at, created_by)
       VALUES (UPPER($1), $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [code, description, discount_type, discount_value, min_purchase || 0, max_uses, expires_at, req.session.adminId]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Failed to create coupon' }); }
});

router.put('/admin/api/coupons/:id', requireAdmin, async (req, res) => {
  const { is_active } = req.body;
  try {
    await pool.query('UPDATE coupons SET is_active = $1 WHERE id = $2', [is_active, req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// Validate coupon (public endpoint for portal/checkout)
router.post('/api/coupons/validate', async (req, res) => {
  const { code, amount } = req.body;
  try {
    const r = await pool.query(
      `SELECT * FROM coupons WHERE code = UPPER($1) AND is_active = true AND (expires_at IS NULL OR expires_at > NOW()) AND (max_uses IS NULL OR uses_count < max_uses)`,
      [code]
    );
    if (r.rows.length === 0) return res.json({ valid: false, error: 'Invalid or expired code' });
    const coupon = r.rows[0];
    if (amount && parseFloat(amount) < parseFloat(coupon.min_purchase)) {
      return res.json({ valid: false, error: `Minimum purchase: $${coupon.min_purchase}` });
    }
    const discount = coupon.discount_type === 'percent'
      ? (parseFloat(amount || 0) * parseFloat(coupon.discount_value) / 100)
      : parseFloat(coupon.discount_value);
    res.json({ valid: true, coupon, discount: Math.min(discount, parseFloat(amount || 999999)) });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ─── Deposits ───────────────────────────────────────────────────────────────
router.get('/admin/api/deposits', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT d.*, c.first_name, c.last_name FROM deposits d
      LEFT JOIN customers c ON d.customer_id = c.id
      ORDER BY d.created_at DESC LIMIT 100
    `);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/admin/api/deposits', requireAdmin, async (req, res) => {
  const { customer_id, repair_id, amount, payment_method } = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO deposits (customer_id, repair_id, amount, payment_method) VALUES ($1, $2, $3, $4) RETURNING id`,
      [customer_id, repair_id, amount, payment_method || 'card']
    );
    res.json({ id: r.rows[0].id });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ─── Expenses ───────────────────────────────────────────────────────────────
router.get('/admin/api/expenses', requireAdmin, async (req, res) => {
  const { month, category } = req.query;
  try {
    let where = ['1=1'], params = [];
    let idx = 1;
    if (month) { where.push(`TO_CHAR(expense_date, 'YYYY-MM') = $${idx++}`); params.push(month); }
    if (category) { where.push(`category = $${idx++}`); params.push(category); }
    
    const r = await pool.query(`
      SELECT e.*, au.name as created_by_name FROM expenses e
      LEFT JOIN admin_users au ON e.created_by = au.id
      WHERE ${where.join(' AND ')} ORDER BY expense_date DESC
    `, params);
    
    const totals = await pool.query(`
      SELECT category, SUM(amount) as total FROM expenses WHERE ${where.join(' AND ')} GROUP BY category ORDER BY total DESC
    `, params);
    
    res.json({ expenses: r.rows, totals: totals.rows });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/admin/api/expenses', requireAdmin, async (req, res) => {
  const { category, description, amount, payment_method, vendor, expense_date } = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO expenses (category, description, amount, payment_method, vendor, expense_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [category, description, amount, payment_method, vendor, expense_date || new Date(), req.session.adminId]
    );
    res.json({ id: r.rows[0].id });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ─── Time Clock ─────────────────────────────────────────────────────────────
router.get('/admin/api/timeclock', requireAdmin, async (req, res) => {
  try {
    const entries = await pool.query(`
      SELECT te.*, au.name as admin_name FROM time_entries te
      JOIN admin_users au ON te.admin_id = au.id
      ORDER BY te.clock_in DESC LIMIT 100
    `);
    // Current active clock-in for this user
    const active = await pool.query(
      `SELECT * FROM time_entries WHERE admin_id = $1 AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1`,
      [req.session.adminId]
    );
    res.json({ entries: entries.rows, active: active.rows[0] || null });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/admin/api/timeclock/in', requireAdmin, async (req, res) => {
  try {
    // Check if already clocked in
    const existing = await pool.query(
      'SELECT id FROM time_entries WHERE admin_id = $1 AND clock_out IS NULL',
      [req.session.adminId]
    );
    if (existing.rows.length > 0) return res.status(400).json({ error: 'Already clocked in' });

    const r = await pool.query(
      'INSERT INTO time_entries (admin_id, clock_in) VALUES ($1, NOW()) RETURNING *',
      [req.session.adminId]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/admin/api/timeclock/out', requireAdmin, async (req, res) => {
  const { notes, break_minutes } = req.body;
  try {
    const r = await pool.query(`
      UPDATE time_entries SET clock_out = NOW(), notes = $1, break_minutes = COALESCE($2, 0),
        total_hours = ROUND(EXTRACT(EPOCH FROM (NOW() - clock_in)) / 3600.0 - COALESCE($2, 0) / 60.0, 2)
      WHERE admin_id = $3 AND clock_out IS NULL
      RETURNING *
    `, [notes, break_minutes || 0, req.session.adminId]);
    if (r.rows.length === 0) return res.status(400).json({ error: 'Not clocked in' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ─── Suppliers ──────────────────────────────────────────────────────────────
router.get('/admin/api/suppliers', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM suppliers WHERE is_active = true ORDER BY name');
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/admin/api/suppliers', requireAdmin, async (req, res) => {
  const { name, contact_name, email, phone, website, lead_time_days, notes } = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO suppliers (name, contact_name, email, phone, website, lead_time_days, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [name, contact_name, email, phone, website, lead_time_days, notes]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ─── Purchase Orders ────────────────────────────────────────────────────────
router.get('/admin/api/purchase-orders', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT po.*, s.name as supplier_name,
        (SELECT COUNT(*) FROM purchase_order_items WHERE po_id = po.id) as item_count
      FROM purchase_orders po
      LEFT JOIN suppliers s ON po.supplier_id = s.id
      ORDER BY po.created_at DESC
    `);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/admin/api/purchase-orders', requireAdmin, async (req, res) => {
  const { supplier_id, items, notes, expected_delivery } = req.body;
  try {
    const poNum = `PO-${Date.now().toString(36).toUpperCase()}`;
    const total = (items || []).reduce((s, i) => s + (i.quantity * i.unit_cost), 0);
    
    const r = await pool.query(
      `INSERT INTO purchase_orders (supplier_id, po_number, total_amount, notes, expected_delivery, ordered_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [supplier_id, poNum, total, notes, expected_delivery, req.session.adminId]
    );

    for (const item of (items || [])) {
      await pool.query(
        `INSERT INTO purchase_order_items (po_id, part_id, description, quantity, unit_cost)
         VALUES ($1, $2, $3, $4, $5)`,
        [r.rows[0].id, item.part_id || null, item.description, item.quantity, item.unit_cost]
      );
    }

    res.json({ id: r.rows[0].id, po_number: poNum });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ─── Walk-in Queue ──────────────────────────────────────────────────────────
router.get('/admin/api/queue', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT wq.*, c.first_name, c.last_name
      FROM walkin_queue wq
      LEFT JOIN customers c ON wq.customer_id = c.id
      WHERE wq.status IN ('waiting', 'serving') AND wq.checked_in_at > NOW() - INTERVAL '12 hours'
      ORDER BY wq.position ASC
    `);
    const avgWait = await pool.query(`
      SELECT AVG(EXTRACT(EPOCH FROM (called_at - checked_in_at))/60)::INTEGER as avg_minutes
      FROM walkin_queue WHERE called_at IS NOT NULL AND checked_in_at > NOW() - INTERVAL '7 days'
    `);
    res.json({ queue: r.rows, avgWait: avgWait.rows[0]?.avg_minutes || 15 });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/admin/api/queue', requireAdmin, async (req, res) => {
  const { customer_id, customer_name, phone, reason } = req.body;
  try {
    const maxPos = await pool.query(
      `SELECT COALESCE(MAX(position), 0) + 1 as next FROM walkin_queue WHERE status = 'waiting'`
    );
    const r = await pool.query(
      `INSERT INTO walkin_queue (customer_id, customer_name, phone, reason, position) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [customer_id, customer_name, phone, reason, maxPos.rows[0].next]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.put('/admin/api/queue/:id/call', requireAdmin, async (req, res) => {
  try {
    await pool.query(`UPDATE walkin_queue SET status = 'serving', called_at = NOW() WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.put('/admin/api/queue/:id/complete', requireAdmin, async (req, res) => {
  try {
    await pool.query(`UPDATE walkin_queue SET status = 'completed', completed_at = NOW() WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ─── Repair Templates ───────────────────────────────────────────────────────
router.get('/admin/api/repair-templates', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM repair_templates WHERE is_active = true ORDER BY name');
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/admin/api/repair-templates', requireAdmin, async (req, res) => {
  const { name, device_type, description, estimated_time_hours, estimated_cost, checklist, parts_needed } = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO repair_templates (name, device_type, description, estimated_time_hours, estimated_cost, checklist, parts_needed)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [name, device_type, description, estimated_time_hours, estimated_cost,
       JSON.stringify(checklist || []), JSON.stringify(parts_needed || [])]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ─── Email Templates ────────────────────────────────────────────────────────
router.get('/admin/api/email-templates', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query('SELECT id, name, subject, category, is_active, updated_at FROM email_templates ORDER BY name');
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.get('/admin/api/email-templates/:id', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM email_templates WHERE id = $1', [req.params.id]);
    res.json(r.rows[0] || null);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.put('/admin/api/email-templates/:id', requireAdmin, async (req, res) => {
  const { subject, html_body, is_active } = req.body;
  try {
    await pool.query(
      `UPDATE email_templates SET subject = COALESCE($1, subject), html_body = COALESCE($2, html_body), 
       is_active = COALESCE($3, is_active), updated_at = NOW() WHERE id = $4`,
      [subject, html_body, is_active, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ─── Legal Templates ────────────────────────────────────────────────────────
router.get('/admin/api/legal-templates', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM legal_templates WHERE is_active = true ORDER BY name');
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/admin/api/legal-templates', requireAdmin, async (req, res) => {
  const { name, type, content, variables } = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO legal_templates (name, type, content, variables) VALUES ($1, $2, $3, $4) RETURNING id`,
      [name, type, content, JSON.stringify(variables || [])]
    );
    res.json({ id: r.rows[0].id });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

module.exports = router;
