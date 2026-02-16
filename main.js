import { supabase } from './supabase.js';
import { getPaymentType, extractDetailsFromText } from './extract.js';
import { extractTextFromPdf } from './pdfParse.js';
import * as XLSX from 'xlsx';

/** Supported currencies: Israel, USA, India, Europe, UK. Invoices with these are auto-detected. */
const SUPPORTED_CURRENCIES = [
  { code: '₪', symbol: '₪', label: 'Israel (₪)' },
  { code: 'USD', symbol: '$', label: 'USA ($)' },
  { code: 'INR', symbol: '₹', label: 'India (₹)' },
  { code: 'EUR', symbol: '€', label: 'Europe (€)' },
  { code: 'GBP', symbol: '£', label: 'UK (£)' },
];

const appEl = document.getElementById('app');
let activeTab = 'open';
let searchDebounce = null;

function escapeHtml(s) {
  if (!s) return '';
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function showToast(msg, durationMs = 2500) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), durationMs);
}

function renderLogin() {
  appEl.innerHTML = `
    <div class="brand-bar"></div>
    <header class="header">
      <div><span class="logo"><span class="orange">s</span><span class="white">canmarker</span></span>
      <span class="header-subtitle">Invoice Management</span></div>
    </header>
    <main class="main">
      <div class="login-container">
        <h2>Sign in</h2>
        <form class="login-form" id="loginForm">
          <div id="loginError" class="error-msg" style="display:none"></div>
          <label>Email</label>
          <input type="email" id="loginEmail" required placeholder="you@example.com">
          <label>Password</label>
          <input type="password" id="loginPassword" required>
          <button type="submit" class="btn-login">Sign in</button>
        </form>
        <p style="margin-top:16px;color:var(--grey-light);font-size:0.9rem">
          Don't have an account? <a href="#" id="showSignup" style="color:var(--orange)">Sign up</a>
        </p>
      </div>
    </main>
  `;
  document.getElementById('loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('loginError');
    errEl.style.display = 'none';
    const { data, error } = await supabase.auth.signInWithPassword({
      email: document.getElementById('loginEmail').value,
      password: document.getElementById('loginPassword').value,
    });
    if (error) {
      errEl.textContent = error.message;
      errEl.style.display = 'block';
      return;
    }
    renderDashboard();
  };
  document.getElementById('showSignup').onclick = (e) => {
    e.preventDefault();
    renderSignup();
  };
}

function renderSignup() {
  appEl.innerHTML = `
    <div class="brand-bar"></div>
    <header class="header">
      <div><span class="logo"><span class="orange">s</span><span class="white">canmarker</span></span>
      <span class="header-subtitle">Invoice Management</span></div>
    </header>
    <main class="main">
      <div class="login-container">
        <h2>Sign up</h2>
        <form class="login-form" id="signupForm">
          <div id="signupError" class="error-msg" style="display:none"></div>
          <label>Email</label>
          <input type="email" id="signupEmail" required placeholder="you@example.com">
          <label>Password</label>
          <input type="password" id="signupPassword" required minlength="6">
          <button type="submit" class="btn-login">Create account</button>
        </form>
        <p style="margin-top:16px;color:var(--grey-light);font-size:0.9rem">
          Already have an account? <a href="#" id="showLogin" style="color:var(--orange)">Sign in</a>
        </p>
      </div>
    </main>
  `;
  document.getElementById('signupForm').onsubmit = async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('signupError');
    errEl.style.display = 'none';
    const { data, error } = await supabase.auth.signUp({
      email: document.getElementById('signupEmail').value,
      password: document.getElementById('signupPassword').value,
    });
    if (error) {
      errEl.textContent = error.message;
      errEl.style.display = 'block';
      return;
    }
    showToast('Account created! Check your email to confirm, or sign in.');
    renderLogin();
  };
  document.getElementById('showLogin').onclick = (e) => {
    e.preventDefault();
    renderLogin();
  };
}

