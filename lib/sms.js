/**
 * SMS sending via Twilio.
 * Reads credentials from env or falls back to business_settings.
 */
const { pool } = require('./db');
const logger = require('./logger');

async function trySendSMS(toPhone, message) {
  if (!toPhone) return { ok: false, error: 'No phone number' };

  try {
    // Check if SMS is enabled
    const settingsResult = await pool.query(
      "SELECT key, value FROM business_settings WHERE key IN ('sms_enabled','twilio_account_sid','twilio_auth_token','twilio_from_number')"
    ).catch(() => ({ rows: [] }));

    const settings = {};
    for (const row of settingsResult.rows) settings[row.key] = row.value;

    if (settings.sms_enabled !== 'true') return { ok: false, error: 'SMS disabled' };

    const accountSid = process.env.TWILIO_ACCOUNT_SID || settings.twilio_account_sid;
    const authToken = process.env.TWILIO_AUTH_TOKEN || settings.twilio_auth_token;
    const fromNumber = process.env.TWILIO_FROM_NUMBER || settings.twilio_from_number;

    if (!accountSid || !authToken || !fromNumber) {
      return { ok: false, error: 'Twilio not configured' };
    }

    const resp = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
        },
        body: new URLSearchParams({ To: toPhone, From: fromNumber, Body: message }),
      }
    );

    if (resp.ok) {
      logger.info({ to: toPhone }, 'SMS sent');
      return { ok: true };
    }
    const errBody = await resp.text().catch(() => '');
    logger.error({ to: toPhone, status: resp.status }, 'SMS API error');
    return { ok: false, error: errBody };
  } catch (err) {
    logger.error({ err, to: toPhone }, 'SMS send failed');
    return { ok: false, error: err.message };
  }
}

module.exports = { trySendSMS };
