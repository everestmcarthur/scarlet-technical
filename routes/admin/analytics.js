const express = require('express');
const router = express.Router();
const { pool } = require('../../lib/db');

function requireAdmin(req, res, next) {
  if (!req.session?.adminId) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

router.use(requireAdmin);

// ── Executive Dashboard Stats ─────────────────────────────────────────────
router.get('/admin/api/analytics/executive', async (req, res) => {
  try {
    const [customers, repairs, revenue, tickets, appointments] = await Promise.all([
      pool.query(`SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '30 days') as new_30d,
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '7 days') as new_7d
        FROM customers`),
      pool.query(`SELECT
        COUNT(*) as total_active,
        COUNT(*) FILTER (WHERE status = 'completed' AND updated_at >= CURRENT_DATE) as completed_today,
        COUNT(*) FILTER (WHERE status = 'completed' AND updated_at >= CURRENT_DATE - INTERVAL '7 days') as completed_7d,
        AVG(EXTRACT(EPOCH FROM (updated_at - created_at))/3600) FILTER (WHERE status='completed' AND updated_at >= CURRENT_DATE - INTERVAL '30 days') as avg_completion_hours
        FROM repair_requests WHERE status NOT IN ('cancelled')`),
      pool.query(`SELECT
        COALESCE(SUM(amount),0) as today FROM partial_payments WHERE created_at >= CURRENT_DATE`),
      pool.query(`SELECT
        COUNT(*) FILTER (WHERE status = 'open') as open_tickets,
        COUNT(*) FILTER (WHERE status = 'open' AND created_at < NOW() - INTERVAL '24 hours') as overdue
        FROM support_tickets`),
      pool.query(`SELECT COUNT(*) as upcoming FROM appointments WHERE date >= CURRENT_DATE AND date <= CURRENT_DATE + INTERVAL '7 days'`)
    ]);
    
    res.json({
      customers: customers.rows[0],
      repairs: repairs.rows[0],
      revenue_today: parseFloat(revenue.rows[0].today),
      tickets: tickets.rows[0],
      appointments_7d: parseInt(appointments.rows[0].upcoming)
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Revenue Analytics ─────────────────────────────────────────────────────
router.get('/admin/api/analytics/revenue', async (req, res) => {
  try {
    const { period } = req.query;
    let interval = '30 days';
    let trunc = 'day';
    if (period === 'week') { interval = '7 days'; trunc = 'day'; }
    if (period === 'quarter') { interval = '90 days'; trunc = 'week'; }
    if (period === 'year') { interval = '365 days'; trunc = 'month'; }

    const { rows } = await pool.query(
      `SELECT DATE_TRUNC($1, created_at) as period,
       COALESCE(SUM(amount),0) as revenue,
       COUNT(*) as transactions
       FROM partial_payments
       WHERE created_at >= NOW() - $2::INTERVAL
       GROUP BY DATE_TRUNC($1, created_at)
       ORDER BY period`,
      [trunc, interval]
    );
    
    // Also get expenses for P&L
    const expenses = await pool.query(
      `SELECT DATE_TRUNC($1, created_at) as period,
       COALESCE(SUM(amount),0) as total
       FROM expenses WHERE created_at >= NOW() - $2::INTERVAL
       GROUP BY DATE_TRUNC($1, created_at)`,
      [trunc, interval]
    );
    
    const expenseMap = {};
    expenses.rows.forEach(e => { expenseMap[e.period] = parseFloat(e.total); });

    res.json(rows.map(r => ({
      period: r.period,
      revenue: parseFloat(r.revenue),
      expenses: expenseMap[r.period] || 0,
      profit: parseFloat(r.revenue) - (expenseMap[r.period] || 0),
      transactions: parseInt(r.transactions)
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Repair Analytics ──────────────────────────────────────────────────────
router.get('/admin/api/analytics/repairs', async (req, res) => {
  try {
    const [byStatus, byType, avgTime, byTech] = await Promise.all([
      pool.query(`SELECT status, COUNT(*) as count FROM repair_requests GROUP BY status`),
      pool.query(`SELECT device_type, COUNT(*) as count FROM repair_requests GROUP BY device_type ORDER BY count DESC LIMIT 10`),
      pool.query(`SELECT
        AVG(EXTRACT(EPOCH FROM (updated_at - created_at))/3600) as avg_hours,
        MIN(EXTRACT(EPOCH FROM (updated_at - created_at))/3600) as min_hours,
        MAX(EXTRACT(EPOCH FROM (updated_at - created_at))/3600) as max_hours
        FROM repair_requests WHERE status = 'completed'`),
      pool.query(`SELECT au.username, au.full_name,
        COUNT(rr.id) as total,
        COUNT(rr.id) FILTER (WHERE rr.status='completed') as completed,
        AVG(EXTRACT(EPOCH FROM (rr.updated_at - rr.created_at))/3600) FILTER (WHERE rr.status='completed') as avg_hours
        FROM admin_users au
        JOIN repair_requests rr ON rr.assigned_tech = au.id
        GROUP BY au.id, au.username, au.full_name ORDER BY total DESC`)
    ]);
    
    res.json({
      by_status: byStatus.rows,
      by_type: byType.rows,
      avg_completion: avgTime.rows[0],
      by_technician: byTech.rows
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Customer Analytics ────────────────────────────────────────────────────
router.get('/admin/api/analytics/customers', async (req, res) => {
  try {
    const [growth, topCustomers, retention] = await Promise.all([
      pool.query(
        `SELECT DATE_TRUNC('month', created_at) as month, COUNT(*) as new_customers
         FROM customers WHERE created_at >= NOW() - INTERVAL '12 months'
         GROUP BY DATE_TRUNC('month', created_at) ORDER BY month`
      ),
      pool.query(
        `SELECT c.id, c.name, c.email,
         COUNT(rr.id) as total_repairs,
         COALESCE(SUM(pp.amount),0) as total_spent
         FROM customers c
         LEFT JOIN repair_requests rr ON rr.customer_id = c.id
         LEFT JOIN partial_payments pp ON pp.plan_id IN (SELECT id FROM payment_plans WHERE customer_id = c.id)
         GROUP BY c.id, c.name, c.email ORDER BY total_spent DESC LIMIT 10`
      ),
      pool.query(
        `SELECT COUNT(DISTINCT c.id) FILTER (WHERE rr_count > 1) as returning,
         COUNT(DISTINCT c.id) as total
         FROM customers c
         LEFT JOIN LATERAL (SELECT COUNT(*) as rr_count FROM repair_requests WHERE customer_id = c.id) rr ON true`
      )
    ]);
    
    res.json({
      growth: growth.rows,
      top_customers: topCustomers.rows,
      retention: retention.rows[0]
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Inventory Analytics ───────────────────────────────────────────────────
router.get('/admin/api/analytics/inventory', async (req, res) => {
  try {
    const [lowStock, topSelling, valuation] = await Promise.all([
      pool.query(`SELECT * FROM inventory WHERE quantity <= COALESCE(reorder_point, 3) ORDER BY quantity ASC LIMIT 10`),
      pool.query(
        `SELECT i.name, i.sku, SUM(rp.quantity) as units_used
         FROM repair_parts rp JOIN inventory i ON rp.inventory_id = i.id
         WHERE rp.created_at >= NOW() - INTERVAL '30 days'
         GROUP BY i.id, i.name, i.sku ORDER BY units_used DESC LIMIT 10`
      ),
      pool.query(`SELECT COUNT(*) as total_items, SUM(quantity) as total_units,
                  SUM(quantity * COALESCE(unit_cost, 0)) as total_value FROM inventory`)
    ]);
    
    res.json({
      low_stock: lowStock.rows,
      top_selling: topSelling.rows,
      valuation: valuation.rows[0]
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Global Search ─────────────────────────────────────────────────────────
router.get('/admin/api/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) return res.json([]);
    const term = `%${q}%`;
    
    const [customers, repairs, tickets, invoices] = await Promise.all([
      pool.query(`SELECT id, name, email, phone, 'customer' as type FROM customers WHERE name ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1 LIMIT 5`, [term]),
      pool.query(`SELECT id, device_type, issue_description, status, 'repair' as type FROM repair_requests WHERE device_type ILIKE $1 OR issue_description ILIKE $1 OR id::text = $2 LIMIT 5`, [term, q]),
      pool.query(`SELECT id, subject, status, 'ticket' as type FROM support_tickets WHERE subject ILIKE $1 OR id::text = $2 LIMIT 5`, [term, q]),
      pool.query(`SELECT id, description, status, 'invoice' as type FROM invoices WHERE description ILIKE $1 OR id::text = $2 LIMIT 5`, [term, q])
    ]);
    
    res.json([...customers.rows, ...repairs.rows, ...tickets.rows, ...invoices.rows]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── NPS Surveys ───────────────────────────────────────────────────────────
router.get('/admin/api/nps', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ns.*, c.name as customer_name FROM nps_surveys ns
       JOIN customers c ON ns.customer_id = c.id ORDER BY ns.sent_at DESC`
    );
    const scores = rows.filter(r => r.score !== null);
    const promoters = scores.filter(r => r.score >= 9).length;
    const detractors = scores.filter(r => r.score <= 6).length;
    const nps = scores.length > 0 ? Math.round(((promoters - detractors) / scores.length) * 100) : 0;
    
    res.json({ surveys: rows, nps_score: nps, total_responses: scores.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/admin/api/nps/send', async (req, res) => {
  try {
    const { customer_id, repair_id } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO nps_surveys (customer_id, repair_id) VALUES ($1,$2) RETURNING *`,
      [customer_id, repair_id || null]
    );
    // TODO: send actual survey email/SMS
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
