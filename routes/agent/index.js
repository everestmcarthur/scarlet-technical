/**
 * Device agent API — enrollment, heartbeat, command acknowledgement.
 * Called by Android and Linux agents installed on enrolled devices.
 */
const { Router } = require('express');
const { pool } = require('../../lib/db');
const logger = require('../../lib/logger');

const router = Router();

// ─── Enroll Device ───────────────────────────────────────────────────────────
router.post('/api/agent/enroll', async (req, res) => {
  const { token, hostname, platform, os_version, device_info } = req.body;
  if (!token || !hostname) return res.status(400).json({ error: 'token and hostname required' });
  try {
    // Validate enrollment token
    const tokenResult = await pool.query(
      'SELECT * FROM enrollment_tokens WHERE token=$1 AND (expires_at IS NULL OR expires_at > NOW())',
      [token]
    );
    if (!tokenResult.rows.length) return res.status(401).json({ error: 'Invalid or expired token' });
    const et = tokenResult.rows[0];

    // Check max devices
    const used = await pool.query(
      'SELECT COUNT(*) FROM enrolled_devices WHERE enrollment_token_id=$1 AND unenrolled_at IS NULL',
      [et.id]
    );
    if (parseInt(used.rows[0].count) >= (et.max_devices || 1)) {
      return res.status(403).json({ error: 'Token device limit reached' });
    }

    // Register device
    const r = await pool.query(
      `INSERT INTO enrolled_devices (enrollment_token_id, customer_id, hostname, platform, os_version, device_info, enrolled_at, last_seen_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW()) RETURNING *`,
      [et.id, et.customer_id, hostname, platform || 'unknown', os_version || null, JSON.stringify(device_info || {})]
    );
    logger.info({ deviceId: r.rows[0].id, hostname, platform }, 'Device enrolled');
    res.json({ device_id: r.rows[0].id, poll_interval: 300 });
  } catch (err) {
    logger.error({ err }, 'Device enrollment error');
    res.status(500).json({ error: 'Enrollment failed' });
  }
});

// ─── Heartbeat (device polls this every 5 minutes) ──────────────────────────
router.post('/api/agent/heartbeat', async (req, res) => {
  const { device_id, hostname, ip_address, os_version, uptime, cpu_usage, memory_usage, disk_usage, battery, agent_version } = req.body;
  if (!device_id) return res.status(400).json({ error: 'device_id required' });
  try {
    // Update device info + last seen
    await pool.query(
      `UPDATE enrolled_devices SET last_seen_at=NOW(), online_status='online',
       hostname=COALESCE($2,hostname), ip_address=$3, os_version=COALESCE($4,os_version),
       uptime=$5, cpu_usage=$6, memory_usage=$7, disk_usage=$8, battery=$9, agent_version=$10,
       updated_at=NOW()
       WHERE id=$1`,
      [device_id, hostname || null, ip_address || null, os_version || null,
       uptime || null, cpu_usage || null, memory_usage || null, disk_usage || null,
       battery || null, agent_version || null]
    );

    // Check for pending commands
    const commands = await pool.query(
      `SELECT id, command, params FROM device_commands
       WHERE device_id=$1 AND status='pending' ORDER BY created_at ASC LIMIT 5`,
      [device_id]
    );

    // Mark commands as sent
    if (commands.rows.length) {
      const ids = commands.rows.map(c => c.id);
      await pool.query(
        `UPDATE device_commands SET status='sent', sent_at=NOW() WHERE id = ANY($1)`,
        [ids]
      );
    }

    res.json({
      commands: commands.rows,
      poll_interval: 300, // 5 minutes
    });
  } catch (err) {
    logger.error({ err, device_id }, 'Heartbeat error');
    res.status(500).json({ error: 'Heartbeat failed' });
  }
});

// ─── Command Acknowledgement ─────────────────────────────────────────────────
router.post('/api/agent/command-ack', async (req, res) => {
  const { device_id, command_id, status, result, error_message } = req.body;
  if (!device_id || !command_id) return res.status(400).json({ error: 'device_id and command_id required' });
  const validStatus = ['completed', 'failed', 'rejected'];
  if (!validStatus.includes(status)) return res.status(400).json({ error: `status must be one of: ${validStatus.join(', ')}` });
  try {
    await pool.query(
      `UPDATE device_commands SET status=$1, result=$2, error_message=$3, completed_at=NOW()
       WHERE id=$4 AND device_id=$5`,
      [status, result || null, error_message || null, command_id, device_id]
    );
    res.json({ success: true });
  } catch (err) {
    logger.error({ err, device_id, command_id }, 'Command ack error');
    res.status(500).json({ error: 'Ack failed' });
  }
});

module.exports = router;
