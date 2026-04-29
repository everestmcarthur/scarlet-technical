/**
 * Database connection pool.
 * Supports Render internal PostgreSQL (no SSL) and external connections (SSL).
 */
const { Pool } = require('pg');
const logger = require('./logger');

const dbUrl = process.env.DATABASE_URL || '';
const isProduction = process.env.NODE_ENV === 'production';

// Render internal connections don't need SSL; external/Supabase do
const needsSSL = dbUrl.includes('supabase') || dbUrl.includes('pooler') || 
                 (isProduction && dbUrl.includes('.render.com'));

const pool = new Pool({
  connectionString: dbUrl,
  ssl: needsSSL ? { rejectUnauthorized: false } : false,
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
