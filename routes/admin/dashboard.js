/**
 * Admin dashboard stats + analytics + EOD reports.
 */
const { Router } = require('express');
const { pool } = require('../../lib/db');
const { requireAdmin } = require('../../middleware/auth');
const { auditLog } = require('../../lib/audit');
const logger = require('../../lib/logger');

const router = Router();

// ─── Dashboard Stats ─────────────────────────────────────────────────────────
router.get('/admin/api/dashboard', requireAdmin, async (req, res) => {
  try {
    const [customers, activePlans, overdue, thisMonth, outstanding, requests] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM customers WHERE status IS NULL OR status NOT IN (\'deleted\')'),
      pool.query("SELECT COUNT(*) FROM payment_plans WHERE status='active'"),
      pool.query(`SELECT COUNT(*) FROM installments i
        JOIN payment_plans p ON p.id=i.payment_plan_id
        WHERE i.status='pending' AND i.due_date < CURRENT_DATE AND p.status='active'`),
      pool.query(`SELECT COALESCE(SUM(paid_amount),0) as total FROM installments
        WHERE status='paid' AND DATE_TRUNC('month',paid_at)=DATE_TRUNC('month',NOW())`),
      pool.query(`SELECT COALESCE(SUM(i.amount),0) as total FROM installments i
        JOIN payment_plans p ON p.id=i.payment_plan_id
        WHERE i.status='pending' AND p.status='active'`),
      pool.query("SELECT COUNT(*) FROM repair_requests WHERE status='new'"),
    ]);
    res.json({
      total_customers: parseInt(customers.rows[0].count),
      active_plans: parseInt(activePlans.rows[0].count),
      overdue_installments: parseInt(overdue.rows[0].count),
      collected_this_month: parseFloat(thisMonth.rows[0].total),
      total_outstanding: parseFloat(outstanding.rows[0].total),
      new_repair_requests: parseInt(requests.rows[0].count),
    });
  } catch (err) {
    logger.error({ err }, 'Dashboard stats error');
    res.status(500).json({ error: err.message });
  }
});

