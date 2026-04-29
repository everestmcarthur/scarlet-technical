/**
 * HTML generators for contracts and invoices.
 */
const { getSettings, DEFAULTS } = require('./settings');

function generateContractHTML(plan, installments) {
  const device = [plan.device_brand, plan.device_model, plan.device_type].filter(Boolean).join(' ') || 'Device';
  const instRows = installments.map(i => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${i.installment_number}</td>
      <td style="padding:8px;border-bottom:1px solid #eee">${new Date(i.due_date).toLocaleDateString()}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;font-weight:600">$${parseFloat(i.amount).toFixed(2)}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${i.status === 'paid' ? '✅ Paid' : 'Pending'}</td>
    </tr>`).join('');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Service Agreement</title>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
  <style>
    body{font-family:Inter,sans-serif;background:#f4f6fa;margin:0;padding:32px;color:#1a1a2e;font-size:14px}
    .contract{max-width:760px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.1)}
    .hdr{background:#C41E3A;padding:32px 40px;color:#fff}
    .body{padding:32px 40px}
    table{width:100%;border-collapse:collapse;margin:16px 0}
    th{background:#f9fafb;padding:8px;text-align:left;font-size:11px;text-transform:uppercase;color:#6b7280;letter-spacing:.5px}
    h3{margin:24px 0 8px;color:#1a1a2e;font-size:1rem;border-bottom:2px solid #f0f0f0;padding-bottom:8px}
    .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:16px 0}
    .info-item{background:#f9fafb;padding:12px;border-radius:8px}
    .label{font-size:.75rem;text-transform:uppercase;color:#6b7280;font-weight:600;margin-bottom:4px}
    .sig-box{margin-top:32px;padding:24px;border:2px dashed #ddd;border-radius:12px;text-align:center}
    .terms{font-size:.85rem;color:#666;line-height:1.6;margin:16px 0}
    @media print{body{padding:0;background:#fff}.contract{box-shadow:none}}
  </style></head><body>
  <div class="contract">
    <div class="hdr">
      <h1 style="margin:0;font-size:1.5rem">Scarlet Technical</h1>
      <p style="margin:4px 0 0;opacity:.8;font-size:.9rem">Service Agreement & Payment Plan</p>
    </div>
    <div class="body">
      <h3>Customer Information</h3>
      <div class="info-grid">
        <div class="info-item"><div class="label">Name</div><strong>${plan.customer_name || 'N/A'}</strong></div>
        <div class="info-item"><div class="label">Email</div>${plan.customer_email || 'N/A'}</div>
        <div class="info-item"><div class="label">Phone</div>${plan.customer_phone || 'N/A'}</div>
        <div class="info-item"><div class="label">Address</div>${plan.customer_address || 'N/A'}</div>
      </div>

      <h3>Device / Service</h3>
      <div class="info-grid">
        <div class="info-item"><div class="label">Device</div><strong>${device}</strong></div>
        ${plan.serial_number ? `<div class="info-item"><div class="label">Serial</div>${plan.serial_number}</div>` : ''}
        ${plan.issue_description ? `<div class="info-item" style="grid-column:1/-1"><div class="label">Issue</div>${plan.issue_description}</div>` : ''}
        ${plan.diagnosis_notes ? `<div class="info-item" style="grid-column:1/-1"><div class="label">Diagnosis</div>${plan.diagnosis_notes}</div>` : ''}
      </div>

      <h3>Payment Schedule</h3>
      <div class="info-grid">
        <div class="info-item"><div class="label">Total Amount</div><strong style="font-size:1.2rem;color:#C41E3A">$${parseFloat(plan.total_amount).toFixed(2)}</strong></div>
        ${plan.down_payment > 0 ? `<div class="info-item"><div class="label">Down Payment</div>$${parseFloat(plan.down_payment).toFixed(2)}</div>` : ''}
        <div class="info-item"><div class="label">Installments</div>${plan.num_installments} ${plan.frequency} payments of $${parseFloat(plan.installment_amount).toFixed(2)}</div>
      </div>
      <table>
        <thead><tr><th style="text-align:center">#</th><th>Due Date</th><th style="text-align:right">Amount</th><th style="text-align:center">Status</th></tr></thead>
        <tbody>${instRows}</tbody>
      </table>

      <h3>Terms & Conditions</h3>
      <div class="terms">
        <p><strong>1. Payment Obligation:</strong> Customer agrees to make all scheduled payments by the due dates listed above.</p>
        <p><strong>2. Late Payments:</strong> Payments not received within 3 days of the due date may incur a late fee.</p>
        <p><strong>3. Data Disclaimer:</strong> Scarlet Technical is not responsible for data loss during device repair. Customer acknowledges they have backed up important data prior to service.</p>
        <p><strong>4. Warranty:</strong> Repairs include a standard warranty period as specified. Warranty covers the same issue only and does not cover physical damage, water damage, or unauthorized modifications.</p>
        <p><strong>5. Device Pickup:</strong> Devices must be picked up within 30 days of completion notice. Unclaimed devices may be subject to storage fees.</p>
      </div>

      <div class="sig-box">
        ${plan.signature_data_url ? `<p style="margin:0 0 8px;font-weight:600">Customer Signature</p><img src="${plan.signature_data_url}" style="max-width:300px;max-height:120px" alt="Signature">` : '<p style="margin:0;color:#999">Signature will appear here after signing</p>'}
        ${plan.contract_signed_at ? `<p style="margin:8px 0 0;font-size:.85rem;color:#666">Signed on ${new Date(plan.contract_signed_at).toLocaleString()}</p>` : ''}
      </div>

      <p style="text-align:center;color:#999;font-size:.8rem;margin-top:24px">
        Scarlet Technical &mdash; Low Cost IT Support & Device Repair &mdash; Muncie, Indiana
      </p>
    </div>
  </div></body></html>`;
}

function generateInvoiceHTML(inv, items) {
  const rows = items.map(i => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee">${i.description || ''}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center">${i.quantity || 1}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right">$${parseFloat(i.unit_price || 0).toFixed(2)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;font-weight:600">$${(parseFloat(i.quantity || 1) * parseFloat(i.unit_price || 0)).toFixed(2)}</td>
    </tr>`).join('');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Invoice ${inv.invoice_number}</title>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
  <style>
    body{font-family:Inter,sans-serif;background:#f4f6fa;margin:0;padding:32px;color:#1a1a2e}
    .invoice{max-width:760px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.1)}
    .hdr{background:#C41E3A;padding:32px 40px;color:#fff;display:flex;justify-content:space-between;align-items:flex-start}
    .body{padding:32px 40px}
    table{width:100%;border-collapse:collapse}th{background:#f9fafb;padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#6b7280;letter-spacing:.5px}
    .total-row td{padding:8px 12px;font-weight:600}
    .grand-total td{padding:12px 12px;font-weight:700;font-size:1.1rem;background:#fdeaed;color:#C41E3A}
    .btn{display:inline-block;padding:10px 24px;background:#C41E3A;color:#fff;border-radius:8px;font-weight:600;text-decoration:none;margin-top:24px}
    @media print{.btn{display:none}.invoice{box-shadow:none}}
  </style></head><body>
  <div class="invoice">
    <div class="hdr">
      <div>
        <div style="font-size:1.5rem;font-weight:700;margin-bottom:4px">Scarlet Technical</div>
        <div style="opacity:.8;font-size:.9rem">Low Cost IT Support &amp; Development</div>
        <div style="opacity:.8;font-size:.85rem;margin-top:4px">Muncie, Indiana</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:1.2rem;font-weight:700">${inv.invoice_number}</div>
        <div style="opacity:.8;font-size:.85rem;margin-top:4px">Date: ${new Date(inv.created_at).toLocaleDateString()}</div>
        <div style="margin-top:8px;background:rgba(255,255,255,.2);padding:4px 12px;border-radius:20px;display:inline-block;font-size:.8rem;text-transform:uppercase;font-weight:600">${inv.status}</div>
      </div>
    </div>
    <div class="body">
      <div style="display:flex;justify-content:space-between;margin-bottom:32px">
        <div>
          <div style="font-size:.75rem;text-transform:uppercase;color:#6b7280;font-weight:600;margin-bottom:6px">Bill To</div>
          <div style="font-weight:600;font-size:1rem">${inv.customer_name}</div>
          ${inv.customer_email ? `<div style="color:#6b7280;font-size:.9rem">${inv.customer_email}</div>` : ''}
          ${inv.customer_phone ? `<div style="color:#6b7280;font-size:.9rem">${inv.customer_phone}</div>` : ''}
          ${inv.customer_address ? `<div style="color:#6b7280;font-size:.9rem">${inv.customer_address}</div>` : ''}
        </div>
      </div>
      <table>
        <thead><tr><th>Description</th><th style="text-align:center">Qty</th><th style="text-align:right">Unit Price</th><th style="text-align:right">Subtotal</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr class="total-row"><td colspan="3" style="text-align:right;padding:8px 12px">Subtotal</td><td style="padding:8px 12px;text-align:right">$${parseFloat(inv.subtotal || 0).toFixed(2)}</td></tr>
          ${parseFloat(inv.discount_amount || 0) > 0 ? `<tr class="total-row"><td colspan="3" style="text-align:right;padding:8px 12px;color:#16a34a">Discount</td><td style="padding:8px 12px;text-align:right;color:#16a34a">-$${parseFloat(inv.discount_amount || 0).toFixed(2)}</td></tr>` : ''}
          <tr class="total-row"><td colspan="3" style="text-align:right;padding:8px 12px">Tax (${(parseFloat(inv.tax_rate || 0.07) * 100).toFixed(0)}%)</td><td style="padding:8px 12px;text-align:right">$${parseFloat(inv.tax_amount || 0).toFixed(2)}</td></tr>
          <tr class="grand-total"><td colspan="3" style="text-align:right">Total Due</td><td style="text-align:right">$${parseFloat(inv.total || 0).toFixed(2)}</td></tr>
        </tfoot>
      </table>
      ${inv.notes ? `<div style="margin-top:24px;padding:16px;background:#f9fafb;border-radius:8px;color:#374151"><strong>Notes:</strong> ${inv.notes}</div>` : ''}
      <div style="text-align:right"><button class="btn" onclick="window.print()">🖨 Print / Save PDF</button></div>
    </div>
  </div></body></html>`;
}

module.exports = { generateContractHTML, generateInvoiceHTML };
