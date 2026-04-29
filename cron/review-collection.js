/**
 * Automated Review Collection Cron
 * After a repair is completed, sends a satisfaction survey.
 * Good ratings prompt customers to leave a Google review.
 */
const { pool } = require('../lib/db');
const logger = require('../lib/logger');
const { sendEmail } = require('../lib/email');
const { trySendSMS: sendSMS } = require('../lib/sms');

const GOOGLE_REVIEW_URL = process.env.GOOGLE_REVIEW_URL || 'https://g.page/r/YOUR_REVIEW_LINK';

/**
 * Send review requests to customers whose repairs were completed recently.
 * Uses `review_prompt_due_at` column (set when repair is marked complete).
 */
async function runReviewCollection() {
  try {
    const result = await pool.query(
      `SELECT r.id as repair_id, r.device_type, r.issue_description,
              c.id as customer_id, c.name, c.email, c.phone,
              r.satisfaction_rating
       FROM repairs r
       JOIN customers c ON r.customer_id = c.id
       WHERE r.review_prompt_due_at IS NOT NULL
         AND r.review_prompt_due_at <= NOW()
         AND r.review_sent = false
         AND r.status = 'completed'`
    );

    if (!result.rows.length) {
      logger.debug('No review prompts due');
      return;
    }

    logger.info({ count: result.rows.length }, 'Sending review collection requests');

    for (const row of result.rows) {
      try {
        const surveyUrl = `${process.env.APP_URL || 'https://jarviscli.dev'}/portal/satisfaction?repair=${row.repair_id}`;

        // If they already gave a high rating, skip survey and ask for Google review
        if (row.satisfaction_rating && row.satisfaction_rating >= 4) {
          await sendGoogleReviewRequest(row);
        } else if (!row.satisfaction_rating) {
          // Send satisfaction survey
          await sendSurveyRequest(row, surveyUrl);
        }

        // Mark as sent
        await pool.query(
          'UPDATE repairs SET review_sent = true, updated_at = NOW() WHERE id = $1',
          [row.repair_id]
        );
      } catch (err) {
        logger.error({ err, repairId: row.repair_id }, 'Failed to send review request');
      }
    }
  } catch (err) {
    logger.error({ err }, 'Review collection cron error');
  }
}

async function sendSurveyRequest(row, surveyUrl) {
  const subject = 'How was your repair experience?';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #E74C3C; color: white; padding: 20px; text-align: center;">
        <h1 style="margin: 0;">Scarlet Technical</h1>
      </div>
      <div style="padding: 30px; background: #f9f9f9;">
        <h2>Hi ${row.name || 'there'}!</h2>
        <p>Your ${row.device_type || 'device'} repair has been completed. We'd love to hear about your experience!</p>
        <p>It takes less than 30 seconds:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${surveyUrl}" style="background: #E74C3C; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-size: 16px;">
            Rate Your Experience
          </a>
        </div>
        <p style="color: #666; font-size: 14px;">Your feedback helps us improve our service for everyone.</p>
      </div>
      <div style="padding: 15px; text-align: center; color: #999; font-size: 12px;">
        Scarlet Technical — Low-Cost IT Support & Device Repair<br>Muncie, Indiana
      </div>
    </div>
  `;

  if (row.email) {
    await sendEmail(row.email, subject, html);
  }
  if (row.phone) {
    await sendSMS(row.phone, `Hi ${row.name}! How was your repair at Scarlet Technical? Rate your experience: ${surveyUrl}`);
  }

  logger.info({ customerId: row.customer_id, repairId: row.repair_id }, 'Survey request sent');
}

async function sendGoogleReviewRequest(row) {
  const subject = 'Thanks for your great rating! 🌟';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #E74C3C; color: white; padding: 20px; text-align: center;">
        <h1 style="margin: 0;">Scarlet Technical</h1>
      </div>
      <div style="padding: 30px; background: #f9f9f9;">
        <h2>Thank you, ${row.name || 'valued customer'}! 🎉</h2>
        <p>We're thrilled you had a great experience with us!</p>
        <p>Would you mind taking a moment to share your experience on Google? It helps other people in Muncie find reliable tech support.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${GOOGLE_REVIEW_URL}" style="background: #4285F4; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-size: 16px;">
            ⭐ Leave a Google Review
          </a>
        </div>
        <p style="color: #666; font-size: 14px;">It only takes a minute and means the world to us!</p>
      </div>
      <div style="padding: 15px; text-align: center; color: #999; font-size: 12px;">
        Scarlet Technical — Low-Cost IT Support & Device Repair<br>Muncie, Indiana
      </div>
    </div>
  `;

  if (row.email) {
    await sendEmail(row.email, subject, html);
  }
  if (row.phone) {
    await sendSMS(row.phone, `Thanks for the great rating, ${row.name}! Would you mind leaving us a Google review? ${GOOGLE_REVIEW_URL} — Scarlet Technical`);
  }

  logger.info({ customerId: row.customer_id }, 'Google review request sent');
}

module.exports = { runReviewCollection };
