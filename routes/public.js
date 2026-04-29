/**
 * Public-facing API routes (no auth required).
 * - Repair request submission
 * - Public settings
 * - Service tiers
 * - Landing page
 */
const { Router } = require('express');
const path = require('path');
const fs = require('fs');
const { pool } = require('../lib/db');
const logger = require('../lib/logger');

const router = Router();

// ─── Public Repair Request ───────────────────────────────────────────────────
router.post('/api/repair-request', async (req, res) => {
  const { name, email, phone, device_type, device_brand, issue_description, preferred_contact, service_type } = req.body;
  if (!name || !issue_description) {
    return res.status(400).json({ error: 'Name and issue description required' });
  }
  const svcType = ['in_person', 'remote'].includes(service_type) ? service_type : 'in_person';
  try {
    const result = await pool.query(
      `INSERT INTO repair_requests (name, email, phone, device_type, device_brand, issue_description, preferred_contact, service_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [name, email || null, phone || null, device_type || null, device_brand || null, issue_description, preferred_contact || 'email', svcType]
    );
    res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    logger.error({ err }, 'Repair request submission failed');
    res.status(500).json({ error: 'Failed to submit request' });
  }
});

// ─── Public Settings (for landing page) ──────────────────────────────────────
router.get('/api/public-settings', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT key, value FROM business_settings WHERE key LIKE 'landing_%' OR key LIKE 'theme_%' OR key LIKE 'seo_%'
       OR key LIKE 'footer_%' OR key LIKE 'social_%'
       OR key IN ('business_name','business_phone','business_email','business_address','business_hours','maintenance_mode','maintenance_message','feature_registration_enabled')`
    );
    const settings = {};
    for (const row of r.rows) settings[row.key] = row.value;
    res.json(settings);
  } catch {
    res.json({ business_name: 'Scarlet Technical' });
  }
});

// ─── Public Service Tiers ────────────────────────────────────────────────────
router.get('/api/service-tiers', async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT id, name, slug, turnaround_hours, price_multiplier, color FROM service_tiers WHERE is_active=true ORDER BY sort_order'
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Landing Page ────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const slug = process.env.POLSIA_ANALYTICS_SLUG || '';
  const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
  if (fs.existsSync(htmlPath)) {
    let html = fs.readFileSync(htmlPath, 'utf8');
    html = html.replace('__POLSIA_SLUG__', slug);
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.type('html').send(html);
  } else {
    res.json({ message: 'Scarlet Technical', status: 'running' });
  }
});

module.exports = router;
