/**
 * Public Booking Routes
 * Customer self-service scheduling — pick a time slot and book an appointment.
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../lib/db');
const logger = require('../lib/logger');
const { notifyCustomerActivity } = require('../lib/discord-webhook');

// Get available time slots for a given date range
router.get('/api/public/available-slots', async (req, res) => {
  try {
    const { start_date, end_date, service_type } = req.query;

    if (!start_date) {
      return res.status(400).json({ error: 'start_date is required (YYYY-MM-DD)' });
    }

    const startDate = start_date;
    const endDate = end_date || start_date;

    // Get business hours from settings (default 9-5, Mon-Fri)
    const settingsResult = await pool.query(
      "SELECT value FROM settings WHERE key = 'business_hours'"
    );
    const businessHours = settingsResult.rows[0]
      ? JSON.parse(settingsResult.rows[0].value)
      : {
          monday: { open: '09:00', close: '17:00' },
          tuesday: { open: '09:00', close: '17:00' },
          wednesday: { open: '09:00', close: '17:00' },
          thursday: { open: '09:00', close: '17:00' },
          friday: { open: '09:00', close: '17:00' },
          saturday: null,
          sunday: null,
          slotDurationMinutes: 60,
        };

    // Get already-booked slots in the range
    const bookedResult = await pool.query(
      `SELECT appointment_date, appointment_time FROM appointments
       WHERE appointment_date BETWEEN $1 AND $2
         AND status NOT IN ('cancelled', 'no-show')`,
      [startDate, endDate]
    );
    const bookedSet = new Set(
      bookedResult.rows.map(r => `${r.appointment_date}T${r.appointment_time}`)
    );

    // Generate available slots
    const slots = [];
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const slotDuration = businessHours.slotDurationMinutes || 60;

    let current = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T23:59:59');

    while (current <= end) {
      const dayName = dayNames[current.getDay()];
      const hours = businessHours[dayName];

      if (hours && hours.open && hours.close) {
        const dateStr = current.toISOString().split('T')[0];
        const [openH, openM] = hours.open.split(':').map(Number);
        const [closeH, closeM] = hours.close.split(':').map(Number);

        let slotMinutes = openH * 60 + openM;
        const closeMinutes = closeH * 60 + closeM;

        while (slotMinutes + slotDuration <= closeMinutes) {
          const h = Math.floor(slotMinutes / 60).toString().padStart(2, '0');
          const m = (slotMinutes % 60).toString().padStart(2, '0');
          const timeStr = `${h}:${m}`;
          const key = `${dateStr}T${timeStr}`;

          if (!bookedSet.has(key)) {
            slots.push({
              date: dateStr,
              time: timeStr,
              available: true,
            });
          }

          slotMinutes += slotDuration;
        }
      }

      current.setDate(current.getDate() + 1);
    }

    res.json({ slots, slotDurationMinutes: slotDuration });
  } catch (err) {
    logger.error({ err }, 'Available slots error');
    res.status(500).json({ error: 'Failed to load available slots' });
  }
});

// Book an appointment (public — no auth required)
router.post('/api/public/book-appointment', async (req, res) => {
  try {
    const {
      name, email, phone,
      date, time,
      service_type, device_type, issue_description,
    } = req.body;

    // Validation
    if (!name || !email || !date || !time) {
      return res.status(400).json({
        error: 'Name, email, date, and time are required',
      });
    }

    // Check slot is still available
    const existing = await pool.query(
      `SELECT id FROM appointments 
       WHERE appointment_date = $1 AND appointment_time = $2
         AND status NOT IN ('cancelled', 'no-show')`,
      [date, time]
    );

    if (existing.rows.length) {
      return res.status(409).json({ error: 'This time slot is no longer available' });
    }

    // Find or create customer
    let customerId;
    const custResult = await pool.query(
      'SELECT id FROM customers WHERE email = $1',
      [email]
    );

    if (custResult.rows.length) {
      customerId = custResult.rows[0].id;
    } else {
      const newCust = await pool.query(
        `INSERT INTO customers (name, email, phone, status, created_at)
         VALUES ($1, $2, $3, 'active', NOW()) RETURNING id`,
        [name, email, phone || null]
      );
      customerId = newCust.rows[0].id;
    }

    // Create appointment
    const apptResult = await pool.query(
      `INSERT INTO appointments (
        customer_id, appointment_date, appointment_time,
        service_type, device_type, notes, status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, 'scheduled', NOW())
      RETURNING id`,
      [customerId, date, time, service_type || null, device_type || null, issue_description || null]
    );

    const appointmentId = apptResult.rows[0].id;

    // Discord notification
    await notifyCustomerActivity({
      action: 'New Appointment Booked',
      customerName: name,
      details: `${date} at ${time} — ${service_type || 'General'} ${device_type ? `(${device_type})` : ''}`,
    });

    logger.info({ appointmentId, customer: name, date, time }, 'Public appointment booked');

    res.status(201).json({
      success: true,
      appointmentId,
      message: `Appointment confirmed for ${date} at ${time}. We'll send a confirmation to ${email}.`,
    });
  } catch (err) {
    logger.error({ err }, 'Public booking error');
    res.status(500).json({ error: 'Failed to book appointment' });
  }
});

// Get service types and pricing for the booking page
router.get('/api/public/booking-services', async (req, res) => {
  try {
    const services = await pool.query(
      `SELECT id, name, description, base_price, estimated_duration
       FROM service_catalog WHERE active = true
       ORDER BY sort_order, name`
    );
    const tiers = await pool.query(
      `SELECT id, name, description, price, features
       FROM service_tiers WHERE active = true
       ORDER BY sort_order, price`
    );
    res.json({
      services: services.rows,
      tiers: tiers.rows,
    });
  } catch (err) {
    logger.error({ err }, 'Booking services error');
    res.status(500).json({ error: 'Failed to load services' });
  }
});

module.exports = router;
