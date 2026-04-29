module.exports = {
  name: '012_support_tickets',
  up: async (client) => {
    // Customer support tickets
    await client.query(`
      CREATE TABLE IF NOT EXISTS support_tickets (
        id SERIAL PRIMARY KEY,
        customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
        repair_id INTEGER REFERENCES repairs(id) ON DELETE SET NULL,
        subject VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        status VARCHAR(50) DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','closed')),
        admin_response TEXT,
        responded_by INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
        responded_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS tickets_customer_idx ON support_tickets (customer_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS tickets_status_idx ON support_tickets (status)
    `);

    // End-of-day reconciliation logs
    await client.query(`
      CREATE TABLE IF NOT EXISTS eod_reports (
        id SERIAL PRIMARY KEY,
        report_date DATE NOT NULL UNIQUE,
        repairs_completed INTEGER DEFAULT 0,
        revenue_card NUMERIC(10,2) DEFAULT 0,
        revenue_cash NUMERIC(10,2) DEFAULT 0,
        revenue_other NUMERIC(10,2) DEFAULT 0,
        outstanding_balance NUMERIC(10,2) DEFAULT 0,
        new_customers INTEGER DEFAULT 0,
        new_repairs INTEGER DEFAULT 0,
        payments_recorded INTEGER DEFAULT 0,
        notes TEXT,
        generated_by INTEGER REFERENCES admin_users(id),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Stripe payment intents for portal self-service
    await client.query(`
      CREATE TABLE IF NOT EXISTS stripe_payments (
        id SERIAL PRIMARY KEY,
        customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
        payment_plan_id INTEGER REFERENCES payment_plans(id) ON DELETE CASCADE,
        installment_id INTEGER REFERENCES installments(id) ON DELETE SET NULL,
        stripe_payment_intent_id VARCHAR(255) UNIQUE,
        amount NUMERIC(10,2) NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      )
    `);

    // Add phone-based portal login option (no email required)
    await client.query(`
      ALTER TABLE customers
        ADD COLUMN IF NOT EXISTS portal_login_phone VARCHAR(50)
    `);
  }
};
