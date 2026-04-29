module.exports = {
  name: '021_sms_email_mega',
  up: async (client) => {
    async function safeExec(sql, label) {
      try {
        await client.query('SAVEPOINT sp');
        await client.query(sql);
        await client.query('RELEASE SAVEPOINT sp');
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT sp');
        console.log(`  [021 warn] ${(label || '').substring(0, 60)}: ${err.message}`);
      }
    }

    await safeExec(`-- ════════════════════════════════════════════════════════════════════════════
-- SMS SYSTEM
-- ════════════════════════════════════════════════════════════════════════════

-- SMS message log (inbound + outbound)
CREATE TABLE IF NOT EXISTS sms_messages (
  id SERIAL PRIMARY KEY,
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  phone VARCHAR(20) NOT NULL,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  twilio_sid VARCHAR(64),
  media_count INTEGER DEFAULT 0,
  sent_by INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  bulk_campaign_id INTEGER,
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
)`, 'stmt_1');

    await safeExec(`CREATE INDEX IF NOT EXISTS sms_phone_idx ON sms_messages (phone, created_at DESC)`, 'CREATE INDEX IF NOT EXISTS sms_phone_idx ON sms_messages (ph');

    await safeExec(`CREATE INDEX IF NOT EXISTS sms_customer_idx ON sms_messages (customer_id)`, 'CREATE INDEX IF NOT EXISTS sms_customer_idx ON sms_messages ');

    await safeExec(`CREATE INDEX IF NOT EXISTS sms_unread_idx ON sms_messages (phone, direction, read) WHERE read = false`, 'CREATE INDEX IF NOT EXISTS sms_unread_idx ON sms_messages (p');

    await safeExec(`-- SMS opt-in preferences
CREATE TABLE IF NOT EXISTS sms_preferences (
  id SERIAL PRIMARY KEY,
  phone VARCHAR(20) NOT NULL UNIQUE,
  opted_in BOOLEAN DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT NOW()
)`, 'stmt_5');

    await safeExec(`-- Add sms_opt_in to customers if not exists
ALTER TABLE customers ADD COLUMN IF NOT EXISTS sms_opt_in BOOLEAN DEFAULT true`, 'stmt_6');

    await safeExec(`-- Add sms_phone and source to support_tickets
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS sms_phone VARCHAR(20)`, 'stmt_7');

    await safeExec(`ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'portal'`, 'ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS source ');

    await safeExec(`-- Ticket conversation messages (multi-channel)
CREATE TABLE IF NOT EXISTS ticket_messages (
  id SERIAL PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  sender_type VARCHAR(20) NOT NULL CHECK (sender_type IN ('customer_sms', 'customer_email', 'customer_portal', 'admin_sms', 'admin_email', 'admin_portal', 'system')),
  sender_id INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  sender_phone VARCHAR(20),
  message TEXT NOT NULL,
  attachments JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
)`, 'stmt_9');

    await safeExec(`CREATE INDEX IF NOT EXISTS ticket_msg_ticket_idx ON ticket_messages (ticket_id, created_at)`, 'CREATE INDEX IF NOT EXISTS ticket_msg_ticket_idx ON ticket_m');

    await safeExec(`-- SMS bulk campaigns
CREATE TABLE IF NOT EXISTS sms_campaigns (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  filter_criteria JSONB DEFAULT '{}',
  sent_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  created_by INTEGER REFERENCES admin_users(id),
  status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'sending', 'completed', 'cancelled')),
  scheduled_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
)`, 'stmt_11');

    await safeExec(`-- ════════════════════════════════════════════════════════════════════════════
-- EMAIL SYSTEM
-- ════════════════════════════════════════════════════════════════════════════

-- Email templates
CREATE TABLE IF NOT EXISTS email_templates (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  subject VARCHAR(255) NOT NULL,
  html_body TEXT NOT NULL,
  text_body TEXT,
  category VARCHAR(50) DEFAULT 'transactional' CHECK (category IN ('transactional', 'marketing', 'notification', 'system')),
  variables JSONB DEFAULT '[]',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
)`, 'stmt_12');

    await safeExec(`-- Email log
CREATE TABLE IF NOT EXISTS email_log (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  to_email VARCHAR(255) NOT NULL,
  from_email VARCHAR(255) NOT NULL,
  subject VARCHAR(255) NOT NULL,
  template_id INTEGER REFERENCES email_templates(id) ON DELETE SET NULL,
  resend_id VARCHAR(100),
  status VARCHAR(20) DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'opened', 'clicked', 'bounced', 'failed')),
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
)`, 'stmt_13');

    await safeExec(`CREATE INDEX IF NOT EXISTS email_log_customer_idx ON email_log (customer_id)`, 'CREATE INDEX IF NOT EXISTS email_log_customer_idx ON email_l');

    await safeExec(`-- Drip email sequences
CREATE TABLE IF NOT EXISTS email_sequences (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  trigger_event VARCHAR(50) NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
)`, 'stmt_15');

    await safeExec(`CREATE TABLE IF NOT EXISTS email_sequence_steps (
  id SERIAL PRIMARY KEY,
  sequence_id INTEGER NOT NULL REFERENCES email_sequences(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  delay_hours INTEGER NOT NULL DEFAULT 0,
  template_id INTEGER REFERENCES email_templates(id) ON DELETE SET NULL,
  subject VARCHAR(255),
  body TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
)`, 'CREATE TABLE IF NOT EXISTS email_sequence_steps (');

    await safeExec(`CREATE TABLE IF NOT EXISTS email_sequence_enrollments (
  id SERIAL PRIMARY KEY,
  sequence_id INTEGER NOT NULL REFERENCES email_sequences(id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  current_step INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  next_send_at TIMESTAMPTZ,
  enrolled_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
)`, 'CREATE TABLE IF NOT EXISTS email_sequence_enrollments (');

    await safeExec(`-- ════════════════════════════════════════════════════════════════════════════
-- CUSTOMER ENHANCEMENTS
-- ════════════════════════════════════════════════════════════════════════════

-- Customer tags
CREATE TABLE IF NOT EXISTS customer_tags (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,
  color VARCHAR(7) DEFAULT '#6B7280',
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
)`, 'stmt_18');

    await safeExec(`CREATE TABLE IF NOT EXISTS customer_tag_assignments (
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES customer_tags(id) ON DELETE CASCADE,
  assigned_by INTEGER REFERENCES admin_users(id),
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (customer_id, tag_id)
)`, 'CREATE TABLE IF NOT EXISTS customer_tag_assignments (');

    await safeExec(`-- Customer credits
CREATE TABLE IF NOT EXISTS customer_credits (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  amount NUMERIC(10,2) NOT NULL,
  reason VARCHAR(255),
  source VARCHAR(50) CHECK (source IN ('referral', 'overpayment', 'return', 'promo', 'manual', 'goodwill')),
  applied_to_invoice INTEGER,
  created_by INTEGER REFERENCES admin_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
)`, 'stmt_20');

    await safeExec(`-- Referral program
CREATE TABLE IF NOT EXISTS referrals (
  id SERIAL PRIMARY KEY,
  referrer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  referred_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  referred_name VARCHAR(100),
  referred_phone VARCHAR(20),
  referred_email VARCHAR(255),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'converted', 'rewarded', 'expired')),
  referrer_reward NUMERIC(10,2),
  referred_reward NUMERIC(10,2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  converted_at TIMESTAMPTZ
)`, 'stmt_21');

    await safeExec(`-- Customer communication preferences
ALTER TABLE customers ADD COLUMN IF NOT EXISTS comm_pref VARCHAR(20) DEFAULT 'both' CHECK (comm_pref IN ('email', 'sms', 'both', 'none'))`, 'stmt_22');

    await safeExec(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS emergency_contact VARCHAR(255)`, 'ALTER TABLE customers ADD COLUMN IF NOT EXISTS emergency_con');

    await safeExec(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS business_name VARCHAR(255)`, 'ALTER TABLE customers ADD COLUMN IF NOT EXISTS business_name');

    await safeExec(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_business BOOLEAN DEFAULT false`, 'ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_business B');

    await safeExec(`-- Customer documents vault
CREATE TABLE IF NOT EXISTS customer_documents (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  file_type VARCHAR(50),
  file_size INTEGER,
  file_url TEXT,
  uploaded_by VARCHAR(20) DEFAULT 'admin' CHECK (uploaded_by IN ('admin', 'customer')),
  created_at TIMESTAMPTZ DEFAULT NOW()
)`, 'stmt_26');

    await safeExec(`-- ════════════════════════════════════════════════════════════════════════════
-- REPAIR ENHANCEMENTS
-- ════════════════════════════════════════════════════════════════════════════

-- Repair templates
CREATE TABLE IF NOT EXISTS repair_templates (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  device_type VARCHAR(50),
  description TEXT,
  estimated_time_hours NUMERIC(4,1),
  estimated_cost NUMERIC(10,2),
  checklist JSONB DEFAULT '[]',
  parts_needed JSONB DEFAULT '[]',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
)`, 'stmt_27');

    await safeExec(`-- Add fields to repairs
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'normal' CHECK (priority IN ('normal', 'rush', 'emergency'))`, 'stmt_28');

    await safeExec(`ALTER TABLE repairs ADD COLUMN IF NOT EXISTS sla_deadline TIMESTAMPTZ`, 'ALTER TABLE repairs ADD COLUMN IF NOT EXISTS sla_deadline TI');

    await safeExec(`ALTER TABLE repairs ADD COLUMN IF NOT EXISTS assigned_tech INTEGER REFERENCES admin_users(id) ON DELETE SET NULL`, 'ALTER TABLE repairs ADD COLUMN IF NOT EXISTS assigned_tech I');

    await safeExec(`ALTER TABLE repairs ADD COLUMN IF NOT EXISTS template_id INTEGER REFERENCES repair_templates(id) ON DELETE SET NULL`, 'ALTER TABLE repairs ADD COLUMN IF NOT EXISTS template_id INT');

    await safeExec(`ALTER TABLE repairs ADD COLUMN IF NOT EXISTS kanban_position INTEGER DEFAULT 0`, 'ALTER TABLE repairs ADD COLUMN IF NOT EXISTS kanban_position');

    await safeExec(`ALTER TABLE repairs ADD COLUMN IF NOT EXISTS diagnosis_report TEXT`, 'ALTER TABLE repairs ADD COLUMN IF NOT EXISTS diagnosis_repor');

    await safeExec(`ALTER TABLE repairs ADD COLUMN IF NOT EXISTS internal_notes TEXT`, 'ALTER TABLE repairs ADD COLUMN IF NOT EXISTS internal_notes ');

    await safeExec(`ALTER TABLE repairs ADD COLUMN IF NOT EXISTS bench_fee NUMERIC(10,2) DEFAULT 0`, 'ALTER TABLE repairs ADD COLUMN IF NOT EXISTS bench_fee NUMER');

    await safeExec(`ALTER TABLE repairs ADD COLUMN IF NOT EXISTS related_repair_id INTEGER REFERENCES repairs(id) ON DELETE SET NULL`, 'ALTER TABLE repairs ADD COLUMN IF NOT EXISTS related_repair_');

    await safeExec(`ALTER TABLE repairs ADD COLUMN IF NOT EXISTS is_warranty_claim BOOLEAN DEFAULT false`, 'ALTER TABLE repairs ADD COLUMN IF NOT EXISTS is_warranty_cla');

    await safeExec(`ALTER TABLE repairs ADD COLUMN IF NOT EXISTS parts_consumed JSONB DEFAULT '[]'`, 'ALTER TABLE repairs ADD COLUMN IF NOT EXISTS parts_consumed ');

    await safeExec(`-- Before/after photos
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS before_photos JSONB DEFAULT '[]'`, 'stmt_39');

    await safeExec(`ALTER TABLE repairs ADD COLUMN IF NOT EXISTS after_photos JSONB DEFAULT '[]'`, 'ALTER TABLE repairs ADD COLUMN IF NOT EXISTS after_photos JS');

    await safeExec(`-- ════════════════════════════════════════════════════════════════════════════
-- BILLING ENHANCEMENTS
-- ════════════════════════════════════════════════════════════════════════════

-- Coupon / discount codes
CREATE TABLE IF NOT EXISTS coupons (
  id SERIAL PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  description TEXT,
  discount_type VARCHAR(10) NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
  discount_value NUMERIC(10,2) NOT NULL,
  min_purchase NUMERIC(10,2) DEFAULT 0,
  max_uses INTEGER,
  uses_count INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  expires_at TIMESTAMPTZ,
  created_by INTEGER REFERENCES admin_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
)`, 'stmt_41');

    await safeExec(`CREATE TABLE IF NOT EXISTS coupon_uses (
  id SERIAL PRIMARY KEY,
  coupon_id INTEGER NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  invoice_id INTEGER,
  discount_amount NUMERIC(10,2) NOT NULL,
  used_at TIMESTAMPTZ DEFAULT NOW()
)`, 'CREATE TABLE IF NOT EXISTS coupon_uses (');

    await safeExec(`-- Late fees
CREATE TABLE IF NOT EXISTS late_fees (
  id SERIAL PRIMARY KEY,
  payment_plan_id INTEGER NOT NULL REFERENCES payment_plans(id) ON DELETE CASCADE,
  installment_id INTEGER REFERENCES installments(id) ON DELETE SET NULL,
  amount NUMERIC(10,2) NOT NULL,
  reason VARCHAR(255),
  waived BOOLEAN DEFAULT false,
  waived_by INTEGER REFERENCES admin_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
)`, 'stmt_43');

    await safeExec(`-- Deposits
CREATE TABLE IF NOT EXISTS deposits (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  repair_id INTEGER REFERENCES repairs(id) ON DELETE SET NULL,
  amount NUMERIC(10,2) NOT NULL,
  payment_method VARCHAR(20) DEFAULT 'card',
  status VARCHAR(20) DEFAULT 'held' CHECK (status IN ('held', 'applied', 'refunded')),
  applied_to_invoice INTEGER,
  stripe_payment_id VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  applied_at TIMESTAMPTZ
)`, 'stmt_44');

    await safeExec(`-- Multi-payment method tracking
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20) DEFAULT 'card' CHECK (payment_method IN ('card', 'cash', 'check', 'zelle', 'venmo', 'paypal', 'credit', 'other'))`, 'stmt_45');

    await safeExec(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS reference_number VARCHAR(100)`, 'ALTER TABLE payments ADD COLUMN IF NOT EXISTS reference_numb');

    await safeExec(`-- ════════════════════════════════════════════════════════════════════════════
-- SUPPORT ENHANCEMENTS
-- ════════════════════════════════════════════════════════════════════════════

-- Canned responses
CREATE TABLE IF NOT EXISTS canned_responses (
  id SERIAL PRIMARY KEY,
  title VARCHAR(100) NOT NULL,
  content TEXT NOT NULL,
  category VARCHAR(50),
  variables JSONB DEFAULT '[]',
  use_count INTEGER DEFAULT 0,
  created_by INTEGER REFERENCES admin_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
)`, 'stmt_47');

    await safeExec(`-- Knowledge base articles
CREATE TABLE IF NOT EXISTS kb_articles (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL UNIQUE,
  content TEXT NOT NULL,
  category VARCHAR(100),
  is_public BOOLEAN DEFAULT true,
  is_internal BOOLEAN DEFAULT false,
  view_count INTEGER DEFAULT 0,
  helpful_count INTEGER DEFAULT 0,
  not_helpful_count INTEGER DEFAULT 0,
  author_id INTEGER REFERENCES admin_users(id),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
)`, 'stmt_48');

    await safeExec(`CREATE INDEX IF NOT EXISTS kb_slug_idx ON kb_articles (slug)`, 'CREATE INDEX IF NOT EXISTS kb_slug_idx ON kb_articles (slug)');

    await safeExec(`CREATE INDEX IF NOT EXISTS kb_category_idx ON kb_articles (category)`, 'CREATE INDEX IF NOT EXISTS kb_category_idx ON kb_articles (c');

    await safeExec(`-- Ticket SLA and priority
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent'))`, 'stmt_51');

    await safeExec(`ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS sla_deadline TIMESTAMPTZ`, 'ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS sla_dea');

    await safeExec(`ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS assigned_to INTEGER REFERENCES admin_users(id) ON DELETE SET NULL`, 'ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS assigne');

    await safeExec(`ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS category VARCHAR(100)`, 'ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS categor');

    await safeExec(`ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS satisfaction_rating INTEGER CHECK (satisfaction_rating BETWEEN 1 AND 5)`, 'ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS satisfa');

    await safeExec(`ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS satisfaction_comment TEXT`, 'ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS satisfa');

    await safeExec(`-- ════════════════════════════════════════════════════════════════════════════
-- NOTIFICATIONS
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  admin_id INTEGER REFERENCES admin_users(id) ON DELETE CASCADE,
  customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT,
  link VARCHAR(500),
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
)`, 'stmt_57');

    await safeExec(`CREATE INDEX IF NOT EXISTS notifications_admin_idx ON notifications (admin_id, read, created_at DESC)`, 'CREATE INDEX IF NOT EXISTS notifications_admin_idx ON notifi');

    await safeExec(`CREATE INDEX IF NOT EXISTS notifications_customer_idx ON notifications (customer_id, read, created_at DESC)`, 'CREATE INDEX IF NOT EXISTS notifications_customer_idx ON not');

    await safeExec(`-- ════════════════════════════════════════════════════════════════════════════
-- SCHEDULING ENHANCEMENTS
-- ════════════════════════════════════════════════════════════════════════════

-- Recurring appointments
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN DEFAULT false`, 'stmt_60');

    await safeExec(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS recurrence_rule VARCHAR(50)`, 'ALTER TABLE appointments ADD COLUMN IF NOT EXISTS recurrence');

    await safeExec(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS parent_appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL`, 'ALTER TABLE appointments ADD COLUMN IF NOT EXISTS parent_app');

    await safeExec(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reminder_sent BOOLEAN DEFAULT false`, 'ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reminder_s');

    await safeExec(`-- Walk-in queue
CREATE TABLE IF NOT EXISTS walkin_queue (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  customer_name VARCHAR(100),
  phone VARCHAR(20),
  reason VARCHAR(255),
  position INTEGER,
  status VARCHAR(20) DEFAULT 'waiting' CHECK (status IN ('waiting', 'serving', 'completed', 'no_show')),
  checked_in_at TIMESTAMPTZ DEFAULT NOW(),
  called_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  estimated_wait INTEGER
)`, 'stmt_64');

    await safeExec(`-- ════════════════════════════════════════════════════════════════════════════
-- INVENTORY ENHANCEMENTS
-- ════════════════════════════════════════════════════════════════════════════

-- Suppliers
CREATE TABLE IF NOT EXISTS suppliers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  contact_name VARCHAR(100),
  email VARCHAR(255),
  phone VARCHAR(20),
  website VARCHAR(500),
  lead_time_days INTEGER,
  reliability_score NUMERIC(3,2) DEFAULT 5.00,
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
)`, 'stmt_65');

    await safeExec(`-- Purchase orders
CREATE TABLE IF NOT EXISTS purchase_orders (
  id SERIAL PRIMARY KEY,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  po_number VARCHAR(50) NOT NULL UNIQUE,
  status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'confirmed', 'shipped', 'received', 'cancelled')),
  total_amount NUMERIC(10,2) DEFAULT 0,
  notes TEXT,
  ordered_by INTEGER REFERENCES admin_users(id),
  expected_delivery TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
)`, 'stmt_66');

    await safeExec(`CREATE TABLE IF NOT EXISTS purchase_order_items (
  id SERIAL PRIMARY KEY,
  po_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  part_id INTEGER REFERENCES parts(id) ON DELETE SET NULL,
  description VARCHAR(255),
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_cost NUMERIC(10,2) NOT NULL,
  received_quantity INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
)`, 'CREATE TABLE IF NOT EXISTS purchase_order_items (');

    await safeExec(`-- Add supplier and reorder fields to parts
