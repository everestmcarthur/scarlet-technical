/**
 * Admin routes for service catalog, service tiers, loaners, inventory, appointments.
 */
const { Router } = require('express');
const { pool } = require('../../lib/db');
const { requireAdmin } = require('../../middleware/auth');

const router = Router();

// ═══════════════════════════════════════════════════════════════════════════════
// ─── SERVICE CATALOG ─────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/admin/api/services', requireAdmin, async (req, res) => {
  try { res.json((await pool.query('SELECT * FROM service_catalog ORDER BY sort_order, name')).rows); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/admin/api/services', requireAdmin, async (req, res) => {
  const { name, description, base_price, category, estimated_hours, sort_order, is_active } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const r = await pool.query(
      `INSERT INTO service_catalog (name,description,base_price,category,estimated_hours,sort_order,is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [name, description||null, parseFloat(base_price||0), category||null,
       parseFloat(estimated_hours||1), parseInt(sort_order||0), is_active !== false]);
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/admin/api/services/:id', requireAdmin, async (req, res) => {
  const { name, description, base_price, category, estimated_hours, sort_order, is_active } = req.body;
  try {
    const r = await pool.query(
      `UPDATE service_catalog SET name=COALESCE($1,name),description=COALESCE($2,description),
       base_price=COALESCE($3,base_price),category=COALESCE($4,category),
       estimated_hours=COALESCE($5,estimated_hours),sort_order=COALESCE($6,sort_order),
       is_active=COALESCE($7,is_active) WHERE id=$8 RETURNING *`,
      [name||null, description||null, base_price!=null?parseFloat(base_price):null,
       category||null, estimated_hours!=null?parseFloat(estimated_hours):null,
       sort_order!=null?parseInt(sort_order):null, is_active!=null?is_active:null, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/admin/api/services/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('UPDATE service_catalog SET is_active=false WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── SERVICE TIERS ───────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/admin/api/service-tiers', requireAdmin, async (req, res) => {
  try { res.json((await pool.query('SELECT * FROM service_tiers ORDER BY sort_order')).rows); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/admin/api/service-tiers', requireAdmin, async (req, res) => {
  const { name, slug, turnaround_hours, price_multiplier, color, sort_order } = req.body;
  if (!name || !slug) return res.status(400).json({ error: 'name and slug required' });
  try {
    const r = await pool.query(
      `INSERT INTO service_tiers (name,slug,turnaround_hours,price_multiplier,color,sort_order)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [name, slug, parseInt(turnaround_hours||72), parseFloat(price_multiplier||1.0), color||'green', parseInt(sort_order||0)]);
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/admin/api/service-tiers/:id', requireAdmin, async (req, res) => {
  const { name, turnaround_hours, price_multiplier, color, sort_order, is_active } = req.body;
  try {
    const r = await pool.query(
      `UPDATE service_tiers SET name=COALESCE($1,name),turnaround_hours=COALESCE($2,turnaround_hours),
       price_multiplier=COALESCE($3,price_multiplier),color=COALESCE($4,color),
       sort_order=COALESCE($5,sort_order),is_active=COALESCE($6,is_active) WHERE id=$7 RETURNING *`,
      [name||null, turnaround_hours!=null?parseInt(turnaround_hours):null,
       price_multiplier!=null?parseFloat(price_multiplier):null, color||null,
       sort_order!=null?parseInt(sort_order):null, is_active!=null?is_active:null, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── LOANERS ─────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/admin/api/loaners', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT l.*, c.name as assigned_customer_name
       FROM loaners l LEFT JOIN customers c ON c.id=l.assigned_customer_id ORDER BY l.created_at DESC`);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/admin/api/loaners', requireAdmin, async (req, res) => {
  const { device_name, device_type, serial_number, condition_notes } = req.body;
  if (!device_name) return res.status(400).json({ error: 'device_name required' });
  try {
    const r = await pool.query(
      `INSERT INTO loaners (device_name,device_type,serial_number,condition_notes) VALUES ($1,$2,$3,$4) RETURNING *`,
      [device_name, device_type||null, serial_number||null, condition_notes||null]);
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/admin/api/loaners/:id', requireAdmin, async (req, res) => {
  const { status, assigned_customer_id, assigned_repair_id, condition_notes, return_notes } = req.body;
  try {
    const updates = [];
    const params = [];
    if (status) { params.push(status); updates.push(`status=$${params.length}`); }
    if (assigned_customer_id !== undefined) { params.push(assigned_customer_id||null); updates.push(`assigned_customer_id=$${params.length}`); }
    if (assigned_repair_id !== undefined) { params.push(assigned_repair_id||null); updates.push(`assigned_repair_id=$${params.length}`); }
    if (condition_notes !== undefined) { params.push(condition_notes||null); updates.push(`condition_notes=$${params.length}`); }
    if (return_notes !== undefined) { params.push(return_notes||null); updates.push(`return_notes=$${params.length}`); }
    if (status === 'checked_out') updates.push('checked_out_at=NOW()');
    if (status === 'available') updates.push('returned_at=NOW()');
    updates.push('updated_at=NOW()');
    params.push(req.params.id);
    const r = await pool.query(`UPDATE loaners SET ${updates.join(',')} WHERE id=$${params.length} RETURNING *`, params);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── INVENTORY / PARTS ───────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/admin/api/inventory', requireAdmin, async (req, res) => {
  const { search, low_stock } = req.query;
  let q = 'SELECT * FROM inventory WHERE 1=1';
  const params = [];
  if (search) { params.push(`%${search}%`); q += ` AND (name ILIKE $${params.length} OR sku ILIKE $${params.length})`; }
  if (low_stock === 'true') q += ' AND quantity <= reorder_point';
  q += ' ORDER BY name';
  try { res.json((await pool.query(q, params)).rows); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/admin/api/inventory', requireAdmin, async (req, res) => {
  const { name, sku, description, quantity, unit_cost, sell_price, reorder_point, category, supplier, location } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const r = await pool.query(
      `INSERT INTO inventory (name,sku,description,quantity,unit_cost,sell_price,reorder_point,category,supplier,location)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [name, sku||null, description||null, parseInt(quantity||0), parseFloat(unit_cost||0),
       parseFloat(sell_price||0), parseInt(reorder_point||5), category||null, supplier||null, location||null]);
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/admin/api/inventory/:id', requireAdmin, async (req, res) => {
  const { name, sku, description, quantity, unit_cost, sell_price, reorder_point, category, supplier, location } = req.body;
  try {
    const r = await pool.query(
      `UPDATE inventory SET name=COALESCE($1,name),sku=$2,description=$3,
       quantity=COALESCE($4,quantity),unit_cost=COALESCE($5,unit_cost),sell_price=COALESCE($6,sell_price),
       reorder_point=COALESCE($7,reorder_point),category=$8,supplier=$9,location=$10,updated_at=NOW()
       WHERE id=$11 RETURNING *`,
      [name||null, sku??null, description??null, quantity!=null?parseInt(quantity):null,
       unit_cost!=null?parseFloat(unit_cost):null, sell_price!=null?parseFloat(sell_price):null,
       reorder_point!=null?parseInt(reorder_point):null, category??null, supplier??null, location??null, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/admin/api/inventory/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM inventory WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── APPOINTMENTS ────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/admin/api/appointments', requireAdmin, async (req, res) => {
  const { date, customer_id, status } = req.query;
  let q = `SELECT a.*, c.name as customer_name, c.phone as customer_phone
    FROM appointments a LEFT JOIN customers c ON c.id=a.customer_id WHERE 1=1`;
  const params = [];
  if (date) { params.push(date); q += ` AND DATE(a.appointment_date)=$${params.length}`; }
  if (customer_id) { params.push(customer_id); q += ` AND a.customer_id=$${params.length}`; }
  if (status) { params.push(status); q += ` AND a.status=$${params.length}`; }
  q += ' ORDER BY a.appointment_date ASC';
  try { res.json((await pool.query(q, params)).rows); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/admin/api/appointments', requireAdmin, async (req, res) => {
  const { customer_id, appointment_date, appointment_time, duration_minutes, service_type, notes, assigned_to } = req.body;
  if (!appointment_date) return res.status(400).json({ error: 'appointment_date required' });
  try {
    const r = await pool.query(
      `INSERT INTO appointments (customer_id,appointment_date,appointment_time,duration_minutes,service_type,notes,assigned_to,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [customer_id||null, appointment_date, appointment_time||null, parseInt(duration_minutes||30),
       service_type||null, notes||null, assigned_to||null, req.session.adminId]);
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/admin/api/appointments/:id', requireAdmin, async (req, res) => {
  const { appointment_date, appointment_time, duration_minutes, status, service_type, notes, assigned_to } = req.body;
  try {
    const r = await pool.query(
      `UPDATE appointments SET appointment_date=COALESCE($1,appointment_date),
       appointment_time=COALESCE($2,appointment_time),duration_minutes=COALESCE($3,duration_minutes),
       status=COALESCE($4,status),service_type=COALESCE($5,service_type),
       notes=COALESCE($6,notes),assigned_to=COALESCE($7,assigned_to),updated_at=NOW()
       WHERE id=$8 RETURNING *`,
      [appointment_date||null, appointment_time||null, duration_minutes!=null?parseInt(duration_minutes):null,
       status||null, service_type||null, notes||null, assigned_to||null, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/admin/api/appointments/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM appointments WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── REMOTE SESSIONS ─────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/admin/api/remote-sessions', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT rs.*, c.name as customer_name FROM remote_sessions rs
       LEFT JOIN customers c ON c.id=rs.customer_id ORDER BY rs.created_at DESC LIMIT 50`);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/admin/api/remote-sessions', requireAdmin, async (req, res) => {
  const { customer_id, repair_id, session_url, tool, notes } = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO remote_sessions (customer_id,repair_id,session_url,tool,notes,started_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [customer_id||null, repair_id||null, session_url||null, tool||'anydesk', notes||null, req.session.adminId]);
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/admin/api/remote-sessions/:id', requireAdmin, async (req, res) => {
  const { status, notes, duration_minutes } = req.body;
  try {
    const r = await pool.query(
      `UPDATE remote_sessions SET status=COALESCE($1,status),notes=COALESCE($2,notes),
       duration_minutes=COALESCE($3,duration_minutes),
       ended_at=CASE WHEN $1='ended' THEN NOW() ELSE ended_at END,
       updated_at=NOW() WHERE id=$4 RETURNING *`,
      [status||null, notes||null, duration_minutes!=null?parseInt(duration_minutes):null, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
