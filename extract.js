const PAYMENT_MARKERS = { VB: ['scanmarker'], IL: ['topscan', 'top scan', 'topscan ltd'] };

export function getPaymentType(text) {
  if (!text || typeof text !== 'string') return null;
  const lower = text.toLowerCase();
  for (const [type, keywords] of Object.entries(PAYMENT_MARKERS)) {
    for (const kw of keywords) {
      if (lower.includes(String(kw).toLowerCase())) return type;
    }
  }
  return null;
}

/** Normalize text: collapse whitespace and newlines so patterns match across line breaks. */
function normalizeForMatch(text) {
  return text.replace(/\r\n|\r|\n|\t/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Supported: Israel (₪), USA ($), India (₹), Europe (€), UK (£). */
function detectDocumentCurrency(fullText) {
  const t = fullText;
  if (/\$[\d,]+\.?\d*|Amount due\s*\$|Total\s*\$|\bUSD\b|Dollar/i.test(t)) return 'USD';
  if (/₪|ש\"ח|NIS|ILS|שקל/i.test(t)) return '₪';
  if (/₹|INR|Rupee|Rs\.?(\s|$)/i.test(t)) return 'INR';
  if (/\bEUR\b|€|Euro/i.test(t)) return 'EUR';
  if (/\bGBP\b|£|Pound|Sterling/i.test(t)) return 'GBP';
  return null;
}

/** Parse amount string to number; return null if invalid. */
function parseAmount(s) {
  if (!s || typeof s !== 'string') return null;
  const raw = s.replace(/,/g, '').trim();
  const n = parseFloat(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Reject values that are not plausible invoice totals: years, zip codes, fragments, small ints. */
function isReasonableAmount(str, num) {
  if (num == null || num < 0) return false;
  if (str.length <= 1) return false;
  if (num < 1 && !str.includes('.')) return false;
  if (num >= 2020 && num <= 2035) return false;
  const hasDecimal = str.includes('.');
  if (!hasDecimal && num < 1000) return false;
  if (!hasDecimal && num >= 10000 && num < 100000) return false;
  if (hasDecimal) {
    const afterDot = str.split('.')[1] || '';
    if (afterDot.length > 2) return false;
  }
  return true;
}

/** Prefer amounts that look like currency (e.g. 8650.00 or 8,650.00 with 2 decimal places). */
function scoreAmount(str, num) {
  if (!str || num == null) return -1;
  const clean = str.replace(/,/g, '');
  const hasTwoDecimals = /^\d+\.\d{2}$/.test(clean);
  return (hasTwoDecimals ? 1e10 : 0) + num;
}

/** Resolve currency from match group or symbol. */
function resolveCurrency(c, docCurrency) {
  if (!c) return docCurrency || 'USD';
  const x = String(c).trim();
  if (/₪|ש\"ח|NIS|ILS/i.test(x)) return '₪';
  if (/USD|\$/i.test(x)) return 'USD';
  if (/₹|INR|Rupee|Rs\.?/i.test(x)) return 'INR';
  if (/EUR|€/i.test(x)) return 'EUR';
  if (/GBP|£/i.test(x)) return 'GBP';
  return docCurrency || 'USD';
}

export function extractDetailsFromText(text) {
  if (!text || typeof text !== 'string') {
    return { amount: null, currency: '', invoiceNumber: null, date: null, vendor: null, billTo: null };
  }
  const fullText = text.replace(/\r/g, '\n');
  const normalized = normalizeForMatch(fullText);
  const lines = fullText.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const docCurrency = detectDocumentCurrency(fullText);
  const details = {
    amount: null,
    currency: docCurrency || '',
    invoiceNumber: null,
    date: null,
    vendor: null,
    billTo: null,
  };

  // —— Vendor (From): Hebrew issuer – עיריית/מנהל/חברת/מנפיק (skip לכבוד = recipient)
  const vendorHebrewMatch =
    fullText.match(/(עיריית\s+[\u0590-\u05FF\s\-]+?)(?:\n|לכבוד|תאריך|סך|₪|$)/u) ||
    fullText.match(/(מנהל\s+[\u0590-\u05FF\s\-]+?)(?:\n|לכבוד|תאריך|סך|₪|$)/u) ||
    fullText.match(/(חברת\s+[\u0590-\u05FF\s\-]+?)(?:\n|לכבוד|תאריך|סך|₪|$)/u) ||
    fullText.match(/(?:מנפיק|ניתן על ידי|רשות)\s*[:\s]*([^\n]+?)(?:\n|לכבוד|תאריך|סך|₪|$)/i);
  if (vendorHebrewMatch && vendorHebrewMatch[1]) {
    const v = vendorHebrewMatch[1].trim().replace(/\s+/g, ' ').replace(/[:\s]+$/, '').slice(0, 120);
    if (v.length >= 3 && !/^לכבוד\s*$/.test(v)) details.vendor = v;
  }

  // —— Bill to (for whom the payment) – English + Hebrew. "לכבוד" = To / For the attention of
  const billToMatch = fullText.match(/Bill\s+to\s*:\s*([^\n]+?)(?:\s*,|\s*\d{5,}|$)/i) ||
    normalized.match(/Bill\s+to\s*:\s*([^,]+)/i) ||
    fullText.match(/(?:לתשלום\s+עבור|נמען)\s*[:\s]*([^\n]+?)(?:\n|$)/i) ||
    normalized.match(/(?:לתשלום\s+עבור|נמען)\s*[:\s]*([^,]+)/i) ||
    fullText.match(/לכבוד\s*[:\s]*([^\n]+?)(?:\n|תאריך|סך|₪|$)/i) ||
    normalized.match(/לכבוד\s*[:\s]*([^,\n]+)/i);
  if (billToMatch && billToMatch[1]) {
    details.billTo = billToMatch[1].trim().replace(/\s+/g, ' ').slice(0, 120);
  }

  // —— Factura / Topscan-style + Hebrew: "Total"/"סך הכל" then amount
  const facturaTotal = fullText.match(/Total\s*[\t ]+\$\s*([\d,]+\.\d{2})/i) ||
    normalized.match(/Total\s+\$\s*([\d,]+\.\d{2})/i) ||
    fullText.match(/(?:סך הכל|סה״כ|סיכום)\s*[:\s]*₪?\s*([\d,]+\.\d{1,2})/i) ||
    normalized.match(/(?:סך הכל|סה״כ|סיכום)\s*[:\s]*₪?\s*([\d,]+\.\d{1,2})/i) ||
    fullText.match(/₪\s*([\d,]+\.\d{1,2})\s*$/m) ||
    normalized.match(/סכום\s+לתשלום\s*[:\s]*₪?\s*([\d,]+\.\d{1,2})/i);
  if (facturaTotal && facturaTotal[1]) {
    const n = parseAmount(facturaTotal[1]);
    if (n != null && n >= 1 && n < 1e8) {
      details.amount = facturaTotal[1];
      details.currency = docCurrency || '₪';
    }
  }
  const facturaInv = fullText.match(/N\.?\s*º?\s*invoice\s*:\s*(\d[\d\-]+)/i) ||
    normalized.match(/invoice\s*:\s*(\d[\d\-]+)/i) ||
    fullText.match(/(?:מספר|מס['׳״]?)\s*חשבונית\s*[:\s]*(\d[\d\-]+)/i) ||
    fullText.match(/ח\.?פ\.?\s*[:\s]*(\d[\d\-]+)/i) ||
    fullText.match(/חשבונית\s*[#:]?\s*(\d[\d\-]+)/i);
  if (facturaInv && facturaInv[1]) details.invoiceNumber = facturaInv[1].trim();
  const facturaDate = fullText.match(/Date\s*:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i) ||
    fullText.match(/Due\s+date\s+(\d{1,2}\/\d{1,2}\/\d{4})/i) ||
    fullText.match(/תאריך\s*[:\s]*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i) ||
    fullText.match(/תוקף\s*[:\s]*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i);
  if (facturaDate && facturaDate[1]) details.date = facturaDate[1];
  if (!details.vendor && lines.length > 0) {
    const first = lines[0].trim();
    if (first.length >= 3 && !/^(Invoice|Date|Bill|Description)/i.test(first) && !/^\d+$/.test(first)) {
      details.vendor = first;
    }
  }

  // —— Amount: first try "Total"/"סך הכל"/"סה״כ" + anything + number with decimals (within 120 chars)
  const totalThenAmountRe = /(?:total|סך הכל|סה״כ|סיכום|סכום לתשלום)[\s\S]{0,120}?([\d,]+\.\d{1,2})/gi;
  let match;
  while ((match = totalThenAmountRe.exec(normalized)) !== null) {
    const str = match[1];
    const num = parseAmount(str);
    if (num != null && num >= 1 && num < 1e8 && !(num >= 2020 && num <= 2035)) {
      if (details.amount == null || num > parseAmount(details.amount)) {
        details.amount = str;
        details.currency = docCurrency || (/\$|USD/i.test(fullText) ? 'USD' : /₪|ש\"ח|ILS/i.test(fullText) ? '₪' : '');
      }
    }
  }
  if (details.amount != null) {
    if (!details.currency) details.currency = docCurrency || 'USD';
  }

  // —— Amount: LINE-BY-LINE (Total/סך הכל + $ or ₪ amount often split across rows)
  const totalLineRe = /(?:Total|סך הכל|סה״כ|סיכום|סכום לתשלום)\s+[\s\S]*?(?:\$|₪)\s*([\d,]+\.?\d*)/i;
  const dollarOnlyRe = /\$\s*([\d,]+\.\d{1,2})\s*$/;
  const anyAmountRe = /([\d,]+\.\d{1,2})\s*$/;
  let lineAmount = null;
  let lineAmountNum = -1;
  for (let i = 0; i < lines.length; i++) {
    let chunk = lines[i];
    const m = chunk.match(totalLineRe);
    if (m && m[1]) {
      const num = parseAmount(m[1]);
      if (num != null && isReasonableAmount(m[1], num) && num > lineAmountNum && num < 1e8) {
        lineAmountNum = num;
        lineAmount = m[1];
      }
    }
    if (lineAmount == null && /(?:Total|סך הכל|סה״כ|סיכום|סכום לתשלום)/i.test(chunk.trim()) && lines[i + 1]) {
      const next = lines[i + 1].trim();
      const dm = next.match(dollarOnlyRe) || next.match(/^\$?\s*([\d,]+\.\d{1,2})\s*$/) || next.match(/^₪?\s*([\d,]+\.\d{1,2})\s*$/);
      if (dm && dm[1]) {
        const num = parseAmount(dm[1]);
        if (num != null && isReasonableAmount(dm[1], num) && num > lineAmountNum && num < 1e8) {
          lineAmountNum = num;
          lineAmount = dm[1];
        }
      }
    }
    if (lineAmount == null && /(?:Total|סך הכל|סה״כ|סיכום|סכום לתשלום)/i.test(chunk)) {
      const combined = chunk + ' ' + (lines[i + 1] || '') + ' ' + (lines[i + 2] || '');
      const m2 = combined.match(totalLineRe);
      if (m2 && m2[1]) {
        const num = parseAmount(m2[1]);
        if (num != null && isReasonableAmount(m2[1], num) && num > lineAmountNum && num < 1e8) {
          lineAmountNum = num;
          lineAmount = m2[1];
        }
      }
      const amountOnly = combined.match(/(?:\$|₪)\s*([\d,]+\.\d{1,2})/);
      if (lineAmount == null && amountOnly && amountOnly[1]) {
        const num = parseAmount(amountOnly[1]);
        if (num != null && isReasonableAmount(amountOnly[1], num) && num > lineAmountNum && num < 1e8) {
          lineAmountNum = num;
          lineAmount = amountOnly[1];
        }
      }
    }
  }
  if (lineAmount != null) {
    const currentNum = parseAmount(details.amount);
    if (currentNum == null || lineAmountNum > currentNum) {
      details.amount = lineAmount;
      details.currency = docCurrency || (/\$|USD/i.test(fullText) ? 'USD' : '₪');
    }
  }

  // —— Amount: if no line match, try explicit patterns on NORMALIZED text
  if (details.amount == null) {
  const amountPatterns = [
    { re: /(?:סך הכל|סה״כ|סיכום)\s*(?:לתשלום)?\s*[:\s]*₪?\s*([\d,]+\.?\d*)/gi, amtIdx: 1, cur: '₪' },
    { re: /סכום\s+לתשלום\s*[:\s]*₪?\s*([\d,]+\.?\d*)/gi, amtIdx: 1, cur: '₪' },
    { re: /₪\s*([\d,]+\.?\d*)\s*$/gm, amtIdx: 1, cur: '₪' },
    { re: /([\d,]+\.?\d*)\s*₪/g, amtIdx: 1, cur: '₪' },
    { re: /(?:ש\"ח|ILS)\s*([\d,]+\.?\d*)/gi, amtIdx: 1, cur: '₪' },
    { re: /BALANCE\s+DUE\s*:\s*(USD|EUR|GBP|₪|ILS|\$)?\s*([\d,]+\.?\d*)/gi, amtIdx: 2, curIdx: 1 },
    { re: /TOTAL\s+DUE\s*:\s*(USD|EUR|GBP|₪|ILS|\$)?\s*([\d,]+\.?\d*)/gi, amtIdx: 2, curIdx: 1 },
    { re: /AMOUNT\s+DUE\s*:\s*(USD|EUR|GBP|₪|ILS|\$)?\s*([\d,]+\.?\d*)/gi, amtIdx: 2, curIdx: 1 },
    { re: /(?:INVOICE\s+)?TOTAL\s*:\s*(USD|EUR|GBP|₪|ILS|\$)?\s*([\d,]+\.?\d*)/gi, amtIdx: 2, curIdx: 1 },
    { re: /Total\s+\$\s*([\d,]+\.?\d*)/gi, amtIdx: 1, cur: 'USD' },
    { re: /Total\s+[\s\S]{0,40}?\$\s*([\d,]+\.?\d*)/gi, amtIdx: 1, cur: 'USD' },
    { re: /GRAND\s+TOTAL\s*:\s*(USD|EUR|GBP|₪|ILS|\$)?\s*([\d,]+\.?\d*)/gi, amtIdx: 2, curIdx: 1 },
    { re: /NET\s+TOTAL\s*:\s*(USD|EUR|GBP|₪|ILS|\$)?\s*([\d,]+\.?\d*)/gi, amtIdx: 2, curIdx: 1 },
    { re: /Amount\s+due\s+(?:USD|EUR|\$)?\s*([\d,]+\.?\d*)/gi, amtIdx: 1, cur: 'USD' },
    { re: /Total\s+due\s+(?:USD|EUR|\$)?\s*([\d,]+\.?\d*)/gi, amtIdx: 1, cur: 'USD' },
    { re: /Balance\s+due\s+(?:USD|EUR|\$)?\s*([\d,]+\.?\d*)/gi, amtIdx: 1, cur: 'USD' },
    { re: /Amount\s+due\s*\$?\s*([\d,]+\.?\d*)/gi, amtIdx: 1, cur: 'USD' },
    { re: /TOTAL\s+DUE\s*\$?\s*([\d,]+\.?\d*)/gi, amtIdx: 1, cur: 'USD' },
    { re: /(?:Invoice\s+)?Total\s*[:\s]+\$?\s*([\d,]+\.?\d*)/gi, amtIdx: 1, cur: docCurrency || 'USD' },
    { re: /(?:Total|Amount)\s*[:\s]+([\d,]+\.?\d*)\s*(USD|EUR|₪|ILS|\$)?/gi, amtIdx: 1, curIdx: 2 },
    { re: /(?:total|invoice total)\s*[:\s]+([\d,]+\.?\d*)\s*(₪|ש\"ח|NIS|ILS|USD|EUR|\$)?/gi, amtIdx: 1, curIdx: 2 },
    { re: /\$\s*([\d,]+\.?\d*)\s*$/gm, amtIdx: 1, cur: 'USD' },
    { re: /(USD|EUR|GBP|₪|ILS)\s*([\d,]+\.?\d*)\s*$/gim, amtIdx: 2, curIdx: 1 },
    { re: /\$\s*([\d,]+\.?\d*)/g, amtIdx: 1, cur: 'USD' },
    { re: /([\d,]+\.?\d*)\s*(USD|EUR|₪|ILS|\$)/g, amtIdx: 1, curIdx: 2 },
    { re: /(₪|USD|EUR|\$)\s*([\d,]+\.?\d*)/g, amtIdx: 2, curIdx: 1 },
  ];

  // Run patterns in order; first pattern that has any match wins (use largest amount from that pattern)
  for (const p of amountPatterns) {
    const re = new RegExp(p.re.source, p.re.flags.replace('g', '') + 'g');
    let match;
    let bestInPattern = null;
    let bestNumInPattern = -1;
    let bestCurInPattern = null;
    while ((match = re.exec(normalized)) !== null) {
      const amtStr = match[p.amtIdx];
      const num = parseAmount(amtStr);
      if (num == null || !isReasonableAmount(amtStr, num)) continue;
      if (num > bestNumInPattern && num < 1e8) {
        bestNumInPattern = num;
        bestInPattern = amtStr;
        bestCurInPattern = p.cur || (p.curIdx != null ? resolveCurrency(match[p.curIdx], docCurrency) : null);
      }
    }
    if (bestInPattern != null) {
      details.amount = bestInPattern;
      details.currency = bestCurInPattern || docCurrency || 'USD';
      break;
    }
  }

  if (details.amount == null) {
    // Fallback: find largest amount near "total/due/balance/amount" or Hebrew keywords
    const totalKeywords = /\b(?:total|balance|due|amount|sum|grand|invoice total|payable)\b|סך הכל|סה״כ|סיכום|סכום לתשלום/i;
    const amountNumRe = /(?:USD|EUR|GBP|₪|ILS|\$)?\s*([\d,]+\.?\d+)/g;
    const chunks = normalized.split(/\s{2,}|\n/).join(' ');
    const windowSize = 80;
    let fallbackAmount = null;
    let fallbackNum = -1;
    for (let i = 0; i < chunks.length - 20; i++) {
      const window = chunks.slice(i, i + windowSize);
      if (!totalKeywords.test(window)) continue;
      let m;
      amountNumRe.lastIndex = 0;
      while ((m = amountNumRe.exec(window)) !== null) {
        const num = parseAmount(m[1]);
        if (num != null && isReasonableAmount(m[1], num) && num > fallbackNum && num < 1e8) {
          fallbackNum = num;
          fallbackAmount = m[1];
        }
      }
    }
    if (fallbackAmount != null) {
      details.amount = fallbackAmount;
      details.currency = docCurrency || 'USD';
    }
  }

  // Prefer largest $ amount that appears AFTER "Total", preferring currency format (e.g. 8650.00)
  if (details.amount == null) {
    const totalIdx = normalized.toLowerCase().lastIndexOf('total');
    if (totalIdx >= 0) {
      const afterTotal = normalized.slice(totalIdx);
      const matches = [...afterTotal.matchAll(/\$\s*([\d,]+\.?\d*)/g)].map((m) => ({ str: m[1], num: parseAmount(m[1]) }));
      const valid = matches.filter((x) => x.num != null && isReasonableAmount(x.str, x.num) && x.num < 1e8);
      if (valid.length > 0) {
        const best = valid.reduce((a, b) => (scoreAmount(a.str, a.num) > scoreAmount(b.str, b.num) ? a : b));
        details.amount = best.str;
        details.currency = docCurrency || 'USD';
      }
    }
  }
  // Last resort: take best $ amount in document (prefer two-decimal format, then largest)
  if (details.amount == null) {
    const allDollar = [...normalized.matchAll(/\$\s*([\d,]+\.?\d*)/g)].map((m) => ({ str: m[1], num: parseAmount(m[1]) }));
    const valid = allDollar.filter((x) => x.num != null && isReasonableAmount(x.str, x.num) && x.num > 0 && x.num < 1e8);
    if (valid.length > 0) {
      const best = valid.reduce((a, b) => (scoreAmount(a.str, a.num) > scoreAmount(b.str, b.num) ? a : b));
      details.amount = best.str;
      details.currency = docCurrency || 'USD';
    }
  }
  // Very last resort: after "Total" take largest number with two decimals (e.g. 8650.00)
  if (details.amount == null) {
    const totalIdx = normalized.toLowerCase().lastIndexOf('total');
    if (totalIdx >= 0) {
      const afterTotal = normalized.slice(totalIdx);
      const matches = [...afterTotal.matchAll(/([\d,]+\.\d{1,2})/g)].map((m) => ({ str: m[1], num: parseAmount(m[1]) }));
      const valid = matches.filter((x) => x.num != null && x.num >= 1 && x.num < 1e8);
      if (valid.length > 0) {
        const best = valid.reduce((a, b) => (a.num > b.num ? a : b));
        details.amount = best.str;
        details.currency = docCurrency || 'USD';
      }
    }
  }
  // Absolute last resort: largest money-like number in entire text
  if (details.amount == null) {
    const all = [...normalized.matchAll(/([\d,]+\.\d{1,2})/g)].map((m) => ({ str: m[1], num: parseAmount(m[1]) }));
    const valid = all.filter((x) => x.num != null && x.num >= 1 && x.num < 1e7 && !(x.num >= 2020 && x.num <= 2035));
    if (valid.length > 0) {
      const best = valid.reduce((a, b) => (a.num > b.num ? a : b));
      details.amount = best.str;
      details.currency = docCurrency || 'USD';
    }
  }
  }
  if (!details.currency) details.currency = docCurrency || 'USD';

  // —— Invoice number: English + Hebrew
  const invPatterns = [
    /(?:מספר|מס['׳״]?)\s*חשבונית\s*[:\s]*(\d[\d\-/]+)/i,
    /ח\.?פ\.?\s*[:\s]*(\d[\d\-/]+)/i,
    /חשבונית\s*[#:]?\s*(\d[\d\-/]+)/i,
    /INVOICE\s+NUMBER\s*:\s*(INV[\-\s]?\d+|\d+)/i,
    /(?:N\.?\s*[º°]?\s*)?invoice\s*[#:.\s]*[:\s]*(\d[\d\-/]+)/i,
    /(?:Factura|Invoice)\s*[#:.\s]*(\d[\d\-/]+)/i,
    /INVOICE\s*#\s*:\s*(\S+)/i,
    /Invoice\s+number\s*[:\s]+(INV[\-\d]+|[\d\-]+)/i,
    /(?:Invoice|Inv\.?)\s*[#:.]*\s*(INV[\-\d]+|[\d\-/]+)/i,
    /\b(INV\s*[\d\-]+)\b/i,
    /\b(INV[\d\-]+)\b/i,
    /Invoice\s*#\s*[:\s]*(\d[\d\-/]+)/i,
    /(?:Ref|Reference|No\.?|#)\s*[#:.]*\s*(\d[\d\-/]+)/i,
    /(?:invoice\s+no\.?|inv\s+no\.?)\s*(\d+)/i,
  ];
  for (const re of invPatterns) {
    const m = normalized.match(re) || fullText.match(re);
    if (m && m[1]) {
      const num = m[1].replace(/\s/g, '').trim();
      if (num.length >= 2) {
        details.invoiceNumber = num;
        break;
      }
    }
  }

  // —— Date: English + Hebrew
  const datePatterns = [
    /תאריך\s*[:\s]*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
    /תוקף\s*[:\s]*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
    /(?:DUE\s+DATE|DATE\s+ISSUED|DATE\s+ISSUE)\s*:\s*([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})/i,
    /Due\s+date\s+(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
    /Date\s*:\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
    /(?:Date|Due\s+date)\s*[:\s]*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
    /(?:Due\s+date|Issue\s+date|Invoice\s+date)\s*[:\s]+([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})/i,
    /(?:Date|Issued|Due)\s*[:\s]+([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})/i,
    /([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})/,
    /(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/,
    /(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})/,
  ];
  for (const re of datePatterns) {
    const m = normalized.match(re) || fullText.match(re);
    if (m && m[1]) {
      details.date = m[1].trim();
      break;
    }
  }

  // —— Vendor: first line that looks like a company name – skip headers (English + Hebrew)
  const skip =
    /^(invoice|חשבונית|date|תאריך|total|סך הכל|סה״כ|amount|סכום|number|מספר|item|תיאור|description|bill to|from|to|ship to|לכתובת|נמען|לכבוד|\d|₪|$|scanmarker|topscan)/i;
  const isLikelyVendor = (s) =>
    s.length >= 2 &&
    s.length <= 150 &&
    !skip.test(s) &&
    !/^\d+[,.]?\d*$/.test(s) &&
    !/^\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}$/.test(s) &&
    !/^(USD|EUR|GBP|ILS|NIS)/i.test(s) &&
    !/^[\d\s,.\-\/]+$/.test(s);
  for (const line of lines) {
    const t = line.trim();
    if (isLikelyVendor(t) && !/^\d+\s+[\d.]+\s+[\d.]+$/.test(t)) {
      details.vendor = t;
      break;
    }
  }
  if (!details.vendor && lines[0] && !/^invoice$/i.test(lines[0].trim())) {
    details.vendor = lines[0].trim();
  }

  return details;
}
