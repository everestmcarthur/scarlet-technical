-- Migration 022: Feature Expansion Pack
-- Adds: repair kanban, partial payments, refunds, NPS surveys, SLA timers,
--        barcode scanning, recurring appointments, global search index, and more.

-- ════════════════════════════════════════════════════════════════════════════
-- REPAIR WORKFLOW ENHANCEMENTS
-- ════════════════════════════════════════════════════════════════════════════

-- Repair kanban board positions
ALTER TABLE repair_requests ADD COLUMN IF NOT EXISTS kanban_position INTEGER DEFAULT 0;
ALTER TABLE repair_requests ADD COLUMN IF NOT EXISTS priority VARCHAR(10) DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent'));
ALTER TABLE repair_requests ADD COLUMN IF NOT EXISTS assigned_tech INTEGER REFERENCES admin_users(id) ON DELETE SET NULL;
ALTER TABLE repair_requests ADD COLUMN IF NOT EXISTS estimated_minutes INTEGER;
ALTER TABLE repair_requests ADD COLUMN IF NOT EXISTS actual_minutes INTEGER;
ALTER TABLE repair_requests ADD COLUMN IF NOT EXISTS bench_fee DECIMAL(10,2) DEFAULT 0;
ALTER TABLE repair_requests ADD COLUMN IF NOT EXISTS storage_fee DECIMAL(10,2) DEFAULT 0;
ALTER TABLE repair_requests ADD COLUMN IF NOT EXISTS template_id INTEGER REFERENCES repair_templates(id) ON DELETE SET NULL;
ALTER TABLE repair_requests ADD COLUMN IF NOT EXISTS parent_repair_id INTEGER REFERENCES repair_requests(id) ON DELETE SET NULL;
ALTER TABLE repair_requests ADD COLUMN IF NOT EXISTS warranty_claim BOOLEAN DEFAULT false;

