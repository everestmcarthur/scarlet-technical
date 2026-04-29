module.exports = {
  name: '015_enhancements',
  up: async (client) => {
    // Add service_type to repair_requests
    await client.query(`
      ALTER TABLE repair_requests
      ADD COLUMN IF NOT EXISTS service_type VARCHAR(50) DEFAULT 'in_person'
        CHECK (service_type IN ('in_person', 'remote'))
    `);

    // Add self_registered flag to customers
    await client.query(`
      ALTER TABLE customers
      ADD COLUMN IF NOT EXISTS self_registered BOOLEAN DEFAULT FALSE
    `);

    // Password reset tokens table
    await client.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id SERIAL PRIMARY KEY,
        customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        token VARCHAR(128) NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS password_reset_tokens_token_idx ON password_reset_tokens (token)
    `);
  }
};
