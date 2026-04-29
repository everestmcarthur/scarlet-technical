/**
 * Admin device management — enrolled devices, commands, enrollment tokens, installer downloads.
 */
const { Router } = require('express');
const path = require('path');
const fs = require('fs');
const { pool } = require('../../lib/db');
const { requireAdmin } = require('../../middleware/auth');
const { auditLog } = require('../../lib/audit');
const { generateToken } = require('../../lib/utils');
const logger = require('../../lib/logger');

const router = Router();

// ─── Device List ─────────────────────────────────────────────────────────────
router.get('/admin/api/devices', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT d.*, c.name as customer_name, c.email as customer_email
       FROM enrolled_devices d LEFT JOIN customers c ON c.id=d.customer_id
       WHERE d.unenrolled_at IS NULL ORDER BY d.enrolled_at DESC`
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Device Detail ───────────────────────────────────────────────────────────
router.get('/admin/api/devices/:id', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT d.*, c.name as customer_name, c.email as customer_email, c.phone as customer_phone
       FROM enrolled_devices d LEFT JOIN customers c ON c.id=d.customer_id WHERE d.id=$1`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    const commands = await pool.query(
      `SELECT * FROM device_commands WHERE device_id=$1 ORDER BY created_at DESC LIMIT 20`,
      [req.params.id]
    );
    res.json({ ...r.rows[0], commands: commands.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Send Command ────────────────────────────────────────────────────────────
router.post('/admin/api/devices/:id/command', requireAdmin, async (req, res) => {
  const { command, params: cmdParams } = req.body;
  const validCommands = ['lock', 'unlock', 'wipe', 'screenshot', 'restart', 'update_agent', 'custom'];
  if (!validCommands.includes(command)) return res.status(400).json({ error: `Invalid command. Valid: ${validCommands.join(', ')}` });
  try {
    const r = await pool.query(
      `INSERT INTO device_commands (device_id, command, params, issued_by) VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.params.id, command, JSON.stringify(cmdParams || {}), req.session.adminId]
    );
    if (command === 'lock') {
      await pool.query(`UPDATE enrolled_devices SET lock_status='locked', updated_at=NOW() WHERE id=$1`, [req.params.id]);
    } else if (command === 'unlock') {
      await pool.query(`UPDATE enrolled_devices SET lock_status='unlocked', updated_at=NOW() WHERE id=$1`, [req.params.id]);
    }
    await auditLog(req, `device_${command}`, 'device', req.params.id, { command });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Update Device ───────────────────────────────────────────────────────────
router.put('/admin/api/devices/:id', requireAdmin, async (req, res) => {
  const { notes, customer_id, hostname } = req.body;
  try {
    const r = await pool.query(
      `UPDATE enrolled_devices SET notes=COALESCE($1,notes), customer_id=COALESCE($2,customer_id),
       hostname=COALESCE($3,hostname), updated_at=NOW() WHERE id=$4 RETURNING *`,
      [notes || null, customer_id || null, hostname || null, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Unenroll Device ─────────────────────────────────────────────────────────
router.delete('/admin/api/devices/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('UPDATE enrolled_devices SET unenrolled_at=NOW(), updated_at=NOW() WHERE id=$1', [req.params.id]);
    await auditLog(req, 'unenroll_device', 'device', req.params.id, {});
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Enrollment Tokens ───────────────────────────────────────────────────────
router.post('/admin/api/enrollment-tokens', requireAdmin, async (req, res) => {
  const { customer_id, label, max_devices } = req.body;
  const token = generateToken(24);
  try {
    const r = await pool.query(
      `INSERT INTO enrollment_tokens (token, customer_id, label, max_devices, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [token, customer_id || null, label || null, parseInt(max_devices) || 1, req.session.adminId]
    );
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/admin/api/enrollment-tokens', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT et.*, c.name as customer_name,
        (SELECT COUNT(*) FROM enrolled_devices WHERE enrollment_token_id=et.id) as used_count
       FROM enrollment_tokens et LEFT JOIN customers c ON c.id=et.customer_id
       ORDER BY et.created_at DESC`
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Installer Downloads ─────────────────────────────────────────────────────
router.get('/admin/api/installers/:platform', requireAdmin, (req, res) => {
  const platform = req.params.platform;
  const siteUrl = process.env.SITE_URL || 'https://jarviscli.dev';

  if (platform === 'linux') {
    const scriptPath = path.join(__dirname, '../../public/agents/linux/install.sh');
    if (!fs.existsSync(scriptPath)) return res.status(404).json({ error: 'Linux installer not found' });
    let script = fs.readFileSync(scriptPath, 'utf8');
    script = script.replace(/__SERVER_URL__/g, siteUrl);
    res.type('text/plain').send(script);
  } else if (platform === 'android') {
    const apkPath = path.join(__dirname, '../../public/agents/android/app-release.apk');
    if (!fs.existsSync(apkPath)) return res.status(404).json({ error: 'Android APK not found' });
    res.download(apkPath, 'scarlet-agent.apk');
  } else if (platform === 'windows') {
    res.json({ message: 'Windows agent coming soon', download_url: null });
  } else {
    res.status(400).json({ error: 'Unsupported platform. Use: linux, android, windows' });
  }
});

module.exports = router;
