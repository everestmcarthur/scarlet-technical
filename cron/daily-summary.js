/**
 * Daily Summary Cron
 * Generates end-of-day business summary and posts to Discord + backs up to Drive.
 */
const { pool } = require('../lib/db');
const logger = require('../lib/logger');
const { notifyDailySummary } = require('../lib/discord-webhook');
const { backupReport } = require('../lib/gdrive');

async function runDailySummary() {
  try {
    const today = new Date().toISOString().split('T')[0];

    // Repairs today
    const repairsResult = await pool.query(
      `SELECT COUNT(*) as total,
              COUNT(*) FILTER (WHERE status = 'completed') as completed,
              COUNT(*) FILTER (WHERE created_at::date = $1) as new_today
       FROM repairs WHERE updated_at::date = $1 OR created_at::date = $1`,
      [today]
    );

    // Revenue today
    const revenueResult = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total_revenue,
              COUNT(*) as payment_count
       FROM payments WHERE created_at::date = $1 AND status = 'completed'`,
      [today]
    );

    // New customers today
    const customersResult = await pool.query(
      `SELECT COUNT(*) as new_customers FROM customers WHERE created_at::date = $1`,
      [today]
    );

    // Open tickets
    const ticketsResult = await pool.query(
      `SELECT COUNT(*) as open_tickets FROM support_tickets WHERE status IN ('open', 'in_progress')`
    );

    // Overdue installments
    const overdueResult = await pool.query(
      `SELECT COUNT(*) as overdue FROM installments 
       WHERE status = 'pending' AND due_date < $1`,
      [today]
    );

    // Appointments tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];
    const appointmentsResult = await pool.query(
      `SELECT COUNT(*) as tomorrow_appointments FROM appointments
       WHERE appointment_date = $1 AND status = 'scheduled'`,
      [tomorrowStr]
    );

    const summary = {
      date: today,
      repairs: {
        total: parseInt(repairsResult.rows[0].total),
        completed: parseInt(repairsResult.rows[0].completed),
        new: parseInt(repairsResult.rows[0].new_today),
      },
      revenue: {
        total: parseFloat(revenueResult.rows[0].total_revenue),
        payments: parseInt(revenueResult.rows[0].payment_count),
      },
      customers: {
        new: parseInt(customersResult.rows[0].new_customers),
      },
      tickets: {
        open: parseInt(ticketsResult.rows[0].open_tickets),
      },
      overdue: {
        installments: parseInt(overdueResult.rows[0].overdue),
      },
      appointments: {
        tomorrow: parseInt(appointmentsResult.rows[0].tomorrow_appointments),
      },
    };

    // Post to Discord
    await notifyDailySummary({
      repairs: summary.repairs.new,
      revenue: Math.round(summary.revenue.total * 100),
      newCustomers: summary.customers.new,
      openTickets: summary.tickets.open,
    });

    // Backup to Google Drive
    await backupReport(summary, 'daily-summary');

    logger.info({ summary }, 'Daily summary generated');
    return summary;
  } catch (err) {
    logger.error({ err }, 'Daily summary cron error');
  }
}

module.exports = { runDailySummary };