ALTER TABLE parts ADD COLUMN IF NOT EXISTS supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL`, 'stmt_68');

    await safeExec(`ALTER TABLE parts ADD COLUMN IF NOT EXISTS reorder_point INTEGER DEFAULT 5`, 'ALTER TABLE parts ADD COLUMN IF NOT EXISTS reorder_point INT');

    await safeExec(`ALTER TABLE parts ADD COLUMN IF NOT EXISTS reorder_quantity INTEGER DEFAULT 10`, 'ALTER TABLE parts ADD COLUMN IF NOT EXISTS reorder_quantity ');

    await safeExec(`ALTER TABLE parts ADD COLUMN IF NOT EXISTS location VARCHAR(100)`, 'ALTER TABLE parts ADD COLUMN IF NOT EXISTS location VARCHAR(');

    await safeExec(`ALTER TABLE parts ADD COLUMN IF NOT EXISTS barcode VARCHAR(100)`, 'ALTER TABLE parts ADD COLUMN IF NOT EXISTS barcode VARCHAR(1');

    await safeExec(`ALTER TABLE parts ADD COLUMN IF NOT EXISTS warranty_months INTEGER DEFAULT 0`, 'ALTER TABLE parts ADD COLUMN IF NOT EXISTS warranty_months I');

    await safeExec(`-- ════════════════════════════════════════════════════════════════════════════
