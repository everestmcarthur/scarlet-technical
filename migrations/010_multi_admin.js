module.exports = {
  name: '010_multi_admin',
  up: async (client) => {
    // Add role and display_name to admin_users
    await client.query(`
      ALTER TABLE admin_users
        ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'admin'
          CHECK (role IN ('admin','technician')),
        ADD COLUMN IF NOT EXISTS display_name VARCHAR(255),
        ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE
    `);

    // Admin activity audit log
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_audit_log (
        id SERIAL PRIMARY KEY,
        admin_id INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
        admin_name VARCHAR(255),
        action VARCHAR(100) NOT NULL,
        entity_type VARCHAR(100),
        entity_id INTEGER,
        details JSONB,
        ip_address VARCHAR(50),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS audit_log_admin_idx ON admin_audit_log (admin_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS audit_log_created_idx ON admin_audit_log (created_at DESC)
    `);
  }
};
