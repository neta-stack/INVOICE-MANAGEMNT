import * as XLSX from 'xlsx';

const STORAGE_KEY = 'zd_creds';

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

function loadCreds() {
  try { return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
}

function saveCreds(creds) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(creds));
}

function sentimentClass(s) {
  if (!s) return '';
  if (['חיובי', 'מרוצה', 'positive', 'satisfied'].includes(s.toLowerCase())) return 'sentiment-pos';
  if (['שלילי', 'מתוסכל', 'negative', 'frustrated'].includes(s.toLowerCase())) return 'sentiment-neg';
  return 'sentiment-neu';
}

function qualityClass(q) {
  if (!q) return '';
  if (['מצוין', 'excellent'].includes((q || '').toLowerCase())) return 'quality-excellent';
  if (['טוב', 'good'].includes((q || '').toLowerCase())) return 'quality-good';
  if (['דורש שיפור', 'needs improvement', 'poor'].includes((q || '').toLowerCase())) return 'quality-poor';
  return '';
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleDateString('he-IL');
}

function renderTicketRows(tickets) {
  if (!tickets.length) return '<tr><td colspan="8" class="empty-state">לא נמצאו טיקטים.</td></tr>';
  return tickets.map((t) => `
    <tr>
      <td>${escapeHtml(String(t.id))}</td>
      <td class="td-subject" title="${escapeHtml(t.subject)}">${escapeHtml(t.subject)}</td>
      <td><span class="zd-category">${escapeHtml(t.category || '—')}</span><br><small>${escapeHtml(t.sub_category || '')}</small></td>
      <td><span class="zd-badge ${sentimentClass(t.sentiment)}">${escapeHtml(t.sentiment || '—')}</span></td>
      <td><span class="zd-badge ${qualityClass(t.response_quality)}">${escapeHtml(t.response_quality || '—')}</span></td>
      <td class="td-summary">${escapeHtml(t.summary || '—')}</td>
      <td><span class="zd-status zd-status-${escapeHtml(t.status || '')}">${escapeHtml(t.status || '—')}</span></td>
      <td>${formatDate(t.created_at)}</td>
    </tr>
  `).join('');
}

