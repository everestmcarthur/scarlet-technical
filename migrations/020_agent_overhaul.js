module.exports = {
  name: '020_agent_overhaul',
  up: async (client) => {
    async function safeExec(sql, label) {
      const trimmed = sql.trim();
      if (!trimmed || trimmed.startsWith('--')) return;
      try {
        await client.query('SAVEPOINT sp');
        await client.query(trimmed);
        await client.query('RELEASE SAVEPOINT sp');
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT sp');
        console.log(`  [020 warn] ${(label || trimmed.substring(0, 60))}: ${err.message}`);
      }
    }

    // Device token
    await safeExec(`ALTER TABLE enrolled_devices ADD COLUMN IF NOT EXISTS device_token VARCHAR(255) UNIQUE`);

    // Override PIN
    await safeExec(`ALTER TABLE enrolled_devices ADD COLUMN IF NOT EXISTS override_pin VARCHAR(10)`);
    await safeExec(`ALTER TABLE enrolled_devices ADD COLUMN IF NOT EXISTS override_pin_expires_at TIMESTAMPTZ`);
    await safeExec(`ALTER TABLE enrolled_devices ADD COLUMN IF NOT EXISTS override_pin_attempts INTEGER DEFAULT 0`);

    // Heartbeat data
    await safeExec(`ALTER TABLE enrolled_devices ADD COLUMN IF NOT EXISTS ip_address VARCHAR(100)`);
    await safeExec(`ALTER TABLE enrolled_devices ADD COLUMN IF NOT EXISTS uptime TEXT`);
    await safeExec(`ALTER TABLE enrolled_devices ADD COLUMN IF NOT EXISTS cpu_usage NUMERIC`);
    await safeExec(`ALTER TABLE enrolled_devices ADD COLUMN IF NOT EXISTS memory_usage NUMERIC`);
    await safeExec(`ALTER TABLE enrolled_devices ADD COLUMN IF NOT EXISTS disk_usage NUMERIC`);
    await safeExec(`ALTER TABLE enrolled_devices ADD COLUMN IF NOT EXISTS battery NUMERIC`);

    // Device commands
    await safeExec(`ALTER TABLE device_commands ADD COLUMN IF NOT EXISTS params JSONB DEFAULT '{}'`);

    // Enrollment tokens table
    await safeExec(`CREATE TABLE IF NOT EXISTS enrollment_tokens (
      id SERIAL PRIMARY KEY,
      token VARCHAR(255) UNIQUE NOT NULL,
      customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
      label VARCHAR(255),
      max_devices INTEGER DEFAULT 1,
      created_by INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
      expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 days',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`, 'create enrollment_tokens');

    // Unlock requests
    await safeExec(`CREATE TABLE IF NOT EXISTS unlock_requests (
      id SERIAL PRIMARY KEY,
      device_id INTEGER NOT NULL REFERENCES enrolled_devices(id) ON DELETE CASCADE,
      customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
      reason TEXT,
      contact_info VARCHAR(255),
      status VARCHAR(50) NOT NULL DEFAULT 'pending',
      reviewed_by INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
      reviewed_at TIMESTAMPTZ,
      review_notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`, 'create unlock_requests');

    await safeExec(`CREATE INDEX IF NOT EXISTS idx_unlock_requests_device ON unlock_requests(device_id, status)`);
    await safeExec(`CREATE INDEX IF NOT EXISTS idx_unlock_requests_status ON unlock_requests(status, created_at DESC)`);

    // Generate tokens for existing devices
    await safeExec(`UPDATE enrolled_devices SET device_token = encode(gen_random_bytes(24), 'hex') WHERE device_token IS NULL`);

    console.log('  Migration 020 complete');
  }
};
