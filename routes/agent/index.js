/**
 * Device Agent API — enrollment, heartbeat, command acknowledgement, override PIN, unlock requests.
 *
 * Protocol (all agents):
 *   POST /api/agent/enroll     → { enrollment_token, device_uuid, hostname, os_info, platform, agent_version }
 *   POST /api/agent/heartbeat  → { device_token, device_uuid, current_status }
 *   POST /api/agent/command-ack → { device_token, device_uuid, command_id, result, new_lock_status }
 *   POST /api/agent/verify-pin → { device_token, device_uuid, pin }
 *   POST /api/agent/unlock-request → { device_token, device_uuid, reason, contact_info }
 *   GET  /api/agent/payment-url/:device_uuid → redirect to portal payment page
 */
const { Router } = require('express');
const crypto = require('crypto');
const { pool } = require('../../lib/db');
const logger = require('../../lib/logger');

const router = Router();

// ─── Helper: look up device by token + uuid ─────────────────────────────────
async function findDevice(device_token, device_uuid) {
  if (!device_token || !device_uuid) return null;
  const r = await pool.query(
    `SELECT d.*, c.name as customer_name, c.email as customer_email, c.phone as customer_phone
     FROM enrolled_devices d LEFT JOIN customers c ON c.id = d.customer_id
     WHERE d.device_token = $1 AND d.device_uuid = $2 AND d.unenrolled_at IS NULL`,
    [device_token, device_uuid]
  );
  return r.rows[0] || null;
}

// ─── Enroll Device ───────────────────────────────────────────────────────────
router.post('/api/agent/enroll', async (req, res) => {
  const { enrollment_token, device_uuid, hostname, os_info, platform, agent_version } = req.body;
  if (!enrollment_token || !device_uuid) {
    return res.status(400).json({ error: 'enrollment_token and device_uuid required' });
  }

  try {
    // Validate enrollment token
    const tokResult = await pool.query(
      `SELECT * FROM enrollment_tokens WHERE token = $1 AND (expires_at IS NULL OR expires_at > NOW())`,
      [enrollment_token]
    );
    if (!tokResult.rows.length) {
      // Also check device_enrollment_tokens (legacy table)
      const legacyResult = await pool.query(
        `SELECT * FROM device_enrollment_tokens WHERE token = $1 AND (expires_at IS NULL OR expires_at > NOW()) AND used_at IS NULL`,
        [enrollment_token]
      );
      if (!legacyResult.rows.length) {
        return res.status(401).json({ error: 'Invalid or expired enrollment token' });
      }
      // Use legacy token
      const lt = legacyResult.rows[0];
      return enrollWithToken(res, {
        tokenId: lt.id,
        tokenTable: 'device_enrollment_tokens',
        customerId: lt.customer_id,
        repairId: lt.repair_id,
        paymentPlanId: lt.payment_plan_id,
        device_uuid, hostname, os_info, platform, agent_version
      });
    }

    const et = tokResult.rows[0];

    // Check max devices
    const used = await pool.query(
      `SELECT COUNT(*) FROM enrolled_devices WHERE enrollment_token = $1 AND unenrolled_at IS NULL`,
      [enrollment_token]
    );
    if (parseInt(used.rows[0].count) >= (et.max_devices || 1)) {
      return res.status(403).json({ error: 'Token device limit reached' });
    }

    return enrollWithToken(res, {
      tokenId: et.id,
      tokenTable: 'enrollment_tokens',
      customerId: et.customer_id,
      repairId: null,
      paymentPlanId: null,
      device_uuid, hostname, os_info, platform, agent_version
    });
  } catch (err) {
    logger.error({ err }, 'Device enrollment error');
    res.status(500).json({ error: 'Enrollment failed' });
  }
});

async function enrollWithToken(res, opts) {
  const { tokenId, tokenTable, customerId, repairId, paymentPlanId, device_uuid, hostname, os_info, platform, agent_version } = opts;

  // Check if device_uuid already enrolled
  const existing = await pool.query(
    `SELECT id, device_token FROM enrolled_devices WHERE device_uuid = $1 AND unenrolled_at IS NULL`,
    [device_uuid]
  );
  if (existing.rows.length) {
    // Re-enroll: return existing token
    return res.json({
      device_id: existing.rows[0].id,
      device_token: existing.rows[0].device_token,
      poll_interval: 300,
      message: 'Device already enrolled'
    });
  }

  // Generate secure device token
  const device_token = crypto.randomBytes(32).toString('hex');

  const r = await pool.query(
    `INSERT INTO enrolled_devices
       (device_uuid, enrollment_token, device_token, customer_id, repair_id, payment_plan_id,
        hostname, os_info, platform, agent_version, enrolled_at, last_seen_at, online_status)
     VALUES ($1, (SELECT token FROM ${tokenTable} WHERE id = $2), $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW(), 'online')
     RETURNING id`,
    [device_uuid, tokenId, device_token, customerId, repairId || null, paymentPlanId || null,
     hostname || 'Unknown', os_info || null, platform || 'unknown', agent_version || '1.0.0']
  );

  // Mark token as used (for legacy tokens)
  if (tokenTable === 'device_enrollment_tokens') {
    await pool.query(`UPDATE device_enrollment_tokens SET used_at = NOW(), device_id = $1 WHERE id = $2`, [r.rows[0].id, tokenId]);
  }

  logger.info({ deviceId: r.rows[0].id, device_uuid, hostname, platform }, 'Device enrolled');

  res.json({
    device_id: r.rows[0].id,
    device_token: device_token,
    poll_interval: 300
  });
}

