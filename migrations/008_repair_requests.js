module.exports = {
  name: '008_repair_requests',
  up: async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS repair_requests (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        phone VARCHAR(50),
        device_type VARCHAR(100),
        device_brand VARCHAR(100),
        issue_description TEXT,
        preferred_contact VARCHAR(50) DEFAULT 'email',
        status VARCHAR(50) DEFAULT 'new'
          CHECK (status IN ('new','contacted','converted','closed')),
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
  }
};
