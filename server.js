require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 10000;

// DB connection with SSL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('supabase') || process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
});

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Scarlet Technical — testing DB' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

async function start() {
  try {
    // Test DB connection
    const client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    console.log('Database connected:', result.rows[0].now);
    client.release();

    // Try running migrations
    try {
      const { execSync } = require('child_process');
      execSync('node migrate.js', { stdio: 'inherit', cwd: __dirname, timeout: 120000 });
      console.log('Migrations completed');
    } catch (err) {
      console.error('Migration error (non-fatal):', err.message);
    }

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Startup failed:', err.message);
    // Fall back to minimal server without DB
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT} (DB unavailable)`);
    });
  }
}

start();