-- BUSINESS MANAGEMENT
-- ════════════════════════════════════════════════════════════════════════════

-- Employee time clock
CREATE TABLE IF NOT EXISTS time_entries (
  id SERIAL PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  clock_in TIMESTAMPTZ NOT NULL,
  clock_out TIMESTAMPTZ,
  break_minutes INTEGER DEFAULT 0,
  total_hours NUMERIC(5,2),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
)`, 'stmt_74');

    await safeExec(`-- Commission rules
CREATE TABLE IF NOT EXISTS commission_rules (
  id SERIAL PRIMARY KEY,
  admin_id INTEGER REFERENCES admin_users(id) ON DELETE CASCADE,
  service_type VARCHAR(100),
  rate_type VARCHAR(10) CHECK (rate_type IN ('percent', 'fixed')),
  rate_value NUMERIC(10,2) NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
)`, 'stmt_75');

    await safeExec(`CREATE TABLE IF NOT EXISTS commission_entries (
  id SERIAL PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  repair_id INTEGER REFERENCES repairs(id) ON DELETE SET NULL,
  rule_id INTEGER REFERENCES commission_rules(id) ON DELETE SET NULL,
  amount NUMERIC(10,2) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'paid')),
  pay_period_start DATE,
  pay_period_end DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
)`, 'CREATE TABLE IF NOT EXISTS commission_entries (');

    await safeExec(`-- Expenses
