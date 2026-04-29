/**
 * Stripe Integration
 * Handles payment processing via Stripe Checkout and webhooks.
 */
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const logger = require('./logger');

// Product IDs (created in Stripe)
const PRODUCTS = {
  DIAGNOSTIC: process.env.STRIPE_PRODUCT_DIAGNOSTIC || 'prod_UQQj6n3Jwmqm3l',
  STANDARD_REPAIR: process.env.STRIPE_PRODUCT_STANDARD || 'prod_UQQj4swLtuUbYV',
  RUSH_REPAIR: process.env.STRIPE_PRODUCT_RUSH || 'prod_UQQjVuR1NBWwwu',
  MAINTENANCE: process.env.STRIPE_PRODUCT_MAINTENANCE || 'prod_UQQjsOLmWvrRd4',
  REMOTE_SUPPORT: process.env.STRIPE_PRODUCT_REMOTE || 'prod_UQQjEmWeaXc3WC',
};

/**
 * Create a Stripe Checkout session for a one-time payment.
 * @param {Object} opts
 * @param {number} opts.amountCents - Amount in cents
 * @param {string} opts.description - Line item description
 * @param {string} opts.customerEmail - Customer email
 * @param {string} opts.successUrl - Redirect URL on success
 * @param {string} opts.cancelUrl - Redirect URL on cancel
 * @param {Object} opts.metadata - Additional metadata (repair_id, plan_id, etc.)
 * @returns {Object} Stripe Checkout session
 */
async function createCheckoutSession({
  amountCents,
  description,
  customerEmail,
  successUrl,
  cancelUrl,
  metadata = {},
}) {
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: customerEmail,
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: description },
          unit_amount: amountCents,
        },
        quantity: 1,
      }],
      success_url: successUrl || `${process.env.APP_URL}/portal?payment=success`,
      cancel_url: cancelUrl || `${process.env.APP_URL}/portal?payment=cancelled`,
      metadata,
    });
    logger.info({ sessionId: session.id, amount: amountCents }, 'Stripe checkout session created');
    return session;
  } catch (err) {
    logger.error({ err }, 'Failed to create Stripe checkout session');
    throw err;
  }
}

/**
 * Create a Stripe Checkout session for a recurring subscription.
 * @param {Object} opts
 * @param {string} opts.priceId - Stripe Price ID
 * @param {string} opts.customerEmail - Customer email
 * @param {string} opts.successUrl - Redirect URL on success
 * @param {string} opts.cancelUrl - Redirect URL on cancel
 * @param {Object} opts.metadata - Additional metadata
 * @returns {Object} Stripe Checkout session
 */
async function createSubscriptionSession({
  priceId,
  customerEmail,
  successUrl,
  cancelUrl,
  metadata = {},
}) {
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      customer_email: customerEmail,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl || `${process.env.APP_URL}/portal?subscription=success`,
      cancel_url: cancelUrl || `${process.env.APP_URL}/portal?subscription=cancelled`,
      metadata,
    });
    logger.info({ sessionId: session.id, priceId }, 'Stripe subscription session created');
    return session;
  } catch (err) {
    logger.error({ err }, 'Failed to create Stripe subscription session');
    throw err;
  }
}

/**
 * Create a payment link for sharing (e.g., in emails or SMS).
 * @param {Object} opts
 * @param {number} opts.amountCents - Amount in cents
 * @param {string} opts.description - Product name
 * @param {Object} opts.metadata - Additional metadata
 * @returns {Object} Stripe Payment Link
 */
async function createPaymentLink({ amountCents, description, metadata = {} }) {
  try {
    // Create an ad-hoc price
    const price = await stripe.prices.create({
      currency: 'usd',
      unit_amount: amountCents,
      product_data: { name: description },
    });
    const link = await stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }],
      metadata,
    });
    logger.info({ linkId: link.id, url: link.url }, 'Payment link created');
    return link;
  } catch (err) {
    logger.error({ err }, 'Failed to create payment link');
    throw err;
  }
}

/**
 * Verify and parse a Stripe webhook event.
 * @param {Buffer} rawBody - Raw request body
 * @param {string} signature - Stripe-Signature header
 * @returns {Object} Verified Stripe event
 */
function verifyWebhook(rawBody, signature) {
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!endpointSecret) {
    throw new Error('STRIPE_WEBHOOK_SECRET not configured');
  }
  return stripe.webhooks.constructEvent(rawBody, signature, endpointSecret);
}

/**
 * Retrieve a Checkout session with line items.
 * @param {string} sessionId - Stripe session ID
 * @returns {Object} Session with line items
 */
async function retrieveSession(sessionId) {
  return stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['line_items', 'customer'],
  });
}

module.exports = {
  stripe,
  PRODUCTS,
  createCheckoutSession,
  createSubscriptionSession,
  createPaymentLink,
  verifyWebhook,
  retrieveSession,
};
