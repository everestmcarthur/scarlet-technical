/**
 * Health check endpoint with database connectivity test.
 */
const { Router } = require('express');
const { checkConnection } = require('../lib/db');
const logger = require('../lib/logger');

const router = Router();

router.get('/health', async (req, res) => {
  try {
    await checkConnection();
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
  } catch (err) {
    logger.error({ err }, 'Health check failed');
    res.status(503).json({ status: 'unhealthy', error: 'Database unreachable' });
  }
});

module.exports = router;
