const bcrypt = require('bcrypt');

module.exports = {
  name: '009_seed_admin',
  up: async (client) => {
    // Only create default admin if none exists
    const existing = await client.query('SELECT COUNT(*) FROM admin_users');
    if (parseInt(existing.rows[0].count) > 0) {
      console.log('Admin user already exists, skipping seed.');
      return;
    }
    const password = process.env.ADMIN_INITIAL_PASSWORD || 'SRaeV072521012!?!!?';
    const email = process.env.ADMIN_INITIAL_EMAIL || 'everest@jarviscli.dev';
    const hash = await bcrypt.hash(password, 12);
    await client.query(
      'INSERT INTO admin_users (email, password_hash, name) VALUES ($1, $2, $3)',
      [email, hash, 'Admin']
    );
    console.log('Default admin user created:', email);
  }
};
