module.exports = {
  name: '003_repairs',
  up: async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS repairs (
        id SERIAL PRIMARY KEY,
        customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
        device_type VARCHAR(100),
        device_brand VARCHAR(100),
        device_model VARCHAR(255),
        issue_description TEXT,
        diagnosis_notes TEXT,
        repair_notes TEXT,
        status VARCHAR(50) DEFAULT 'intake'
          CHECK (status IN ('intake','diagnosed','in_repair','ready_pickup','complete','cancelled')),
        total_amount NUMERIC(10,2),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS repairs_customer_idx ON repairs (customer_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS repairs_status_idx ON repairs (status)
    `);
  }
};