// ─── Heartbeat ───────────────────────────────────────────────────────────────
router.post('/api/agent/heartbeat', async (req, res) => {
  const { device_token, device_uuid, current_status, hostname, ip_address, os_info,
          uptime, cpu_usage, memory_usage, disk_usage, battery, agent_version } = req.body;

  if (!device_token || !device_uuid) {
    return res.status(400).json({ error: 'device_token and device_uuid required' });
  }

  try {
    const device = await findDevice(device_token, device_uuid);
    if (!device) return res.status(401).json({ error: 'Device not found or unenrolled' });

    // Update last seen + telemetry
    await pool.query(
      `UPDATE enrolled_devices SET
         last_seen_at = NOW(), online_status = 'online',
         hostname = COALESCE($2, hostname), ip_address = COALESCE($3, ip_address),
         os_info = COALESCE($4, os_info), uptime = COALESCE($5, uptime),
         cpu_usage = COALESCE($6, cpu_usage), memory_usage = COALESCE($7, memory_usage),
         disk_usage = COALESCE($8, disk_usage), battery = COALESCE($9, battery),
         agent_version = COALESCE($10, agent_version), updated_at = NOW()
       WHERE id = $1`,
      [device.id, hostname || null, ip_address || req.ip || null, os_info || null,
       uptime || null, cpu_usage || null, memory_usage || null,
       disk_usage || null, battery || null, agent_version || null]
    );

    // Get oldest pending command
    const cmdResult = await pool.query(
      `SELECT id, command as action, lock_message as message, params
       FROM device_commands
       WHERE device_id = $1 AND status = 'pending'
       ORDER BY created_at ASC LIMIT 1`,
      [device.id]
    );

    let command = null;
    if (cmdResult.rows.length) {
      command = {
        id: String(cmdResult.rows[0].id),
        action: cmdResult.rows[0].action,
        message: cmdResult.rows[0].message || null
      };
      // Mark as sent
      await pool.query(
        `UPDATE device_commands SET status = 'acknowledged', acknowledged_at = NOW() WHERE id = $1`,
        [cmdResult.rows[0].id]
      );
    }

    // Determine lock message
    let lockMessage = null;
    if (device.lock_status === 'locked') {
      const lastLockCmd = await pool.query(
        `SELECT lock_message FROM device_commands WHERE device_id = $1 AND command = 'lock'
         ORDER BY created_at DESC LIMIT 1`,
        [device.id]
      );
      lockMessage = lastLockCmd.rows.length ? lastLockCmd.rows[0].lock_message : null;
    }

    // Build payment URL for lock screen
    const siteUrl = process.env.SITE_URL || process.env.RENDER_EXTERNAL_URL || 'https://scarlet-technical.onrender.com';
    const paymentUrl = device.customer_id ? `${siteUrl}/portal/pay?device=${device.device_uuid}` : `${siteUrl}/portal/`;

    res.json({
      lock_status: device.lock_status,
      lock_message: lockMessage || 'This device has been locked by Scarlet Technical. Please contact support or make a payment to unlock.',
      command: command,
      poll_interval: 300,
      payment_url: paymentUrl,
      support_phone: process.env.SUPPORT_PHONE || '(765) 555-0100',
      support_url: siteUrl
    });
  } catch (err) {
    logger.error({ err }, 'Heartbeat error');
    res.status(500).json({ error: 'Heartbeat failed' });
  }
});

// ─── Command Acknowledgement ─────────────────────────────────────────────────
router.post('/api/agent/command-ack', async (req, res) => {
  const { device_token, device_uuid, command_id, result, new_lock_status } = req.body;

  if (!device_token || !device_uuid || !command_id) {
    return res.status(400).json({ error: 'device_token, device_uuid, and command_id required' });
  }

  try {
    const device = await findDevice(device_token, device_uuid);
    if (!device) return res.status(401).json({ error: 'Device not found' });

    await pool.query(
      `UPDATE device_commands SET status = 'executed', executed_at = NOW()
       WHERE id = $1 AND device_id = $2`,
      [command_id, device.id]
    );

    // Update device lock status if changed
    if (new_lock_status && ['unlocked', 'locked', 'wiped'].includes(new_lock_status)) {
      await pool.query(
        `UPDATE enrolled_devices SET lock_status = $1, updated_at = NOW() WHERE id = $2`,
        [new_lock_status, device.id]
      );
    }

    res.json({ success: true });
  } catch (err) {
    logger.error({ err, command_id }, 'Command ack error');
    res.status(500).json({ error: 'Ack failed' });
  }
});