CREATE TABLE IF NOT EXISTS expenses (
  id SERIAL PRIMARY KEY,
  category VARCHAR(100) NOT NULL,
  description TEXT,
  amount NUMERIC(10,2) NOT NULL,
  payment_method VARCHAR(20),
  receipt_url TEXT,
  vendor VARCHAR(255),
  expense_date DATE NOT NULL,
  created_by INTEGER REFERENCES admin_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
)`, 'stmt_77');

    await safeExec(`-- KPI / Goal tracking
CREATE TABLE IF NOT EXISTS kpi_targets (
  id SERIAL PRIMARY KEY,
  metric VARCHAR(50) NOT NULL,
  target_value NUMERIC(10,2) NOT NULL,
  period_type VARCHAR(10) CHECK (period_type IN ('daily', 'weekly', 'monthly', 'quarterly')),
  period_start DATE NOT NULL,
  actual_value NUMERIC(10,2) DEFAULT 0,
  created_by INTEGER REFERENCES admin_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
)`, 'stmt_78');

    await safeExec(`-- Legal document templates
CREATE TABLE IF NOT EXISTS legal_templates (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  type VARCHAR(50) CHECK (type IN ('tos', 'repair_auth', 'liability_waiver', 'data_destruction', 'custom')),
  content TEXT NOT NULL,
  variables JSONB DEFAULT '[]',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
)`, 'stmt_79');

    await safeExec(`-- Signed legal documents
