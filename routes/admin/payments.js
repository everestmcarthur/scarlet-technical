/**
 * Admin payment plans, installments, contracts, invoices, maintenance contracts.
 */
const { Router } = require('express');
const { pool } = require('../../lib/db');
const { requireAdmin } = require('../../middleware/auth');
const { auditLog } = require('../../lib/audit');
const { sendEmail, emailTemplates, emailWrapper } = require('../../lib/email');
const { generateInvoiceNumber } = require('../../lib/utils');
const { generateContractHTML, generateInvoiceHTML } = require('../../lib/documents');
const logger = require('../../lib/logger');

const router = Router();

// ─── Payment Plans: List ─────────────────────────────────────────────────────
router.get('/admin/api/payment-plans', requireAdmin, async (req, res) => {
  const { status, customer_id } = req.query;
  let q = `SELECT pp.*, c.name as customer_name, c.email as customer_email,
    r.device_brand, r.device_model, r.device_type,
    COUNT(CASE WHEN i.status='paid' THEN 1 END)::int AS paid_installments,
    COUNT(i.id)::int AS total_installments,
    COUNT(CASE WHEN i.status='pending' AND i.due_date < CURRENT_DATE THEN 1 END)::int AS overdue_count
    FROM payment_plans pp JOIN customers c ON c.id=pp.customer_id
    LEFT JOIN repairs r ON r.id=pp.repair_id
    LEFT JOIN installments i ON i.payment_plan_id=pp.id`;
  const params = [];
  const conditions = [];
  if (status) { params.push(status); conditions.push(`pp.status=$${params.length}`); }
  if (customer_id) { params.push(customer_id); conditions.push(`pp.customer_id=$${params.length}`); }
  if (conditions.length) q += ` WHERE ${conditions.join(' AND ')}`;
  q += ' GROUP BY pp.id, c.name, c.email, r.device_brand, r.device_model, r.device_type ORDER BY pp.created_at DESC';
  try {
    const result = await pool.query(q, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Payment Plans: Create ───────────────────────────────────────────────────
router.post('/admin/api/payment-plans', requireAdmin, async (req, res) => {
  const { customer_id, repair_id, template_id, total_amount, down_payment, num_installments,
          frequency, first_due_date, auto_charge, notes, first_payment_required } = req.body;
  if (!customer_id || !total_amount || !num_installments) {
    return res.status(400).json({ error: 'customer_id, total_amount, num_installments required' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const dp = parseFloat(down_payment || 0);
    const remaining = parseFloat(total_amount) - dp;
    const n = parseInt(num_installments);
    // BUG FIX: Round normally, last installment absorbs remainder
    const baseAmt = Math.round((remaining / n) * 100) / 100;
    const lastAmt = Math.round((remaining - baseAmt * (n - 1)) * 100) / 100;

    const planResult = await client.query(
      `INSERT INTO payment_plans (customer_id, repair_id, template_id, total_amount, down_payment,
        remaining_balance, num_installments, installment_amount, frequency, first_due_date,
        auto_charge, notes, first_payment_required)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [customer_id, repair_id || null, template_id || null, total_amount, dp,
       remaining, n, baseAmt, frequency || 'monthly',
       first_due_date || null, auto_charge || false, notes || null,
       first_payment_required === true || first_payment_required === 'true']
    );
    const plan = planResult.rows[0];

    let dueDate = first_due_date ? new Date(first_due_date) : new Date();
    if (!first_due_date) dueDate.setDate(dueDate.getDate() + 30);

    for (let i = 1; i <= n; i++) {
      const amt = (i === n) ? lastAmt : baseAmt; // Last installment absorbs rounding
      await client.query(
        'INSERT INTO installments (payment_plan_id, installment_number, due_date, amount) VALUES ($1,$2,$3,$4)',
        [plan.id, i, dueDate.toISOString().split('T')[0], amt]
      );
      if (frequency === 'weekly') dueDate.setDate(dueDate.getDate() + 7);
      else if (frequency === 'biweekly') dueDate.setDate(dueDate.getDate() + 14);
      else dueDate.setMonth(dueDate.getMonth() + 1);
    }
    await client.query('COMMIT');
    res.json(plan);
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err }, 'Create payment plan error');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ─── Payment Plans: Detail ───────────────────────────────────────────────────
router.get('/admin/api/payment-plans/:id', requireAdmin, async (req, res) => {
  try {
    const [plan, installments] = await Promise.all([
      pool.query(`SELECT pp.*, c.name as customer_name, c.email as customer_email, c.phone as customer_phone
        FROM payment_plans pp JOIN customers c ON c.id=pp.customer_id WHERE pp.id=$1`, [req.params.id]),
      pool.query('SELECT * FROM installments WHERE payment_plan_id=$1 ORDER BY installment_number', [req.params.id]),
    ]);
    if (!plan.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ plan: plan.rows[0], installments: installments.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Record Payment ──────────────────────────────────────────────────────────
router.post('/admin/api/payment-plans/:planId/installments/:installId/pay', requireAdmin, async (req, res) => {
  const { paid_amount, payment_method, notes } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const instResult = await client.query(
      'SELECT * FROM installments WHERE id=$1 AND payment_plan_id=$2',
      [req.params.installId, req.params.planId]);
    if (!instResult.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }
    const inst = instResult.rows[0];

    await client.query(
      `UPDATE installments SET status='paid', paid_at=NOW(), paid_amount=$1, payment_method=$2, notes=$3, updated_at=NOW() WHERE id=$4`,
      [paid_amount || inst.amount, payment_method || 'cash', notes || null, inst.id]);

    const paidSum = await client.query(
      `SELECT COALESCE(SUM(paid_amount),0) as total FROM installments WHERE payment_plan_id=$1 AND status='paid'`,
      [req.params.planId]);
    const planResult = await client.query('SELECT * FROM payment_plans WHERE id=$1', [req.params.planId]);
    const plan = planResult.rows[0];
    const newRemaining = Math.max(0, parseFloat(plan.total_amount) - parseFloat(plan.down_payment || 0) - parseFloat(paidSum.rows[0].total));
    const allPaid = newRemaining <= 0.01; // Tolerance for rounding
    await client.query(
      `UPDATE payment_plans SET remaining_balance=$1, status=$2, escalation_status='current', updated_at=NOW() WHERE id=$3`,
      [newRemaining, allPaid ? 'paid_off' : 'active', req.params.planId]);
    await client.query('COMMIT');

    // Send confirmation email
    const custResult = await pool.query('SELECT * FROM customers WHERE id=$1', [plan.customer_id]);
    if (custResult.rows.length && custResult.rows[0].email) {
      const customer = custResult.rows[0];
      const nextInst = await pool.query(
        `SELECT * FROM installments WHERE payment_plan_id=$1 AND status='pending' ORDER BY due_date LIMIT 1`, [req.params.planId]);
      const updatedInst = { ...inst, paid_amount: paid_amount || inst.amount, next_due_date: nextInst.rows[0]?.due_date };
      const updatedPlan = { ...plan, remaining_balance: newRemaining };
      const tpl = emailTemplates.paymentConfirm(customer, updatedInst, updatedPlan);
      await sendEmail(customer.email, tpl.subject, tpl.html);
    }
    res.json({ success: true, remaining_balance: newRemaining, paid_off: allPaid });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err }, 'Record payment error');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ─── Sign Contract ───────────────────────────────────────────────────────────
router.post('/admin/api/payment-plans/:id/sign-contract', requireAdmin, async (req, res) => {
  const { signature } = req.body;
  try {
    const r = await pool.query(
      `UPDATE payment_plans SET contract_signed=true, contract_signed_at=NOW(), contract_signature=$1, updated_at=NOW()
       WHERE id=$2 RETURNING *`, [signature || 'signed', req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    const plan = r.rows[0];
    const custResult = await pool.query('SELECT * FROM customers WHERE id=$1', [plan.customer_id]);
    const repairResult = plan.repair_id ? await pool.query('SELECT * FROM repairs WHERE id=$1', [plan.repair_id]) : { rows: [] };
    if (custResult.rows.length && custResult.rows[0].email) {
      const tpl = emailTemplates.contractCopy(custResult.rows[0], plan, repairResult.rows[0] || null);
      const emailResult = await sendEmail(custResult.rows[0].email, tpl.subject, tpl.html);
      if (emailResult.ok) {
        await pool.query(`INSERT INTO reminder_logs (payment_plan_id, type, email_to, success) VALUES ($1,'contract_copy',$2,true)`,
          [plan.id, custResult.rows[0].email]).catch(() => {});
      }
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin/api/payment-plans/:id/sign-contract-v2', requireAdmin, async (req, res) => {
  const { signature_data_url, contract_html, data_loss_accepted } = req.body;
  if (!signature_data_url) return res.status(400).json({ error: 'signature_data_url required' });
  try {
    const r = await pool.query(
      `UPDATE payment_plans SET contract_signed=true, contract_signed_at=NOW(),
        contract_signature='signed_v2', signature_data_url=$1, contract_html=$2,
        data_loss_disclaimer_accepted=$3, data_loss_accepted_at=CASE WHEN $3 THEN NOW() ELSE NULL END,
        updated_at=NOW() WHERE id=$4 RETURNING *`,
      [signature_data_url, contract_html || null, data_loss_accepted || false, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    const plan = r.rows[0];
    await auditLog(req, 'sign_contract', 'payment_plan', plan.id, { method: 'digital_signature' });
    const custResult = await pool.query('SELECT * FROM customers WHERE id=$1', [plan.customer_id]);
    const repairResult = plan.repair_id ? await pool.query('SELECT * FROM repairs WHERE id=$1', [plan.repair_id]) : { rows: [] };
    if (custResult.rows.length && custResult.rows[0].email) {
      const tpl = emailTemplates.contractCopy(custResult.rows[0], plan, repairResult.rows[0] || null);
      await sendEmail(custResult.rows[0].email, tpl.subject, tpl.html);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/admin/api/payment-plans/:id/contract', requireAdmin, async (req, res) => {
  try {
    const [planRes, instRes] = await Promise.all([
      pool.query(`SELECT pp.*, c.name as customer_name, c.email as customer_email, c.phone as customer_phone, c.address as customer_address,
        r.device_brand, r.device_model, r.device_type, r.issue_description, r.serial_number, r.diagnosis_notes
        FROM payment_plans pp JOIN customers c ON c.id=pp.customer_id LEFT JOIN repairs r ON r.id=pp.repair_id
        WHERE pp.id=$1`, [req.params.id]),
      pool.query('SELECT * FROM installments WHERE payment_plan_id=$1 ORDER BY installment_number', [req.params.id]),
    ]);
    if (!planRes.rows.length) return res.status(404).json({ error: 'Not found' });
    const html = generateContractHTML(planRes.rows[0], instRes.rows);
    res.json({ html, plan: planRes.rows[0], installments: instRes.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/admin/api/payment-plans/:id/view-contract', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT contract_html, signature_data_url, contract_signed_at, contract_signed FROM payment_plans WHERE id=$1',
      [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── First Payment Enforcement ───────────────────────────────────────────────
router.post('/admin/api/payment-plans/:id/first-payment', requireAdmin, async (req, res) => {
  const { payment_method, amount } = req.body;
  try {
    const r = await pool.query(
      'UPDATE payment_plans SET first_payment_collected=true, first_payment_collected_at=NOW(), updated_at=NOW() WHERE id=$1 RETURNING *',
      [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    await auditLog(req, 'first_payment_collected', 'payment_plan', req.params.id, { payment_method, amount });
    if (payment_method) {
      const firstInst = await pool.query('SELECT id FROM installments WHERE payment_plan_id=$1 ORDER BY installment_number LIMIT 1', [req.params.id]);
      if (firstInst.rows.length) {
        await pool.query(
          "UPDATE installments SET status='paid', paid_at=NOW(), paid_amount=$1, payment_method=$2 WHERE id=$3 AND status='pending'",
          [parseFloat(amount) || null, payment_method, firstInst.rows[0].id]);
        await pool.query('UPDATE payment_plans SET remaining_balance=remaining_balance-COALESCE($1,0) WHERE id=$2',
          [parseFloat(amount) || 0, req.params.id]);
      }
    }
    res.json({ success: true, plan: r.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Templates ───────────────────────────────────────────────────────────────
router.get('/admin/api/templates', requireAdmin, async (req, res) => {
  try { res.json((await pool.query('SELECT * FROM payment_plan_templates ORDER BY name')).rows); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/admin/api/templates', requireAdmin, async (req, res) => {
  const { name, num_installments, frequency, down_payment_pct, notes } = req.body;
  if (!name || !num_installments) return res.status(400).json({ error: 'name and num_installments required' });
  try {
    const r = await pool.query(
      'INSERT INTO payment_plan_templates (name,num_installments,frequency,down_payment_pct,notes) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [name, num_installments, frequency || 'monthly', down_payment_pct || 0, notes || null]);
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/admin/api/templates/:id', requireAdmin, async (req, res) => {
  const { name, num_installments, frequency, down_payment_pct, notes, is_active } = req.body;
  try {
    const r = await pool.query(
      `UPDATE payment_plan_templates SET name=COALESCE($1,name), num_installments=COALESCE($2,num_installments),
       frequency=COALESCE($3,frequency), down_payment_pct=COALESCE($4,down_payment_pct),
       notes=COALESCE($5,notes), is_active=COALESCE($6,is_active) WHERE id=$7 RETURNING *`,
      [name||null, num_installments||null, frequency||null, down_payment_pct!=null?down_payment_pct:null,
       notes||null, is_active!=null?is_active:null, req.params.id]);
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/admin/api/templates/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('UPDATE payment_plan_templates SET is_active=false WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Invoices ────────────────────────────────────────────────────────────────
router.get('/admin/api/invoices', requireAdmin, async (req, res) => {
  const { customer_id, repair_id, status } = req.query;
  let q = `SELECT i.*, c.name as customer_name FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE 1=1`;
  const params = [];
  if (customer_id) { params.push(customer_id); q += ` AND i.customer_id=$${params.length}`; }
  if (repair_id) { params.push(repair_id); q += ` AND i.repair_id=$${params.length}`; }
  if (status) { params.push(status); q += ` AND i.status=$${params.length}`; }
  q += ' ORDER BY i.created_at DESC';
  try { res.json((await pool.query(q, params)).rows); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/admin/api/invoices/:id', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT i.*, c.name as customer_name, c.email as customer_email, c.phone as customer_phone, c.address as customer_address
       FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.id=$1`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/admin/api/invoices', requireAdmin, async (req, res) => {
  const { customer_id, repair_id, payment_plan_id, line_items, tax_rate, discount_amount, notes, status } = req.body;
  if (!customer_id) return res.status(400).json({ error: 'customer_id required' });
  try {
    const items = Array.isArray(line_items) ? line_items : [];
    const subtotal = items.reduce((sum, item) => sum + (parseFloat(item.quantity || 1) * parseFloat(item.unit_price || 0)), 0);
    const taxR = parseFloat(tax_rate || 0.07);
    const disc = parseFloat(discount_amount || 0);
    const taxAmt = subtotal * taxR;
    const total = subtotal + taxAmt - disc;
    const invNum = await generateInvoiceNumber();
    const r = await pool.query(
      `INSERT INTO invoices (invoice_number,customer_id,repair_id,payment_plan_id,line_items,subtotal,tax_rate,tax_amount,discount_amount,total,status,notes,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [invNum, customer_id, repair_id||null, payment_plan_id||null, JSON.stringify(items),
       subtotal.toFixed(2), taxR, taxAmt.toFixed(2), disc.toFixed(2), total.toFixed(2),
       status||'draft', notes||null, req.session.adminId]);
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/admin/api/invoices/:id', requireAdmin, async (req, res) => {
  const { line_items, tax_rate, discount_amount, notes, status } = req.body;
  try {
    const items = Array.isArray(line_items) ? line_items : [];
    const subtotal = items.reduce((sum, item) => sum + (parseFloat(item.quantity||1) * parseFloat(item.unit_price||0)), 0);
    const taxR = parseFloat(tax_rate||0.07);
    const disc = parseFloat(discount_amount||0);
    const taxAmt = subtotal * taxR;
    const total = subtotal + taxAmt - disc;
    const r = await pool.query(
      `UPDATE invoices SET line_items=$1,subtotal=$2,tax_rate=$3,tax_amount=$4,discount_amount=$5,total=$6,
       status=COALESCE($7,status),notes=COALESCE($8,notes),updated_at=NOW() WHERE id=$9 RETURNING *`,
      [JSON.stringify(items), subtotal.toFixed(2), taxR, taxAmt.toFixed(2), disc.toFixed(2), total.toFixed(2),
       status||null, notes||null, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/admin/api/invoices/:id/html', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT i.*, c.name as customer_name, c.email as customer_email, c.phone as customer_phone, c.address as customer_address
       FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.id=$1`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    const inv = r.rows[0];
    const items = Array.isArray(inv.line_items) ? inv.line_items : JSON.parse(inv.line_items || '[]');
    res.setHeader('Content-Type', 'text/html');
    res.send(generateInvoiceHTML(inv, items));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Maintenance Contracts ───────────────────────────────────────────────────
router.get('/admin/api/maintenance-contracts', requireAdmin, async (req, res) => {
  const { status, customer_id } = req.query;
  let q = `SELECT mc.*, c.name as customer_name, c.email as customer_email, c.phone as customer_phone
    FROM maintenance_contracts mc JOIN customers c ON c.id=mc.customer_id WHERE 1=1`;
  const params = [];
  if (status) { params.push(status); q += ` AND mc.status=$${params.length}`; }
  if (customer_id) { params.push(customer_id); q += ` AND mc.customer_id=$${params.length}`; }
  q += ' ORDER BY mc.created_at DESC';
  try { res.json((await pool.query(q, params)).rows); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/admin/api/maintenance-contracts/:id', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT mc.*, c.name as customer_name, c.email as customer_email, c.phone as customer_phone
       FROM maintenance_contracts mc JOIN customers c ON c.id=mc.customer_id WHERE mc.id=$1`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    const invR = await pool.query('SELECT * FROM invoices WHERE maintenance_contract_id=$1 ORDER BY created_at DESC', [req.params.id]);
    res.json({ ...r.rows[0], invoices: invR.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/admin/api/maintenance-contracts', requireAdmin, async (req, res) => {
  const { customer_id, contract_name, devices_covered, frequency, price, services_included,
          start_date, next_invoice_date, notes } = req.body;
  if (!customer_id || !contract_name) return res.status(400).json({ error: 'customer_id and contract_name required' });
  try {
    const r = await pool.query(
      `INSERT INTO maintenance_contracts (customer_id,contract_name,devices_covered,frequency,price,services_included,start_date,next_invoice_date,notes,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [customer_id, contract_name, devices_covered||null, frequency||'monthly', parseFloat(price||0),
       services_included||null, start_date||null, next_invoice_date||null, notes||null, req.session.adminId]);
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/admin/api/maintenance-contracts/:id', requireAdmin, async (req, res) => {
  const { contract_name, devices_covered, frequency, price, services_included, status, next_invoice_date, notes } = req.body;
  try {
    const r = await pool.query(
      `UPDATE maintenance_contracts SET contract_name=COALESCE($1,contract_name),devices_covered=COALESCE($2,devices_covered),
       frequency=COALESCE($3,frequency),price=COALESCE($4,price),services_included=COALESCE($5,services_included),
       status=COALESCE($6,status),next_invoice_date=COALESCE($7,next_invoice_date),notes=COALESCE($8,notes),updated_at=NOW()
       WHERE id=$9 RETURNING *`,
      [contract_name||null, devices_covered||null, frequency||null, price!=null?parseFloat(price):null,
       services_included||null, status||null, next_invoice_date||null, notes||null, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
