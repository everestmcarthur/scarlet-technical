/**
 * Structured logger with request tracking.
 * Uses pino in production, pino-pretty for development.
 */
const pino = require('pino');

const isDev = process.env.NODE_ENV !== 'production';

const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
  ...(isDev ? { transport: { target: 'pino-pretty', options: { colorize: true } } } : {}),
});

module.exports = logger;
