/**
 * Discord Webhook Integration
 * Sends real-time business notifications to Discord channels.
 *
 * Setup: Create webhooks in each Discord channel and add URLs to .env
 * DISCORD_WEBHOOK_REPAIRS=https://discord.com/api/webhooks/...
 * DISCORD_WEBHOOK_PAYMENTS=https://discord.com/api/webhooks/...
 * DISCORD_WEBHOOK_ALERTS=https://discord.com/api/webhooks/...
 * DISCORD_WEBHOOK_ACTIVITY=https://discord.com/api/webhooks/...
 * DISCORD_WEBHOOK_SUMMARY=https://discord.com/api/webhooks/...
 */
const logger = require('./logger');

const WEBHOOKS = {
  repairs: process.env.DISCORD_WEBHOOK_REPAIRS,
  payments: process.env.DISCORD_WEBHOOK_PAYMENTS,
  alerts: process.env.DISCORD_WEBHOOK_ALERTS,
  activity: process.env.DISCORD_WEBHOOK_ACTIVITY,
  summary: process.env.DISCORD_WEBHOOK_SUMMARY,
};

/**
 * Send a message to a Discord webhook.
 * @param {string} channel - Channel key (repairs, payments, alerts, activity, summary)
 * @param {Object} embed - Discord embed object
 */
async function sendDiscordNotification(channel, embed) {
  const url = WEBHOOKS[channel];
  if (!url) {
    logger.debug({ channel }, 'Discord webhook not configured for channel, skipping');
    return;
  }

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'Scarlet Technical',
        embeds: [embed],
      }),
    });
    if (!resp.ok) {
      logger.warn({ channel, status: resp.status }, 'Discord webhook returned non-OK');
    }
  } catch (err) {
    // Never let Discord failures affect the main app
    logger.error({ err, channel }, 'Discord webhook error');
  }
}

// ─── Pre-built notification helpers ──────────────────────────────────────────

async function notifyNewRepair({ customerName, deviceType, issue, repairId }) {
  await sendDiscordNotification('repairs', {
    title: '🔧 New Repair Request',
    color: 0xE74C3C,  // Red
    fields: [
      { name: 'Customer', value: customerName || 'Unknown', inline: true },
      { name: 'Device', value: deviceType || 'N/A', inline: true },
      { name: 'Issue', value: (issue || 'No description').substring(0, 200) },
      { name: 'Repair ID', value: `#${repairId}`, inline: true },
    ],
    timestamp: new Date().toISOString(),
  });
}

async function notifyPaymentReceived({ customerName, amount, method, invoiceNum }) {
  await sendDiscordNotification('payments', {
    title: '💰 Payment Received',
    color: 0x2ECC71,  // Green
    fields: [
      { name: 'Customer', value: customerName || 'Unknown', inline: true },
      { name: 'Amount', value: `$${(amount / 100).toFixed(2)}`, inline: true },
      { name: 'Method', value: method || 'N/A', inline: true },
      ...(invoiceNum ? [{ name: 'Invoice', value: invoiceNum, inline: true }] : []),
    ],
    timestamp: new Date().toISOString(),
  });
}

async function notifyAlert({ title, message, severity = 'warning' }) {
  const colors = { info: 0x3498DB, warning: 0xF39C12, critical: 0xE74C3C };
  const emojis = { info: 'ℹ️', warning: '⚠️', critical: '🚨' };
  await sendDiscordNotification('alerts', {
    title: `${emojis[severity] || '⚠️'} ${title}`,
    description: message,
    color: colors[severity] || colors.warning,
    timestamp: new Date().toISOString(),
  });
}

async function notifyCustomerActivity({ action, customerName, details }) {
  await sendDiscordNotification('activity', {
    title: `👤 ${action}`,
    color: 0x9B59B6,  // Purple
    fields: [
      { name: 'Customer', value: customerName || 'Unknown', inline: true },
      ...(details ? [{ name: 'Details', value: details }] : []),
    ],
    timestamp: new Date().toISOString(),
  });
}

async function notifyDailySummary({ repairs, revenue, newCustomers, openTickets }) {
  await sendDiscordNotification('summary', {
    title: '📊 Daily Summary',
    color: 0x3498DB,  // Blue
    fields: [
      { name: 'Repairs Today', value: `${repairs || 0}`, inline: true },
      { name: 'Revenue', value: `$${((revenue || 0) / 100).toFixed(2)}`, inline: true },
      { name: 'New Customers', value: `${newCustomers || 0}`, inline: true },
      { name: 'Open Tickets', value: `${openTickets || 0}`, inline: true },
    ],
    timestamp: new Date().toISOString(),
    footer: { text: 'Scarlet Technical — End of Day Report' },
  });
}

module.exports = {
  sendDiscordNotification,
  notifyNewRepair,
  notifyPaymentReceived,
  notifyAlert,
  notifyCustomerActivity,
  notifyDailySummary,
};
