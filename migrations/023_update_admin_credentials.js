const bcrypt = require('bcrypt');

module.exports = {
  name: '023_update_admin_credentials',
  up: async (client) => {
    const newEmail = 'everest@jarviscli.dev';
    const newPassword = 'SRaeV072521012!?!!?';
    
    // Check if there's an admin user to update
    const existing = await client.query('SELECT id, email FROM admin_users ORDER BY id ASC LIMIT 1');
    if (!existing.rows.length) {
      console.log('No admin user found, skipping credential update.');
      return;
    }
    
    const admin = existing.rows[0];
    const hash = await bcrypt.hash(newPassword, 12);
    
    await client.query(
      'UPDATE admin_users SET email = $1, password_hash = $2, name = $3, display_name = $4 WHERE id = $5',
      [newEmail, hash, 'Everest', 'Everest', admin.id]
    );
    
    console.log(`Admin credentials updated: ${admin.email} → ${newEmail}`);
  }
};
