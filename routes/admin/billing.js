const express = require('express');
const router = express.Router();
const { pool } = require('../../lib/db');
const { requireAuth } = require('../../middleware/auth');

router.use(requireAuth);

// ── Partial Payments ──────────────────────────────────────────────────────
router.get('/api/admin/partial-payments', async (req, res) => {
  try {
    const { invoice_id, plan_id } = req.query;
    let q = `SELECT pp.*, c.name as customer_name FROM partial_payments pp
             LEFT JOIN invoices i ON pp.invoice_id = i.id
             LEFT JOIN payment_plans p ON pp.plan_id = p.id
             LEFT JOIN customers c ON COALESCE(i.customer_id, p.customer_id) = c.id
             WHERE 1=1`;
    const params = [];
    if (invoice_id) { params.push(invoice_id); q += ` AND pp.invoice_id = $${params.length}`; }
    if (plan_id) { params.push(plan_id); q += ` AND pp.plan_id = $${params.length}`; }
    q += ' ORDER BY pp.created_at DESC';
    const { rows } = await pool.query(q, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/admin/partial-payments', async (req, res) => {
  try {
    const { invoice_id, plan_id, amount, method, reference, notes } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO partial_payments (invoice_id, plan_id, amount, method, reference, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [invoice_id || null, plan_id || null, amount, method || 'cash', reference, notes, req.session.user.id]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Refunds ───────────────────────────────────────────────────────────────
router.get('/api/admin/refunds', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.*, c.name as customer_name FROM refunds r
       JOIN customers c ON r.customer_id = c.id ORDER BY r.created_at DESC`
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/admin/refunds', async (req, res) => {
  try {
    const { invoice_id, plan_id, customer_id, amount, reason, method } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO refunds (invoice_id, plan_id, customer_id, amount, reason, method, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [invoice_id||null, plan_id||null, customer_id, amount, reason, method||'original', req.session.user.id]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/api/admin/refunds/:id/process', async (req, res) => {
  try {
    const { status } = req.body;
    const { rows } = await pool.query(
      `UPDATE refunds SET status=$1, approved_by=$2, processed_at=CASE WHEN $1='processed' THEN NOW() ELSE processed_at END
       WHERE id=$3 RETURNING *`,
      [status, req.session.user.id, req.params.id]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Recurring Invoices ────────────────────────────────────────────────────
router.get('/api/admin/recurring-invoices', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ri.*, c.name as customer_name FROM recurring_invoices ri
       JOIN customers c ON ri.customer_id = c.id ORDER BY ri.next_due ASC`
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/admin/recurring-invoices', async (req, res) => {
  try {
    const { customer_id, description, amount, frequency, next_due } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO recurring_invoices (customer_id, description, amount, frequency, next_due)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [customer_id, description, amount, frequency || 'monthly', next_due]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/api/admin/recurring-invoices/:id', async (req, res) => {
  try {
    const { description, amount, frequency, next_due, active } = req.body;
    const { rows } = await pool.query(
      `UPDATE recurring_invoices SET description=$1, amount=$2, frequency=$3, next_due=$4, active=$5
       WHERE id=$6 RETURNING *`,
      [description, amount, frequency, next_due, active, req.params.id]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Late Fees ─────────────────────────────────────────────────────────────
router.get('/api/admin/late-fees', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT lf.*, c.name as customer_name FROM late_fees lf
       LEFT JOIN customers c ON lf.customer_id = c.id ORDER BY lf.created_at DESC`
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Deposits ──────────────────────────────────────────────────────────────
router.get('/api/admin/deposits', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT d.*, c.name as customer_name FROM deposits d
       LEFT JOIN customers c ON d.customer_id = c.id ORDER BY d.created_at DESC`
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/admin/deposits', async (req, res) => {
  try {
    const { customer_id, repair_id, amount, method, notes } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO deposits (customer_id, repair_id, amount, method, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [customer_id, repair_id||null, amount, method||'cash', notes, req.session.user.id]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Financial Reports ─────────────────────────────────────────────────────
router.get('/api/admin/financial-report', async (req, res) => {
  try {
    const { period } = req.query; // daily, weekly, monthly
    let dateFilter = "created_at >= NOW() - INTERVAL '30 days'";
    if (period === 'daily') dateFilter = "created_at >= CURRENT_DATE";
    if (period === 'weekly') dateFilter = "created_at >= NOW() - INTERVAL '7 days'";
    if (period === 'yearly') dateFilter = "created_at >= NOW() - INTERVAL '365 days'";

    const [revenue, expenses, refunds] = await Promise.all([
      pool.query(`SELECT COALESCE(SUM(amount),0) as total FROM partial_payments WHERE ${dateFilter}`),
      pool.query(`SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE ${dateFilter}`),
      pool.query(`SELECT COALESCE(SUM(amount),0) as total FROM refunds WHERE status='processed' AND ${dateFilter}`)
    ]);

    res.json({
      revenue: parseFloat(revenue.rows[0].total),
      expenses: parseFloat(expenses.rows[0].total),
      refunds: parseFloat(refunds.rows[0].total),
      net: parseFloat(revenue.rows[0].total) - parseFloat(expenses.rows[0].total) - parseFloat(refunds.rows[0].total)
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
