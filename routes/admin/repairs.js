/**
 * Admin repair management routes — CRUD, status updates, photos, timeline,
 * intake checklist, warranty, QR codes, device history, satisfaction, time tracking.
 */
const { Router } = require('express');
const { pool } = require('../../lib/db');
const { requireAdmin } = require('../../middleware/auth');
const { auditLog } = require('../../lib/audit');
const { sendEmail, emailTemplates, statusLabel, emailWrapper } = require('../../lib/email');
const { trySendSMS } = require('../../lib/sms');
const { getSettings } = require('../../lib/settings');
const logger = require('../../lib/logger');

const router = Router();

// ─── Create Repair ───────────────────────────────────────────────────────────
router.post('/admin/api/repairs', requireAdmin, async (req, res) => {
  const { customer_id, device_type, device_brand, device_model, issue_description,
          total_amount, serial_number, service_tier_id, is_warranty_claim, rush_repair } = req.body;
  if (!customer_id) return res.status(400).json({ error: 'customer_id required' });
  try {
    const r = await pool.query(
      `INSERT INTO repairs (customer_id, device_type, device_brand, device_model, issue_description,
       total_amount, serial_number, service_tier_id, is_warranty_claim, rush_repair)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [customer_id, device_type || null, device_brand || null, device_model || null,
       issue_description || null, total_amount || null, serial_number || null,
       service_tier_id || null, is_warranty_claim || false, rush_repair || false]
    );
    const repair = r.rows[0];
    // Log initial status in history
    await pool.query(
      `INSERT INTO repair_status_history (repair_id, status, notes, changed_by) VALUES ($1,$2,$3,$4)`,
      [repair.id, repair.status || 'intake', 'Repair created', req.session.adminId]
    ).catch((err) => logger.warn({ err }, 'Failed to log initial repair status'));
    res.json(repair);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Update Repair ───────────────────────────────────────────────────────────
router.put('/admin/api/repairs/:id', requireAdmin, async (req, res) => {
  const { status, diagnosis_notes, repair_notes, total_amount, device_brand, device_model,
          device_type, serial_number, service_tier_id, warranty_period_days,
          is_warranty_claim, rush_repair } = req.body;
  try {
    const prevR = await pool.query('SELECT status FROM repairs WHERE id=$1', [req.params.id]);
    const prevStatus = prevR.rows[0]?.status;

    let warrantyStartsAt = null, warrantyExpiresAt = null;
    if (status === 'complete' && warranty_period_days && parseInt(warranty_period_days) > 0) {
      warrantyStartsAt = new Date();
      warrantyExpiresAt = new Date(Date.now() + parseInt(warranty_period_days) * 86400000);
    }

    const r = await pool.query(
      `UPDATE repairs SET status=COALESCE($1,status), diagnosis_notes=COALESCE($2,diagnosis_notes),
       repair_notes=COALESCE($3,repair_notes), total_amount=COALESCE($4,total_amount),
       device_brand=COALESCE($5,device_brand), device_model=COALESCE($6,device_model),
       device_type=COALESCE($7,device_type), updated_at=NOW(),
       serial_number=COALESCE($9,serial_number), service_tier_id=COALESCE($10,service_tier_id),
       warranty_period_days=COALESCE($11,warranty_period_days),
       is_warranty_claim=COALESCE($12,is_warranty_claim), rush_repair=COALESCE($13,rush_repair),
       warranty_starts_at=COALESCE($14,warranty_starts_at), warranty_expires_at=COALESCE($15,warranty_expires_at)
       WHERE id=$8 RETURNING *`,
      [status || null, diagnosis_notes || null, repair_notes || null, total_amount || null,
       device_brand || null, device_model || null, device_type || null, req.params.id,
       serial_number || null, service_tier_id || null,
       warranty_period_days != null ? parseInt(warranty_period_days) : null,
       is_warranty_claim != null ? is_warranty_claim : null,
       rush_repair != null ? rush_repair : null,
       warrantyStartsAt, warrantyExpiresAt]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    const repair = r.rows[0];

    // Log status change
    if (status && status !== prevStatus) {
      await pool.query(
        `INSERT INTO repair_status_history (repair_id, status, notes, changed_by) VALUES ($1,$2,$3,$4)`,
        [repair.id, status, req.body.status_note || null, req.session.adminId]
      ).catch((err) => logger.warn({ err }, 'Failed to log repair status change'));
    }

    // Notify customer on status change
    if (status && status !== prevStatus) {
      const custResult = await pool.query('SELECT * FROM customers WHERE id=$1', [repair.customer_id]);
      if (custResult.rows.length) {
        const customer = custResult.rows[0];
        if (customer.email) {
          const tpl = emailTemplates.repairStatus(customer, repair);
          const emailResult = await sendEmail(customer.email, tpl.subject, tpl.html);
          if (emailResult.ok) {
            await pool.query(`INSERT INTO reminder_logs (type,email_to,success) VALUES ('repair_status',$1,true)`, [customer.email])
              .catch(() => {});
          }
        }
        await trySendSMS(customer.phone,
          `Hi ${(customer.name || '').split(' ')[0]}, your repair at Scarlet Technical is now: ${statusLabel(status)}. Questions? Call us in Muncie!`
        ).catch(() => {});

        // Schedule review prompt via database flag instead of setTimeout
        // (BUG FIX: setTimeout is lost on server restart)
        if (status === 'complete') {
          const rvSet = await getSettings(['review_prompt_enabled', 'google_review_url', 'review_prompt_delay_hours']);
          if (rvSet.review_prompt_enabled === 'true' && rvSet.google_review_url) {
            const delayHours = parseInt(rvSet.review_prompt_delay_hours || '2');
            const sendAt = new Date(Date.now() + delayHours * 3600000);
            await pool.query(
              `UPDATE repairs SET review_prompt_due_at=$1 WHERE id=$2 AND review_prompt_sent_at IS NULL`,
              [sendAt, repair.id]
            ).catch(() => {});
          }
        }
      }
    }
    res.json(repair);
  } catch (err) {
    logger.error({ err }, 'Repair update error');
    res.status(500).json({ error: err.message });
  }
});

// ─── Repair Requests (from public form) ──────────────────────────────────────
router.get('/admin/api/repair-requests', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM repair_requests ORDER BY created_at DESC');
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/admin/api/repair-requests/:id', requireAdmin, async (req, res) => {
  const { status, notes } = req.body;
  try {
    const r = await pool.query(
      'UPDATE repair_requests SET status=COALESCE($1,status), notes=COALESCE($2,notes) WHERE id=$3 RETURNING *',
      [status || null, notes || null, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Repair Status Timeline ──────────────────────────────────────────────────
router.get('/admin/api/repairs/:id/timeline', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT rsh.*, a.display_name as changed_by_name
       FROM repair_status_history rsh LEFT JOIN admin_users a ON a.id = rsh.changed_by
       WHERE rsh.repair_id=$1 ORDER BY rsh.changed_at ASC`, [req.params.id]);
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Repair Photos ───────────────────────────────────────────────────────────
router.get('/admin/api/repairs/:id/photos', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, stage, caption, uploaded_at,
        CASE WHEN photo_data IS NOT NULL THEN true ELSE false END as has_photo
       FROM repair_photos WHERE repair_id=$1 ORDER BY uploaded_at ASC`, [req.params.id]);
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/admin/api/photos/:id', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM repair_photos WHERE id=$1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin/api/repairs/:id/photos', requireAdmin, async (req, res) => {
  const { photo_data, stage, caption } = req.body;
  if (!photo_data) return res.status(400).json({ error: 'photo_data required' });
  // Validate base64 size (max ~5MB)
  if (photo_data.length > 7_000_000) return res.status(400).json({ error: 'Photo too large (max 5MB)' });
  try {
    const count = await pool.query('SELECT COUNT(*) FROM repair_photos WHERE repair_id=$1 AND stage=$2',
      [req.params.id, stage || 'before']);
    if (parseInt(count.rows[0].count) >= 10) return res.status(400).json({ error: 'Max 10 photos per stage' });
    const r = await pool.query(
      `INSERT INTO repair_photos (repair_id, stage, photo_data, caption, uploaded_by) VALUES ($1,$2,$3,$4,$5)
       RETURNING id, stage, caption, uploaded_at`,
      [req.params.id, stage || 'before', photo_data, caption || null, req.session.adminId]);
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/admin/api/photos/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM repair_photos WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Intake Checklist ────────────────────────────────────────────────────────
router.get('/admin/api/repairs/:id/checklist', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM intake_checklists WHERE repair_id=$1', [req.params.id]);
    res.json(r.rows[0] || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin/api/repairs/:id/checklist', requireAdmin, async (req, res) => {
  const { screen_cond, screen_notes, buttons_cond, buttons_notes, battery_cond, battery_notes,
          water_cond, water_notes, ports_cond, ports_notes, cosmetic_cond, cosmetic_notes,
          power_test, power_notes, audio_test, audio_notes, customer_signature, customer_name } = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO intake_checklists
       (repair_id,screen_cond,screen_notes,buttons_cond,buttons_notes,battery_cond,battery_notes,
        water_cond,water_notes,ports_cond,ports_notes,cosmetic_cond,cosmetic_notes,
        power_test,power_notes,audio_test,audio_notes,customer_signature,customer_name,completed_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       ON CONFLICT (repair_id) DO UPDATE SET
         screen_cond=$2,screen_notes=$3,buttons_cond=$4,buttons_notes=$5,
         battery_cond=$6,battery_notes=$7,water_cond=$8,water_notes=$9,
         ports_cond=$10,ports_notes=$11,cosmetic_cond=$12,cosmetic_notes=$13,
         power_test=$14,power_notes=$15,audio_test=$16,audio_notes=$17,
         customer_signature=$18,customer_name=$19,completed_by=$20,completed_at=NOW()
       RETURNING *`,
      [req.params.id, screen_cond||'na', screen_notes||null, buttons_cond||'na', buttons_notes||null,
       battery_cond||'na', battery_notes||null, water_cond||'na', water_notes||null,
       ports_cond||'na', ports_notes||null, cosmetic_cond||'na', cosmetic_notes||null,
       power_test||'na', power_notes||null, audio_test||'na', audio_notes||null,
       customer_signature||null, customer_name||null, req.session.adminId]
    );
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Satisfaction Rating ─────────────────────────────────────────────────────
router.post('/admin/api/repairs/:id/satisfaction', requireAdmin, async (req, res) => {
  const { rating, comment } = req.body;
  if (!['thumbs_up', 'thumbs_down'].includes(rating)) {
    return res.status(400).json({ error: 'rating must be thumbs_up or thumbs_down' });
  }
  try {
    const r = await pool.query(
      `UPDATE repairs SET satisfaction_rating=$1, satisfaction_comment=$2,
       satisfaction_rated_at=NOW(), updated_at=NOW() WHERE id=$3 RETURNING *`,
      [rating, comment || null, req.params.id]);
    res.json({ success: true, repair: r.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Warranty ────────────────────────────────────────────────────────────────
router.get('/admin/api/repairs/warranty-expiring', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT r.*, c.name as customer_name, c.email as customer_email, c.phone as customer_phone
       FROM repairs r JOIN customers c ON c.id=r.customer_id
       WHERE r.warranty_expires_at IS NOT NULL AND r.warranty_expires_at > NOW()
         AND r.warranty_expires_at < NOW() + INTERVAL '14 days'
       ORDER BY r.warranty_expires_at ASC`);
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/admin/api/repairs/:id/warranty', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, warranty_period_days, warranty_starts_at, warranty_expires_at, is_warranty_claim
       FROM repairs WHERE id=$1`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── QR Code ─────────────────────────────────────────────────────────────────
router.get('/admin/api/repairs/:id/qr', requireAdmin, (req, res) => {
  const siteUrl = process.env.SITE_URL || 'https://jarviscli.dev';
  const repairUrl = `${siteUrl}/admin#repair-${req.params.id}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(repairUrl)}`;
  res.json({ qr_url: qrUrl, repair_url: repairUrl, repair_id: req.params.id });
});

router.get('/admin/api/repairs/qr-batch', requireAdmin, async (req, res) => {
  const { ids } = req.query;
  if (!ids) return res.status(400).json({ error: 'ids required' });
  const siteUrl = process.env.SITE_URL || 'https://jarviscli.dev';
  const idList = ids.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
  try {
    const r = await pool.query(
      `SELECT id, device_brand, device_model, device_type, serial_number, status FROM repairs WHERE id = ANY($1)`,
      [idList]);
    const results = r.rows.map(rep => ({
      ...rep,
      qr_url: `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(`${siteUrl}/admin#repair-${rep.id}`)}`,
    }));
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Device History (by serial) ──────────────────────────────────────────────
router.get('/admin/api/device-history', requireAdmin, async (req, res) => {
  const { serial } = req.query;
  if (!serial) return res.status(400).json({ error: 'serial required' });
  try {
    const r = await pool.query(
      `SELECT r.*, c.name as customer_name, c.email as customer_email
       FROM repairs r LEFT JOIN customers c ON c.id=r.customer_id
       WHERE LOWER(r.serial_number) = LOWER($1) ORDER BY r.created_at DESC`, [serial]);
    res.json({ serial, count: r.rows.length, repairs: r.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/admin/api/device-lookup', requireAdmin, async (req, res) => {
  const { serial } = req.query;
  if (!serial) return res.json({ found: false });
  try {
    const r = await pool.query(
      `SELECT COUNT(*) as count, MAX(created_at) as last_seen FROM repairs WHERE LOWER(serial_number)=LOWER($1)`, [serial]);
    res.json({ found: parseInt(r.rows[0].count) > 0, count: parseInt(r.rows[0].count), last_seen: r.rows[0].last_seen });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Time Tracking ───────────────────────────────────────────────────────────
router.get('/admin/api/repairs/:id/time-entries', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT te.*, a.display_name as technician_name
       FROM time_entries te LEFT JOIN admin_users a ON a.id=te.user_id
       WHERE te.repair_id=$1 ORDER BY te.started_at DESC`, [req.params.id]);
    const totalMinutes = r.rows.reduce((sum, e) => sum + (e.duration_minutes || 0), 0);
    res.json({ entries: r.rows, total_minutes: totalMinutes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin/api/repairs/:id/time-entries', requireAdmin, async (req, res) => {
  const { started_at, ended_at, duration_minutes, notes } = req.body;
  try {
    let dur = duration_minutes ? parseInt(duration_minutes) : null;
    if (!dur && started_at && ended_at) dur = Math.round((new Date(ended_at) - new Date(started_at)) / 60000);
    const r = await pool.query(
      `INSERT INTO time_entries (repair_id,user_id,started_at,ended_at,duration_minutes,notes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.params.id, req.session.adminId, started_at || null, ended_at || null, dur, notes || null]);
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin/api/repairs/:id/time-entries/start', requireAdmin, async (req, res) => {
  try {
    const running = await pool.query(
      `SELECT id FROM time_entries WHERE repair_id=$1 AND user_id=$2 AND ended_at IS NULL`,
      [req.params.id, req.session.adminId]);
    if (running.rows.length) return res.status(409).json({ error: 'Timer already running', entry_id: running.rows[0].id });
    const r = await pool.query(
      `INSERT INTO time_entries (repair_id,user_id,started_at) VALUES ($1,$2,NOW()) RETURNING *`,
      [req.params.id, req.session.adminId]);
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin/api/time-entries/:id/stop', requireAdmin, async (req, res) => {
  const { notes } = req.body;
  try {
    const r = await pool.query(
      `UPDATE time_entries SET ended_at=NOW(),
       duration_minutes=ROUND(EXTRACT(EPOCH FROM (NOW()-started_at))/60),
       notes=COALESCE($1,notes) WHERE id=$2 AND user_id=$3 AND ended_at IS NULL RETURNING *`,
      [notes || null, req.params.id, req.session.adminId]);
    if (!r.rows.length) return res.status(404).json({ error: 'No running timer found' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/admin/api/time-entries/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM time_entries WHERE id=$1 AND user_id=$2', [req.params.id, req.session.adminId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
