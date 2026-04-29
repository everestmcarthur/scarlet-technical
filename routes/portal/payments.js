/**
 * Portal Payment Routes
 * Allows customers to pay online via Stripe Checkout.
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../../lib/db');
const logger = require('../../lib/logger');
const { requireCustomer } = require('../../middleware/auth');
const { createCheckoutSession, createSubscriptionSession } = require('../../lib/stripe');

// Pay for a repair
router.post('/api/portal/repairs/:id/pay', requireCustomer, async (req, res) => {
  try {
    const customerId = req.session.customerId;
    const repairId = req.params.id;

    // Verify repair belongs to this customer and has balance due
    const result = await pool.query(
      `SELECT r.*, c.email, c.name as customer_name 
       FROM repairs r JOIN customers c ON r.customer_id = c.id
       WHERE r.id = $1 AND r.customer_id = $2`,
      [repairId, customerId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Repair not found' });
    }

    const repair = result.rows[0];
    if (!repair.estimated_cost || repair.payment_status === 'paid') {
      return res.status(400).json({ error: 'No balance due for this repair' });
    }

    // Calculate amount due (total - already paid)
    const paidResult = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total_paid FROM stripe_payments 
       WHERE repair_id = $1 AND status = 'completed'`,
      [repairId]
    );
    const totalPaid = parseFloat(paidResult.rows[0].total_paid);
    const amountDue = parseFloat(repair.estimated_cost) - totalPaid;

    if (amountDue <= 0) {
      return res.status(400).json({ error: 'Repair is already fully paid' });
    }

    const session = await createCheckoutSession({
      amountCents: Math.round(amountDue * 100),
      description: `Repair #${repairId} — ${repair.device_type || 'Device'} (${repair.issue_description?.substring(0, 50) || 'Repair'})`,
      customerEmail: repair.email,
      metadata: {
        repair_id: repairId.toString(),
        customer_id: customerId.toString(),
        type: 'repair_payment',
      },
    });

    res.json({ checkoutUrl: session.url });
  } catch (err) {
    logger.error({ err }, 'Portal repair payment error');
    res.status(500).json({ error: 'Failed to create payment session' });
  }
});

// Pay a plan installment
router.post('/api/portal/plans/:planId/installments/:installmentId/pay', requireCustomer, async (req, res) => {
  try {
    const customerId = req.session.customerId;
    const { planId, installmentId } = req.params;

    // Verify plan belongs to this customer
    const result = await pool.query(
      `SELECT pp.*, i.amount as installment_amount, i.due_date, i.status as installment_status,
              c.email, c.name as customer_name
       FROM payment_plans pp
       JOIN installments i ON i.plan_id = pp.id
       JOIN customers c ON pp.customer_id = c.id
       WHERE pp.id = $1 AND i.id = $2 AND pp.customer_id = $3`,
      [planId, installmentId, customerId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Installment not found' });
    }

    const plan = result.rows[0];
    if (plan.installment_status === 'paid') {
      return res.status(400).json({ error: 'This installment is already paid' });
    }

    const session = await createCheckoutSession({
      amountCents: Math.round(parseFloat(plan.installment_amount) * 100),
      description: `Payment Plan #${planId} — Installment due ${plan.due_date}`,
      customerEmail: plan.email,
      metadata: {
        plan_id: planId.toString(),
        installment_id: installmentId.toString(),
        customer_id: customerId.toString(),
        type: 'installment_payment',
      },
    });

    res.json({ checkoutUrl: session.url });
  } catch (err) {
    logger.error({ err }, 'Portal installment payment error');
    res.status(500).json({ error: 'Failed to create payment session' });
  }
});

// Pay an invoice
router.post('/api/portal/invoices/:id/pay', requireCustomer, async (req, res) => {
  try {
    const customerId = req.session.customerId;
    const invoiceId = req.params.id;

    const result = await pool.query(
      `SELECT inv.*, c.email, c.name as customer_name
       FROM invoices inv JOIN customers c ON inv.customer_id = c.id
       WHERE inv.id = $1 AND inv.customer_id = $2`,
      [invoiceId, customerId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const invoice = result.rows[0];
    if (invoice.status === 'paid') {
      return res.status(400).json({ error: 'Invoice is already paid' });
    }

    const session = await createCheckoutSession({
      amountCents: Math.round(parseFloat(invoice.total) * 100),
      description: `Invoice ${invoice.invoice_number}`,
      customerEmail: invoice.email,
      metadata: {
        invoice_id: invoiceId.toString(),
        invoice_number: invoice.invoice_number,
        customer_id: customerId.toString(),
        type: 'invoice_payment',
      },
    });

    res.json({ checkoutUrl: session.url });
  } catch (err) {
    logger.error({ err }, 'Portal invoice payment error');
    res.status(500).json({ error: 'Failed to create payment session' });
  }
});

// Subscribe to maintenance plan
router.post('/api/portal/maintenance/subscribe', requireCustomer, async (req, res) => {
  try {
    const customerId = req.session.customerId;
    const { priceId } = req.body;

    if (!priceId) {
      return res.status(400).json({ error: 'Price ID required' });
    }

    const custResult = await pool.query(
      'SELECT email, name FROM customers WHERE id = $1',
      [customerId]
    );

    if (!custResult.rows.length) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const session = await createSubscriptionSession({
      priceId,
      customerEmail: custResult.rows[0].email,
      metadata: {
        customer_id: customerId.toString(),
        type: 'maintenance_subscription',
      },
    });

    res.json({ checkoutUrl: session.url });
  } catch (err) {
    logger.error({ err }, 'Portal subscription error');
    res.status(500).json({ error: 'Failed to create subscription session' });
  }
});

module.exports = router;
