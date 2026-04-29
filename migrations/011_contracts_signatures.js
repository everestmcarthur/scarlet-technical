module.exports = {
  name: '011_contracts_signatures',
  up: async (client) => {
    // Store signature image as data URL + contract HTML snapshot
    await client.query(`
      ALTER TABLE payment_plans
        ADD COLUMN IF NOT EXISTS contract_html TEXT,
        ADD COLUMN IF NOT EXISTS signature_data_url TEXT,
        ADD COLUMN IF NOT EXISTS data_loss_disclaimer_accepted BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS data_loss_accepted_at TIMESTAMPTZ
    `);
    // Add serial_number and intake_photo_url to repairs
    await client.query(`
      ALTER TABLE repairs
        ADD COLUMN IF NOT EXISTS serial_number VARCHAR(255),
        ADD COLUMN IF NOT EXISTS data_loss_disclaimer BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS rush_repair BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS warranty_of_repair_id INTEGER REFERENCES repairs(id),
        ADD COLUMN IF NOT EXISTS satisfaction_rating VARCHAR(10) CHECK (satisfaction_rating IN ('thumbs_up','thumbs_down')),
        ADD COLUMN IF NOT EXISTS satisfaction_comment TEXT,
        ADD COLUMN IF NOT EXISTS satisfaction_rated_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS google_review_prompted BOOLEAN DEFAULT FALSE
    `);
  }
};
