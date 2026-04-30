/**
 * Admin device management — full control panel for enrolled devices.
 *
 * Features:
 * - Device list with real-time status, telemetry, customer info
 * - Lock / Unlock / Wipe commands with custom messages
 * - Override PIN generation (one-time, time-limited)
 * - Unlock request review (approve/deny)
 * - Enrollment token management
 * - Installer downloads (Android APK, Linux script, Windows PowerShell)
 * - Device audit log
 * - Bulk operations
 */
const { Router } = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pool } = require('../../lib/db');
const { requireAdmin } = require('../../middleware/auth');
const { auditLog } = require('../../lib/audit');
const { generateToken } = require('../../lib/utils');
const logger = require('../../lib/logger');

const router = Router();

// ─── Device List (with search, filter, sort) ─────────────────────────────────
router.get('/admin/api/devices', requireAdmin, async (req, res) => {
  const { status, platform, search, sort } = req.query;
  try {
    let where = ['d.unenrolled_at IS NULL'];
    const params = [];
    let paramIdx = 1;

    if (status && ['locked', 'unlocked', 'wiped'].includes(status)) {
      where.push(`d.lock_status = $${paramIdx++}`);
      params.push(status);
    }
    if (platform && ['windows', 'android', 'linux'].includes(platform)) {
      where.push(`d.platform = $${paramIdx++}`);
      params.push(platform);
    }
    if (search) {
      where.push(`(d.hostname ILIKE $${paramIdx} OR d.device_uuid ILIKE $${paramIdx} OR c.name ILIKE $${paramIdx} OR c.email ILIKE $${paramIdx})`);
      params.push(`%${search}%`);
      paramIdx++;
    }

    const orderBy = sort === 'last_seen' ? 'd.last_seen_at DESC NULLS LAST' :
                    sort === 'status' ? 'd.lock_status, d.hostname' :
                    'd.enrolled_at DESC';

    const r = await pool.query(
      `SELECT d.*, c.name as customer_name, c.email as customer_email, c.phone as customer_phone,
        (SELECT COUNT(*) FROM unlock_requests ur WHERE ur.device_id = d.id AND ur.status = 'pending') as pending_unlock_requests,
        (SELECT COUNT(*) FROM device_commands dc WHERE dc.device_id = d.id AND dc.status = 'pending') as pending_commands,
        CASE WHEN d.last_seen_at > NOW() - INTERVAL '10 minutes' THEN 'online'
             WHEN d.last_seen_at > NOW() - INTERVAL '1 hour' THEN 'recently_seen'
             ELSE 'offline' END as connectivity_status
       FROM enrolled_devices d LEFT JOIN customers c ON c.id = d.customer_id
       WHERE ${where.join(' AND ')} ORDER BY ${orderBy}`,
      params
    );
    res.json({ devices: r.rows });
  } catch (err) {
    logger.error({ err }, 'Device list error');
    res.status(500).json({ error: err.message });
  }
});

