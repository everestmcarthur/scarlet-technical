/**
 * Security middleware — helmet, rate limiting, request ID tracking.
 */
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

// ─── Helmet (security headers) ───────────────────────────────────────────────
const helmetMiddleware = helmet({
  contentSecurityPolicy: false, // Disable CSP for admin SPA (inline scripts)
  crossOriginEmbedderPolicy: false,
});

// ─── Rate Limiters ───────────────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in 15 minutes.' },
  keyGenerator: (req) => req.ip || req.headers['x-forwarded-for'] || 'unknown',
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 120, // 120 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded. Please slow down.' },
});

// ─── Request ID ──────────────────────────────────────────────────────────────
function requestId(req, res, next) {
  req.id = crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}

module.exports = { helmetMiddleware, authLimiter, apiLimiter, requestId };
