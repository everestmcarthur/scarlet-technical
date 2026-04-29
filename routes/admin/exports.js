/**
 * CSV export routes for admin.
 */
const { Router } = require('express');
const { pool } = require('../../lib/db');
const { requireAdmin } = require('../../middleware/auth');
const { csvEsc } = require('../../lib/utils');

const router = Router();

// ─── Export Customers ────────────────────────────────────────────────────────
router.get('/admin/api/export/customers', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(`SELECT c.*, COUNT(r.id) as repair_count
      FROM customers c LEFT JOIN repairs r ON r.customer_id=c.id
      WHERE c.deleted_at IS NULL GROUP BY c.id ORDER BY c.name`);
    const header = 'Name,Email,Phone,Address,Status,Repairs,Created';
    const rows = r.rows.map(c =>
      [csvEsc(c.name), csvEsc(c.email), csvEsc(c.phone), csvEsc(c.address),
       csvEsc(c.status || 'active'), c.repair_count, new Date(c.created_at).toLocaleDateString()].join(',')
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="customers.csv"');
    res.send([header, ...rows].join('\n'));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Export Payments ─────────────────────────────────────────────────────────
router.get('/admin/api/export/payments', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(`SELECT i.*, pp.total_amount as plan_total, c.name as customer_name, c.email as customer_email
      FROM installments i JOIN payment_plans pp ON pp.id=i.payment_plan_id
      JOIN customers c ON c.id=pp.customer_id WHERE i.status='paid' ORDER BY i.paid_at DESC`);
    const header = 'Customer,Email,Amount,Method,Paid Date,Plan Total';
    const rows = r.rows.map(p =>
      [csvEsc(p.customer_name), csvEsc(p.customer_email), p.paid_amount,
       csvEsc(p.payment_method), p.paid_at ? new Date(p.paid_at).toLocaleDateString() : '',
       p.plan_total].join(',')
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="payments.csv"');
    res.send([header, ...rows].join('\n'));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Export Repairs ──────────────────────────────────────────────────────────
router.get('/admin/api/export/repairs', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(`SELECT r.*, c.name as customer_name, c.email as customer_email
      FROM repairs r JOIN customers c ON c.id=r.customer_id ORDER BY r.created_at DESC`);
    const header = 'Customer,Email,Device,Brand,Model,Serial,Status,Issue,Total,Created';
    const rows = r.rows.map(rep =>
      [csvEsc(rep.customer_name), csvEsc(rep.customer_email), csvEsc(rep.device_type),
       csvEsc(rep.device_brand), csvEsc(rep.device_model), csvEsc(rep.serial_number),
       csvEsc(rep.status), csvEsc(rep.issue_description), rep.total_amount || '',
       new Date(rep.created_at).toLocaleDateString()].join(',')
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="repairs.csv"');
    res.send([header, ...rows].join('\n'));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Export Devices ──────────────────────────────────────────────────────────
router.get('/admin/api/export/devices', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(`SELECT d.*, c.name as customer_name
      FROM enrolled_devices d LEFT JOIN customers c ON c.id=d.customer_id
      WHERE d.unenrolled_at IS NULL ORDER BY d.enrolled_at DESC`);
    const header = 'Customer,Hostname,Platform,Lock Status,Online,Last Seen,Enrolled';
    const rows = r.rows.map(d =>
      [csvEsc(d.customer_name), csvEsc(d.hostname), csvEsc(d.platform),
       csvEsc(d.lock_status), csvEsc(d.online_status),
       d.last_seen_at ? new Date(d.last_seen_at).toLocaleString() : '',
       new Date(d.enrolled_at).toLocaleDateString()].join(',')
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="devices.csv"');
    res.send([header, ...rows].join('\n'));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Export Appointments ─────────────────────────────────────────────────────
router.get('/admin/api/export/appointments', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(`SELECT a.*, c.name as customer_name
      FROM appointments a LEFT JOIN customers c ON c.id=a.customer_id ORDER BY a.appointment_date DESC`);
    const header = 'Customer,Date,Time,Duration,Type,Status,Notes';
    const rows = r.rows.map(a =>
      [csvEsc(a.customer_name), a.appointment_date ? new Date(a.appointment_date).toLocaleDateString() : '',
       csvEsc(a.appointment_time), a.duration_minutes, csvEsc(a.service_type),
       csvEsc(a.status), csvEsc(a.notes)].join(',')
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="appointments.csv"');
    res.send([header, ...rows].join('\n'));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
