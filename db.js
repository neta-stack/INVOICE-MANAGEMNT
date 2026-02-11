const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'invoices.db');
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    file_path TEXT,
    text TEXT,
    payment_type TEXT,
    amount TEXT,
    currency TEXT,
    invoice_number TEXT,
    date TEXT,
    vendor TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

const cols = db.prepare("PRAGMA table_info(invoices)").all().map(r => r.name);
if (!cols.includes('file_path')) db.exec('ALTER TABLE invoices ADD COLUMN file_path TEXT');
if (!cols.includes('currency')) db.exec('ALTER TABLE invoices ADD COLUMN currency TEXT');
if (!cols.includes('invoice_number')) db.exec('ALTER TABLE invoices ADD COLUMN invoice_number TEXT');
if (!cols.includes('status')) db.exec("ALTER TABLE invoices ADD COLUMN status TEXT DEFAULT 'open'");
if (!cols.includes('paid_at')) db.exec('ALTER TABLE invoices ADD COLUMN paid_at TEXT');

function listInvoices(opts = {}) {
  const { paymentType, search, fromDate, toDate, status } = opts;
  let sql = 'SELECT * FROM invoices WHERE 1=1';
  const params = [];

  if (paymentType) {
    if (paymentType === 'unmarked') {
      sql += " AND (payment_type IS NULL OR payment_type = '')";
    } else {
      sql += ' AND payment_type = ?';
      params.push(paymentType);
    }
  }
  if (search) {
    sql += ' AND (filename LIKE ? OR text LIKE ? OR vendor LIKE ? OR invoice_number LIKE ? OR amount LIKE ?)';
    const term = '%' + search + '%';
    params.push(term, term, term, term, term);
  }
  if (fromDate) {
    sql += " AND date(created_at) >= date(?)";
    params.push(fromDate);
  }
  if (toDate) {
    sql += " AND date(created_at) <= date(?)";
    params.push(toDate);
  }
  if (status) {
    if (status === 'open') sql += " AND (status IS NULL OR status = '' OR status = 'open')";
    else if (status === 'paid') sql += " AND status = 'paid'";
  }

  sql += ' ORDER BY created_at DESC';
  const rows = db.prepare(sql).all(...params);
  return rows.map(row => ({
    id: row.id,
    filename: row.filename,
    filePath: row.file_path,
    text: row.text,
    paymentType: row.payment_type,
    status: row.status || 'open',
    paidAt: row.paid_at,
    details: {
      amount: row.amount,
      currency: row.currency,
      invoiceNumber: row.invoice_number,
      date: row.date,
      vendor: row.vendor
    },
    created_at: row.created_at
  }));
}

function getInvoice(id) {
  const row = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
  if (!row) return null;
  return {
    id: row.id,
    filename: row.filename,
    filePath: row.file_path,
    text: row.text,
    paymentType: row.payment_type,
    status: row.status || 'open',
    paidAt: row.paid_at,
    details: {
      amount: row.amount,
      currency: row.currency,
      invoiceNumber: row.invoice_number,
      date: row.date,
      vendor: row.vendor
    },
    created_at: row.created_at
  };
}

function insertInvoice(data) {
  const { filename, filePath, text, paymentType, details = {} } = data;
  const stmt = db.prepare(`
    INSERT INTO invoices (filename, file_path, text, payment_type, amount, currency, invoice_number, date, vendor)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    filename || '',
    filePath || null,
    text || '',
    paymentType || null,
    details.amount || null,
    details.currency || null,
    details.invoiceNumber || null,
    details.date || null,
    details.vendor || null
  );
  return getInvoice(info.lastInsertRowid);
}

function markAsPaid(id) {
  db.prepare("UPDATE invoices SET status = 'paid', paid_at = datetime('now') WHERE id = ?").run(id);
  return getInvoice(id);
}
function markAsUnpaid(id) {
  db.prepare("UPDATE invoices SET status = 'open', paid_at = NULL WHERE id = ?").run(id);
  return getInvoice(id);
}

function updateInvoice(id, data) {
  const allowed = ['payment_type', 'filename', 'amount', 'currency', 'invoice_number', 'date', 'vendor', 'status'];
  const updates = [];
  const values = [];
  for (const key of allowed) {
    const val = data[key] !== undefined ? data[key] : data[key === 'payment_type' ? 'paymentType' : key];
    if (val !== undefined) {
      updates.push(key + ' = ?');
      values.push(val === '' ? null : val);
    }
  }
  if (updates.length === 0) return getInvoice(id);
  values.push(id);
  db.prepare('UPDATE invoices SET ' + updates.join(', ') + ' WHERE id = ?').run(...values);
  return getInvoice(id);
}

function deleteInvoice(id) {
  const row = db.prepare('SELECT file_path FROM invoices WHERE id = ?').get(id);
  db.prepare('DELETE FROM invoices WHERE id = ?').run(id);
  return row ? row.file_path : null;
}

function getOpenTotals(opts = {}) {
  const { paymentType } = opts;
  let sql = "SELECT payment_type, amount FROM invoices WHERE (status IS NULL OR status = '' OR status = 'open') AND amount IS NOT NULL AND amount != ''";
  const params = [];
  if (paymentType) {
    if (paymentType === 'unmarked') sql += " AND (payment_type IS NULL OR payment_type = '')";
    else { sql += ' AND payment_type = ?'; params.push(paymentType); }
  }
  const rows = db.prepare(sql).all(...params);
  const vb = { sum: 0, count: 0 };
  const il = { sum: 0, count: 0 };
  const unmarked = { sum: 0, count: 0 };
  for (const r of rows) {
    const amt = parseFloat((r.amount || '').replace(/,/g, '')) || 0;
    const pt = r.payment_type || '';
    if (pt === 'VB') { vb.sum += amt; vb.count++; }
    else if (pt === 'IL') { il.sum += amt; il.count++; }
    else { unmarked.sum += amt; unmarked.count++; }
  }
  return { vb: vb.sum, il: il.sum, unmarked: unmarked.sum, total: vb.sum + il.sum + unmarked.sum };
}

module.exports = {
  listInvoices,
  getInvoice,
  insertInvoice,
  updateInvoice,
  deleteInvoice,
  markAsPaid,
  markAsUnpaid,
  getOpenTotals
};
