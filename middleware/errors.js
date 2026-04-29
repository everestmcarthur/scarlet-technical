/**
 * Error handling middleware.
 */
const logger = require('../lib/logger');

// 404 handler — unknown routes
function notFoundHandler(req, res) {
  if (req.accepts('html')) {
    return res.status(404).send(`
      <!DOCTYPE html>
      <html><head><title>404 — Scarlet Technical</title>
      <style>body{font-family:Inter,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f4f6fa;color:#1a1a2e}
      .box{text-align:center}.code{font-size:4rem;font-weight:700;color:#C41E3A;margin:0}p{color:#666}a{color:#C41E3A;font-weight:600}</style></head>
      <body><div class="box"><p class="code">404</p><p>Page not found</p><p><a href="/">Go Home</a> · <a href="/portal">Customer Portal</a></p></div></body></html>
    `);
  }
  res.status(404).json({ error: 'Not found' });
}

// Global error handler — catches unhandled errors in routes
function errorHandler(err, req, res, _next) {
  logger.error({ err, method: req.method, path: req.path, requestId: req.id }, 'Unhandled error');
  const status = err.status || 500;
  const message = process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message;
  res.status(status).json({ error: message });
}

module.exports = { notFoundHandler, errorHandler };
