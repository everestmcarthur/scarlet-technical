/**
 * Scarlet Technical — IT Support & Device Repair Platform
 * v2.1.0 — Full integration upgrade
 *
 * Entry point: wires together middleware, routes, cron, and starts the server.
 * 
 * Integrations:
 *   - Stripe (payments, checkout, webhooks)
 *   - Sentry (error monitoring)
 *   - Discord (real-time notifications via webhooks)
 *   - Google Drive (document backup)
 *   - SMS 2FA (Twilio)
 */
require('dotenv').config();

const express = require('express');
const session = require('express-session');
const PgStore = require('connect-pg-simple')(session);
const path = require('path');
const cron = require('node-cron');

const logger = require('./lib/logger');
const { pool, checkConnection } = require('./lib/db');
const { helmetMiddleware, authLimiter, apiLimiter, requestId } = require('./middleware/security');
const { notFoundHandler, errorHandler } = require('./middleware/errors');
const { initSentry, sentryErrorHandler } = require('./lib/sentry');

// ─── Validate Required Environment ──────────────────────────────────────────
const required = ['SESSION_SECRET', 'DATABASE_URL'];
for (const key of required) {
  if (!process.env[key]) {
    logger.fatal(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}
if (process.env.ADMIN_SETUP_KEY && process.env.ADMIN_SETUP_KEY.length < 16) {
  logger.warn('ADMIN_SETUP_KEY is short — consider using a stronger key');
}

// ─── App Setup ───────────────────────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3000;

// Trust first proxy (Render)
app.set('trust proxy', 1);

// ─── Sentry (must be first) ─────────────────────────────────────────────────
initSentry(app);

// Request ID
app.use(requestId);

// Security headers + rate limiters
app.use(helmetMiddleware);

// ─── Stripe Webhook (needs raw body — BEFORE json parser) ───────────────────
app.use(require('./routes/stripe-webhook'));

// Body parsing with size limit
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Sessions ────────────────────────────────────────────────────────────────
app.use(session({
  store: new PgStore({
    pool,
    tableName: 'session',
    createTableIfMissing: true,
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    sameSite: 'lax',
  },
}));

// ─── Static Assets ───────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
}));

// ─── Routes ──────────────────────────────────────────────────────────────────
// Health check
app.use(require('./routes/health'));

// Public routes (no auth required)
app.use(require('./routes/public'));
app.use(require('./routes/public-booking'));

// Auth routes (login, setup, recovery)
app.use(require('./routes/auth'));

// Admin routes
app.use(require('./routes/admin/dashboard'));
app.use(require('./routes/admin/customers'));
app.use(require('./routes/admin/repairs'));
app.use(require('./routes/admin/payments'));
app.use(require('./routes/admin/devices'));
app.use(require('./routes/admin/services'));
app.use(require('./routes/admin/users'));
app.use(require('./routes/admin/settings'));
app.use(require('./routes/admin/exports'));

// Customer portal
app.use(require('./routes/portal/index'));
app.use(require('./routes/portal/payments'));

// SMS webhook (Twilio inbound + admin SMS tools)
app.use(require('./routes/sms-webhook'));

// New v3.0 feature routes
app.use(require('./routes/admin/support'));
app.use(require('./routes/admin/operations'));
app.use(require('./routes/admin/billing'));
app.use(require('./routes/admin/repair-workflow'));
app.use(require('./routes/admin/analytics'));
app.use(require('./routes/admin/scheduling'));

// Device agent API
app.use(require('./routes/agent/index'));

// ─── Debug: migration & table status (temporary) ────────────────────────────
app.get('/admin/api/debug-db', async (req, res) => {
  try {
    const { pool } = require('./lib/db');
    const migrations = await pool.query('SELECT name FROM _migrations ORDER BY name');
    const tables = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
    const adminUser = await pool.query('SELECT id, email, name, display_name FROM admin_users ORDER BY id LIMIT 1');
    res.json({
      migrations: migrations.rows.map(r => r.name),
      tables: tables.rows.map(r => r.tablename),
      admin: adminUser.rows[0] || null
    });
  } catch (err) {
    res.json({ error: err.message });
  }
});

// ─── Admin SPA Fallback ─────────────────────────────────────────────────────
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/admin/index.html'));
});
app.get('/admin/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/admin/index.html'));
});

// ─── Error Handlers ──────────────────────────────────────────────────────────
// Sentry error handler (must be before custom error handler)
app.use(sentryErrorHandler());
app.use(notFoundHandler);
app.use(errorHandler);

// ─── Cron Jobs ───────────────────────────────────────────────────────────────
const { runPaymentReminders, runReviewPrompts } = require('./cron/reminders');
const { runMaintenanceInvoicing } = require('./cron/maintenance');
const { runWarrantyChecks } = require('./cron/warranty');
const { runDailySummary } = require('./cron/daily-summary');
const { runReviewCollection } = require('./cron/review-collection');

// Daily at 9 AM ET: payment reminders, review prompts, warranty checks, review collection
cron.schedule('0 9 * * *', async () => {
  await runPaymentReminders();
  await runReviewPrompts();
  await runWarrantyChecks();
  await runReviewCollection();
}, { timezone: 'America/New_York' });

// Daily at 1 AM ET: maintenance contract auto-invoicing
cron.schedule('0 1 * * *', async () => {
  await runMaintenanceInvoicing();
}, { timezone: 'America/New_York' });

// Daily at 6 PM ET: end-of-day summary to Discord + Drive backup
cron.schedule('0 18 * * *', async () => {
  await runDailySummary();
}, { timezone: 'America/New_York' });

// Mark devices offline if no heartbeat in 15 minutes (every 10 min)
cron.schedule('*/10 * * * *', async () => {
  try {
    await pool.query(
      `UPDATE enrolled_devices SET online_status='offline', updated_at=NOW()
       WHERE online_status='online' AND last_seen_at < NOW() - INTERVAL '15 minutes'`
    );
  } catch (err) {
    logger.error({ err }, 'Device offline check error');
  }
});

// ─── Run Migrations & Start Server ──────────────────────────────────────────
async function runMigrations() {
  try {
    const migratePath = require.resolve('./migrate.js');
    delete require.cache[migratePath]; // ensure fresh run
    // Run migrate.js as a child process so it gets its own context
    const { execSync } = require('child_process');
    execSync('node migrate.js', { stdio: 'inherit', cwd: __dirname, timeout: 60000 });
    logger.info('Migrations completed successfully');
  } catch (err) {
    logger.error({ err: err.message }, 'Migration failed — starting server anyway (tables may already exist)');
  }
}

async function start() {
  // 1. Test database connection
  try {
    await checkConnection();
    logger.info('Database connected');
  } catch (err) {
    logger.error({ err: err.message }, 'Database connection failed — will retry on first request');
  }

  // 2. Run migrations (non-fatal)
  try {
    await runMigrations();
  } catch (err) {
    logger.error({ err: err.message }, 'Migration failed — starting server anyway');
  }

  // 3. Always start the HTTP server
  app.listen(PORT, () => {
    logger.info({ port: PORT, env: process.env.NODE_ENV || 'development' },
      `Scarlet Technical v2.1.0 running on port ${PORT}`);
  });
}

start().catch(err => {
  console.error('Fatal startup error:', err);
  // Last resort — start minimal server
  const http = require('http');
  http.createServer((req, res) => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Server startup failed', detail: err.message }));
  }).listen(process.env.PORT || 10000);
});
