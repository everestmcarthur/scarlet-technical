const express = require('express');
const router = express.Router();
const { pool } = require('../../lib/db');

function requireAdmin(req, res, next) {
  if (!req.session?.adminId) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

router.use(requireAdmin);

// ── Kanban Board ──────────────────────────────────────────────────────────
router.get('/admin/api/repair-kanban', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT rr.*, c.name as customer_name, au.name as tech_name
       FROM repair_requests rr
       LEFT JOIN customers c ON rr.customer_id = c.id
       LEFT JOIN admin_users au ON rr.assigned_tech = au.id
       WHERE rr.status NOT IN ('completed','cancelled')
       ORDER BY 
         CASE rr.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
         rr.kanban_position ASC, rr.created_at ASC`
    );
    // Group by status for kanban columns
    const columns = {};
    rows.forEach(r => {
      if (!columns[r.status]) columns[r.status] = [];
      columns[r.status].push(r);
    });
    res.json(columns);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Update kanban position / assign tech / set priority
router.put('/admin/api/repairs/:id/workflow', async (req, res) => {
  try {
    const { status, priority, assigned_tech, kanban_position, estimated_minutes } = req.body;
    const sets = [];
    const params = [];
    if (status !== undefined) { params.push(status); sets.push(`status=$${params.length}`); }
    if (priority !== undefined) { params.push(priority); sets.push(`priority=$${params.length}`); }
    if (assigned_tech !== undefined) { params.push(assigned_tech); sets.push(`assigned_tech=$${params.length}`); }
    if (kanban_position !== undefined) { params.push(kanban_position); sets.push(`kanban_position=$${params.length}`); }
    if (estimated_minutes !== undefined) { params.push(estimated_minutes); sets.push(`estimated_minutes=$${params.length}`); }
    if (sets.length === 0) return res.status(400).json({ error: 'No fields to update' });
    
    params.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE repair_requests SET ${sets.join(',')} WHERE id=$${params.length} RETURNING *`,
      params
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Parts Consumption ─────────────────────────────────────────────────────
router.get('/admin/api/repairs/:id/parts', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT rp.*, i.name as part_name, i.sku FROM repair_parts rp
       JOIN inventory_parts i ON rp.inventory_id = i.id WHERE rp.repair_id = $1 ORDER BY rp.created_at`,
      [req.params.id]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/admin/api/repairs/:id/parts', async (req, res) => {
  try {
    const { inventory_id, quantity } = req.body;
    // Get cost and decrement inventory
    const inv = await pool.query('SELECT * FROM inventory_parts WHERE id=$1', [inventory_id]);
    if (!inv.rows[0]) return res.status(404).json({ error: 'Part not found' });
    if (inv.rows[0].quantity < quantity) return res.status(400).json({ error: 'Insufficient stock' });
    
    const cost = inv.rows[0].sell_price || inv.rows[0].unit_cost || 0;
    await pool.query('UPDATE inventory_parts SET quantity = quantity - $1 WHERE id = $2', [quantity, inventory_id]);
    
    const { rows } = await pool.query(
      `INSERT INTO repair_parts (repair_id, inventory_id, quantity, unit_cost)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.params.id, inventory_id, quantity, cost]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Repair Templates ──────────────────────────────────────────────────────
router.get('/admin/api/repair-templates', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM repair_templates ORDER BY name');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/admin/api/repair-templates', async (req, res) => {
  try {
    const { name, device_type, checklist, estimated_minutes, default_priority, notes } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO repair_templates (name, device_type, checklist, estimated_minutes, default_priority, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [name, device_type, JSON.stringify(checklist || []), estimated_minutes, default_priority || 'normal', notes, req.session.adminId]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Diagnostic Reports ────────────────────────────────────────────────────
router.get('/admin/api/repairs/:id/diagnostic', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM diagnostic_reports WHERE repair_id = $1 ORDER BY created_at DESC',
      [req.params.id]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/admin/api/repairs/:id/diagnostic', async (req, res) => {
  try {
    const { device_id, battery_health, storage_used_gb, storage_total_gb, ram_gb,
            screen_condition, wifi_test, bluetooth_test, speaker_test, camera_test,
            charging_test, notes } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO diagnostic_reports (repair_id, device_id, battery_health, storage_used_gb, storage_total_gb,
       ram_gb, screen_condition, wifi_test, bluetooth_test, speaker_test, camera_test, charging_test, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [req.params.id, device_id||null, battery_health, storage_used_gb, storage_total_gb, ram_gb,
       screen_condition, wifi_test, bluetooth_test, speaker_test, camera_test, charging_test, notes, req.session.adminId]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Aging Alerts ──────────────────────────────────────────────────────────
router.get('/admin/api/aging-repairs', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT rr.*, c.name as customer_name,
       EXTRACT(DAY FROM NOW() - rr.updated_at) as days_since_update,
       EXTRACT(DAY FROM NOW() - rr.created_at) as days_open
       FROM repair_requests rr
       LEFT JOIN customers c ON rr.customer_id = c.id
       WHERE rr.status NOT IN ('completed','cancelled')
       AND rr.updated_at < NOW() - INTERVAL '3 days'
       ORDER BY rr.updated_at ASC`
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Technician workload ───────────────────────────────────────────────────
router.get('/admin/api/tech-workload', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT au.id, au.name, au.display_name,
       COUNT(rr.id) FILTER (WHERE rr.status NOT IN ('completed','cancelled')) as active_repairs,
       SUM(rr.estimated_minutes) FILTER (WHERE rr.status NOT IN ('completed','cancelled')) as total_estimated_minutes,
       COUNT(rr.id) FILTER (WHERE rr.status = 'completed' AND rr.updated_at >= CURRENT_DATE) as completed_today
       FROM admin_users au
       LEFT JOIN repair_requests rr ON rr.assigned_tech = au.id
       WHERE au.active = true
       GROUP BY au.id, au.name, au.display_name
       ORDER BY active_repairs DESC`
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
