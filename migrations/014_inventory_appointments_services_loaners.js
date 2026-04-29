'use strict';
module.exports = {
  name: '014_inventory_appointments_services_loaners',
  up: async (client) => {
    // Inventory / Parts
    await client.query(`
      CREATE TABLE IF NOT EXISTS inventory_parts (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        sku VARCHAR(100),
        category VARCHAR(100),
        description TEXT,
        quantity INTEGER NOT NULL DEFAULT 0,
        low_stock_threshold INTEGER DEFAULT 3,
        unit_cost NUMERIC(10,2),
        unit_price NUMERIC(10,2),
        supplier VARCHAR(255),
        location VARCHAR(255),
        notes TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Appointments
    await client.query(`
      CREATE TABLE IF NOT EXISTS appointments (
        id SERIAL PRIMARY KEY,
        customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
        customer_name VARCHAR(255),
        customer_phone VARCHAR(50),
        appointment_type VARCHAR(50) DEFAULT 'drop_off',
        device_type VARCHAR(100),
        device_brand VARCHAR(100),
        issue_description TEXT,
        scheduled_at TIMESTAMPTZ NOT NULL,
        duration_minutes INTEGER DEFAULT 30,
        status VARCHAR(50) DEFAULT 'scheduled',
        notes TEXT,
        technician_name VARCHAR(255),
        repair_id INTEGER REFERENCES repairs(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Service Catalog
    await client.query(`
      CREATE TABLE IF NOT EXISTS service_catalog (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        category VARCHAR(100),
        description TEXT,
        base_price NUMERIC(10,2),
        price_max NUMERIC(10,2),
        duration_estimate_minutes INTEGER,
        is_active BOOLEAN DEFAULT TRUE,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Seed default services
    await client.query(`
      INSERT INTO service_catalog (name, category, description, base_price, price_max, duration_estimate_minutes, sort_order)
      VALUES
        ('Virus/Malware Removal', 'Software', 'Full scan, removal, and cleanup of viruses and malware', 49.99, 89.99, 90, 1),
        ('OS Reinstall (Windows)', 'Software', 'Fresh Windows installation with driver setup', 79.99, 129.99, 180, 2),
        ('Speed Optimization', 'Software', 'Startup cleanup, bloatware removal, performance tuning', 39.99, 59.99, 60, 3),
        ('Screen Replacement (Laptop)', 'Hardware', 'LCD/LED screen replacement for laptops', 89.99, 199.99, 120, 4),
        ('Screen Replacement (Phone)', 'Hardware', 'Glass and digitizer replacement for smartphones', 69.99, 149.99, 90, 5),
        ('Battery Replacement', 'Hardware', 'Battery swap for laptops or phones', 49.99, 99.99, 60, 6),
        ('Data Recovery', 'Hardware', 'Recovery of files from failed or damaged drives', 99.99, 299.99, 240, 7),
        ('Hard Drive Replacement', 'Hardware', 'HDD/SSD swap and OS migration', 79.99, 149.99, 120, 8),
        ('New Device Setup', 'Setup', 'Complete setup of a new computer or phone', 49.99, 79.99, 90, 9),
        ('Data Transfer', 'Setup', 'Transfer files, photos, and settings from old device', 39.99, 69.99, 60, 10),
        ('Account Recovery', 'Security', 'Recovery of locked email, social, or device accounts', 29.99, 59.99, 45, 11),
        ('Remote Support Session', 'Remote', 'Remote support via secure screen sharing (per hour)', 39.99, 59.99, 60, 12)
      ON CONFLICT DO NOTHING
    `);

    // Loaners
    await client.query(`
      CREATE TABLE IF NOT EXISTS loaners (
        id SERIAL PRIMARY KEY,
        device_type VARCHAR(100) NOT NULL,
        device_brand VARCHAR(100),
        device_model VARCHAR(100),
        serial_number VARCHAR(255),
        condition VARCHAR(50) DEFAULT 'good',
        status VARCHAR(50) DEFAULT 'available',
        checked_out_to INTEGER REFERENCES customers(id) ON DELETE SET NULL,
        checked_out_at TIMESTAMPTZ,
        due_back_at TIMESTAMPTZ,
        checked_in_at TIMESTAMPTZ,
        repair_id INTEGER REFERENCES repairs(id) ON DELETE SET NULL,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
  }
};
