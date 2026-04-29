module.exports = {
  name: '007_reminder_logs',
  up: async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS reminder_logs (
        id SERIAL PRIMARY KEY,
        payment_plan_id INTEGER REFERENCES payment_plans(id) ON DELETE CASCADE,
        installment_id INTEGER REFERENCES installments(id) ON DELETE CASCADE,
        type VARCHAR(100) NOT NULL
          CHECK (type IN ('reminder_3day','due_today','overdue_3day','overdue_7day','payment_confirmation','repair_status','contract_copy')),
        sent_at TIMESTAMPTZ DEFAULT NOW(),
        sent_date DATE DEFAULT CURRENT_DATE,
        email_to VARCHAR(255),
        success BOOLEAN DEFAULT TRUE,
        error_message TEXT
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS reminder_logs_plan_idx ON reminder_logs (payment_plan_id)
    `);
    // Dedup unique index using stored sent_date column (immutable, no expression)
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS reminder_logs_dedup_idx
      ON reminder_logs (payment_plan_id, installment_id, type, sent_date)
      WHERE type IN ('reminder_3day','due_today','overdue_3day','overdue_7day')
    `);
  }
};
