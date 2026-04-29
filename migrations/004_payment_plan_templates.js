module.exports = {
  name: '004_payment_plan_templates',
  up: async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS payment_plan_templates (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        num_installments INTEGER NOT NULL,
        frequency VARCHAR(50) DEFAULT 'monthly'
          CHECK (frequency IN ('weekly','biweekly','monthly')),
        down_payment_pct NUMERIC(5,2) DEFAULT 0,
        notes TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      INSERT INTO payment_plan_templates (name, num_installments, frequency, down_payment_pct, notes)
      VALUES
        ('Standard 6-Month', 6, 'monthly', 10, 'Standard payment plan with 10% down payment'),
        ('3-Month Express', 3, 'monthly', 25, 'Faster payoff with 25% down payment'),
        ('Biweekly 4-Payment', 4, 'biweekly', 0, 'Four biweekly payments, no down payment required'),
        ('90-Day Same As Cash', 3, 'monthly', 0, 'No interest if paid within 3 months')
      ON CONFLICT DO NOTHING
    `);
  }
};
