module.exports = {
  name: '015_feature_polish',
  up: async (db) => {
  // 1. Add service_type + preferred_datetime to repair_requests
  await db.query(`
    ALTER TABLE repair_requests
      ADD COLUMN IF NOT EXISTS service_type VARCHAR(20) DEFAULT 'in_person',
      ADD COLUMN IF NOT EXISTS preferred_datetime VARCHAR(200)
  `);

  // 2. Add first_payment fields to payment_plans
  await db.query(`
    ALTER TABLE payment_plans
      ADD COLUMN IF NOT EXISTS first_payment_required BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS first_payment_collected BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS first_payment_collected_at TIMESTAMPTZ
  `);

  // 3. Password reset tokens for customer forgot-password flow
  await db.query(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      token VARCHAR(128) NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // 4. Remote sessions table
  await db.query(`
    CREATE TABLE IF NOT EXISTS remote_sessions (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
      repair_id INTEGER REFERENCES repairs(id) ON DELETE SET NULL,
      technician_name VARCHAR(200),
      session_type VARCHAR(50) DEFAULT 'support',
      status VARCHAR(30) DEFAULT 'scheduled',
      scheduled_at TIMESTAMPTZ,
      started_at TIMESTAMPTZ,
      ended_at TIMESTAMPTZ,
      duration_minutes INTEGER,
      tool_used VARCHAR(100),
      session_code VARCHAR(100),
      issue_description TEXT,
      resolution_notes TEXT,
      customer_name VARCHAR(200),
      customer_email VARCHAR(200),
      customer_phone VARCHAR(50),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // 5. Add avatar_color to customers (for colored initials avatar)
  await db.query(`
    ALTER TABLE customers
      ADD COLUMN IF NOT EXISTS avatar_color VARCHAR(20) DEFAULT '#C41E3A'
  `);

  // 6. Add bio/title/avatar_url to admin_users for team profiles
  await db.query(`
    ALTER TABLE admin_users
      ADD COLUMN IF NOT EXISTS title VARCHAR(100),
      ADD COLUMN IF NOT EXISTS bio TEXT,
      ADD COLUMN IF NOT EXISTS phone VARCHAR(50),
      ADD COLUMN IF NOT EXISTS avatar_color VARCHAR(20) DEFAULT '#C41E3A'
  `);
  },
  down: async (db) => {
    await db.query(`DROP TABLE IF EXISTS remote_sessions`);
    await db.query(`DROP TABLE IF EXISTS password_reset_tokens`);
    await db.query(`ALTER TABLE payment_plans DROP COLUMN IF EXISTS first_payment_required, DROP COLUMN IF EXISTS first_payment_collected, DROP COLUMN IF EXISTS first_payment_collected_at`);
    await db.query(`ALTER TABLE repair_requests DROP COLUMN IF EXISTS service_type, DROP COLUMN IF EXISTS preferred_datetime`);
    await db.query(`ALTER TABLE customers DROP COLUMN IF EXISTS avatar_color`);
    await db.query(`ALTER TABLE admin_users DROP COLUMN IF EXISTS title, DROP COLUMN IF EXISTS bio, DROP COLUMN IF EXISTS phone, DROP COLUMN IF EXISTS avatar_color`);
  }
};
