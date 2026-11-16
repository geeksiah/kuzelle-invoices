// Shared helpers. No app state lives here.

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
export const num = v => { const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : 0; };
/* Money is summed in integer minor units (pesewas/cents) to avoid floating-point drift. */
export const toCents = v => Math.round((num(v) + Number.EPSILON) * 100);
export const fromCents = c => Math.round(c) / 100;
export const round2 = n => fromCents(toCents(n));
export const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const readJSON = (k, f) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? f; } catch { return f; } };
export const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
export const mq = q => matchMedia(q).matches;
export const initials = n => (String(n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('') || '?').toUpperCase();
export const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/* ---------- dates (ISO yyyy-mm-dd, local time) ---------- */
export const toISO = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const todayISO = () => toISO(new Date());
export const parseISO = iso => new Date(iso + 'T00:00:00');
export const addDays = (iso, n) => { const d = parseISO(iso); d.setDate(d.getDate() + n); return toISO(d); };
export const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 864e5);
export const fmtDate = iso => iso ? parseISO(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
export const fmtShort = iso => iso ? parseISO(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—';
export const monthKey = iso => (iso || '').slice(0, 7);
export const monthLabel = (k, style = 'long') => parseISO(k + '-01').toLocaleDateString('en-GB', style === 'short' ? { month: 'short' } : { month: 'long', year: 'numeric' });
export function monthsBetween(fromISO, toISO_) {
  const out = []; const d = parseISO(fromISO.slice(0, 7) + '-01'); const end = toISO_.slice(0, 7);
  while (toISO(d).slice(0, 7) <= end && out.length < 120) { out.push(toISO(d).slice(0, 7)); d.setMonth(d.getMonth() + 1); }
  return out;
}
export function periodRange(key, custom = {}) {
  const t = new Date(), y = t.getFullYear(), m = t.getMonth();
  switch (key) {
    case 'this-month': return { from: toISO(new Date(y, m, 1)), to: toISO(new Date(y, m + 1, 0)), label: 'This month' };
    case 'last-month': return { from: toISO(new Date(y, m - 1, 1)), to: toISO(new Date(y, m, 0)), label: 'Last month' };
    case 'last-90': return { from: addDays(todayISO(), -89), to: todayISO(), label: 'Last 90 days' };
    case 'this-year': return { from: `${y}-01-01`, to: `${y}-12-31`, label: 'This year' };
    case 'last-year': return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, label: 'Last year' };
    case 'custom': return { from: custom.from || `${y}-01-01`, to: custom.to || todayISO(), label: 'Custom range' };
    default: return { from: '0000-01-01', to: '9999-12-31', label: 'All time' };
  }
}
export const inRange = (iso, r) => !!iso && iso >= r.from && iso <= r.to;

/* ---------- currency ---------- */
export const CURRENCIES = [
  ['GHS', 'Ghana cedi', 'en-GH', ['cedi', 'cedis', 'pesewa', 'pesewas']],
  ['USD', 'US dollar', 'en-US', ['dollar', 'dollars', 'cent', 'cents']],
  ['EUR', 'Euro', 'en-IE', ['euro', 'euros', 'cent', 'cents']],
  ['GBP', 'British pound', 'en-GB', ['pound', 'pounds', 'penny', 'pence']],
  ['NGN', 'Nigerian naira', 'en-NG', ['naira', 'naira', 'kobo', 'kobo']],
  ['XOF', 'West African CFA franc', 'fr-SN', ['franc', 'francs', '', '']],
  ['KES', 'Kenyan shilling', 'en-KE', ['shilling', 'shillings', 'cent', 'cents']],
  ['ZAR', 'South African rand', 'en-ZA', ['rand', 'rand', 'cent', 'cents']],
  ['CAD', 'Canadian dollar', 'en-CA', ['dollar', 'dollars', 'cent', 'cents']]
];
const CUR = Object.fromEntries(CURRENCIES.map(c => [c[0], c]));
const nfCache = {};
export function nf(cur) {
  if (!nfCache[cur]) {
    const loc = (CUR[cur] && CUR[cur][2]) || 'en-GB';
    try { nfCache[cur] = new Intl.NumberFormat(loc, { style: 'currency', currency: cur, currencyDisplay: 'narrowSymbol' }); }
    catch { try { nfCache[cur] = new Intl.NumberFormat(loc, { style: 'currency', currency: cur }); } catch { nfCache[cur] = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'USD' }); } }
  }
  return nfCache[cur];
}
/* Ghana cedi: always render as GH₵ — narrowSymbol gives ₵ alone, which is ambiguous on paper. */
export function money(n, cur) {
  const s = nf(cur).format(n || 0);
  return cur === 'GHS' ? s.replace(/^(-?)\s*(GH)?₵\s?/, '$1GH₵') : s;
}
export function moneyHTML(n, cur) {
  const s = money(n, cur);
  const m = s.match(/^(.*?)([.,]\d{2})(\D*)$/);
  return m ? `${esc(m[1])}<span class="frac">${esc(m[2])}</span>${esc(m[3])}` : esc(s);
}
const plainNF = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const plainAmount = n => plainNF.format(n || 0);
export const symbolOf = cur => money(0, cur).replace(/[\d.,\s]/g, '') || cur;
export const currencyName = cur => (CUR[cur] && CUR[cur][1]) || cur;

