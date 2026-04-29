'use strict';
module.exports = {
  name: '017_settings_expansion',
  up: async (client) => {
    // Expanded business settings: feature flags, landing page content, theme, SEO, footer
    await client.query(`
      INSERT INTO business_settings (key, value) VALUES
        -- Feature flags
        ('feature_registration_enabled', 'true'),
        ('feature_online_payments_enabled', 'true'),
        ('feature_contract_signing_enabled', 'true'),
        ('feature_customer_messaging_enabled', 'true'),
        ('feature_remote_repair_requests', 'true'),
        ('maintenance_mode', 'false'),
        ('maintenance_message', 'We are performing scheduled maintenance. We will be back shortly.'),

        -- Landing page content
        ('landing_hero_headline', 'Device repair you can <span class="highlight">actually afford.</span>'),
        ('landing_hero_subheadline', 'Software issues, hardware failures, account lockouts — we fix it all. No credit check. Take your device home today and pay over time.'),
        ('landing_hero_badge', 'Muncie, Indiana'),
        ('landing_hero_cta_primary', 'Request a Repair'),
        ('landing_hero_cta_secondary', 'View Plans'),
        ('landing_about_title', 'Local tech support that actually shows up.'),
        ('landing_about_body', 'We''re a Muncie-based repair shop focused on making tech support accessible to everyone — especially those who can''t pay everything upfront. No corporate runaround, no hidden fees, no judgment. Just honest work at fair prices.'),
        ('landing_services_title', 'What we fix'),
        ('landing_testimonials_enabled', 'true'),

        -- Theme
        ('theme_primary_color', '#C41E3A'),
        ('theme_accent_color', '#9e1830'),
        ('theme_font', 'Inter'),
        ('theme_logo_url', ''),
        ('theme_favicon_url', ''),
        ('theme_dark_mode_portal', 'false'),

        -- SEO
        ('seo_site_title', 'Scarlet Technical — Affordable Device Repair in Muncie, IN'),
        ('seo_meta_description', 'Scarlet Technical offers affordable device repair with flexible payment plans. No credit check. Muncie, Indiana.'),
        ('seo_og_image_url', ''),

        -- Footer / social
        ('footer_copyright', '© 2026 Scarlet Technical. All rights reserved.'),
        ('social_facebook', ''),
        ('social_instagram', ''),
        ('social_twitter', ''),
        ('business_hours', 'Mon–Fri 9am–6pm, Sat 10am–4pm'),

        -- Google Maps
        ('google_maps_embed', ''),

        -- Contract template
        ('contract_template_body', 'This Payment Plan Agreement ("Agreement") is entered into between Scarlet Technical ("Company") and the undersigned customer ("Customer").\n\nCustomer agrees to pay the total amount specified in this agreement according to the payment schedule outlined herein. Payments are due on the dates specified. A grace period of {grace_days} days is provided before late fees apply.\n\nLate Fee Policy: A late fee of {late_fee} will be applied to any payment not received within the grace period.\n\nDevice Lock Policy: In the event of non-payment, Scarlet Technical reserves the right to remotely lock enrolled devices as described in the Device Enrollment Agreement.\n\nBy signing this agreement, Customer acknowledges understanding of and agreement to all terms stated herein.')
      ON CONFLICT (key) DO NOTHING
    `);

    // Notification templates table for custom email templates
    await client.query(`
      CREATE TABLE IF NOT EXISTS email_templates (
        id SERIAL PRIMARY KEY,
        template_key VARCHAR(100) NOT NULL UNIQUE,
        subject TEXT NOT NULL,
        body_html TEXT NOT NULL,
        description TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        updated_by INTEGER REFERENCES admin_users(id)
      )
    `);

    // Seed default email templates
    await client.query(
      'INSERT INTO email_templates (template_key, subject, body_html, description) VALUES' +
      "('payment_reminder_3day', 'Friendly Reminder: Payment Due in 3 Days — {business_name}'," +
      " '<p>Hi {customer_name},</p><p>Reminder: your payment of <strong>{amount}</strong> is due in 3 days on {due_date}.</p><p>Visit our location or contact us to arrange payment. Thank you!</p>'," +
      " 'Sent 3 days before payment due date')," +
      "('payment_reminder_due', 'Payment Due Today — {business_name}'," +
      " '<p>Hi {customer_name},</p><p>Your installment payment of <strong>{amount}</strong> is <strong>due today</strong>. Please arrange payment at your earliest convenience.</p>'," +
      " 'Sent on payment due date')," +
      "('payment_overdue_3day', 'Overdue Notice — Payment Past Due · {business_name}'," +
      " '<p>Hi {customer_name},</p><p>Your payment of <strong>{amount}</strong> due on {due_date} has not been received. Please pay as soon as possible to avoid escalation.</p>'," +
      " 'Sent 3 days after missed payment')," +
      "('payment_overdue_7day', 'Final Warning — Account Action Required · {business_name}'," +
      " '<p>Hi {customer_name},</p><p>Your payment of <strong>{amount}</strong> is 7 days overdue. Failure to pay may result in device management actions per your signed contract. Please contact us immediately.</p>'," +
      " 'Sent 7 days after missed payment')," +
      "('payment_received', 'Payment Received — Thank You! · {business_name}'," +
      " '<p>Hi {customer_name},</p><p>We have received your payment of <strong>{amount}</strong>. Thank you! Your remaining balance is <strong>{remaining_balance}</strong>.</p>'," +
      " 'Sent when payment is recorded')," +
      "('repair_status_update', 'Repair Update: {status} — {business_name}'," +
      " '<p>Hi {customer_name},</p><p>Update on your device repair:</p><p><strong>Device:</strong> {device}<br><strong>Status:</strong> {status}<br><strong>Updated:</strong> {date}</p>{technician_notes}'," +
      " 'Sent when repair status changes')," +
      "('contract_signed', 'Your Signed Service Agreement — {business_name}'," +
      " '<p>Hi {customer_name},</p><p>Thank you for signing your service agreement with {business_name}. A copy is attached.</p><p><strong>Total Amount:</strong> {total_amount}<br><strong>Plan:</strong> {num_installments} installments of {installment_amount}<br><strong>First Due:</strong> {first_due_date}</p>'," +
      " 'Sent when customer signs contract')," +
      "('welcome', 'Welcome to {business_name}!'," +
      " '<p>Hi {customer_name},</p><p>Welcome to {business_name}! Your portal account has been created. You can log in at <a href=\"{portal_url}\">{portal_url}</a>.</p><p>Thank you for choosing {business_name}!</p>'," +
      " 'Sent when customer portal account is created')" +
      ' ON CONFLICT (template_key) DO NOTHING'
    );

    // Customer notifications table (in-portal notifications)
    await client.query(`
      CREATE TABLE IF NOT EXISTS customer_notifications (
        id SERIAL PRIMARY KEY,
        customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL,
        title VARCHAR(255) NOT NULL,
        message TEXT,
        is_read BOOLEAN DEFAULT FALSE,
        related_id INTEGER,
        related_type VARCHAR(50),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS cust_notif_customer_idx ON customer_notifications (customer_id, is_read)`);
  },
  down: async (client) => {
    await client.query(`DROP TABLE IF EXISTS customer_notifications`);
    await client.query(`DROP TABLE IF EXISTS email_templates`);
    await client.query(`
      DELETE FROM business_settings WHERE key IN (
        'feature_registration_enabled','feature_online_payments_enabled','feature_contract_signing_enabled',
        'feature_customer_messaging_enabled','feature_remote_repair_requests','maintenance_mode','maintenance_message',
        'landing_hero_headline','landing_hero_subheadline','landing_hero_badge',
        'landing_hero_cta_primary','landing_hero_cta_secondary',
        'landing_about_title','landing_about_body','landing_services_title','landing_testimonials_enabled',
        'theme_primary_color','theme_accent_color','theme_font','theme_logo_url','theme_favicon_url','theme_dark_mode_portal',
        'seo_site_title','seo_meta_description','seo_og_image_url',
        'footer_copyright','social_facebook','social_instagram','social_twitter','business_hours','google_maps_embed',
        'contract_template_body'
      )
    `);
  }
};
