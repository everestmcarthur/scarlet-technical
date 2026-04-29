module.exports = {
  name: '016_admin_full_control',
  up: async (client) => {
    // 1. Add status column to customers (active/suspended)
    await client.query(`
      ALTER TABLE customers
        ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active'
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS customers_status_idx ON customers (status)
    `);

    // 2. Add suspended_at / suspended_reason to customers
    await client.query(`
      ALTER TABLE customers
        ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS suspended_reason TEXT,
        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ
    `);

    // 3. Business settings table (key-value store for admin-configurable settings)
    await client.query(`
      CREATE TABLE IF NOT EXISTS business_settings (
        id SERIAL PRIMARY KEY,
        key VARCHAR(100) NOT NULL UNIQUE,
        value TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        updated_by INTEGER REFERENCES admin_users(id)
      )
    `);

    // 4. Seed default business settings
    await client.query(`
      INSERT INTO business_settings (key, value) VALUES
        ('business_name', 'Scarlet Technical'),
        ('business_address', 'Muncie, Indiana'),
        ('business_phone', ''),
        ('business_email', ''),
        ('late_fee_amount', '10.00'),
        ('late_fee_grace_days', '3'),
        ('lockout_days_overdue', '14'),
        ('reminder_schedule', '3,0,-3,-7')
      ON CONFLICT (key) DO NOTHING
    `);
  },
  down: async (client) => {
    await client.query(`DROP TABLE IF EXISTS business_settings`);
    await client.query(`ALTER TABLE customers DROP COLUMN IF EXISTS status, DROP COLUMN IF EXISTS suspended_at, DROP COLUMN IF EXISTS suspended_reason, DROP COLUMN IF EXISTS deleted_at`);
  }
};
