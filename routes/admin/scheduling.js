const express = require('express');
const router = express.Router();
const { pool } = require('../../lib/db');

function requireAdmin(req, res, next) {
  if (!req.session?.adminId) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

router.use(requireAdmin);

// ── Technician Availability ───────────────────────────────────────────────
router.get('/api/admin/tech-availability', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ta.*, au.username, au.full_name FROM tech_availability ta
       JOIN admin_users au ON ta.admin_user_id = au.id ORDER BY au.username, ta.day_of_week, ta.start_time`
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/admin/tech-availability', async (req, res) => {
  try {
    const { admin_user_id, day_of_week, start_time, end_time } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO tech_availability (admin_user_id, day_of_week, start_time, end_time)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [admin_user_id, day_of_week, start_time, end_time]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/api/admin/tech-availability/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM tech_availability WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Recurring Appointments ────────────────────────────────────────────────
router.post('/api/admin/appointments/:id/make-recurring', async (req, res) => {
  try {
    const { pattern, end_date } = req.body;
    const { rows } = await pool.query(
      `UPDATE appointments SET recurring=true, recurrence_pattern=$1, recurrence_end=$2
       WHERE id=$3 RETURNING *`,
      [pattern, end_date, req.params.id]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Wait Time Estimator ───────────────────────────────────────────────────
router.get('/api/admin/wait-estimate', async (req, res) => {
  try {
    // Count active queue items and average service time
    const queue = await pool.query(
      `SELECT COUNT(*) as waiting FROM walkin_queue WHERE status='waiting'`
    );
    const avgTime = await pool.query(
      `SELECT AVG(EXTRACT(EPOCH FROM (updated_at - created_at))/60) as avg_minutes
       FROM walkin_queue WHERE status='completed' AND created_at >= CURRENT_DATE`
    );
    const waitingCount = parseInt(queue.rows[0].waiting);
    const avgMinutes = parseFloat(avgTime.rows[0].avg_minutes) || 15;
    
    res.json({
      waiting_count: waitingCount,
      avg_service_minutes: Math.round(avgMinutes),
      estimated_wait: Math.round(waitingCount * avgMinutes)
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── SLA Policies ──────────────────────────────────────────────────────────
router.get('/api/admin/sla-policies', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM sla_policies ORDER BY response_hours');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/admin/sla-policies', async (req, res) => {
  try {
    const { name, response_hours, resolution_hours, priority } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO sla_policies (name, response_hours, resolution_hours, priority)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [name, response_hours, resolution_hours, priority || 'normal']
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Escalation Rules ──────────────────────────────────────────────────────
router.get('/api/admin/escalation-rules', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT er.*, au.username as escalate_to_name FROM escalation_rules er
       LEFT JOIN admin_users au ON er.escalate_to = au.id ORDER BY er.created_at`
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/admin/escalation-rules', async (req, res) => {
  try {
    const { name, trigger_type, trigger_value, escalate_to, notify_via } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO escalation_rules (name, trigger_type, trigger_value, escalate_to, notify_via)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [name, trigger_type, trigger_value, escalate_to, notify_via || 'notification']
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Inventory Movements ───────────────────────────────────────────────────
router.get('/api/admin/inventory/:id/movements', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT im.*, au.username as user_name FROM inventory_movements im
       LEFT JOIN admin_users au ON im.created_by = au.id
       WHERE im.inventory_id = $1 ORDER BY im.created_at DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/admin/inventory/:id/movements', async (req, res) => {
  try {
    const { movement_type, quantity, notes } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO inventory_movements (inventory_id, movement_type, quantity, notes, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.params.id, movement_type, quantity, notes, req.session.adminId]
    );
    // Update inventory quantity
    const adjustment = ['purchase', 'return'].includes(movement_type) ? quantity : -quantity;
    await pool.query('UPDATE inventory SET quantity = quantity + $1 WHERE id = $2', [adjustment, req.params.id]);
    
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Notifications ─────────────────────────────────────────────────────────
router.get('/api/admin/notifications', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.session.adminId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/api/admin/notifications/read-all', async (req, res) => {
  try {
    await pool.query('UPDATE notifications SET read=true WHERE user_id=$1', [req.session.adminId]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