-- Parts consumption per repair
CREATE TABLE IF NOT EXISTS repair_parts (
  id SERIAL PRIMARY KEY,
  repair_id INTEGER NOT NULL REFERENCES repair_requests(id) ON DELETE CASCADE,
  inventory_id INTEGER NOT NULL REFERENCES inventory(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_cost DECIMAL(10,2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Repair aging alerts config
CREATE TABLE IF NOT EXISTS aging_alert_rules (
  id SERIAL PRIMARY KEY,
  days_threshold INTEGER NOT NULL,
  alert_type VARCHAR(20) DEFAULT 'notification' CHECK (alert_type IN ('notification','email','sms')),
  message_template TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Diagnostic reports
CREATE TABLE IF NOT EXISTS diagnostic_reports (
  id SERIAL PRIMARY KEY,
  repair_id INTEGER NOT NULL REFERENCES repair_requests(id) ON DELETE CASCADE,
  device_id INTEGER REFERENCES devices(id) ON DELETE SET NULL,
  battery_health VARCHAR(20),
  storage_used_gb DECIMAL(6,2),
  storage_total_gb DECIMAL(6,2),
  ram_gb DECIMAL(6,2),
  screen_condition VARCHAR(30),
  wifi_test VARCHAR(20),
  bluetooth_test VARCHAR(20),
  speaker_test VARCHAR(20),
  camera_test VARCHAR(20),
  charging_test VARCHAR(20),
  notes TEXT,
  created_by INTEGER REFERENCES admin_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ════════════════════════════════════════════════════════════════════════════
-- BILLING ENHANCEMENTS
-- ════════════════════════════════════════════════════════════════════════════

-- Partial payments
CREATE TABLE IF NOT EXISTS partial_payments (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE CASCADE,
  plan_id INTEGER REFERENCES payment_plans(id) ON DELETE CASCADE,
  amount DECIMAL(10,2) NOT NULL,
  method VARCHAR(30) DEFAULT 'cash',
  reference VARCHAR(100),
  stripe_payment_id VARCHAR(100),
  notes TEXT,
  created_by INTEGER REFERENCES admin_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Refunds
CREATE TABLE IF NOT EXISTS refunds (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  plan_id INTEGER REFERENCES payment_plans(id) ON DELETE SET NULL,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  amount DECIMAL(10,2) NOT NULL,
  reason TEXT,
  method VARCHAR(30) DEFAULT 'original',
  stripe_refund_id VARCHAR(100),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','approved','processed','denied')),
  approved_by INTEGER REFERENCES admin_users(id),
  created_by INTEGER REFERENCES admin_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

-- Recurring invoices
CREATE TABLE IF NOT EXISTS recurring_invoices (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  description TEXT,
  amount DECIMAL(10,2) NOT NULL,
  frequency VARCHAR(20) DEFAULT 'monthly' CHECK (frequency IN ('weekly','biweekly','monthly','quarterly','yearly')),
  next_due DATE,
  active BOOLEAN DEFAULT true,
  auto_charge BOOLEAN DEFAULT false,
  stripe_subscription_id VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ════════════════════════════════════════════════════════════════════════════
-- CUSTOMER ENHANCEMENTS
-- ════════════════════════════════════════════════════════════════════════════

-- NPS Surveys
CREATE TABLE IF NOT EXISTS nps_surveys (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  repair_id INTEGER REFERENCES repair_requests(id) ON DELETE SET NULL,
  score INTEGER CHECK (score BETWEEN 0 AND 10),
  feedback TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  responded_at TIMESTAMPTZ
);

-- Business accounts (for B2B customers)
ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_business BOOLEAN DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS company_name VARCHAR(200);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS tax_id VARCHAR(50);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS billing_address TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS net_terms INTEGER DEFAULT 0;

-- Communication preferences
ALTER TABLE customers ADD COLUMN IF NOT EXISTS pref_sms BOOLEAN DEFAULT true;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS pref_email BOOLEAN DEFAULT true;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS pref_marketing BOOLEAN DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS language VARCHAR(10) DEFAULT 'en';

-- ════════════════════════════════════════════════════════════════════════════
-- SUPPORT ENHANCEMENTS
-- ════════════════════════════════════════════════════════════════════════════

-- SLA definitions
CREATE TABLE IF NOT EXISTS sla_policies (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  response_hours INTEGER NOT NULL DEFAULT 24,
  resolution_hours INTEGER NOT NULL DEFAULT 72,
  priority VARCHAR(10) DEFAULT 'normal',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ticket SLA tracking
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS sla_policy_id INTEGER REFERENCES sla_policies(id) ON DELETE SET NULL;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS sla_response_due TIMESTAMPTZ;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS sla_resolution_due TIMESTAMPTZ;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS sla_responded_at TIMESTAMPTZ;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS sla_resolved_at TIMESTAMPTZ;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS escalated BOOLEAN DEFAULT false;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS escalated_to INTEGER REFERENCES admin_users(id) ON DELETE SET NULL;

-- Escalation rules
CREATE TABLE IF NOT EXISTS escalation_rules (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  trigger_type VARCHAR(30) DEFAULT 'sla_breach' CHECK (trigger_type IN ('sla_breach','time_elapsed','priority','keyword')),
  trigger_value VARCHAR(100),
  escalate_to INTEGER REFERENCES admin_users(id),
  notify_via VARCHAR(20) DEFAULT 'notification',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ════════════════════════════════════════════════════════════════════════════
-- SCHEDULING ENHANCEMENTS
-- ════════════════════════════════════════════════════════════════════════════

-- Recurring appointments
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS recurring BOOLEAN DEFAULT false;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS recurrence_pattern VARCHAR(30);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS recurrence_end DATE;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS parent_appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL;

-- Technician availability
CREATE TABLE IF NOT EXISTS tech_availability (
  id SERIAL PRIMARY KEY,
  admin_user_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  day_of_week INTEGER CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  available BOOLEAN DEFAULT true
);

-- ════════════════════════════════════════════════════════════════════════════
-- INVENTORY ENHANCEMENTS
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE inventory ADD COLUMN IF NOT EXISTS barcode VARCHAR(100);
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS location VARCHAR(100) DEFAULT 'Main';
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS last_cost DECIMAL(10,2);
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS avg_cost DECIMAL(10,2);
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS warranty_months INTEGER DEFAULT 0;

-- Inventory movements/audit trail
CREATE TABLE IF NOT EXISTS inventory_movements (
  id SERIAL PRIMARY KEY,
  inventory_id INTEGER NOT NULL REFERENCES inventory(id) ON DELETE CASCADE,
  movement_type VARCHAR(20) CHECK (movement_type IN ('purchase','sale','repair_use','adjustment','transfer','return')),
  quantity INTEGER NOT NULL,
  reference_id INTEGER,
  reference_type VARCHAR(30),
  notes TEXT,
  created_by INTEGER REFERENCES admin_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ════════════════════════════════════════════════════════════════════════════
-- SECURITY ENHANCEMENTS
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS reset_token VARCHAR(64);
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMPTZ;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS totp_secret VARCHAR(64);
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN DEFAULT false;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS allowed_ips TEXT;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS last_password_change TIMESTAMPTZ;

-- IP allowlist global
CREATE TABLE IF NOT EXISTS ip_allowlist (
  id SERIAL PRIMARY KEY,
  ip_address VARCHAR(45) NOT NULL,
  label VARCHAR(100),
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ════════════════════════════════════════════════════════════════════════════
-- UI/UX ENHANCEMENTS
-- ════════════════════════════════════════════════════════════════════════════

-- Dashboard widgets configuration
CREATE TABLE IF NOT EXISTS dashboard_widgets (
  id SERIAL PRIMARY KEY,
  admin_user_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  widget_type VARCHAR(50) NOT NULL,
  position INTEGER DEFAULT 0,
  config JSONB DEFAULT '{}',
  visible BOOLEAN DEFAULT true
);

-- Keyboard shortcuts config
CREATE TABLE IF NOT EXISTS user_preferences (
  id SERIAL PRIMARY KEY,
  admin_user_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  key VARCHAR(50) NOT NULL,
  value TEXT,
  UNIQUE(admin_user_id, key)
);

-- ════════════════════════════════════════════════════════════════════════════
-- SEED DATA
-- ════════════════════════════════════════════════════════════════════════════

-- Default SLA policies
INSERT INTO sla_policies (name, response_hours, resolution_hours, priority)
VALUES
  ('Standard', 24, 72, 'normal'),
  ('Priority', 8, 24, 'high'),
  ('Emergency', 1, 4, 'urgent')
ON CONFLICT DO NOTHING;

-- Default aging alert rules
INSERT INTO aging_alert_rules (days_threshold, alert_type, message_template)
VALUES
  (3, 'notification', 'Repair #{repair_id} has been in {status} for {days} days'),
  (7, 'email', 'ATTENTION: Repair #{repair_id} is aging - {days} days in {status}'),
  (14, 'sms', 'Urgent: Repair #{repair_id} needs attention - {days} days without update')
ON CONFLICT DO NOTHING;

-- Default tech availability (Mon-Fri 9-5)
-- (Will be populated per user when they set up)

-- Update default admin credentials 
-- (password update handled by JS migration 023)