// ─── Override PIN Verification (entered on lock screen) ──────────────────────
router.post('/api/agent/verify-pin', async (req, res) => {
  const { device_token, device_uuid, pin } = req.body;

  if (!device_token || !device_uuid || !pin) {
    return res.status(400).json({ error: 'device_token, device_uuid, and pin required' });
  }

  try {
    const device = await findDevice(device_token, device_uuid);
    if (!device) return res.status(401).json({ error: 'Device not found' });

    // Check PIN attempt limit (max 5 attempts)
    if (device.override_pin_attempts >= 5) {
      return res.status(429).json({ error: 'Too many PIN attempts. Contact support.' });
    }

    // Increment attempt counter
    await pool.query(
      `UPDATE enrolled_devices SET override_pin_attempts = COALESCE(override_pin_attempts, 0) + 1 WHERE id = $1`,
      [device.id]
    );

    // Validate PIN
    if (!device.override_pin || !device.override_pin_expires_at) {
      return res.status(400).json({ error: 'No override PIN set for this device. Contact support.' });
    }

    if (new Date(device.override_pin_expires_at) < new Date()) {
      return res.status(400).json({ error: 'Override PIN has expired. Contact support for a new one.' });
    }

    // Constant-time comparison
    const valid = crypto.timingSafeEqual(
      Buffer.from(pin.toString().padEnd(10)),
      Buffer.from(device.override_pin.toString().padEnd(10))
    );

    if (!valid) {
      const remaining = 5 - (device.override_pin_attempts + 1);
      return res.status(403).json({
        error: `Invalid PIN. ${remaining} attempt(s) remaining.`,
        attempts_remaining: remaining
      });
    }

    // PIN is valid! Unlock the device
    await pool.query(
      `UPDATE enrolled_devices SET
         lock_status = 'unlocked', override_pin = NULL, override_pin_expires_at = NULL,
         override_pin_attempts = 0, updated_at = NOW()
       WHERE id = $1`,
      [device.id]
    );

    // Cancel any pending lock commands
    await pool.query(
      `UPDATE device_commands SET status = 'executed', executed_at = NOW()
       WHERE device_id = $1 AND status IN ('pending', 'acknowledged')`,
      [device.id]
    );

    // Audit log
    await pool.query(
      `INSERT INTO device_audit_log (device_id, action, details) VALUES ($1, 'pin_unlock', $2)`,
      [device.id, JSON.stringify({ method: 'override_pin', ip: req.ip })]
    );

    logger.info({ deviceId: device.id, device_uuid }, 'Device unlocked via override PIN');

    res.json({ success: true, message: 'Device unlocked successfully.' });
  } catch (err) {
    logger.error({ err }, 'PIN verification error');
    res.status(500).json({ error: 'Verification failed' });
  }
});

// ─── Unlock Request (customer submits from lock screen) ──────────────────────
router.post('/api/agent/unlock-request', async (req, res) => {
  const { device_token, device_uuid, reason, contact_info } = req.body;

  if (!device_token || !device_uuid) {
    return res.status(400).json({ error: 'device_token and device_uuid required' });
  }

  try {
    const device = await findDevice(device_token, device_uuid);
    if (!device) return res.status(401).json({ error: 'Device not found' });

    // Rate limit: max 3 pending requests per device
    const pending = await pool.query(
      `SELECT COUNT(*) FROM unlock_requests WHERE device_id = $1 AND status = 'pending'`,
      [device.id]
    );
    if (parseInt(pending.rows[0].count) >= 3) {
      return res.status(429).json({
        error: 'You already have pending unlock requests. Please wait for a response or contact support.'
      });
    }

    const r = await pool.query(
      `INSERT INTO unlock_requests (device_id, customer_id, reason, contact_info)
       VALUES ($1, $2, $3, $4) RETURNING id, created_at`,
      [device.id, device.customer_id, reason || 'Unlock requested from device', contact_info || null]
    );

    logger.info({ deviceId: device.id, requestId: r.rows[0].id }, 'Unlock request submitted');

    res.json({
      success: true,
      request_id: r.rows[0].id,
      message: 'Unlock request submitted. A technician will review it shortly.'
    });
  } catch (err) {
    logger.error({ err }, 'Unlock request error');
    res.status(500).json({ error: 'Request failed' });
  }
});

// ─── Payment URL redirect (opens portal payment page) ───────────────────────
router.get('/api/agent/payment-url/:device_uuid', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT customer_id FROM enrolled_devices WHERE device_uuid = $1 AND unenrolled_at IS NULL`,
      [req.params.device_uuid]
    );
    const siteUrl = process.env.SITE_URL || process.env.RENDER_EXTERNAL_URL || 'https://scarlet-technical.onrender.com';
    if (r.rows.length && r.rows[0].customer_id) {
      res.redirect(`${siteUrl}/portal/?device=${req.params.device_uuid}`);
    } else {
      res.redirect(`${siteUrl}/portal/`);
    }
  } catch (err) {
    const siteUrl = process.env.SITE_URL || process.env.RENDER_EXTERNAL_URL || 'https://scarlet-technical.onrender.com';
    res.redirect(`${siteUrl}/portal/`);
  }
});

module.exports = router;
