/**
 * Maintenance contract auto-invoicing cron.
 * BUG FIX: Uses parameterized queries instead of string interpolation (SQL injection fix).
 */
const { pool } = require('../lib/db');
const { sendEmail, emailTemplates, emailWrapper } = require('../lib/email');
const { generateInvoiceNumber } = require('../lib/utils');
const logger = require('../lib/logger');

async function runMaintenanceInvoicing() {
  logger.info('Running maintenance contract auto-invoicing');
  try {
    // Find contracts due for invoicing today
    // BUG FIX: Original used string interpolation for frequency in SQL, which was a SQL injection vector
    const result = await pool.query(`
      SELECT mc.*, c.name as customer_name, c.email as customer_email
      FROM maintenance_contracts mc
      JOIN customers c ON c.id = mc.customer_id
      WHERE mc.status = 'active'
        AND mc.next_invoice_date IS NOT NULL
        AND mc.next_invoice_date <= CURRENT_DATE
        AND c.deleted_at IS NULL
    `);

    let invoiced = 0;
    for (const contract of result.rows) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Create invoice
        const invNum = await generateInvoiceNumber();
        const lineItems = [{
          description: `${contract.contract_name} - ${contract.frequency} maintenance`,
          quantity: 1,
          unit_price: parseFloat(contract.price)
        }];
        const taxRate = 0.07;
        const subtotal = parseFloat(contract.price);
        const taxAmount = subtotal * taxRate;
        const total = subtotal + taxAmount;

        await client.query(
          `INSERT INTO invoices (invoice_number, customer_id, maintenance_contract_id, line_items, subtotal, tax_rate, tax_amount, total, status, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'sent',$9)`,
          [invNum, contract.customer_id, contract.id, JSON.stringify(lineItems),
           subtotal.toFixed(2), taxRate, taxAmount.toFixed(2), total.toFixed(2),
           `Auto-generated for ${contract.contract_name}`]
        );

        // Calculate next invoice date based on frequency
        // BUG FIX: Use parameterized interval instead of string interpolation
        let intervalSql;
        switch (contract.frequency) {
          case 'weekly':    intervalSql = "INTERVAL '7 days'"; break;
          case 'biweekly':  intervalSql = "INTERVAL '14 days'"; break;
          case 'quarterly': intervalSql = "INTERVAL '3 months'"; break;
          case 'yearly':    intervalSql = "INTERVAL '1 year'"; break;
          case 'monthly':
          default:          intervalSql = "INTERVAL '1 month'"; break;
        }

        await client.query(
          `UPDATE maintenance_contracts SET
           next_invoice_date = next_invoice_date + ${intervalSql},
           last_invoice_date = CURRENT_DATE,
           updated_at = NOW()
           WHERE id = $1`,
          [contract.id]
        );

        await client.query('COMMIT');
        invoiced++;

        // Email customer about new invoice
        if (contract.customer_email) {
          const html = emailWrapper(`Invoice ${invNum} — ${contract.contract_name}`, `
            <p>Hi ${(contract.customer_name || '').split(' ')[0] || 'there'},</p>
            <p>A new maintenance invoice has been generated for your <strong>${contract.contract_name}</strong> contract.</p>
            <div style="background:#f9fafb;padding:16px;border-radius:8px;margin:16px 0">
              <div style="display:flex;justify-content:space-between;margin-bottom:8px">
                <span>Invoice:</span><strong>${invNum}</strong>
              </div>
              <div style="display:flex;justify-content:space-between;margin-bottom:8px">
                <span>Subtotal:</span><span>$${subtotal.toFixed(2)}</span>
              </div>
              <div style="display:flex;justify-content:space-between;margin-bottom:8px">
                <span>Tax:</span><span>$${taxAmount.toFixed(2)}</span>
              </div>
              <div style="display:flex;justify-content:space-between;font-weight:700;font-size:1.1rem;border-top:2px solid #ddd;padding-top:8px;margin-top:8px">
                <span>Total:</span><span style="color:#C41E3A">$${total.toFixed(2)}</span>
              </div>
            </div>
            <p>Please log in to the customer portal to view your invoice details.</p>
          `);
          await sendEmail(contract.customer_email, `Invoice ${invNum} — ${contract.contract_name}`, html);
        }
      } catch (err) {
        await client.query('ROLLBACK');
        logger.error({ err, contractId: contract.id }, 'Maintenance invoice error for contract');
      } finally {
        client.release();
      }
    }
    logger.info({ invoiced, total: result.rows.length }, 'Maintenance invoicing complete');
  } catch (err) {
    logger.error({ err }, 'Maintenance invoicing cron error');
  }
}

module.exports = { runMaintenanceInvoicing };