function formatAmount(n) {
  if (n === 0) return '0';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function renderBadge(paymentType) {
  const t = paymentType || 'none';
  const label = t === 'VB' ? 'Pay via VB' : t === 'IL' ? 'Pay via IL' : 'Not marked';
  return `<span class="badge ${t}">${escapeHtml(label)}</span>`;
}

function rowToInvoice(row) {
  return {
    id: row.id,
    filename: row.filename,
    filePath: row.file_path,
    paymentType: row.payment_type,
    status: row.status || 'open',
    details: {
      amount: row.amount,
      currency: row.currency,
      invoiceNumber: row.invoice_number,
      date: row.date,
      vendor: row.vendor,
      billTo: row.bill_to,
    },
  };
}

function buildRow(invoice, listEl, refresh) {
  const details = invoice.details || {};
  const row = document.createElement('tr');
  row.dataset.id = invoice.id;
  const hasFile = !!invoice.filePath;
  const isPaid = invoice.status === 'paid';
  const statusBadge = isPaid ? '<span class="badge paid">Paid</span>' : '<span class="badge unpaid">Unpaid</span>';
  const paidBtn = isPaid
    ? '<button type="button" class="btn success btn-unpaid">Unmark paid</button>'
    : '<button type="button" class="btn success btn-paid">Mark as paid</button>';
  row.innerHTML =
    `<td>${escapeHtml(invoice.filename || '—')}</td>` +
    `<td>${escapeHtml(details.invoiceNumber || '—')}</td>` +
    `<td>${escapeHtml(details.amount || '—')}</td>` +
    `<td>${escapeHtml(details.currency || '₪')}</td>` +
    `<td>${escapeHtml(details.vendor || '—')}</td>` +
    `<td>${escapeHtml(details.billTo || '—')}</td>` +
    `<td>${renderBadge(invoice.paymentType)}</td>` +
    `<td>${statusBadge}</td>` +
    `<td>${escapeHtml(details.date || '—')}</td>` +
    `<td>${paidBtn}` +
    (hasFile ? `<button type="button" class="btn primary btn-view">View</button>` : `<button type="button" class="btn" disabled title="File not saved">View</button>`) +
    `<button type="button" class="btn btn-edit">Edit</button>` +
    `<button type="button" class="btn danger btn-delete">Delete</button></td>`;
  const viewBtn = row.querySelector('.btn-view');
  if (viewBtn) viewBtn.onclick = () => window.open(invoice.filePath, '_blank');
  row.querySelector('.btn-paid')?.addEventListener('click', async () => {
    await supabase.from('invoices').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', invoice.id);
    showToast('Marked as paid');
    refresh();
  });
  row.querySelector('.btn-unpaid')?.addEventListener('click', async () => {
    await supabase.from('invoices').update({ status: 'open', paid_at: null }).eq('id', invoice.id);
    showToast('Unmarked as paid');
    refresh();
  });
  row.querySelector('.btn-edit').onclick = () => openEdit(row, invoice, listEl, refresh);
  row.querySelector('.btn-delete').onclick = () => deleteInvoice(row, invoice.id, listEl, refresh);
  return row;
}

function openEdit(row, invoice, listEl, refresh) {
  if (row.querySelector('.edit-form')) return;
  const details = invoice.details || {};
  const editRow = document.createElement('tr');
  editRow.className = 'edit-row editing';
  editRow.dataset.editFor = invoice.id;
  editRow.innerHTML = '<td colspan="10"></td>';
  const cell = editRow.querySelector('td');
  const form = document.createElement('div');
  form.className = 'edit-form';
  form.innerHTML =
    `<label>Payment method</label><select name="paymentType">` +
    `<option value="">Not marked</option><option value="VB"${invoice.paymentType === 'VB' ? ' selected' : ''}>Pay via VB</option>` +
    `<option value="IL"${invoice.paymentType === 'IL' ? ' selected' : ''}>Pay via IL</option></select>` +
    `<label>Invoice name</label><input name="filename" value="${escapeHtml(invoice.filename || '')}">` +
    `<label>Invoice #</label><input name="invoiceNumber" value="${escapeHtml(details.invoiceNumber || '')}">` +
    `<label>Amount</label><input name="amount" value="${escapeHtml(details.amount || '')}">` +
    `<label>Currency</label><select name="currency">${(function () {
      const current = details.currency || '₪';
      const opts = SUPPORTED_CURRENCIES.map((c) => ({ code: c.code, label: c.label }));
      const hasCurrent = opts.some((c) => c.code === current);
      if (!hasCurrent && current) opts.unshift({ code: current, label: current });
      return opts.map((c) => `<option value="${escapeHtml(c.code)}"${current === c.code ? ' selected' : ''}>${escapeHtml(c.label)}</option>`).join('');
    })()}</select>` +
    `<label>Payment date</label><input name="date" value="${escapeHtml(details.date || '')}">` +
    `<label>From (vendor)</label><input name="vendor" value="${escapeHtml(details.vendor || '')}">` +
    `<label>Bill to</label><input name="billTo" value="${escapeHtml(details.billTo || '')}">` +
    `<div class="actions"><button type="button" class="btn primary save-edit">Save</button><button type="button" class="btn cancel-edit">Cancel</button></div>`;
  cell.appendChild(form);
  form.querySelector('.cancel-edit').onclick = () => editRow.remove();
  form.querySelector('.save-edit').onclick = async () => {
    const updates = {
      payment_type: form.querySelector('[name="paymentType"]').value || null,
      filename: form.querySelector('[name="filename"]').value.trim() || null,
      amount: form.querySelector('[name="amount"]').value.trim() || null,
      currency: form.querySelector('[name="currency"]').value || '₪',
      invoice_number: form.querySelector('[name="invoiceNumber"]').value.trim() || null,
      date: form.querySelector('[name="date"]').value.trim() || null,
      vendor: form.querySelector('[name="vendor"]').value.trim() || null,
      bill_to: form.querySelector('[name="billTo"]').value.trim() || null,
    };
    const { error } = await supabase.from('invoices').update(updates).eq('id', invoice.id);
    if (error) { alert('Error: ' + error.message); return; }
    editRow.remove();
    const { data } = await supabase.from('invoices').select('*').eq('id', invoice.id).single();
    if (data) row.replaceWith(buildRow(rowToInvoice(data), listEl, refresh));
    showToast('Saved');
    refresh();
  };
  row.after(editRow);
}

async function deleteInvoice(row, id, listEl, refresh) {
  if (!confirm('Delete this invoice?')) return;
  const { error } = await supabase.from('invoices').delete().eq('id', id);
  if (error) { alert('Error: ' + error.message); return; }
  row.remove();
  listEl.querySelector(`tr[data-edit-for="${id}"]`)?.remove();
  showToast('Deleted');
  refresh();
}

async function fetchInvoices(filters) {
  let q = supabase.from('invoices').select('*').order('created_at', { ascending: false });
  if (filters.status === 'paid') {
    q = q.eq('status', 'paid');
  } else {
    q = q.or('status.is.null,status.eq.open');
  }
  if (filters.paymentType === 'VB') q = q.eq('payment_type', 'VB');
  else if (filters.paymentType === 'IL') q = q.eq('payment_type', 'IL');
  else if (filters.paymentType === 'unmarked') q = q.or('payment_type.is.null,payment_type.eq.');
  if (filters.search) {
    const term = '%' + filters.search + '%';
    q = q.or(`filename.ilike.${term},vendor.ilike.${term},bill_to.ilike.${term},invoice_number.ilike.${term},amount.ilike.${term}`);
  }
  if (filters.fromDate) q = q.gte('created_at', filters.fromDate);
  if (filters.toDate) q = q.lte('created_at', filters.toDate + 'T23:59:59');
  const { data, error } = await q;
  if (error) throw error;
  return (data || []).map(rowToInvoice);
}

/** Returns totals by payment type AND currency: { VB: { USD: x, '₪': y }, IL: { USD: x, '₪': y }, ... }, plus grand total. */
async function fetchTotals(filters) {
  let q = supabase.from('invoices').select('payment_type, amount, currency')
    .or('status.is.null,status.eq.open');
  if (filters.paymentType === 'VB') q = q.eq('payment_type', 'VB');
  else if (filters.paymentType === 'IL') q = q.eq('payment_type', 'IL');
  else if (filters.paymentType === 'unmarked') q = q.or('payment_type.is.null,payment_type.eq.');
  const { data } = await q;
  const vb = { USD: 0, '₪': 0, other: 0 }, il = { USD: 0, '₪': 0, other: 0 }, unmarked = { USD: 0, '₪': 0, other: 0 };
  const add = (obj, cur, amt) => {
    if (cur === 'USD' || cur === '$') obj.USD += amt;
    else if (cur === '₪' || cur === 'ILS' || cur === 'NIS') obj['₪'] += amt;
    else obj.other += amt;
  };
  (data || []).forEach((r) => {
    const amt = parseFloat((r.amount || '').replace(/,/g, '')) || 0;
    const cur = r.currency || 'USD';
    if (r.payment_type === 'VB') add(vb, cur, amt);
    else if (r.payment_type === 'IL') add(il, cur, amt);
    else add(unmarked, cur, amt);
  });
  return { vb, il, unmarked };
}

/** Returns totals for open invoices grouped by currency: { USD: 1234.56, '₪': 500, EUR: 0 } */
async function fetchTotalsByCurrency(filters) {
  let q = supabase.from('invoices').select('currency, amount')
    .or('status.is.null,status.eq.open');
  if (filters.paymentType === 'VB') q = q.eq('payment_type', 'VB');
  else if (filters.paymentType === 'IL') q = q.eq('payment_type', 'IL');
  else if (filters.paymentType === 'unmarked') q = q.or('payment_type.is.null,payment_type.eq.');
  const { data } = await q;
  const byCurrency = {};
  (data || []).forEach((r) => {
    const cur = r.currency || 'USD';
    const amt = parseFloat((r.amount || '').replace(/,/g, '')) || 0;
    byCurrency[cur] = (byCurrency[cur] || 0) + amt;
  });
  return byCurrency;
}

function getFilters() {
  const filterType = document.getElementById('filterType');
  const searchBox = document.getElementById('searchBox');
  const fromDate = document.getElementById('fromDate');
  const toDate = document.getElementById('toDate');
  return {
    status: activeTab,
    paymentType: filterType?.value || '',
    search: searchBox?.value?.trim() || '',
    fromDate: fromDate?.value || '',
    toDate: toDate?.value || '',
  };
}

async function refreshDashboard() {
  const listEl = document.getElementById('invoiceList');
  const totalVbEl = document.getElementById('totalVb');
  const totalIlEl = document.getElementById('totalIl');
  const summarySection = document.getElementById('summarySection');
  const filters = getFilters();

  const list = await fetchInvoices(filters);
  listEl.innerHTML = '';
  if (list.length === 0) {
    listEl.innerHTML = `<tr><td colspan="10" class="empty-state">No ${activeTab === 'open' ? 'open' : 'paid'} invoices found.</td></tr>`;
  } else {
    list.forEach((inv) => listEl.appendChild(buildRow(inv, listEl, refreshDashboard)));
  }

  summarySection.style.display = activeTab === 'open' ? 'block' : 'none';
  if (activeTab === 'open') {
    const t = await fetchTotals(filters);
    const totalIlIlsEl = document.getElementById('totalIlIls');
    const vbUsd = (t.vb && t.vb.USD) || 0;
    const ilUsd = (t.il && t.il.USD) || 0;
    const ilIls = (t.il && t.il['₪']) || 0;
    totalVbEl.textContent = '$' + formatAmount(vbUsd);
    totalIlEl.textContent = '$' + formatAmount(ilUsd);
    if (totalIlIlsEl) totalIlIlsEl.textContent = '₪' + formatAmount(ilIls);
    const byCur = await fetchTotalsByCurrency(filters);
    const currencyOrder = ['USD', '₪', 'INR', 'EUR', 'GBP'];
    const labels = { USD: 'USA ($)', '₪': 'Israel (₪)', INR: 'India (₹)', EUR: 'Europe (€)', GBP: 'UK (£)' };
    const symbols = { USD: '$', '₪': '₪', INR: '₹', EUR: '€', GBP: '£' };
    const container = document.getElementById('totalsByCurrency');
    if (container) {
      container.innerHTML = '';
      const keysWithValue = Object.keys(byCur).filter((c) => byCur[c] > 0);
      const keys = [...new Set([...currencyOrder.filter((c) => keysWithValue.includes(c)), ...keysWithValue])];
      keys.forEach((cur) => {
        const val = byCur[cur] || 0;
        const card = document.createElement('div');
        card.className = 'summary-card';
        const sym = symbols[cur] || cur;
        card.innerHTML = `<div class="label">${escapeHtml(labels[cur] || cur)}</div><div class="value">${sym}${formatAmount(val)}</div>`;
        container.appendChild(card);
      });
    }
  }
}

function exportExcel() {
  (async () => {
    const list = await fetchInvoices(getFilters());
    const rows = list.map((inv) => ({
      'Invoice #': inv.details?.invoiceNumber || '',
      'From': inv.details?.vendor || '',
      'Bill to': inv.details?.billTo || '',
      'Amount': inv.details?.amount || '',
      'Currency': inv.details?.currency || '',
      'Payment method (VB/IL)': inv.paymentType || '',
      'Status': inv.status === 'paid' ? 'Paid' : 'Unpaid',
      'Issue date': inv.details?.date || '',
      'Due date': inv.details?.date || '',
    }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Invoices');
    XLSX.writeFile(wb, 'invoices_export_' + new Date().toISOString().slice(0, 10) + '.xlsx');
    showToast('Export complete');
  })();
}

async function handleFiles(files, listEl, refresh) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  for (const file of files) {
    const placeholder = document.createElement('tr');
    placeholder.className = 'loading';
    placeholder.innerHTML = `<td colspan="10" class="empty-state">Processing: ${escapeHtml(file.name)}...</td>`;
    const emptyState = listEl.querySelector('.empty-state');
    if (emptyState) emptyState.closest('tr')?.remove();
    listEl.prepend(placeholder);
    try {
      const { text, textRaw } = await extractTextFromPdf(file);
      const textToUse = text || textRaw || '';
      if (!textToUse || textToUse.trim().length < 50) {
        showToast('PDF text is very short – extraction may fail', 4000);
      }
      let paymentType = getPaymentType(textToUse) || getPaymentType(file.name || '');
      const fallbackByLine = extractDetailsFromText(textToUse);
      const fallbackRaw = textRaw && textRaw !== textToUse ? extractDetailsFromText(textRaw) : null;
      const num = (s) => parseFloat(String(s || '').replace(/,/g, '')) || 0;
      const fallback = fallbackRaw?.amount != null && (fallbackByLine?.amount == null || num(fallbackRaw.amount) > num(fallbackByLine.amount))
        ? fallbackRaw
        : fallbackByLine;
      const details = {
        amount: fallback.amount,
        currency: fallback.currency || 'USD',
        invoiceNumber: fallback.invoiceNumber,
        date: fallback.date,
        vendor: fallback.vendor,
        billTo: fallback.billTo,
      };
      if (/₪|ILS|NIS|ש\"ח/i.test(details.currency)) {
        paymentType = 'IL';
      }
      const safeName = (file.name || 'invoice')
        .replace(/\s+/g, '-')
        .replace(/[^\w\-\.]/g, '_')
        .replace(/_+/g, '_')
        .slice(0, 100) || 'invoice.pdf';
      const path = `${user.id}/${Date.now()}-${safeName}`;
      const { error: uploadErr } = await supabase.storage.from('invoices').upload(path, file, { upsert: true });
      if (uploadErr) throw uploadErr;
      const { data: urlData } = supabase.storage.from('invoices').getPublicUrl(path);
      const payload = {
        user_id: user.id,
        filename: file.name,
        file_path: urlData.publicUrl,
        text: textToUse,
        payment_type: paymentType,
        amount: details.amount,
        currency: details.currency,
        invoice_number: details.invoiceNumber,
        date: details.date,
        vendor: details.vendor,
        bill_to: details.billTo,
        status: 'open',
      };
      let insertErr = (await supabase.from('invoices').insert(payload)).error;
      if (insertErr && /bill_to|schema cache/i.test(insertErr.message)) {
        const { bill_to: _drop, ...payloadWithoutBillTo } = payload;
        insertErr = (await supabase.from('invoices').insert(payloadWithoutBillTo)).error;
      }
      if (insertErr) throw insertErr;
      placeholder.remove();
      if (details.amount != null) {
        showToast('Saved. Amount: ' + details.amount);
      } else {
        showToast('Saved. Amount not detected – use Edit to add it.');
      }
      refresh();
    } catch (e) {
      placeholder.remove();
      const errRow = document.createElement('tr');
      errRow.innerHTML = `<td colspan="10"><div class="error">${escapeHtml(file.name)}: ${escapeHtml(e.message)}</div></td>`;
      listEl.prepend(errRow);
    }
  }
}

function renderDashboard() {
  appEl.innerHTML = `
    <div class="brand-bar"></div>
    <header class="header">
      <div><span class="logo"><span class="orange">s</span><span class="white">canmarker</span></span>
      <span class="header-subtitle">Invoice Management</span></div>
      <button type="button" class="btn-logout" id="btnLogout">Logout</button>
    </header>
    <main class="main">
      <h1 class="page-title">Invoices</h1>
      <p class="subtitle">Drag a PDF invoice here or click to choose. SCANMARKER → Pay via VB; TOPSCAN → Pay via IL.</p>
      <div class="drop-zone" id="dropZone">
        <input type="file" id="fileInput" accept=".pdf,.PDF" multiple>
        <div class="icon">📄</div>
        <p>Drag an invoice PDF here or click to choose</p>
      </div>
      <div class="tabs">
        <button type="button" class="tab active" data-tab="open">Open Invoices</button>
        <button type="button" class="tab" data-tab="paid">Paid Invoices</button>
      </div>
      <div id="summarySection" class="summary-section">
        <div class="summary-row">
          <div class="summary-card"><div class="label">Total Open – VB ($)</div><div class="value" id="totalVb">—</div></div>
          <div class="summary-card"><div class="label">Total Open – IL ($)</div><div class="value" id="totalIl">—</div></div>
          <div class="summary-card"><div class="label">Total Open – IL (₪)</div><div class="value" id="totalIlIls">—</div></div>
        </div>
        <div class="summary-row" id="byCurrencyRow">
          <div class="summary-subtitle">Totals by currency (open invoices)</div>
          <div class="summary-row" id="totalsByCurrency"></div>
        </div>
      </div>
      <div class="toolbar">
        <label for="filterType">Payment:</label>
        <select id="filterType">
          <option value="">All</option>
          <option value="VB">VB</option>
          <option value="IL">IL</option>
          <option value="unmarked">Unmarked</option>
        </select>
        <label for="searchBox">Search:</label>
        <input type="text" id="searchBox" placeholder="Filename, vendor...">
        <label for="fromDate">From date:</label>
        <input type="date" id="fromDate">
        <label for="toDate">To date:</label>
        <input type="date" id="toDate">
        <button type="button" class="btn-export" id="btnExport">Export to Excel</button>
      </div>
      <div class="dashboard">
        <table>
          <thead>
            <tr>
              <th>Invoice name</th>
              <th>Invoice #</th>
              <th>Amount</th>
              <th>Currency</th>
              <th>From</th>
              <th>Bill to</th>
              <th>Payment method</th>
              <th>Status</th>
              <th>Payment date</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="invoiceList"></tbody>
        </table>
      </div>
    </main>
  `;

  const listEl = document.getElementById('invoiceList');
  document.getElementById('btnLogout').onclick = async () => {
    await supabase.auth.signOut();
    renderLogin();
  };
  document.querySelectorAll('.tab').forEach((t) => {
    t.onclick = () => {
      activeTab = t.dataset.tab;
      document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
      refreshDashboard();
    };
  });
  document.getElementById('filterType').onchange = refreshDashboard;
  document.getElementById('fromDate').onchange = refreshDashboard;
  document.getElementById('toDate').onchange = refreshDashboard;
  document.getElementById('searchBox').oninput = () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(refreshDashboard, 300);
  };
  document.getElementById('btnExport').onclick = exportExcel;
  document.getElementById('dropZone').onclick = () => document.getElementById('fileInput').click();
  document.getElementById('fileInput').onchange = (e) => {
    const files = Array.from(e.target.files || []).filter((f) => f.name.toLowerCase().endsWith('.pdf'));
    if (files.length) handleFiles(files, listEl, refreshDashboard);
    e.target.value = '';
  };
  const dropZone = document.getElementById('dropZone');
  dropZone.ondragover = (e) => { e.preventDefault(); dropZone.classList.add('dragover'); };
  dropZone.ondragleave = () => dropZone.classList.remove('dragover');
  dropZone.ondrop = (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const files = Array.from(e.dataTransfer.files).filter((f) => f.name.toLowerCase().endsWith('.pdf'));
    if (files.length) handleFiles(files, listEl, refreshDashboard);
  };
  refreshDashboard();
}

async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    renderDashboard();
  } else {
    renderLogin();
  }
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') renderLogin();
    else if (session) renderDashboard();
  });
}

init();