CREATE TABLE IF NOT EXISTS signed_documents (
  id SERIAL PRIMARY KEY,
  template_id INTEGER REFERENCES legal_templates(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  repair_id INTEGER REFERENCES repairs(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  signature_data TEXT,
  signed_at TIMESTAMPTZ,
  ip_address VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW()
)`, 'stmt_80');

    await safeExec(`-- ════════════════════════════════════════════════════════════════════════════
-- SECURITY ENHANCEMENTS
-- ════════════════════════════════════════════════════════════════════════════

-- Session management
CREATE TABLE IF NOT EXISTS active_sessions (
  sid VARCHAR(255) PRIMARY KEY,
  admin_id INTEGER REFERENCES admin_users(id) ON DELETE CASCADE,
  ip_address VARCHAR(50),
  user_agent TEXT,
  last_active TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
)`, 'stmt_81');

    await safeExec(`-- ════════════════════════════════════════════════════════════════════════════
-- SEED DEFAULT DATA
-- ════════════════════════════════════════════════════════════════════════════

-- Default customer tags
INSERT INTO customer_tags (name, color, description) VALUES
  ('VIP', '#FFD700', 'High-value repeat customer'),
  ('Business', '#3B82F6', 'Business account'),
  ('Residential', '#10B981', 'Residential customer'),
  ('New', '#8B5CF6', 'Recently acquired customer'),
  ('At Risk', '#EF4444', 'Customer may churn')
ON CONFLICT (name) DO NOTHING`, 'stmt_82');

    await safeExec(`-- Default canned responses
INSERT INTO canned_responses (title, content, category) VALUES
  ('Repair Received', 'Hi {first_name}, we''ve received your device and will begin diagnosis shortly. We''ll keep you updated!', 'repair'),
  ('Parts Ordered', 'Hi {first_name}, the parts for your repair have been ordered. Expected arrival: 2-3 business days.', 'repair'),
  ('Repair Complete', 'Great news, {first_name}! Your repair is complete and ready for pickup. Our hours are Mon-Fri 9-6, Sat 10-4.', 'repair'),
  ('Payment Reminder', 'Hi {first_name}, this is a friendly reminder that you have an outstanding balance. Visit our portal to make a payment or reply to arrange a plan.', 'billing'),
  ('Follow Up', 'Hi {first_name}, just checking in! How is your device working since the repair? Let us know if you need anything.', 'followup')
ON CONFLICT DO NOTHING`, 'stmt_83');

    await safeExec(`-- Default repair templates
INSERT INTO repair_templates (name, device_type, description, estimated_time_hours, estimated_cost, checklist) VALUES
  ('Screen Replacement', 'phone', 'Replace cracked or damaged screen', 1.0, 89.99, '["Remove old screen","Test new screen","Install new screen","Test touch response","Clean device"]'),
  ('Battery Replacement', 'phone', 'Replace degraded battery', 0.5, 49.99, '["Power off device","Remove old battery","Install new battery","Calibrate battery","Test charging"]'),
  ('Virus Removal', 'computer', 'Full malware scan and removal', 2.0, 79.99, '["Boot into safe mode","Run malware scan","Remove infections","Update antivirus","Test system stability"]'),
  ('Data Recovery', 'computer', 'Recover data from damaged drive', 4.0, 149.99, '["Assess drive condition","Clone drive if possible","Run recovery software","Verify recovered files","Transfer to new media"]'),
  ('OS Reinstall', 'computer', 'Fresh operating system installation', 2.0, 99.99, '["Backup user data","Format drive","Install OS","Install drivers","Restore user data","Install essential software"]'),
  ('Water Damage Repair', 'phone', 'Assess and repair liquid damage', 3.0, 129.99, '["Disassemble device","Clean corrosion","Dry components","Test components individually","Reassemble","Test all functions"]')
ON CONFLICT DO NOTHING`, 'stmt_84');

    await safeExec(`-- Default email templates
INSERT INTO email_templates (name, subject, html_body, category, variables) VALUES
  ('welcome', 'Welcome to Scarlet Technical!', '<h2>Welcome, {first_name}!</h2><p>Thanks for choosing Scarlet Technical for your IT support needs. We''re here to help!</p><p>Your customer portal: <a href="{portal_url}">Login Here</a></p><p>Questions? Reply to this email or call us at {support_phone}.</p>', 'transactional', '["first_name", "portal_url", "support_phone"]'),
  ('repair_update', 'Repair Update - #{repair_id}', '<h2>Repair Status Update</h2><p>Hi {first_name},</p><p>Your repair #{repair_id} ({device}) has been updated:</p><p><strong>New Status: {status}</strong></p><p>{message}</p><p>Track your repair: <a href="{portal_url}">View in Portal</a></p>', 'transactional', '["first_name", "repair_id", "device", "status", "message", "portal_url"]'),
  ('invoice', 'Invoice #{invoice_id} from Scarlet Technical', '<h2>Invoice #{invoice_id}</h2><p>Hi {first_name},</p><p>Amount Due: <strong>\${amount}</strong></p><p>Due Date: {due_date}</p><p><a href="{payment_url}">Pay Now</a></p>', 'transactional', '["first_name", "invoice_id", "amount", "due_date", "payment_url"]'),
  ('payment_reminder', 'Payment Reminder - \${amount} Due', '<p>Hi {first_name},</p><p>This is a friendly reminder that you have a payment of <strong>\${amount}</strong> due on {due_date}.</p><p><a href="{payment_url}">Make Payment</a></p>', 'transactional', '["first_name", "amount", "due_date", "payment_url"]'),
  ('satisfaction_survey', 'How did we do? - Scarlet Technical', '<p>Hi {first_name},</p><p>Your recent repair #{repair_id} is complete! We''d love your feedback.</p><p><a href="{survey_url}">Rate Your Experience</a></p><p>Thank you for choosing Scarlet Technical!</p>', 'transactional', '["first_name", "repair_id", "survey_url"]')
ON CONFLICT (name) DO NOTHING`, 'stmt_85');

    await safeExec(`-- Default knowledge base articles
INSERT INTO kb_articles (title, slug, content, category, is_public, published_at) VALUES
  ('How to Check Your Repair Status', 'check-repair-status', 'You can check your repair status anytime:\\n\\n1. **Online Portal**: Log in at our website with your email and password\\n2. **Text Us**: Send "STATUS" to our support number\\n3. **Call Us**: Give us a ring during business hours\\n\\nYou''ll receive automatic updates via SMS and email as your repair progresses.', 'Repairs', true, NOW()),
  ('Payment Options', 'payment-options', 'We offer flexible payment options:\\n\\n- **Credit/Debit Card** (in-person or online)\\n- **Cash** (in-person only)\\n- **Payment Plans** - Split your bill into manageable installments\\n- **Zelle/Venmo/PayPal** - Contact us for details\\n\\nAll online payments are processed securely through Stripe.', 'Billing', true, NOW()),
  ('Device Drop-Off Guide', 'device-drop-off', 'When dropping off your device:\\n\\n1. Back up your data if possible\\n2. Remove any cases or accessories\\n3. Disable Find My Device / Activation Lock\\n4. Note your passcode (we may need it for testing)\\n5. Bring your charger if it''s related to the issue\\n\\nWe''ll provide a receipt and estimated timeline at drop-off.', 'Getting Started', true, NOW())
ON CONFLICT (slug) DO NOTHING`, 'stmt_86');

    console.log('  Migration 021 complete');
  }
};
