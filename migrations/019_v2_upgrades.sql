-- Migration 019: v2.0 Upgrades
-- Two-factor auth, Stripe integration columns, review tracking

-- SMS 2FA codes table
CREATE TABLE IF NOT EXISTS two_factor_codes (
  customer_id INTEGER PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  code VARCHAR(6) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  attempts INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Add Stripe columns to existing tables
ALTER TABLE payments ADD COLUMN IF NOT EXISTS stripe_session_id VARCHAR(255);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS method VARCHAR(50) DEFAULT 'manual';
ALTER TABLE installments ADD COLUMN IF NOT EXISTS stripe_session_id VARCHAR(255);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS stripe_session_id VARCHAR(255);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP;

-- Review tracking
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS review_sent BOOLEAN DEFAULT false;
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS review_prompt_due_at TIMESTAMP;

-- Invoice number sequence (replace Math.random)
CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START WITH 10001;

-- 2FA enabled flag on customers
ALTER TABLE customers ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN DEFAULT false;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_payments_stripe_session ON payments(stripe_session_id);
CREATE INDEX IF NOT EXISTS idx_repairs_review_prompt ON repairs(review_prompt_due_at) WHERE review_sent = false;
CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(appointment_date, status);
CREATE INDEX IF NOT EXISTS idx_installments_due ON installments(due_date) WHERE status = 'pending';
