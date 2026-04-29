/**
 * Database connection pool.
 * Supports direct Supabase connections and Supavisor pooler.
 */
const { Pool } = require('pg');
const logger = require('./logger');

const isProduction = process.env.NODE_ENV === 'production';
const dbUrl = process.env.DATABASE_URL || '';

const pool = new Pool({
  connectionString: dbUrl,
  ssl: isProduction || dbUrl.includes('supabase') || dbUrl.includes('pooler')
    ? { rejectUnauthorized: false }
    : false,
  max: parseInt(process.env.DB_POOL_MAX) || 20,
  idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT) || 30000,
  connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT) || 10000,
});

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected idle client error');
});

// Health check helper
async function checkConnection() {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    return true;
  } finally {
    client.release();
  }
}

module.exports = { pool, checkConnection };
