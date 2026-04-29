module.exports = {
  name: '018_twelve_features',
  up: async (client) => {

    // ── Repair Status History ───────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS repair_status_history (
        id SERIAL PRIMARY KEY,
        repair_id INTEGER NOT NULL REFERENCES repairs(id) ON DELETE CASCADE,
        status VARCHAR(50) NOT NULL,
        notes TEXT,
        changed_by INTEGER REFERENCES admin_users(id),
        changed_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS rsh_repair_idx ON repair_status_history(repair_id)`);

    // ── Repair Photos ────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS repair_photos (
        id SERIAL PRIMARY KEY,
        repair_id INTEGER NOT NULL REFERENCES repairs(id) ON DELETE CASCADE,
        stage VARCHAR(20) DEFAULT 'before' CHECK (stage IN ('before','after','progress')),
        photo_data TEXT,
        caption TEXT,
        uploaded_by INTEGER REFERENCES admin_users(id),
        uploaded_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS rp_repair_idx ON repair_photos(repair_id)`);

    // ── Intake Checklists ────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS intake_checklists (
        id SERIAL PRIMARY KEY,
        repair_id INTEGER UNIQUE NOT NULL REFERENCES repairs(id) ON DELETE CASCADE,
        screen_cond VARCHAR(10) DEFAULT 'na' CHECK (screen_cond IN ('pass','fail','na')),
        screen_notes TEXT,
        buttons_cond VARCHAR(10) DEFAULT 'na' CHECK (buttons_cond IN ('pass','fail','na')),
        buttons_notes TEXT,
        battery_cond VARCHAR(10) DEFAULT 'na' CHECK (battery_cond IN ('pass','fail','na')),
        battery_notes TEXT,
        water_cond VARCHAR(10) DEFAULT 'na' CHECK (water_cond IN ('pass','fail','na')),
        water_notes TEXT,
        ports_cond VARCHAR(10) DEFAULT 'na' CHECK (ports_cond IN ('pass','fail','na')),
        ports_notes TEXT,
        cosmetic_cond VARCHAR(10) DEFAULT 'na' CHECK (cosmetic_cond IN ('pass','fail','na')),
        cosmetic_notes TEXT,
        power_test VARCHAR(10) DEFAULT 'na' CHECK (power_test IN ('pass','fail','na')),
        power_notes TEXT,
        audio_test VARCHAR(10) DEFAULT 'na' CHECK (audio_test IN ('pass','fail','na')),
        audio_notes TEXT,
        customer_signature TEXT,
        customer_name VARCHAR(255),
        completed_by INTEGER REFERENCES admin_users(id),
        completed_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // ── Invoices ─────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS invoices (
        id SERIAL PRIMARY KEY,
        invoice_number VARCHAR(50) UNIQUE,
        repair_id INTEGER REFERENCES repairs(id) ON DELETE SET NULL,
        payment_plan_id INTEGER REFERENCES payment_plans(id) ON DELETE SET NULL,
        maintenance_contract_id INTEGER,
        customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        line_items JSONB DEFAULT '[]',
        subtotal DECIMAL(10,2) DEFAULT 0,
        tax_rate DECIMAL(5,4) DEFAULT 0.0700,
        tax_amount DECIMAL(10,2) DEFAULT 0,
        discount_amount DECIMAL(10,2) DEFAULT 0,
        total DECIMAL(10,2) DEFAULT 0,
        status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft','sent','paid','cancelled')),
        notes TEXT,
        created_by INTEGER REFERENCES admin_users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS inv_customer_idx ON invoices(customer_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS inv_repair_idx ON invoices(repair_id)`);

    // ── Service Tiers ────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS service_tiers (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        slug VARCHAR(50) UNIQUE NOT NULL,
        turnaround_hours INTEGER DEFAULT 72,
        price_multiplier DECIMAL(4,2) DEFAULT 1.00,
        color VARCHAR(20) DEFAULT 'green',
        sort_order INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT TRUE
      )
    `);
    await client.query(`
      INSERT INTO service_tiers (name, slug, turnaround_hours, price_multiplier, color, sort_order)
      VALUES
        ('Standard', 'standard', 72,  1.00, 'green',  1),
        ('Rush',     'rush',     24,  1.50, 'orange', 2),
        ('Emergency','emergency', 4,  2.00, 'red',    3)
      ON CONFLICT (slug) DO NOTHING
    `);

    // ── Time Entries ─────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS time_entries (
        id SERIAL PRIMARY KEY,
        repair_id INTEGER NOT NULL REFERENCES repairs(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES admin_users(id),
        started_at TIMESTAMPTZ,
        ended_at TIMESTAMPTZ,
        duration_minutes INTEGER,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS te_repair_idx ON time_entries(repair_id)`);

    // ── Maintenance Contracts ────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS maintenance_contracts (
        id SERIAL PRIMARY KEY,
        customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        contract_name VARCHAR(255) NOT NULL,
        devices_covered TEXT,
        frequency VARCHAR(20) DEFAULT 'monthly' CHECK (frequency IN ('monthly','quarterly','annual')),
        price DECIMAL(10,2) DEFAULT 0,
        services_included TEXT,
        status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','paused','cancelled')),
        start_date DATE,
        next_invoice_date DATE,
        notes TEXT,
        created_by INTEGER REFERENCES admin_users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS mc_customer_idx ON maintenance_contracts(customer_id)`);

    // ── Add columns to repairs ────────────────────────────────────────────────
    await client.query(`ALTER TABLE repairs ADD COLUMN IF NOT EXISTS service_tier_id INTEGER REFERENCES service_tiers(id)`);
    await client.query(`ALTER TABLE repairs ADD COLUMN IF NOT EXISTS warranty_period_days INTEGER DEFAULT 0`);
    await client.query(`ALTER TABLE repairs ADD COLUMN IF NOT EXISTS warranty_starts_at TIMESTAMPTZ`);
    await client.query(`ALTER TABLE repairs ADD COLUMN IF NOT EXISTS warranty_expires_at TIMESTAMPTZ`);
    await client.query(`ALTER TABLE repairs ADD COLUMN IF NOT EXISTS is_warranty_claim BOOLEAN DEFAULT FALSE`);
    await client.query(`ALTER TABLE repairs ADD COLUMN IF NOT EXISTS review_prompt_sent_at TIMESTAMPTZ`);

    // ── Invoice counter sequence helper ──────────────────────────────────────
    await client.query(`CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START 1000`);
  },
  down: async (client) => {
    await client.query(`DROP TABLE IF EXISTS maintenance_contracts CASCADE`);
    await client.query(`DROP TABLE IF EXISTS time_entries CASCADE`);
    await client.query(`DROP TABLE IF EXISTS service_tiers CASCADE`);
    await client.query(`DROP TABLE IF EXISTS invoices CASCADE`);
    await client.query(`DROP TABLE IF EXISTS intake_checklists CASCADE`);
    await client.query(`DROP TABLE IF EXISTS repair_photos CASCADE`);
    await client.query(`DROP TABLE IF EXISTS repair_status_history CASCADE`);
    await client.query(`DROP SEQUENCE IF EXISTS invoice_number_seq`);
  }
};
