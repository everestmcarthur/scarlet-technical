/**
 * Sentry Error Monitoring Integration
 * 
 * DSN: https://b1decf9ab3a6405e4d94b499c53bcc37@o4510960090873856.ingest.us.sentry.io/4511303978057728
 * Project: scarlet-technical (ally-ee org)
 */
const Sentry = require('@sentry/node');
const logger = require('./logger');

function initSentry(app) {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    logger.warn('SENTRY_DSN not set — error monitoring disabled');
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    release: `scarlet-technical@${process.env.npm_package_version || '2.0.0'}`,
    
    // Performance monitoring
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
    
    // Filter sensitive data
    beforeSend(event) {
      // Strip passwords and tokens from request data
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

  // Express integration
  if (app) {
    // Request handler must be first middleware
    app.use(Sentry.Handlers.requestHandler());
    // Tracing handler for performance
    app.use(Sentry.Handlers.tracingHandler());
  }

  logger.info('Sentry error monitoring initialized');
}

/**
 * Sentry error handler middleware (add after routes, before other error handlers).
 */
function sentryErrorHandler() {
  return Sentry.Handlers.errorHandler({
    shouldHandleError(error) {
      // Capture 4xx and 5xx errors
      if (error.status) {
        return error.status >= 400;
      }
      return true;
    },
  });
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
  captureException,
  captureMessage,
  setUser,
  Sentry,
};
