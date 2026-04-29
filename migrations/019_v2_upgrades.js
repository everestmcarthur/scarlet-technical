const fs = require('fs');
const path = require('path');

module.exports = {
  name: '019_v2_upgrades',
  up: async (client) => {
    async function safeExec(sql, label) {
      const trimmed = sql.trim();
      if (!trimmed || trimmed.startsWith('--')) return;
      try {
        await client.query('SAVEPOINT sp');
        await client.query(trimmed);
        await client.query('RELEASE SAVEPOINT sp');
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT sp');
        console.log(`  [019 warn] ${(label || trimmed.substring(0, 60))}: ${err.message}`);
      }
    }

    // SMS 2FA codes table
    await safeExec(`CREATE TABLE IF NOT EXISTS two_factor_codes (
      customer_id INTEGER PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
      code VARCHAR(6) NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      attempts INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )`, 'create two_factor_codes');

    // Add Stripe columns (table is stripe_payments, not payments)
    await safeExec(`ALTER TABLE stripe_payments ADD COLUMN IF NOT EXISTS stripe_session_id VARCHAR(255)`);
    await safeExec(`ALTER TABLE stripe_payments ADD COLUMN IF NOT EXISTS method VARCHAR(50) DEFAULT 'manual'`);
    await safeExec(`ALTER TABLE installments ADD COLUMN IF NOT EXISTS stripe_session_id VARCHAR(255)`);
    await safeExec(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS stripe_session_id VARCHAR(255)`);
    await safeExec(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP`);

    // Review tracking
    await safeExec(`ALTER TABLE repairs ADD COLUMN IF NOT EXISTS review_sent BOOLEAN DEFAULT false`);
    await safeExec(`ALTER TABLE repairs ADD COLUMN IF NOT EXISTS review_prompt_due_at TIMESTAMP`);

    // Invoice number sequence
    await safeExec(`CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START WITH 10001`);

    // 2FA on customers
    await safeExec(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN DEFAULT false`);

    // Indexes
    await safeExec(`CREATE INDEX IF NOT EXISTS idx_payments_stripe_session ON stripe_payments(stripe_session_id)`);
    await safeExec(`CREATE INDEX IF NOT EXISTS idx_repairs_review_prompt ON repairs(review_prompt_due_at) WHERE review_sent = false`);
    await safeExec(`CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(appointment_date, status)`);
    await safeExec(`CREATE INDEX IF NOT EXISTS idx_installments_due ON installments(due_date) WHERE status = 'pending'`);

    console.log('  Migration 019 complete');
  }
};
