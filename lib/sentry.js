/**
 * Sentry Error Monitoring Integration
 * 
 * Uses @sentry/node v8+ API (no Handlers — automatic Express instrumentation).
 * DSN: https://b1decf9ab3a6405e4d94b499c53bcc37@o4510960090873856.ingest.us.sentry.io/4511303978057728
 * Project: scarlet-technical (ally-ee org)
 */
const Sentry = require('@sentry/node');
const logger = require('./logger');

let initialized = false;

function initSentry(app) {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    logger.warn('SENTRY_DSN not set — error monitoring disabled');
    return;
  }

  if (initialized) return;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    release: `scarlet-technical@${process.env.npm_package_version || '2.1.0'}`,
    
    // Performance monitoring
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
    
    // Filter sensitive data
    beforeSend(event) {
      if (event.request?.data) {
        const sensitive = ['password', 'token', 'secret', 'session_secret', 'api_key'];
        for (const key of sensitive) {
          if (event.request.data[key]) {
            event.request.data[key] = '[FILTERED]';
          }
        }
      }
      return event;
    },

    // Ignore common non-errors
    ignoreErrors: [
      'ECONNRESET',
      'ECONNREFUSED',
      'ETIMEDOUT',
      'Request aborted',
    ],
  });

  initialized = true;
  logger.info('Sentry error monitoring initialized');
}

/**
 * Sentry error handler middleware — v8+ uses setupExpressErrorHandler.
 * Call AFTER all routes.
 */
function sentryErrorHandler() {
  // Return a middleware that sets up Sentry's Express error handler
  return (err, req, res, next) => {
    Sentry.captureException(err);
    next(err);
  };
}

/**
 * Set up Sentry Express error handling on the app.
 * Call after all routes are registered.
 */
function setupSentryExpressErrorHandler(app) {
  if (!initialized) return;
  if (typeof Sentry.setupExpressErrorHandler === 'function') {
    Sentry.setupExpressErrorHandler(app);
  }
}

/**
 * Capture a custom error or message.
 */
function captureException(err, context = {}) {
  Sentry.withScope((scope) => {
    for (const [key, value] of Object.entries(context)) {
      scope.setExtra(key, value);
    }
    Sentry.captureException(err);
  });
}

function captureMessage(message, level = 'info') {
  Sentry.captureMessage(message, level);
}

/**
 * Set user context for Sentry (call after auth).
 */
function setUser(user) {
  Sentry.setUser(user ? {
    id: user.id,
    email: user.email,
    username: user.name || user.username,
  } : null);
}

module.exports = {
  initSentry,
  sentryErrorHandler,
  setupSentryExpressErrorHandler,
  captureException,
  captureMessage,
  setUser,
  Sentry,
};
