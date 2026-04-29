/**
 * Stripe Webhook Handler
 * Processes payment events from Stripe and updates the database.
 * 
 * Endpoint: POST /api/stripe/webhook
 * Must use raw body parsing (not JSON) for signature verification.
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../lib/db');
const logger = require('../lib/logger');
const { verifyWebhook, retrieveSession } = require('../lib/stripe');
const { notifyPaymentReceived, notifyAlert } = require('../lib/discord-webhook');
const { sendEmail } = require('../lib/email');
const { auditLog } = require('../lib/audit');

// Raw body parser for webhook signature verification
router.post('/api/stripe/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
      event = verifyWebhook(req.body, sig);
    } catch (err) {
      logger.warn({ err }, 'Stripe webhook signature verification failed');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    logger.info({ type: event.type, id: event.id }, 'Stripe webhook received');

    try {
      switch (event.type) {
        case 'checkout.session.completed':
          await handleCheckoutComplete(event.data.object);
          break;
        case 'payment_intent.succeeded':
          await handlePaymentSucceeded(event.data.object);
          break;
        case 'payment_intent.payment_failed':
          await handlePaymentFailed(event.data.object);
          break;
        case 'invoice.paid':
          await handleInvoicePaid(event.data.object);
          break;
        case 'customer.subscription.deleted':
          await handleSubscriptionCanceled(event.data.object);
          break;
        default:
          logger.debug({ type: event.type }, 'Unhandled webhook event type');
      }
    } catch (err) {
      logger.error({ err, eventType: event.type }, 'Webhook handler error');
      // Return 200 to prevent Stripe from retrying (we logged the error)
    }

    res.json({ received: true });
  }
);

async function handleCheckoutComplete(session) {
  const { metadata } = session;
  const amountTotal = session.amount_total; // cents
  const customerEmail = session.customer_email || session.customer_details?.email;

  logger.info({ sessionId: session.id, amount: amountTotal, metadata }, 'Checkout completed');

  // Record payment in database based on metadata
  if (metadata?.repair_id) {
    await recordRepairPayment(metadata.repair_id, amountTotal, customerEmail, session.id);
  } else if (metadata?.plan_id && metadata?.installment_id) {
    await recordInstallmentPayment(metadata.plan_id, metadata.installment_id, amountTotal, session.id);
  } else if (metadata?.invoice_id) {
    await recordInvoicePayment(metadata.invoice_id, amountTotal, session.id);
  }

  // Discord notification
  const custResult = await pool.query(
    'SELECT name FROM customers WHERE email = $1 LIMIT 1',
    [customerEmail]
  );
  await notifyPaymentReceived({
    customerName: custResult.rows[0]?.name || customerEmail,
    amount: amountTotal,
    method: 'Stripe',
    invoiceNum: metadata?.invoice_number,
  });
}

async function recordRepairPayment(repairId, amountCents, email, sessionId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create payment record
    await client.query(
      `INSERT INTO payments (repair_id, amount, method, status, stripe_session_id, created_at)
       VALUES ($1, $2, 'stripe', 'completed', $3, NOW())`,
      [repairId, amountCents / 100, sessionId]
    );

    // Update repair status if fully paid
    await client.query(
      `UPDATE repairs SET payment_status = 'paid', updated_at = NOW() WHERE id = $1`,
      [repairId]
    );

    await client.query('COMMIT');
    logger.info({ repairId, amount: amountCents / 100 }, 'Repair payment recorded');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err, repairId }, 'Failed to record repair payment');
    throw err;
  } finally {
    client.release();
  }
}

async function recordInstallmentPayment(planId, installmentId, amountCents, sessionId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE installments SET status = 'paid', paid_at = NOW(), 
       stripe_session_id = $1, updated_at = NOW()
       WHERE id = $2 AND plan_id = $3`,
      [sessionId, installmentId, planId]
    );

    // Check if all installments are paid
    const remaining = await client.query(
      `SELECT COUNT(*) as cnt FROM installments WHERE plan_id = $1 AND status != 'paid'`,
      [planId]
    );
    if (parseInt(remaining.rows[0].cnt) === 0) {
      await client.query(
        `UPDATE payment_plans SET status = 'completed', updated_at = NOW() WHERE id = $1`,
        [planId]
      );
    }

    await client.query('COMMIT');
    logger.info({ planId, installmentId, amount: amountCents / 100 }, 'Installment payment recorded');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err, planId, installmentId }, 'Failed to record installment payment');
    throw err;
  } finally {
    client.release();
  }
}

async function recordInvoicePayment(invoiceId, amountCents, sessionId) {
  await pool.query(
    `UPDATE invoices SET status = 'paid', paid_at = NOW(), 
     stripe_session_id = $1, updated_at = NOW()
     WHERE id = $2`,
    [sessionId, invoiceId]
  );
  logger.info({ invoiceId, amount: amountCents / 100 }, 'Invoice payment recorded');
}

async function handlePaymentSucceeded(paymentIntent) {
  logger.info({ piId: paymentIntent.id, amount: paymentIntent.amount }, 'Payment intent succeeded');
}

async function handlePaymentFailed(paymentIntent) {
  logger.warn({
    piId: paymentIntent.id,
    error: paymentIntent.last_payment_error?.message,
  }, 'Payment intent failed');

  await notifyAlert({
    title: 'Payment Failed',
    message: `Payment of $${(paymentIntent.amount / 100).toFixed(2)} failed: ${paymentIntent.last_payment_error?.message || 'Unknown error'}`,
    severity: 'warning',
  });
}

async function handleInvoicePaid(invoice) {
  logger.info({ invoiceId: invoice.id, amount: invoice.amount_paid }, 'Stripe invoice paid');
}

async function handleSubscriptionCanceled(subscription) {
  logger.info({ subId: subscription.id }, 'Subscription canceled');
  await notifyAlert({
    title: 'Subscription Canceled',
    message: `Subscription ${subscription.id} has been canceled.`,
    severity: 'info',
  });
}

module.exports = router;
