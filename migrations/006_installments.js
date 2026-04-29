module.exports = {
  name: '006_installments',
  up: async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS installments (
        id SERIAL PRIMARY KEY,
        payment_plan_id INTEGER REFERENCES payment_plans(id) ON DELETE CASCADE,
        installment_number INTEGER NOT NULL,
        due_date DATE NOT NULL,
        amount NUMERIC(10,2) NOT NULL,
        status VARCHAR(50) DEFAULT 'pending'
          CHECK (status IN ('pending','paid','overdue','waived')),
        paid_at TIMESTAMPTZ,
        paid_amount NUMERIC(10,2),
        payment_method VARCHAR(100),
        stripe_payment_intent_id VARCHAR(255),
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS installments_plan_idx ON installments (payment_plan_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS installments_due_date_idx ON installments (due_date)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS installments_status_idx ON installments (status)
    `);
  }
};
