module.exports = {
  name: '005_payment_plans',
  up: async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS payment_plans (
        id SERIAL PRIMARY KEY,
        repair_id INTEGER REFERENCES repairs(id) ON DELETE CASCADE,
        customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
        template_id INTEGER REFERENCES payment_plan_templates(id),
        total_amount NUMERIC(10,2) NOT NULL,
        down_payment NUMERIC(10,2) DEFAULT 0,
        remaining_balance NUMERIC(10,2),
        num_installments INTEGER NOT NULL,
        installment_amount NUMERIC(10,2),
        frequency VARCHAR(50) DEFAULT 'monthly',
        first_due_date DATE,
        status VARCHAR(50) DEFAULT 'active'
          CHECK (status IN ('active','paid_off','defaulted','cancelled')),
        escalation_status VARCHAR(50) DEFAULT 'current'
          CHECK (escalation_status IN ('current','reminder_sent','warning_sent','final_notice_sent','flagged_for_action')),
        stripe_customer_id VARCHAR(255),
        stripe_subscription_id VARCHAR(255),
        auto_charge BOOLEAN DEFAULT FALSE,
        contract_signed BOOLEAN DEFAULT FALSE,
        contract_signed_at TIMESTAMPTZ,
        contract_signature TEXT,
        contract_pdf_url TEXT,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS payment_plans_customer_idx ON payment_plans (customer_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS payment_plans_status_idx ON payment_plans (status)
    `);
  }
};
