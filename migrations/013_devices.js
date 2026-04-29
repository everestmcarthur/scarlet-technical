module.exports = {
  name: '013_devices',
  up: async (client) => {
    // Enrolled devices
    await client.query(`
      CREATE TABLE IF NOT EXISTS enrolled_devices (
        id SERIAL PRIMARY KEY,
        device_uuid VARCHAR(255) UNIQUE NOT NULL,
        enrollment_token VARCHAR(255) UNIQUE NOT NULL,
        customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
        repair_id INTEGER REFERENCES repairs(id) ON DELETE SET NULL,
        payment_plan_id INTEGER REFERENCES payment_plans(id) ON DELETE SET NULL,
        platform VARCHAR(50) NOT NULL CHECK (platform IN ('windows','android','linux')),
        hostname VARCHAR(255),
        os_info TEXT,
        agent_version VARCHAR(50),
        lock_status VARCHAR(50) NOT NULL DEFAULT 'unlocked' CHECK (lock_status IN ('unlocked','locked','wiped')),
        online_status VARCHAR(50) NOT NULL DEFAULT 'offline' CHECK (online_status IN ('online','offline')),
        last_seen_at TIMESTAMPTZ,
        enrolled_at TIMESTAMPTZ DEFAULT NOW(),
        unenrolled_at TIMESTAMPTZ,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_enrolled_devices_customer ON enrolled_devices(customer_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_enrolled_devices_status ON enrolled_devices(lock_status, online_status)`);

    // Command queue
    await client.query(`
      CREATE TABLE IF NOT EXISTS device_commands (
        id SERIAL PRIMARY KEY,
        device_id INTEGER NOT NULL REFERENCES enrolled_devices(id) ON DELETE CASCADE,
        command VARCHAR(50) NOT NULL CHECK (command IN ('lock','unlock','wipe')),
        status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','acknowledged','executed','failed')),
        issued_by INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
        issued_at TIMESTAMPTZ DEFAULT NOW(),
        acknowledged_at TIMESTAMPTZ,
        executed_at TIMESTAMPTZ,
        lock_message TEXT,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_device_commands_device ON device_commands(device_id, status)`);

    // Audit log
    await client.query(`
      CREATE TABLE IF NOT EXISTS device_audit_log (
        id SERIAL PRIMARY KEY,
        device_id INTEGER REFERENCES enrolled_devices(id) ON DELETE SET NULL,
        admin_id INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
        action VARCHAR(100) NOT NULL,
        details JSONB DEFAULT '{}',
        ip_address VARCHAR(100),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_device_audit_device ON device_audit_log(device_id, created_at DESC)`);

    // Pre-enrollment tokens (admin generates, technician uses once)
    await client.query(`
      CREATE TABLE IF NOT EXISTS device_enrollment_tokens (
        id SERIAL PRIMARY KEY,
        token VARCHAR(255) UNIQUE NOT NULL,
        customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
        repair_id INTEGER REFERENCES repairs(id) ON DELETE SET NULL,
        payment_plan_id INTEGER REFERENCES payment_plans(id) ON DELETE SET NULL,
        platform VARCHAR(50) NOT NULL,
        created_by INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
        used_at TIMESTAMPTZ,
        device_id INTEGER REFERENCES enrolled_devices(id) ON DELETE SET NULL,
        expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 days',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
  },
  down: async (client) => {
    await client.query(`DROP TABLE IF EXISTS device_audit_log`);
    await client.query(`DROP TABLE IF EXISTS device_commands`);
    await client.query(`DROP TABLE IF EXISTS device_enrollment_tokens`);
    await client.query(`DROP TABLE IF EXISTS enrolled_devices`);
  }
};