function exportTicketsToExcel(tickets) {
  const rows = tickets.map((t) => ({
    'מזהה טיקט': t.id,
    'נושא': t.subject,
    'קטגוריה': t.category,
    'תת-קטגוריה': t.sub_category,
    'סנטימנט לקוח': t.sentiment,
    'איכות מענה': t.response_quality,
    'סיכום': t.summary,
    'סטטוס': t.status,
    'תאריך': formatDate(t.created_at),
    'פנייה': t.customer_message,
    'תגובת נציג': t.agent_response,
  }));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  // RTL column widths
  ws['!cols'] = [
    { wch: 10 }, { wch: 40 }, { wch: 20 }, { wch: 20 },
    { wch: 14 }, { wch: 16 }, { wch: 50 }, { wch: 12 }, { wch: 14 },
    { wch: 60 }, { wch: 60 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Zendesk Tickets');
  XLSX.writeFile(wb, 'zendesk_classified_' + new Date().toISOString().slice(0, 10) + '.xlsx');
  showToast('ייצוא הושלם');
}

export function renderZendeskClassifier(appEl, onBack) {
  const creds = loadCreds();

  appEl.innerHTML = `
    <div class="brand-bar"></div>
    <header class="header">
      <div>
        <span class="logo"><span class="orange">s</span><span class="white">canmarker</span></span>
        <span class="header-subtitle">Zendesk Classifier</span>
      </div>
      <div class="header-nav">
        <button type="button" class="btn-nav" id="btnBackInvoices">← חזרה לחשבוניות</button>
      </div>
    </header>
    <main class="main">
      <h1 class="page-title">סיווג טיקטים מ-Zendesk</h1>
      <p class="subtitle">הזן את פרטי הגישה שלך ל-Zendesk ול-Claude API לסיווג אוטומטי של פניות לקוחות.</p>

      <div class="zd-config-card">
        <h2 class="zd-section-title">הגדרות חיבור</h2>
        <div class="zd-form">
          <div class="zd-form-row">
            <label>Zendesk Subdomain</label>
            <input type="text" id="zdSubdomain" placeholder="mycompany (ללא .zendesk.com)" value="${escapeHtml(creds.subdomain || '')}">
          </div>
          <div class="zd-form-row">
            <label>אימייל</label>
            <input type="email" id="zdEmail" placeholder="you@company.com" value="${escapeHtml(creds.email || '')}">
          </div>
          <div class="zd-form-row">
            <label>API Token (Zendesk)</label>
            <input type="password" id="zdToken" placeholder="Zendesk API token" value="${escapeHtml(creds.token || '')}">
            <small>ניתן לייצר ב-Admin → Apps and Integrations → APIs → Zendesk API</small>
          </div>
          <div class="zd-form-row">
            <label>Claude API Key</label>
            <input type="password" id="zdClaudeKey" placeholder="sk-ant-..." value="${escapeHtml(creds.claudeKey || '')}">
            <small>מפתח API של Anthropic – נשמר רק בזיכרון הדפדפן לאורך הסשן</small>
          </div>
          <div class="zd-form-row">
            <label>מספר טיקטים לשליפה</label>
            <input type="number" id="zdMaxTickets" min="1" max="100" value="${creds.maxTickets || 50}">
          </div>
          <div class="zd-form-actions">
            <button type="button" class="btn primary" id="btnFetchClassify">שלוף וסווג טיקטים</button>
          </div>
        </div>
      </div>

      <div id="zdProgress" class="zd-progress" style="display:none">
        <div class="zd-spinner"></div>
        <span id="zdProgressMsg">שולף טיקטים מ-Zendesk...</span>
      </div>

      <div id="zdError" class="error" style="display:none"></div>

      <div id="zdResults" style="display:none">
        <div class="zd-results-header">
          <h2 class="zd-section-title">תוצאות סיווג <span id="zdCount" class="zd-count-badge"></span></h2>
          <div class="zd-results-actions">
            <input type="text" id="zdSearch" placeholder="חיפוש..." class="zd-search">
            <select id="zdFilterCategory" class="zd-filter">
              <option value="">כל הקטגוריות</option>
            </select>
            <select id="zdFilterSentiment" class="zd-filter">
              <option value="">כל הסנטימנטים</option>
            </select>
            <button type="button" class="btn-export" id="btnExportZd">ייצא ל-Excel</button>
          </div>
        </div>
        <div class="dashboard">
          <table id="zdTable">
            <thead>
              <tr>
                <th>#</th>
                <th>נושא</th>
                <th>קטגוריה</th>
                <th>סנטימנט</th>
                <th>איכות מענה</th>
                <th>סיכום</th>
                <th>סטטוס</th>
                <th>תאריך</th>
              </tr>
            </thead>
            <tbody id="zdList"></tbody>
          </table>
        </div>
      </div>
    </main>
  `;

  document.getElementById('btnBackInvoices').onclick = onBack;

  let allTickets = [];

  function applyFilters() {
    const search = (document.getElementById('zdSearch')?.value || '').toLowerCase();
    const cat = document.getElementById('zdFilterCategory')?.value || '';
    const sent = document.getElementById('zdFilterSentiment')?.value || '';
    const filtered = allTickets.filter((t) => {
      if (cat && t.category !== cat) return false;
      if (sent && t.sentiment !== sent) return false;
      if (search) {
        const haystack = [t.subject, t.category, t.summary, t.customer_message].join(' ').toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
    document.getElementById('zdList').innerHTML = renderTicketRows(filtered);
    document.getElementById('zdCount').textContent = `(${filtered.length})`;
    document.getElementById('btnExportZd').onclick = () => exportTicketsToExcel(filtered);
  }

  document.getElementById('btnFetchClassify').onclick = async () => {
    const subdomain = document.getElementById('zdSubdomain').value.trim();
    const email = document.getElementById('zdEmail').value.trim();
    const token = document.getElementById('zdToken').value.trim();
    const claudeKey = document.getElementById('zdClaudeKey').value.trim();
    const maxTickets = parseInt(document.getElementById('zdMaxTickets').value, 10) || 50;

    if (!subdomain || !email || !token || !claudeKey) {
      document.getElementById('zdError').textContent = 'יש למלא את כל השדות.';
      document.getElementById('zdError').style.display = 'block';
      return;
    }

    saveCreds({ subdomain, email, token, claudeKey, maxTickets });
    document.getElementById('zdError').style.display = 'none';
    document.getElementById('zdResults').style.display = 'none';
    document.getElementById('zdProgress').style.display = 'flex';
    document.getElementById('zdProgressMsg').textContent = 'שולף טיקטים מ-Zendesk...';

    try {
      const res = await fetch('/api/zendesk-classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subdomain, email, apiToken: token, claudeApiKey: claudeKey, maxTickets }),
      });

      document.getElementById('zdProgressMsg').textContent = 'מסווג טיקטים עם Claude AI...';

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      allTickets = data.tickets || [];
      document.getElementById('zdProgress').style.display = 'none';

      // Populate filter dropdowns
      const categories = [...new Set(allTickets.map((t) => t.category).filter(Boolean))].sort();
      const sentiments = [...new Set(allTickets.map((t) => t.sentiment).filter(Boolean))].sort();
      const catEl = document.getElementById('zdFilterCategory');
      const sentEl = document.getElementById('zdFilterSentiment');
      categories.forEach((c) => { const o = document.createElement('option'); o.value = c; o.textContent = c; catEl.appendChild(o); });
      sentiments.forEach((s) => { const o = document.createElement('option'); o.value = s; o.textContent = s; sentEl.appendChild(o); });

      document.getElementById('zdResults').style.display = 'block';
      applyFilters();

      document.getElementById('zdSearch').oninput = applyFilters;
      document.getElementById('zdFilterCategory').onchange = applyFilters;
      document.getElementById('zdFilterSentiment').onchange = applyFilters;

      showToast(`סווגו ${allTickets.length} טיקטים בהצלחה`);
    } catch (e) {
      document.getElementById('zdProgress').style.display = 'none';
      document.getElementById('zdError').textContent = `שגיאה: ${e.message}`;
      document.getElementById('zdError').style.display = 'block';
    }
  };
}
