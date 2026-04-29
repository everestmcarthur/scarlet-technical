module.exports = {
  name: '015_admin_users_phone',
  up: async (client) => {
    await client.query(`
      ALTER TABLE admin_users
        ADD COLUMN IF NOT EXISTS phone VARCHAR(50)
    `);
  }
};