// ─── Analytics ───────────────────────────────────────────────────────────────
router.get('/admin/api/analytics', requireAdmin, async (req, res) => {
  try {
    const [monthly, overdue, planBreakdown, escalations] = await Promise.all([
      pool.query(`SELECT DATE_TRUNC('month', paid_at) as month, COALESCE(SUM(paid_amount),0) as collected
        FROM installments WHERE status='paid' AND paid_at > NOW() - INTERVAL '6 months'
        GROUP BY 1 ORDER BY 1`),
      pool.query(`SELECT COALESCE(SUM(i.amount),0) as overdue_amount, COUNT(*) as overdue_count
        FROM installments i JOIN payment_plans p ON p.id=i.payment_plan_id
        WHERE i.status='pending' AND i.due_date < CURRENT_DATE AND p.status='active'`),
      pool.query(`SELECT status, COUNT(*) as count, COALESCE(SUM(total_amount),0) as total
        FROM payment_plans GROUP BY status`),
      pool.query(`SELECT escalation_status, COUNT(*) as count FROM payment_plans
        WHERE status='active' GROUP BY escalation_status`),
    ]);
    res.json({
      monthly_collections: monthly.rows,
      overdue: overdue.rows[0],
      plan_breakdown: planBreakdown.rows,
      escalations: escalations.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Time Tracking Analytics ─────────────────────────────────────────────────
router.get('/admin/api/analytics/time', requireAdmin, async (req, res) => {
  try {
    const [byTech, byRepairType] = await Promise.all([
      pool.query(`SELECT a.display_name as technician, a.id as user_id,
        COUNT(DISTINCT te.repair_id) as repairs_worked,
        SUM(te.duration_minutes) as total_minutes,
        ROUND(AVG(te.duration_minutes)) as avg_minutes_per_session
        FROM time_entries te JOIN admin_users a ON a.id=te.user_id
        WHERE te.ended_at IS NOT NULL
        GROUP BY a.id, a.display_name ORDER BY total_minutes DESC NULLS LAST`),
      pool.query(`SELECT r.device_type, COUNT(DISTINCT r.id) as repair_count,
        SUM(te.duration_minutes) as total_minutes,
        ROUND(AVG(te.duration_minutes)) as avg_minutes
        FROM time_entries te JOIN repairs r ON r.id=te.repair_id
        WHERE te.ended_at IS NOT NULL AND r.device_type IS NOT NULL
        GROUP BY r.device_type ORDER BY total_minutes DESC NULLS LAST`),
    ]);
    res.json({ by_technician: byTech.rows, by_repair_type: byRepairType.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Maintenance Stats Widget ────────────────────────────────────────────────
router.get('/admin/api/maintenance-stats', requireAdmin, async (req, res) => {
  try {
    const stats = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status='active') as active_contracts,
        COUNT(*) FILTER (WHERE status='paused') as paused_contracts,
        SUM(price) FILTER (WHERE status='active') as monthly_recurring,
        COUNT(*) FILTER (WHERE status='active' AND next_invoice_date <= CURRENT_DATE + INTERVAL '7 days') as due_soon
      FROM maintenance_contracts`);
    res.json(stats.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── End-of-Day Reconciliation ───────────────────────────────────────────────
router.get('/admin/api/eod-report', requireAdmin, async (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  try {
    const existing = await pool.query('SELECT * FROM eod_reports WHERE report_date=$1', [date]);
    if (existing.rows.length) return res.json({ report: existing.rows[0], generated: false });

    const [repairs, payments, customers, newRepairs, outstanding] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM repairs WHERE status='complete' AND DATE(updated_at)=$1`, [date]),
      pool.query(`SELECT payment_method, COUNT(*) as count, COALESCE(SUM(paid_amount),0) as total
        FROM installments WHERE status='paid' AND DATE(paid_at)=$1 GROUP BY payment_method`, [date]),
      pool.query(`SELECT COUNT(*) FROM customers WHERE DATE(created_at)=$1`, [date]),
      pool.query(`SELECT COUNT(*) FROM repairs WHERE DATE(created_at)=$1`, [date]),
      pool.query(`SELECT COALESCE(SUM(i.amount),0) as total FROM installments i
        JOIN payment_plans pp ON pp.id=i.payment_plan_id
        WHERE i.status='pending' AND pp.status='active'`),
    ]);

    let revenue_card = 0, revenue_cash = 0, revenue_other = 0, payments_recorded = 0;
    for (const row of payments.rows) {
      const amt = parseFloat(row.total);
      const cnt = parseInt(row.count);
      payments_recorded += cnt;
      if (row.payment_method === 'card' || row.payment_method === 'stripe') revenue_card += amt;
      else if (row.payment_method === 'cash') revenue_cash += amt;
      else revenue_other += amt;
    }

    res.json({
      report: {
        report_date: date,
        repairs_completed: parseInt(repairs.rows[0].count),
        revenue_card, revenue_cash, revenue_other,
        outstanding_balance: parseFloat(outstanding.rows[0].total),
        new_customers: parseInt(customers.rows[0].count),
        new_repairs: parseInt(newRepairs.rows[0].count),
        payments_recorded,
      },
      generated: true,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin/api/eod-report/save', requireAdmin, async (req, res) => {
  const { report_date, notes, ...rest } = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO eod_reports (report_date, repairs_completed, revenue_card, revenue_cash, revenue_other,
        outstanding_balance, new_customers, new_repairs, payments_recorded, notes, generated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (report_date) DO UPDATE SET notes=EXCLUDED.notes RETURNING *`,
      [report_date, rest.repairs_completed || 0, rest.revenue_card || 0, rest.revenue_cash || 0,
       rest.revenue_other || 0, rest.outstanding_balance || 0, rest.new_customers || 0,
       rest.new_repairs || 0, rest.payments_recorded || 0, notes || null, req.session.adminId]
    );
    await auditLog(req, 'save_eod_report', 'eod_report', null, { date: report_date });
    res.json({ success: true, report: r.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Audit Log ───────────────────────────────────────────────────────────────
router.get('/admin/api/audit-log', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT al.*, au.email as admin_email FROM admin_audit_log al
       LEFT JOIN admin_users au ON au.id=al.admin_id
       ORDER BY al.created_at DESC LIMIT 200`
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
