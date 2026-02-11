const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const pdf = require('pdf-parse');
const YAML = require('yaml');
const XLSX = require('xlsx');
const db = require('./db');

const app = express();
const PORT = 3000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + (file.originalname || 'invoice'))
});
const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } });

function loadRules() {
  const rulesPath = path.join(__dirname, 'rules.yaml');
  const content = fs.readFileSync(rulesPath, 'utf8');
  return YAML.parse(content);
}

function getPaymentType(text) {
  if (!text || typeof text !== 'string') return null;
  const lower = text.toLowerCase();
  const rules = loadRules();
  const markers = rules.payment_markers || {};
  for (const [type, keywords] of Object.entries(markers)) {
    const list = Array.isArray(keywords) ? keywords : [keywords];
    for (const kw of list) {
      if (lower.includes(String(kw).toLowerCase())) return type;
    }
  }
  return null;
}

function extractDetailsFromText(text) {
  if (!text || typeof text !== 'string') return { amount: null, currency: '₪', invoiceNumber: null, date: null, vendor: null };
  const fullText = text.replace(/\r/g, ' ');
  const lines = fullText.split(/\n/).map(l => l.trim()).filter(Boolean);
  const details = { amount: null, currency: '₪', invoiceNumber: null, date: null, vendor: null };

  // Amount: prefer "TOTAL DUE", "Amount due", "Total" – avoid line-item amounts
  const amountPatterns = [
    { re: /TOTAL DUE[\s\t\n]*\$?\s*([\d,]+\.?\d*)/i, amtIdx: 1, cur: 'USD' },
    { re: /Amount due[\s\t\n]*\$?\s*([\d,]+\.?\d*)/i, amtIdx: 1, cur: 'USD' },
    { re: /Total due[\s\t\n]*\$?\s*([\d,]+\.?\d*)/i, amtIdx: 1, cur: 'USD' },
    { re: /Total(?!\s+sales\s+tax)(?!\s+Travel)(?!\s+Reimbursement)[\s\t\n]+[\$]?\s*([\d,]+\.?\d*)/i, amtIdx: 1, cur: null },
    { re: /(?:total|invoice total)[\s:]+([\d,]+\.?\d*)\s*(₪|ש\"ח|NIS|ILS|USD|EUR|\$)?/i, amtIdx: 1, curIdx: 2 },
    { re: /(?:Amount due|amount)[\s:]+[\$₪]?\s*([\d,]+\.?\d*)/i, amtIdx: 1, cur: null },
    { re: /([\d,]+\.?\d*)\s*(₪|ש\"ח|NIS|ILS|USD|EUR|\$)/, amtIdx: 1, curIdx: 2 },
    { re: /\$([\d,]+\.?\d*)/, amtIdx: 1, cur: 'USD' },
    { re: /(₪|ש\"ח|NIS|ILS|\$)\s*([\d,]+\.?\d*)/, amtIdx: 2, curIdx: 1 },
  ];
  for (const p of amountPatterns) {
    const m = fullText.match(p.re);
    if (m && m[p.amtIdx]) {
      const raw = m[p.amtIdx].replace(/,/g, '');
      if (/^\d+\.?\d*$/.test(raw)) {
        details.amount = m[p.amtIdx];
        if (p.cur) details.currency = p.cur;
        else if (p.curIdx && m[p.curIdx]) {
          const c = (m[p.curIdx] || '').trim();
          if (/₪|ש\"ח|NIS|ILS/i.test(c)) details.currency = '₪';
          else if (/USD|\$/i.test(c)) details.currency = 'USD';
          else if (/EUR/i.test(c)) details.currency = 'EUR';
        } else if (!details.currency || details.currency === '₪') details.currency = '₪';
        break;
      }
    }
  }

  // Invoice number: "INV-0104", "Invoice #123", "No. 12345"
  const invPatterns = [
    /Invoice number[\s\n]+(INV[\-\d]+|[\d\-]+)/i,
    /(?:invoice|inv\.?)[\s#:.]*(INV[\-\d]+|[\d\-]+)/i,
    /\b(INV[\-\d]+)\b/i,
    /(?:number|מספר|no\.?|#)\s*[#:.]*\s*(\d[\d\-/]+)/i,
    /(?:invoice no\.?|inv no\.?)\s*(\d+)/i
  ];
  for (const re of invPatterns) {
    const m = fullText.match(re);
    if (m) { details.invoiceNumber = m[1].trim(); break; }
  }

  // Date: "Feb 10, 2026", DD/MM/YYYY, YYYY-MM-DD
  const datePatterns = [
    /(?:Due date|Issue date|date|תאריך|issued|due)[\s\n]*([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})/i,
    /([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})/,
    /(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/,
    /(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})/
  ];
  for (const re of datePatterns) {
    const m = fullText.match(re);
    if (m) { details.date = m[1]; break; }
  }

  // Vendor: "Scanmarker AG Beauty LLC" etc – first line that looks like a company name
  const skip = /^(invoice|חשבונית|date|תאריך|total|amount|number|item|description|\d|₪|$)/i;
  const isLikelyVendor = (s) => s.length >= 2 && s.length <= 120 && !skip.test(s) && !/^\d+[,.]?\d*$/.test(s) && !/\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/.test(s);
  for (const line of lines) {
    const t = line.trim();
    if (isLikelyVendor(t) && !/^\d+\s+[\d.]+\s+[\d.]+$/.test(t)) { details.vendor = t; break; }
  }
  if (!details.vendor && lines[0]) details.vendor = lines[0].trim();

  return details;
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/rules', (req, res) => {
  try {
    res.json(loadRules());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/invoices', (req, res) => {
  try {
    const paymentType = req.query.paymentType || null;
    const search = req.query.search || null;
    const fromDate = req.query.fromDate || null;
    const toDate = req.query.toDate || null;
    const status = req.query.status || null;
    const list = db.listInvoices({ paymentType, search, fromDate, toDate, status });
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/invoices/totals/open', (req, res) => {
  try {
    const paymentType = req.query.paymentType || null;
    const totals = db.getOpenTotals({ paymentType });
    res.json(totals);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/invoices/:id/paid', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const invoice = db.getInvoice(id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    const updated = db.markAsPaid(id);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/invoices/:id/unpaid', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const invoice = db.getInvoice(id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    const updated = db.markAsUnpaid(id);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/invoices/export/xlsx', (req, res) => {
  try {
    const paymentType = req.query.paymentType || null;
    const search = req.query.search || null;
    const fromDate = req.query.fromDate || null;
    const toDate = req.query.toDate || null;
    const status = req.query.status || null;
    const list = db.listInvoices({ paymentType, search, fromDate, toDate, status });
    const rows = list.map(inv => ({
      'Invoice #': inv.details?.invoiceNumber || '',
      'Client name': inv.details?.vendor || inv.filename || '',
      'Amount': inv.details?.amount || '',
      'Currency': inv.details?.currency || '',
      'Payment method (VB/IL)': inv.paymentType || '',
      'Status': inv.status === 'paid' ? 'Paid' : 'Unpaid',
      'Issue date': inv.details?.date || '',
      'Due date': inv.details?.date || ''
    }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Invoices');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filename = 'invoices_export_' + new Date().toISOString().slice(0, 10) + '.xlsx';
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/invoices/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const invoice = db.getInvoice(id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    res.json(invoice);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/invoices/:id/file', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const invoice = db.getInvoice(id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    if (!invoice.filePath || !fs.existsSync(invoice.filePath)) return res.status(404).json({ error: 'File not found' });
    res.sendFile(path.resolve(invoice.filePath), { headers: { 'Content-Disposition': 'inline; filename="' + (invoice.filename || 'invoice.pdf') + '"' } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/invoices/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const invoice = db.getInvoice(id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    const body = req.body || {};
    const updated = db.updateInvoice(id, {
      payment_type: body.paymentType,
      filename: body.filename ?? body.details?.filename,
      amount: body.details?.amount ?? body.amount,
      currency: body.details?.currency ?? body.currency,
      invoice_number: body.details?.invoiceNumber ?? body.invoiceNumber,
      date: body.details?.date ?? body.date,
      vendor: body.details?.vendor ?? body.vendor
    });
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/invoices/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const invoice = db.getInvoice(id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    const filePath = db.deleteInvoice(id);
    if (filePath && fs.existsSync(filePath)) fs.unlink(filePath, () => {});
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/parse-invoice', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file selected' });
  const ext = (req.file.originalname || '').toLowerCase();
  try {
    if (ext.endsWith('.pdf')) {
      const dataBuffer = fs.readFileSync(req.file.path);
      const data = await pdf(dataBuffer);
      const text = data.text || '';
      const paymentType = getPaymentType(text);
      const details = extractDetailsFromText(text);
      const savedPath = path.resolve(req.file.path);
      const payload = {
        filename: req.file.originalname,
        filePath: savedPath,
        text,
        paymentType,
        details: { ...details, pages: data.numpages }
      };
      const saved = db.insertInvoice(payload);
      return res.json(saved);
    }
    if (/\.(jpg|jpeg|png|gif|webp|bmp)$/.test(ext)) {
      const text = '(Image invoice – upload a PDF for text extraction)';
      const paymentType = getPaymentType(text);
      const details = extractDetailsFromText(text);
      const savedPath = path.resolve(req.file.path);
      const payload = {
        filename: req.file.originalname,
        filePath: savedPath,
        text,
        paymentType,
        details
      };
      const saved = db.insertInvoice(payload);
      return res.json(saved);
    }
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'Unsupported format. Please upload a PDF file.' });
  } catch (e) {
    try { fs.unlink(req.file.path, () => {}); } catch (_) {}
    return res.status(500).json({ error: 'Error parsing invoice: ' + e.message });
  }
});

app.listen(PORT, () => {
  console.log('Server running at http://localhost:' + PORT);
});