/* Amount in words, as Ghanaian receipts traditionally show it. */
const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function words999(n) {
  const h = Math.floor(n / 100), r = n % 100, out = [];
  if (h) out.push(ONES[h] + ' hundred');
  if (r) { const w = r < 20 ? ONES[r] : TENS[Math.floor(r / 10)] + (r % 10 ? '-' + ONES[r % 10] : ''); out.push(h ? 'and ' + w : w); }
  return out.join(' ');
}
function intWords(n) {
  if (n === 0) return 'zero';
  const scales = ['', ' thousand', ' million', ' billion'];
  const parts = []; let i = 0;
  while (n > 0 && i < scales.length) { const c = n % 1000; if (c) parts.unshift(words999(c) + scales[i]); n = Math.floor(n / 1000); i++; }
  return parts.join(', ');
}
export function amountInWords(amount, cur) {
  const names = (CUR[cur] && CUR[cur][3]) || ['', '', '', ''];
  const c = toCents(amount), major = Math.floor(c / 100), minor = c % 100;
  let s = intWords(major) + (names[0] ? ' ' + (major === 1 ? names[0] : names[1]) : ' ' + cur);
  if (minor && names[2]) s += ' and ' + intWords(minor) + ' ' + (minor === 1 ? names[2] : names[3]);
  else if (minor) s += ` and ${minor}/100`;
  return s.charAt(0).toUpperCase() + s.slice(1) + ' only';
}

/* ---------- icons (1.6px stroke, 24 grid) ---------- */
export const P = {
  dashboard: '<rect x="3.5" y="3.5" width="7" height="8" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="5" rx="1.5"/><rect x="13.5" y="11.5" width="7" height="9" rx="1.5"/><rect x="3.5" y="14.5" width="7" height="6" rx="1.5"/>',
  invoice: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  receipt: '<path d="M6 3h12v18l-2.5-1.6L13 21l-1-.7-1 .7-2.5-1.6L6 21z"/><path d="M9.5 8h5M9.5 12h5"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.4a6.5 6.5 0 0 1 3.5 5.6"/>',
  box: '<path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z"/><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  chevDown: '<path d="M7 10l5 5 5-5"/>',
  chevRight: '<path d="M10 7l5 5-5 5"/>',
  chevLeft: '<path d="M14 7l-5 5 5 5"/>',
  sortUp: '<path d="M8 14l4-4 4 4"/>',
  sortDown: '<path d="M8 10l4 4 4-4"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 16V5M7 10l5-5 5 5M5 20h14"/>',
  print: '<path d="M7 8.5V3.5h10v5"/><rect x="3" y="8.5" width="18" height="8.5" rx="2.5"/><path d="M7 14h10v6.5H7z"/>',
  share: '<path d="M12 3v12M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>',
  send: '<path d="M21 3 10.5 13.5"/><path d="M21 3l-6.5 18-4-7.5L3 9.5z"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  moon: '<path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  sync: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
  grip: '<circle cx="9" cy="6" r="1.1"/><circle cx="15" cy="6" r="1.1"/><circle cx="9" cy="12" r="1.1"/><circle cx="15" cy="12" r="1.1"/><circle cx="9" cy="18" r="1.1"/><circle cx="15" cy="18" r="1.1"/>',
  wallet: '<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v4"/><rect x="4" y="9" width="17" height="11" rx="2.5"/><path d="M16.5 14.5h.01"/>',
  ban: '<circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/>',
  alert: '<circle cx="12" cy="12" r="8.5"/><path d="M12 8v4.5M12 16v.1"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 7l8.5 6 8.5-6"/>',
  chat: '<path d="M20.5 11.6A8.5 8.5 0 0 1 8 19.1l-4.5 1.4L5 16.2A8.5 8.5 0 1 1 20.5 11.6z"/>',
  sidebar: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9.5 4.5v15"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  arrowDown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  table: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M3.5 15h17M10 10v9.5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10"/>',
  del: '<path d="M9 5h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-6-7z"/><path d="M12 9.5l5 5M17 9.5l-5 5"/>'
};
export const ic = (n, cls = '') => `<svg${cls ? ` class="${cls}"` : ''} viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || ''}</svg>`;

export async function sha256(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