// ─── Device Detail (full info + commands + audit + unlock requests) ──────────
router.get('/admin/api/devices/:id', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT d.*, c.name as customer_name, c.email as customer_email, c.phone as customer_phone,
        pp.id as payment_plan_id, pp.total_amount as plan_total, pp.status as plan_status
       FROM enrolled_devices d
       LEFT JOIN customers c ON c.id = d.customer_id
       LEFT JOIN payment_plans pp ON pp.id = d.payment_plan_id
       WHERE d.id = $1`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Device not found' });

    // Recent commands
    const commands = await pool.query(
      `SELECT dc.*, au.name as issued_by_name
       FROM device_commands dc LEFT JOIN admin_users au ON au.id = dc.issued_by
       WHERE dc.device_id = $1 ORDER BY dc.created_at DESC LIMIT 50`,
      [req.params.id]
    );

    // Unlock requests
    const unlockRequests = await pool.query(
      `SELECT ur.*, au.name as reviewed_by_name
       FROM unlock_requests ur LEFT JOIN admin_users au ON au.id = ur.reviewed_by
       WHERE ur.device_id = $1 ORDER BY ur.created_at DESC LIMIT 20`,
      [req.params.id]
    );

    // Audit log
    const audit = await pool.query(
      `SELECT dal.*, au.name as admin_name
       FROM device_audit_log dal LEFT JOIN admin_users au ON au.id = dal.admin_id
       WHERE dal.device_id = $1 ORDER BY dal.created_at DESC LIMIT 50`,
      [req.params.id]
    );

    res.json({
      device: r.rows[0],
      commands: commands.rows,
      unlock_requests: unlockRequests.rows,
      audit_log: audit.rows,
      has_override_pin: !!r.rows[0].override_pin && new Date(r.rows[0].override_pin_expires_at) > new Date()
    });
  } catch (err) {
    logger.error({ err }, 'Device detail error');
    res.status(500).json({ error: err.message });
  }
});

// ─── Send Command (lock/unlock/wipe with options) ────────────────────────────
router.post('/admin/api/devices/:id/command', requireAdmin, async (req, res) => {
  const { command, lock_message, params: cmdParams } = req.body;
  const validCommands = ['lock', 'unlock', 'wipe'];
  if (!validCommands.includes(command)) {
    return res.status(400).json({ error: `Invalid command. Valid: ${validCommands.join(', ')}` });
  }

  try {
    // Verify device exists
    const device = await pool.query('SELECT * FROM enrolled_devices WHERE id = $1', [req.params.id]);
    if (!device.rows.length) return res.status(404).json({ error: 'Device not found' });

    // Require confirmation for wipe
    if (command === 'wipe' && req.body.confirm !== true) {
      return res.status(400).json({ error: 'Wipe requires confirm: true. This action is irreversible.' });
    }

    // Insert command
    const r = await pool.query(
      `INSERT INTO device_commands (device_id, command, lock_message, params, issued_by, status)
       VALUES ($1, $2, $3, $4, $5, 'pending') RETURNING *`,
      [req.params.id, command, lock_message || null, JSON.stringify(cmdParams || {}), req.session.adminId]
    );

    // Immediately update device lock status
    if (command === 'lock') {
      await pool.query(
        `UPDATE enrolled_devices SET lock_status = 'locked', override_pin = NULL,
         override_pin_expires_at = NULL, override_pin_attempts = 0, updated_at = NOW() WHERE id = $1`,
        [req.params.id]
      );
    } else if (command === 'unlock') {
      await pool.query(
        `UPDATE enrolled_devices SET lock_status = 'unlocked', override_pin = NULL,
         override_pin_expires_at = NULL, override_pin_attempts = 0, updated_at = NOW() WHERE id = $1`,
        [req.params.id]
      );
      // Also mark pending unlock requests as approved
      await pool.query(
        `UPDATE unlock_requests SET status = 'approved', reviewed_by = $1, reviewed_at = NOW(),
         review_notes = 'Auto-approved: unlock command sent' WHERE device_id = $2 AND status = 'pending'`,
        [req.session.adminId, req.params.id]
      );
    } else if (command === 'wipe') {
      await pool.query(
        `UPDATE enrolled_devices SET lock_status = 'wiped', updated_at = NOW() WHERE id = $1`,
        [req.params.id]
      );
    }

    await auditLog(req, `device_${command}`, 'device', req.params.id, { command, lock_message });
    logger.info({ deviceId: req.params.id, command, adminId: req.session.adminId }, `Device ${command} command issued`);

    res.json(r.rows[0]);
  } catch (err) {
    logger.error({ err }, 'Device command error');
    res.status(500).json({ error: err.message });
  }
});

// ─── Generate Override PIN ───────────────────────────────────────────────────
router.post('/admin/api/devices/:id/generate-pin', requireAdmin, async (req, res) => {
  const { duration_minutes } = req.body;
  const durationMin = parseInt(duration_minutes) || 30; // default 30 minutes
  const maxDuration = 1440; // 24 hours max

  if (durationMin < 5 || durationMin > maxDuration) {
    return res.status(400).json({ error: `Duration must be between 5 and ${maxDuration} minutes` });
  }

  try {
    const device = await pool.query('SELECT * FROM enrolled_devices WHERE id = $1', [req.params.id]);
    if (!device.rows.length) return res.status(404).json({ error: 'Device not found' });

    // Generate 6-digit PIN
    const pin = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + durationMin * 60 * 1000);

    await pool.query(
      `UPDATE enrolled_devices SET
         override_pin = $1, override_pin_expires_at = $2, override_pin_attempts = 0, updated_at = NOW()
       WHERE id = $3`,
      [pin, expiresAt, req.params.id]
    );

    await auditLog(req, 'generate_override_pin', 'device', req.params.id, { duration_minutes: durationMin });
    await pool.query(
      `INSERT INTO device_audit_log (device_id, admin_id, action, details, ip_address)
       VALUES ($1, $2, 'generate_pin', $3, $4)`,
      [req.params.id, req.session.adminId,
       JSON.stringify({ duration_minutes: durationMin, expires_at: expiresAt.toISOString() }),
       req.ip]
    );

    logger.info({ deviceId: req.params.id, durationMin }, 'Override PIN generated');

    res.json({
      pin: pin,
      expires_at: expiresAt.toISOString(),
      duration_minutes: durationMin,
      message: `PIN ${pin} is valid for ${durationMin} minutes. Give this to the customer to enter on their lock screen.`
    });
  } catch (err) {
    logger.error({ err }, 'Generate PIN error');
    res.status(500).json({ error: err.message });
  }
});

// ─── Revoke Override PIN ─────────────────────────────────────────────────────
router.post('/admin/api/devices/:id/revoke-pin', requireAdmin, async (req, res) => {
  try {
    await pool.query(
      `UPDATE enrolled_devices SET override_pin = NULL, override_pin_expires_at = NULL,
       override_pin_attempts = 0, updated_at = NOW() WHERE id = $1`,
      [req.params.id]
    );
    await auditLog(req, 'revoke_override_pin', 'device', req.params.id, {});
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Unlock Request Management ───────────────────────────────────────────────
router.get('/admin/api/unlock-requests', requireAdmin, async (req, res) => {
  const { status } = req.query;
  try {
    let where = [];
    const params = [];
    let idx = 1;
    if (status && ['pending', 'approved', 'denied', 'expired'].includes(status)) {
      where.push(`ur.status = $${idx++}`);
      params.push(status);
    }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const r = await pool.query(
      `SELECT ur.*, d.hostname, d.device_uuid, d.platform, d.lock_status,
        c.name as customer_name, c.email as customer_email, c.phone as customer_phone,
        au.name as reviewed_by_name
       FROM unlock_requests ur
       JOIN enrolled_devices d ON d.id = ur.device_id
       LEFT JOIN customers c ON c.id = ur.customer_id
       LEFT JOIN admin_users au ON au.id = ur.reviewed_by
       ${whereClause} ORDER BY ur.created_at DESC`,
      params
    );
    res.json({ requests: r.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin/api/unlock-requests/:id/review', requireAdmin, async (req, res) => {
  const { action, review_notes } = req.body;
  if (!['approve', 'deny'].includes(action)) {
    return res.status(400).json({ error: 'action must be "approve" or "deny"' });
  }

  try {
    const ur = await pool.query('SELECT * FROM unlock_requests WHERE id = $1', [req.params.id]);
    if (!ur.rows.length) return res.status(404).json({ error: 'Request not found' });
    if (ur.rows[0].status !== 'pending') return res.status(400).json({ error: 'Request already reviewed' });

    const newStatus = action === 'approve' ? 'approved' : 'denied';
    await pool.query(
      `UPDATE unlock_requests SET status = $1, reviewed_by = $2, reviewed_at = NOW(), review_notes = $3
       WHERE id = $4`,
      [newStatus, req.session.adminId, review_notes || null, req.params.id]
    );

    // If approved, send unlock command to the device
    if (action === 'approve') {
      await pool.query(
        `INSERT INTO device_commands (device_id, command, lock_message, issued_by, status)
         VALUES ($1, 'unlock', 'Unlock request approved', $2, 'pending')`,
        [ur.rows[0].device_id, req.session.adminId]
      );
      await pool.query(
        `UPDATE enrolled_devices SET lock_status = 'unlocked', override_pin = NULL,
         override_pin_expires_at = NULL, override_pin_attempts = 0, updated_at = NOW()
         WHERE id = $1`,
        [ur.rows[0].device_id]
      );
    }

    await auditLog(req, `unlock_request_${action}`, 'device', ur.rows[0].device_id, { request_id: req.params.id, review_notes });
    res.json({ success: true, status: newStatus });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Update Device ───────────────────────────────────────────────────────────
router.put('/admin/api/devices/:id', requireAdmin, async (req, res) => {
  const { notes, customer_id, hostname, payment_plan_id } = req.body;
  try {
    const r = await pool.query(
      `UPDATE enrolled_devices SET
         notes = COALESCE($1, notes), customer_id = COALESCE($2, customer_id),
         hostname = COALESCE($3, hostname), payment_plan_id = COALESCE($4, payment_plan_id),
         updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [notes || null, customer_id || null, hostname || null, payment_plan_id || null, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    await auditLog(req, 'update_device', 'device', req.params.id, req.body);
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Unenroll Device ─────────────────────────────────────────────────────────
router.delete('/admin/api/devices/:id', requireAdmin, async (req, res) => {
  try {
    // First unlock if locked
    await pool.query(
      `UPDATE enrolled_devices SET lock_status = 'unlocked', unenrolled_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [req.params.id]
    );
    await pool.query(
      `INSERT INTO device_commands (device_id, command, issued_by, status)
       VALUES ($1, 'unlock', $2, 'pending')`,
      [req.params.id, req.session.adminId]
    );
    await auditLog(req, 'unenroll_device', 'device', req.params.id, {});
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Bulk Operations ─────────────────────────────────────────────────────────
router.post('/admin/api/devices/bulk-command', requireAdmin, async (req, res) => {
  const { device_ids, command, lock_message } = req.body;
  if (!Array.isArray(device_ids) || !device_ids.length) {
    return res.status(400).json({ error: 'device_ids array required' });
  }
  if (!['lock', 'unlock'].includes(command)) {
    return res.status(400).json({ error: 'Bulk command must be lock or unlock' });
  }

  try {
    const results = [];
    for (const deviceId of device_ids) {
      const r = await pool.query(
        `INSERT INTO device_commands (device_id, command, lock_message, issued_by, status)
         VALUES ($1, $2, $3, $4, 'pending') RETURNING id`,
        [deviceId, command, lock_message || null, req.session.adminId]
      );
      const newStatus = command === 'lock' ? 'locked' : 'unlocked';
      await pool.query(
        `UPDATE enrolled_devices SET lock_status = $1, updated_at = NOW() WHERE id = $2`,
        [newStatus, deviceId]
      );
      results.push({ device_id: deviceId, command_id: r.rows[0].id });
    }
    await auditLog(req, `bulk_${command}`, 'device', null, { device_ids, count: device_ids.length });
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Device Audit Log ────────────────────────────────────────────────────────
router.get('/admin/api/devices/:id/audit', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT dal.*, au.name as admin_name
       FROM device_audit_log dal LEFT JOIN admin_users au ON au.id = dal.admin_id
       WHERE dal.device_id = $1 ORDER BY dal.created_at DESC LIMIT 100`,
      [req.params.id]
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Device Stats / Dashboard ────────────────────────────────────────────────
router.get('/admin/api/device-stats', requireAdmin, async (req, res) => {
  try {
    const stats = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE unenrolled_at IS NULL) as total_active,
        COUNT(*) FILTER (WHERE lock_status = 'locked' AND unenrolled_at IS NULL) as locked,
        COUNT(*) FILTER (WHERE lock_status = 'unlocked' AND unenrolled_at IS NULL) as unlocked,
        COUNT(*) FILTER (WHERE lock_status = 'wiped' AND unenrolled_at IS NULL) as wiped,
        COUNT(*) FILTER (WHERE last_seen_at > NOW() - INTERVAL '10 minutes' AND unenrolled_at IS NULL) as online,
        COUNT(*) FILTER (WHERE last_seen_at <= NOW() - INTERVAL '10 minutes' AND unenrolled_at IS NULL) as offline,
        COUNT(*) FILTER (WHERE platform = 'android' AND unenrolled_at IS NULL) as android_count,
        COUNT(*) FILTER (WHERE platform = 'linux' AND unenrolled_at IS NULL) as linux_count,
        COUNT(*) FILTER (WHERE platform = 'windows' AND unenrolled_at IS NULL) as windows_count
      FROM enrolled_devices
    `);
    const pendingRequests = await pool.query(
      `SELECT COUNT(*) as count FROM unlock_requests WHERE status = 'pending'`
    );
    res.json({
      ...stats.rows[0],
      pending_unlock_requests: parseInt(pendingRequests.rows[0].count)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Enrollment Tokens ───────────────────────────────────────────────────────
router.post('/admin/api/enrollment-tokens', requireAdmin, async (req, res) => {
  const { customer_id, label, max_devices, platform } = req.body;
  const token = generateToken(24);
  try {
    const r = await pool.query(
      `INSERT INTO enrollment_tokens (token, customer_id, label, max_devices, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [token, customer_id || null, label || null, parseInt(max_devices) || 1, req.session.adminId]
    );
    await auditLog(req, 'create_enrollment_token', 'device', null, { token_id: r.rows[0].id, customer_id, label });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/admin/api/enrollment-tokens', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT et.*, c.name as customer_name, au.name as created_by_name,
        (SELECT COUNT(*) FROM enrolled_devices WHERE enrollment_token = et.token AND unenrolled_at IS NULL) as devices_enrolled
       FROM enrollment_tokens et
       LEFT JOIN customers c ON c.id = et.customer_id
       LEFT JOIN admin_users au ON au.id = et.created_by
       ORDER BY et.created_at DESC`
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/admin/api/enrollment-tokens/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM enrollment_tokens WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Installer Downloads ─────────────────────────────────────────────────────
router.get('/admin/api/installers/:platform', requireAdmin, (req, res) => {
  const platform = req.params.platform;
  const siteUrl = process.env.SITE_URL || process.env.RENDER_EXTERNAL_URL || 'https://scarlet-technical.onrender.com';
  const token = req.query.token || '__TOKEN__';

  if (platform === 'linux') {
    const templatePath = path.join(__dirname, '../../public/agents/linux/installer-template.sh');
    if (!fs.existsSync(templatePath)) return res.status(404).json({ error: 'Linux installer template not found' });
    let script = fs.readFileSync(templatePath, 'utf8');
    script = script.replace(/__SERVER_URL__/g, siteUrl).replace(/__TOKEN__/g, token);
    res.set('Content-Disposition', `attachment; filename="scarlet-agent-install-${token.substring(0,8)}.sh"`);
    res.type('text/plain').send(script);
  } else if (platform === 'windows') {
    const templatePath = path.join(__dirname, '../../public/agents/windows/installer-template.ps1');
    if (!fs.existsSync(templatePath)) return res.status(404).json({ error: 'Windows installer template not found' });
    let script = fs.readFileSync(templatePath, 'utf8');
    script = script.replace(/__SERVER_URL__/g, siteUrl).replace(/__TOKEN__/g, token);
    res.set('Content-Disposition', `attachment; filename="scarlet-agent-install-${token.substring(0,8)}.ps1"`);
    res.type('text/plain').send(script);
  } else if (platform === 'android') {
    const apkPath = path.join(__dirname, '../../public/agents/android/releases/scarlet-lock-agent.apk');
    if (!fs.existsSync(apkPath)) return res.status(404).json({ error: 'Android APK not found' });
    res.download(apkPath, 'scarlet-lock-agent.apk');
  } else {
    res.status(400).json({ error: 'Unsupported platform. Use: linux, android, windows' });
  }
});

module.exports = router;
