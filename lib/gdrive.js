/**
 * Google Drive Integration
 * Auto-backup contracts, invoices, and reports to Google Drive.
 * 
 * Folder structure:
 * Scarlet Technical/
 * ├── Contracts/
 * ├── Invoices/
 * ├── Customer Records/
 * ├── Reports/
 * └── Backups/
 */
const { google } = require('googleapis');
const logger = require('./logger');

// Folder IDs (created in Google Drive)
const FOLDERS = {
  ROOT: process.env.GDRIVE_FOLDER_ROOT || '1iMc4wWLp6sX7GyoC2KHdM1LCArZS4Qe6',
  CONTRACTS: process.env.GDRIVE_FOLDER_CONTRACTS || '1XlZMZwPcGKpr8KmtrpC02_8aD2Oair-x',
  INVOICES: process.env.GDRIVE_FOLDER_INVOICES || '1f2W0MIrZPpNnNvfDSws3pBPhlqIVXr-t',
  CUSTOMER_RECORDS: process.env.GDRIVE_FOLDER_CUSTOMERS || '1IHm7d97yQKRVhdPM7PSpqW8T0J1wDjME',
  REPORTS: process.env.GDRIVE_FOLDER_REPORTS || '1IPABBs_IWnAZZXUKGUb-iTkjLRgU04Ak',
  BACKUPS: process.env.GDRIVE_FOLDER_BACKUPS || '1R7pGl6qLWjjCOUF8-il5ygLEgKM6BXe_',
};

/**
 * Get an authenticated Google Drive client.
 * Requires GOOGLE_SERVICE_ACCOUNT_KEY env var with path to service account JSON,
 * or GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY for direct credentials.
 */
function getDriveClient() {
  let auth;
  
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    const key = require(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    auth = new google.auth.JWT(
      key.client_email,
      null,
      key.private_key,
      ['https://www.googleapis.com/auth/drive.file'],
    );
  } else if (process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    auth = new google.auth.JWT(
      process.env.GOOGLE_CLIENT_EMAIL,
      null,
      process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      ['https://www.googleapis.com/auth/drive.file'],
    );
  } else {
    logger.warn('Google Drive credentials not configured — backup disabled');
    return null;
  }

  return google.drive({ version: 'v3', auth });
}

/**
 * Upload a file (buffer or stream) to a Google Drive folder.
 * @param {Object} opts
 * @param {string} opts.name - File name
 * @param {Buffer|stream.Readable} opts.body - File content
 * @param {string} opts.mimeType - MIME type (e.g., 'application/pdf')
 * @param {string} opts.folder - Folder key from FOLDERS
 * @returns {Object|null} Google Drive file metadata or null on failure
 */
async function uploadFile({ name, body, mimeType, folder = 'ROOT' }) {
  const drive = getDriveClient();
  if (!drive) return null;

  const folderId = FOLDERS[folder] || FOLDERS.ROOT;

  try {
    const res = await drive.files.create({
      requestBody: {
        name,
        parents: [folderId],
      },
      media: {
        mimeType,
        body,
      },
      fields: 'id, name, webViewLink',
    });

    logger.info({ fileId: res.data.id, name, folder }, 'File uploaded to Google Drive');
    return res.data;
  } catch (err) {
    logger.error({ err, name, folder }, 'Google Drive upload failed');
    return null;
  }
}

/**
 * Upload a signed contract PDF to Drive.
 */
async function backupContract(contractHtml, contractId, customerName) {
  // Convert HTML to PDF would be done by a separate utility
  // For now, upload as HTML
  const name = `Contract_${contractId}_${customerName.replace(/\s/g, '_')}_${new Date().toISOString().split('T')[0]}.html`;
  return uploadFile({
    name,
    body: Buffer.from(contractHtml, 'utf-8'),
    mimeType: 'text/html',
    folder: 'CONTRACTS',
  });
}

/**
 * Upload an invoice PDF to Drive.
 */
async function backupInvoice(invoiceHtml, invoiceNumber, customerName) {
  const name = `Invoice_${invoiceNumber}_${customerName.replace(/\s/g, '_')}.html`;
  return uploadFile({
    name,
    body: Buffer.from(invoiceHtml, 'utf-8'),
    mimeType: 'text/html',
    folder: 'INVOICES',
  });
}

/**
 * Upload a daily report to Drive.
 */
async function backupReport(reportContent, reportType = 'eod') {
  const date = new Date().toISOString().split('T')[0];
  const name = `${reportType}_report_${date}.json`;
  return uploadFile({
    name,
    body: Buffer.from(JSON.stringify(reportContent, null, 2), 'utf-8'),
    mimeType: 'application/json',
    folder: 'REPORTS',
  });
}

module.exports = {
  FOLDERS,
  getDriveClient,
  uploadFile,
  backupContract,
  backupInvoice,
  backupReport,
};
