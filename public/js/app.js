// Kuzelle — application shell, routes and views.
import {
  $, $$, esc, uid, num, toCents, fromCents, readJSON, writeJSON, mq, initials, plural, debounce,
  todayISO, addDays, daysBetween, fmtDate, fmtShort, monthLabel, monthsBetween, periodRange, inRange,
  CURRENCIES, money, moneyHTML, plainAmount, symbolOf, ic
} from './util.js';
import {
  CONFIG, UIKEY, ATTKEY, bus, DB, S, MODE, syncState, lastSync, firstSyncDone, pendingCount,
  putDoc, delDoc, putClient, delClient, putProduct, delProduct, putSettings, replaceAll, normalize, defaultSettings,
  login, canResume, sessionValid, endSession, sync, scheduleSync,
  findDoc, findClient, invoices, receipts, byDateDesc, totals, balances, invoiceStatus, docStatus, STATUS,
  receiptAmount, receiptCents, paymentsFor, isVoid, countsAsIssued, nextNumber, numberTaken, formatNumber,
  findDuplicateClient, clientSummary, aggregate, monthlySeries, newInvoice, newReceipt, METHODS, TERMS, lineCents
} from './store.js';
import { renderPreview, paginate, printDoc, downloadPDF, pdfFile, docFileName } from './document.js';
import { toast, openDialog, closeAllDialogs, confirmDialog, showMenu, closeMenu, showTip, hideTip, setFieldError, clearErrors, skeletonRows, dialogs } from './ui.js';
import { LOGO, MARK } from './brand.js';

/* =====================================================================
   Preferences & theme
   ===================================================================== */
let UI = readJSON(UIKEY, {}) || {};
const saveUI = () => writeJSON(UIKEY, UI);
const effectiveTheme = () => { const t = UI.theme || 'system'; return t === 'system' ? (mq('(prefers-color-scheme: dark)') ? 'dark' : 'light') : t; };
function applyTheme() {
  const dark = effectiveTheme() === 'dark';
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const meta = $('meta[name="theme-color"]'); if (meta) meta.content = dark ? '#0E0E10' : '#F7F7F8';
  $$('[data-act="toggle-theme"]').forEach(b => { b.innerHTML = ic(dark ? 'sun' : 'moon'); b.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme'); b.title = dark ? 'Light theme' : 'Dark theme'; });
  $$('[data-theme-opt]').forEach(b => b.classList.toggle('on', b.dataset.themeOpt === (UI.theme || 'system')));
}
function setTheme(t) { UI.theme = t; saveUI(); applyTheme(); if (current.name === 'dashboard' || current.name === 'reports') renderRoute(true); }
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if ((UI.theme || 'system') === 'system') applyTheme(); });

/* =====================================================================
   Shell
   ===================================================================== */
const NAV = [
  { group: '', items: [['dashboard', 'Dashboard', 'dashboard']] },
  { group: 'Billing', items: [['invoices', 'Invoices', 'invoice'], ['receipts', 'Receipts', 'receipt']] },
  { group: 'Customers', items: [['clients', 'Clients', 'users'], ['products', 'Products & services', 'box']] },
  { group: 'Insights', items: [['reports', 'Reports', 'chart']] }
];
function sidebarHTML() {
  return `
  <div class="sb-head">
    <img class="sb-logo brand-ink" src="${LOGO}" alt="Kuzelle">
    <img class="sb-mark brand-ink" src="${MARK}" alt="Kuzelle">
    <button class="icon-btn collapse-btn" data-act="collapse" aria-label="Collapse sidebar" title="Collapse sidebar">${ic('sidebar')}</button>
  </div>
  <div class="sb-scroll">
    <div class="sb-cta"><a class="btn btn-primary btn-block" href="#/invoices/new" title="New invoice">${ic('plus')}<span class="nav-text">New invoice</span></a></div>
    ${NAV.map(g => `<div class="sb-group">${g.group ? `<div class="sb-label">${g.group}</div>` : ''}${g.items.map(([k, l, i]) =>
      `<a class="nav-link" href="#/${k}" data-nav="${k}" title="${l}">${ic(i)}<span class="nav-text">${l}</span><span class="count" data-count="${k}"></span></a>`).join('')}</div>`).join('')}
    <div class="sb-group" style="margin-top:auto"><a class="nav-link" href="#/settings" data-nav="settings" title="Settings">${ic('settings')}<span class="nav-text">Settings</span></a></div>
  </div>
  <div class="sb-foot">
    <div class="sb-row">
      <button class="sync-pill" data-act="sync-now" data-sync><span class="sdot"></span><span class="stxt"></span></button>
      <button class="icon-btn" data-act="toggle-theme"></button>
    </div>
    <button class="account" data-act="account" aria-haspopup="menu">
      <span class="avatar" id="acct-av"></span>
      <span class="who"><b class="ellipsis" id="acct-name"></b><small>${MODE === 'cloud' ? 'Synced workspace' : 'This device'}</small></span>
    </button>
  </div>`;
}
function paintAccount() {
  const s = S();
  const av = $('#acct-av');
  if (av) av.innerHTML = s.logo && s.logo !== 'none' ? `<img src="${s.logo}" alt="">` : esc(initials(s.businessName));
  const n = $('#acct-name'); if (n) n.textContent = s.businessName || 'Kuzelle';
  const open = invoices().filter(d => countsAsIssued(d) && balances(d).balanceCents > 0).length;
  const c = $('[data-count="invoices"]'); if (c) c.textContent = open || '';
}
function paintSync() {
  const label = { synced: 'Synced', syncing: 'Saving…', offline: 'Offline', error: 'Not synced', local: 'Saved on this device' }[MODE === 'cloud' ? syncState : 'local'] || '';
  $$('[data-sync]').forEach(el => {
    el.dataset.state = MODE === 'cloud' ? syncState : 'local';
    const t = $('.stxt', el); if (t) t.textContent = label;
    el.title = syncState === 'synced' && lastSync ? `Synced at ${new Date(lastSync).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : label;
  });
}
function applySidebarMode() {
  const app = $('#app');
  const pref = UI.sidebar || (mq('(min-width:1200px)') ? 'expanded' : 'collapsed');
  app.classList.toggle('collapsed', !mq('(max-width:767px)') && pref === 'collapsed');
}
function setDrawer(open) { $('#app').classList.toggle('drawer-open', open); document.body.classList.toggle('no-scroll', open); }
['(max-width:767px)', '(min-width:1200px)'].forEach(q => matchMedia(q).addEventListener('change', () => { applySidebarMode(); setDrawer(false); }));

function setTopbar({ crumbs = [], actions = '' } = {}) {
  $('#topbar').innerHTML = `
    <button class="icon-btn menu-btn" data-act="drawer" aria-label="Open menu">${ic('menu')}</button>
    <nav class="crumbs" aria-label="Breadcrumb">${crumbs.map((c, i) => {
      const last = i === crumbs.length - 1;
      return `${i ? `<span class="hide-sm">${ic('chevRight')}</span>` : ''}${last ? `<span class="cur">${esc(c[0])}</span>` : `<a class="hide-sm" href="${c[1]}">${esc(c[0])}</a>`}`;
    }).join('')}</nav>
    <div class="tb-actions">
      <div class="gsearch input-affix">${ic('search')}<input class="input" id="gsearch" type="search" placeholder="Search invoices, receipts, clients" autocomplete="off" aria-label="Search"><kbd>⌘K</kbd></div>
      <button class="icon-btn" data-act="search-mobile" aria-label="Search" style="${mq('(max-width:767px)') ? '' : 'display:none'}">${ic('search')}</button>
      ${actions}
    </div>`;
  bindGlobalSearch();
}

/* ---------- global search ---------- */
function searchResults(q) {
  q = q.trim().toLowerCase(); if (!q) return [];
  const hit = (...xs) => xs.filter(Boolean).join(' ').toLowerCase().includes(q);
  const inv = invoices().filter(d => hit(d.number, d.client && d.client.name)).sort(byDateDesc).slice(0, 5)
    .map(d => ({ href: `#/invoices/${d.id}`, icon: 'invoice', label: `${d.number}  ${(d.client && d.client.name) || ''}`, sub: money(totals(d).total, d.currency) }));
  const rc = receipts().filter(d => hit(d.number, d.client && d.client.name, d.reference)).sort(byDateDesc).slice(0, 5)
    .map(d => ({ href: `#/receipts/${d.id}`, icon: 'receipt', label: `${d.number}  ${(d.client && d.client.name) || ''}`, sub: money(receiptAmount(d), d.currency) }));
  const cl = DB.clients.filter(c => hit(c.name, c.email, c.phone)).slice(0, 5)
    .map(c => ({ href: `#/clients/${c.id}`, icon: 'users', label: c.name, sub: c.phone || c.email || '' }));
  return [['Invoices', inv], ['Receipts', rc], ['Clients', cl]].filter(g => g[1].length);
}
function searchPopHTML(groups) {
  if (!groups.length) return `<div class="menu-label" style="padding:10px">No matches</div>`;
  return groups.map(([h, items]) => `<div class="menu-label">${h}</div>${items.map(it => `<a class="menu-item" href="${it.href}">${ic(it.icon)}<span class="ellipsis" style="flex:1">${esc(it.label)}</span><span class="muted nowrap">${esc(it.sub)}</span></a>`).join('')}`).join('');
}
function bindGlobalSearch() {
  const input = $('#gsearch'); if (!input) return;
  const wrap = input.parentElement; let pop = null;
  const close = () => { if (pop) { pop.remove(); pop = null; } };
  const render = () => {
    const q = input.value; if (!q.trim()) { close(); return; }
    if (!pop) { pop = document.createElement('div'); pop.className = 'search-pop'; wrap.appendChild(pop); }
    pop.innerHTML = searchPopHTML(searchResults(q));
  };
  input.addEventListener('input', render);
  input.addEventListener('focus', render);
  input.addEventListener('blur', () => setTimeout(close, 150));
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') { input.value = ''; close(); input.blur(); }
    if (e.key === 'Enter') { const a = pop && $('a', pop); if (a) { location.hash = a.getAttribute('href'); input.value = ''; close(); input.blur(); } }
    if (e.key === 'ArrowDown' && pop) { e.preventDefault(); const a = $('a', pop); if (a) a.focus(); }
  });
  wrap.addEventListener('mousedown', e => { if (e.target.closest('a')) e.preventDefault(); });
  wrap.addEventListener('click', e => { const a = e.target.closest('a'); if (a) { location.hash = a.getAttribute('href'); input.value = ''; close(); } });
}
function openMobileSearch() {
  const d = openDialog({
    title: 'Search', body: `<div class="input-affix">${ic('search')}<input class="input" id="msearch" type="search" placeholder="Invoices, receipts, clients" autocomplete="off" autofocus></div><div id="mres" style="margin-top:10px"></div>`,
    onMount(b) {
      const i = $('#msearch', b);
      i.addEventListener('input', () => { $('#mres', b).innerHTML = i.value.trim() ? searchPopHTML(searchResults(i.value)) : ''; });
      b.addEventListener('click', e => { if (e.target.closest('a')) d.close(); });
      setTimeout(() => i.focus(), 250);
    }
  });
}

/* =====================================================================
   Router
   ===================================================================== */
let current = { name: '', parts: [], query: {} };
let dirty = false;           // an editor has unsaved changes
let lastHash = location.hash;
let pendingDraft = null;     // a prepared document for the next editor (duplicate)
function parseHash(h = location.hash) {
  const [path, qs] = h.replace(/^#\/?/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  // V1 routes
  if (!parts.length || parts[0] === 'home') return { name: 'dashboard', parts: [], query };
  if (parts[0] === 'documents') return { name: 'invoices', parts: [], query };
  if (parts[0] === 'new') return { name: parts[1] === 'receipt' ? 'receipts' : 'invoices', parts: ['new'], query };
  if (parts[0] === 'edit') { const d = findDoc(parts[1]); return { name: d && d.type === 'receipt' ? 'receipts' : 'invoices', parts: [parts[1], 'edit'], query }; }
  return { name: parts[0], parts: parts.slice(1), query };
}
export function go(h) { if (location.hash === h) renderRoute(); else location.hash = h; }
addEventListener('hashchange', async () => {
  if (dirty) {
    const target = location.hash;
    history.replaceState(null, '', lastHash || '#/dashboard');
    if (!(await confirmDialog({ title: 'Discard unsaved changes?', message: 'Your edits to this document haven’t been saved.', ok: 'Discard', danger: true }))) return;
    dirty = false;
    location.hash = target;
    return;
  }
  renderRoute();
});
addEventListener('beforeunload', e => { if (dirty || (MODE === 'cloud' && pendingCount() && navigator.onLine)) { e.preventDefault(); e.returnValue = ''; } });

const ROUTES = {
  dashboard: () => viewDashboard(),
  invoices: ({ parts }) => parts[0] === 'new' ? viewInvoiceEditor(null) : parts[1] === 'edit' ? viewInvoiceEditor(parts[0]) : parts[0] ? viewInvoice(parts[0]) : viewInvoices(),
  receipts: ({ parts, query }) => parts[0] === 'new' ? viewReceiptEditor(null, query) : parts[1] === 'edit' ? viewReceiptEditor(parts[0]) : parts[0] ? viewReceipt(parts[0]) : viewReceipts(),
  clients: ({ parts }) => parts[0] ? viewClient(parts[0]) : viewClients(),
  products: () => viewProducts(),
  reports: () => viewReports(),
  settings: ({ parts }) => viewSettings(parts[0] || 'business')
};
function renderRoute(keep) {
  const r = parseHash();
  if (!ROUTES[r.name]) { location.replace('#/dashboard'); return; }
  const sameView = keep && r.name === current.name && r.parts.join('/') === current.parts.join('/');
  current = r; lastHash = location.hash;
  if (!keep) { closeAllDialogs(); closeMenu(); dirty = false; }
  setDrawer(false);
  $$('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === r.name));
  const y = scrollY;
  const view = ROUTES[r.name](r);
  if (!view) return;
  setTopbar(view.topbar);
  $('#view').innerHTML = view.html;
  view.mount && view.mount($('#view'));
  applyTheme(); paintSync(); paintAccount();
  if (sameView) scrollTo(0, y); else scrollTo(0, 0);
  document.title = `${view.title || 'Kuzelle'} · Kuzelle`;
}
/* Re-render after data changes, but never under someone's cursor or over an open editor. */
let refreshQueued = false;
function refreshView() {
  if (current.parts.includes('new') || current.parts.includes('edit')) { paintAccount(); return; }
  const a = document.activeElement;
  if (a && $('#view').contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) { refreshQueued = true; return; }
  renderRoute(true);
}
document.addEventListener('focusout', () => { if (refreshQueued) setTimeout(() => { const a = document.activeElement; if (!(a && /INPUT|TEXTAREA|SELECT/.test(a.tagName))) { refreshQueued = false; refreshView(); } }, 60); });
bus.addEventListener('change', e => { if (e.detail && e.detail.source === 'remote') refreshView(); else paintAccount(); });
bus.addEventListener('sync', () => { paintSync(); if (firstSyncDone && waitingForFirstSync) { waitingForFirstSync = false; refreshView(); } });
bus.addEventListener('unauthorized', () => lockApp('Your session ended. Enter the code again.'));
bus.addEventListener('storage-error', () => toast('Couldn’t save on this device. Storage is full or blocked.', { error: true }));
bus.addEventListener('migrated', () => { UI.migrated = true; saveUI(); });
bus.addEventListener('migrate', async e => {
  const { counts, resolve } = e.detail;
  const up = await confirmDialog({ title: 'Move your records online?', message: `This device has ${plural(counts.docs, 'document')} and ${plural(counts.clients, 'client')} that aren’t in the database yet. Upload them so every device sees the same records.`, ok: 'Upload', cancel: 'Start fresh' });
  resolve(up);
});
let waitingForFirstSync = false;
const loadingData = () => MODE === 'cloud' && !firstSyncDone && !DB.docs.length && !DB.clients.length;

/* =====================================================================
   Shared renderers
   ===================================================================== */
const badge = d => { const s = docStatus(d); return `<span class="badge ${s}">${STATUS[s]}</span>`; };
const clientName = d => (d.client && d.client.name) || 'No client';
const emptyHTML = (icon, title, text, btn = '') => `<div class="empty"><div class="e-ic">${ic(icon)}</div><h3>${esc(title)}</h3><p>${esc(text)}</p>${btn}</div>`;
const pageHead = (title, sub, actions = '') => `<div class="page-head"><div><h1>${esc(title)}</h1>${sub ? `<p>${sub}</p>` : ''}</div><div class="page-actions">${actions}</div></div>`;
function sortBtn(list, key, label, align = '') {
  const st = LS[list]; const on = st.sort === key;
  return `<button class="${on ? 'sorted' : ''}" data-act="sort" data-list="${list}" data-k="${key}" style="${align === 'r' ? 'margin-left:auto' : ''}">${label}${on ? ic(st.dir === 'asc' ? 'sortUp' : 'sortDown') : ''}</button>`;
}
function pagerHTML(list, total) {
  const st = LS[list], per = 25, pages = Math.max(1, Math.ceil(total / per));
  if (st.page > pages) st.page = pages;
  const a = (st.page - 1) * per + 1, b = Math.min(total, st.page * per);
  return `<div class="tbl-foot"><span>${total ? `${a}–${b} of ${total}` : '0 results'}</span>${pages > 1 ? `<div class="pager">
    <button class="icon-btn sm" data-act="page" data-list="${list}" data-d="-1" ${st.page <= 1 ? 'disabled' : ''} aria-label="Previous page">${ic('chevLeft')}</button>
    <span>${st.page} / ${pages}</span>
    <button class="icon-btn sm" data-act="page" data-list="${list}" data-d="1" ${st.page >= pages ? 'disabled' : ''} aria-label="Next page">${ic('chevRight')}</button></div>` : ''}</div>`;
}
const pageSlice = (list, arr) => { const st = LS[list]; return arr.slice((st.page - 1) * 25, st.page * 25); };
function sortBy(arr, key, dir, get) { const m = dir === 'asc' ? 1 : -1; return [...arr].sort((a, b) => { const x = get(a, key), y = get(b, key); return (x > y ? 1 : x < y ? -1 : 0) * m || byDateDesc(a, b); }); }
const PERIODS = [['all', 'All dates'], ['this-month', 'This month'], ['last-month', 'Last month'], ['last-90', 'Last 90 days'], ['this-year', 'This year'], ['last-year', 'Last year'], ['custom', 'Custom range']];
const periodSelect = (list, st) => `<select class="input" data-lf="period" data-list="${list}" aria-label="Date range">${PERIODS.map(([k, l]) => `<option value="${k}"${st.period === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
  ${st.period === 'custom' ? `<input class="input" type="date" data-lf="from" data-list="${list}" value="${esc(st.from)}" aria-label="From"><input class="input" type="date" data-lf="to" data-list="${list}" value="${esc(st.to)}" aria-label="To">` : ''}`;
const rangeOf = st => periodRange(st.period, st);

/* ---------- chart ---------- */
function niceMax(v) { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p; return 10 * p; }
const compact = (v, cur) => symbolOf(cur) + new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
function drawChart(el, series, cur) {
  const w = Math.max(280, el.clientWidth), h = mq('(max-width:767px)') ? 190 : 230, pl = 54, pb = 26, pt = 8, pr = 4;
  const peak = Math.max(0, ...series.flatMap(s => [s.invoiced, s.received]));
  const max = niceMax(peak);
  const iw = w - pl - pr, ih = h - pt - pb, n = series.length, gw = iw / n, bw = Math.max(4, Math.min(16, gw * .26));
  let svg = `<svg class="chart" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Invoiced and received by month">`;
  for (let i = 0; i <= 4; i++) { const y = pt + ih - ih * i / 4; svg += `<line class="grid-line" x1="${pl}" x2="${w - pr}" y1="${y}" y2="${y}"/>${peak || !i ? `<text class="axis" x="${pl - 8}" y="${y + 4}" text-anchor="end">${esc(compact(max * i / 4, cur))}</text>` : ''}`; }
  const every = n > 8 && w < 520 ? 2 : 1;
  series.forEach((s, i) => {
    const cx = pl + gw * i + gw / 2, ha = ih * s.invoiced / max, hb = ih * s.received / max;
    svg += `<g class="col"><rect class="bar-b" x="${cx - bw - 2}" y="${pt + ih - ha}" width="${bw}" height="${Math.max(ha, 0)}" rx="3"/><rect class="bar-a" x="${cx + 2}" y="${pt + ih - hb}" width="${bw}" height="${Math.max(hb, 0)}" rx="3"/>
      ${i % every === 0 ? `<text class="axis" x="${cx}" y="${h - 6}" text-anchor="middle">${esc(monthLabel(s.key, 'short'))}</text>` : ''}
      <rect class="hit" data-i="${i}" x="${pl + gw * i}" y="${pt}" width="${gw}" height="${ih}" fill="transparent"/></g>`;
  });
  if (!peak) svg += `<text class="axis" x="${pl + iw / 2}" y="${pt + ih / 2}" text-anchor="middle" style="font-size:12.5px">No invoices or payments in this period yet</text>`;
  el.innerHTML = svg + '</svg>';
  $$('.hit', el).forEach(r => {
    r.addEventListener('mousemove', e => { const s = series[+r.dataset.i]; showTip(e, `<b>${esc(monthLabel(s.key))}</b>Invoiced ${esc(money(s.invoiced, cur))}<br>Received ${esc(money(s.received, cur))}`); });
    r.addEventListener('mouseleave', hideTip);
  });
}
function mountChart(el, series, cur) {
  drawChart(el, series, cur);
  let lw = el.clientWidth;
  const ro = new ResizeObserver(() => { if (Math.abs(el.clientWidth - lw) > 8 && el.isConnected) { lw = el.clientWidth; drawChart(el, series, cur); } });
  ro.observe(el);
}
const legend = `<div class="legend"><span><i style="background:var(--chart-b)"></i>Invoiced</span><span><i style="background:var(--chart-a)"></i>Received</span></div>`;

/* =====================================================================
   Dashboard
   ===================================================================== */
function viewDashboard() {
  const s = S(), cur = s.currency, per = UI.dashPeriod || 'this-month', range = periodRange(per);
  const ag = aggregate(range, cur), now = aggregate(periodRange('all'), cur);
  const nM = UI.dashMonths === 12 ? 12 : 6, t0 = new Date();
  const m0 = new Date(t0.getFullYear(), t0.getMonth() - nM + 1, 1);
  const months = monthsBetween(`${m0.getFullYear()}-${String(m0.getMonth() + 1).padStart(2, '0')}-01`, todayISO());
  const series = monthlySeries(months, cur);
  const loading = loadingData();
  const kv = v => loading ? '<span class="sk" style="height:22px;width:70%;margin-top:4px"></span>' : moneyHTML(v, cur);
  const hr = new Date().getHours();
  const greet = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  const recentInv = invoices().sort(byDateDesc).slice(0, 6);
  const recentRc = receipts().sort(byDateDesc).slice(0, 6);
  const invCols = 'minmax(0,1.4fr) 96px 96px 120px 120px 34px';
  if (loading) waitingForFirstSync = true;
  return {
    title: 'Dashboard',
    topbar: { crumbs: [['Dashboard']] },
    html: `<div class="content stack">
      ${pageHead(greet, `${esc(new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }))}. Here’s where ${esc(s.businessName)} stands.`,
        `<a class="btn btn-secondary" href="#/clients?new=1">${ic('users')}Add client</a><a class="btn btn-secondary" href="#/receipts/new">${ic('receipt')}New receipt</a><a class="btn btn-primary" href="#/invoices/new">${ic('plus')}New invoice</a>`)}
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:-8px">
        <div class="seg" role="tablist" aria-label="Period">${[['this-month', 'This month'], ['last-month', 'Last month'], ['this-year', 'This year'], ['all', 'All time']].map(([k, l]) => `<button data-act="dash-period" data-k="${k}" class="${per === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        ${ag.otherCur ? `<span class="muted" style="font-size:12.5px">Totals in ${cur}. ${plural(ag.otherCur, 'document')} in other currencies are left out.</span>` : ''}
      </div>
      <section class="kpis" aria-label="Summary">
        <div class="kpi"><div class="k-label">Total invoiced</div><div class="k-value num">${kv(ag.invoiced)}</div><div class="k-sub">${plural(ag.invoicedCount, 'invoice')} ${range.label.toLowerCase()}</div></div>
        <div class="kpi"><div class="k-label">Received</div><div class="k-value num">${kv(ag.received)}</div><div class="k-sub">${plural(ag.payments.length + ag.legacy.length, 'payment')}</div></div>
        <div class="kpi"><div class="k-label">Outstanding</div><div class="k-value num">${kv(now.outstanding)}</div><div class="k-sub">${plural(now.openCount, 'open invoice')}</div><button class="k-link" data-act="goto-filter" data-f="open" aria-label="Show open invoices"></button></div>
        <div class="kpi ${now.overdueList.length ? 'alert' : ''}"><div class="k-label">Overdue</div><div class="k-value num">${kv(now.overdue)}</div><div class="k-sub">${plural(now.overdueList.length, 'invoice')} past due</div><button class="k-link" data-act="goto-filter" data-f="overdue" aria-label="Show overdue invoices"></button></div>
        <div class="kpi"><div class="k-label">Receipts issued</div><div class="k-value num">${loading ? kv(0) : ag.receiptsCount}</div><div class="k-sub">${range.label}</div></div>
      </section>
      <div class="split-2">
        <section class="card">
          <div class="card-head"><div><h2>Financial overview</h2><div class="sub">Invoiced against received, in ${cur}</div></div>
            <div class="seg">${[[6, '6 months'], [12, '12 months']].map(([k, l]) => `<button data-act="dash-months" data-k="${k}" class="${(UI.dashMonths || 6) === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
          <div class="card-body"><div id="dash-chart"></div><div style="margin-top:10px">${legend}</div></div>
        </section>
        <section class="card">
          <div class="card-head"><h2>Recent receipts</h2><a class="btn btn-ghost btn-sm" href="#/receipts">View all</a></div>
          <div class="tbl list-plain">${loading ? skeletonRows(5) : recentRc.length ? recentRc.map(r => `<div class="tbl-row" style="--cols:minmax(0,1fr) auto" data-href="#/receipts/${r.id}" tabindex="0" role="link">
            <div class="cell-2" data-m="a"><span class="cell-main">${esc(clientName(r))}</span><span class="cell-sub">${esc(r.number)}, ${esc(fmtShort(r.issueDate))}${r.linkedInvoiceId ? `, for ${esc((findDoc(r.linkedInvoiceId) || {}).number || r.invoiceNumber || '')}` : ''}</span></div>
            <div class="cell-2 r" data-m="b" style="align-items:flex-end"><span class="amount" ${isVoid(r) ? 'style="text-decoration:line-through;color:var(--text-3)"' : ''}>${esc(money(receiptAmount(r), r.currency))}</span><span class="cell-sub">${esc(r.paymentMethod || '')}</span></div></div>`).join('')
            : emptyHTML('receipt', 'No receipts yet', 'Record a payment on an invoice, or issue a standalone receipt.', '<a class="btn btn-secondary btn-sm" href="#/receipts/new">New receipt</a>')}</div>
        </section>
      </div>
      <section class="card">
        <div class="card-head"><h2>Recent invoices</h2><a class="btn btn-ghost btn-sm" href="#/invoices">View all</a></div>
        ${loading ? `<div class="tbl">${skeletonRows(5)}</div>` : recentInv.length ? `<div class="tbl">
          <div class="tbl-row tbl-head" style="--cols:${invCols}"><span>Invoice</span><span>Issued</span><span>Due</span><span class="r">Amount</span><span>Status</span><span></span></div>
          <div class="tbl-body">${recentInv.map(d => invoiceRow(d, invCols, true)).join('')}</div></div>`
          : emptyHTML('invoice', 'No invoices yet', 'Create your first invoice. It takes about a minute.', '<a class="btn btn-primary btn-sm" href="#/invoices/new">Create invoice</a>')}
      </section>
    </div>
    <a class="btn btn-primary fab" href="#/invoices/new">${ic('plus')}New invoice</a>`,
    mount(el) { const c = $('#dash-chart', el); if (c) mountChart(c, series, cur); }
  };
}

/* =====================================================================
   Invoices
   ===================================================================== */
const LS = {
  invoices: { q: '', status: 'all', period: 'all', from: '', to: '', sort: 'issueDate', dir: 'desc', page: 1 },
  receipts: { q: '', client: '', period: 'all', from: '', to: '', sort: 'issueDate', dir: 'desc', page: 1 },
  clients: { q: '', sort: 'name', dir: 'asc', page: 1 }
};
const INV_FILTERS = [['all', 'All'], ['open', 'Open'], ['draft', 'Draft'], ['sent', 'Sent'], ['partial', 'Partially paid'], ['overdue', 'Overdue'], ['paid', 'Paid'], ['cancelled', 'Cancelled']];
function invMatches(d, f) {
  const s = invoiceStatus(d);
  if (f === 'all') return true;
  if (f === 'open') return countsAsIssued(d) && s !== 'paid';
  if (f === 'sent') return s === 'sent' || s === 'issued';
  return s === f;
}
function filteredInvoices() {
  const st = LS.invoices, q = st.q.trim().toLowerCase(), range = rangeOf(st);
  const list = invoices().filter(d => invMatches(d, st.status) && (st.period === 'all' || inRange(d.issueDate, range))
    && (!q || [d.number, d.client && d.client.name, d.client && d.client.phone, ...(d.items || []).map(i => i.desc)].join(' ').toLowerCase().includes(q)));
  return sortBy(list, st.sort, st.dir, (d, k) => k === 'amount' ? totals(d).totalCents : k === 'balance' ? balances(d).balanceCents : k === 'client' ? clientName(d).toLowerCase() : k === 'number' ? String(d.number) : d[k] || '');
}
function invoiceRow(d, cols, compactRow) {
  const t = totals(d), b = balances(d), st = invoiceStatus(d);
  const due = st === 'overdue' ? `<span style="color:var(--red)">${esc(fmtShort(d.dueDate))}</span>` : esc(fmtShort(d.dueDate));
  return `<div class="tbl-row" style="--cols:${cols}" data-href="#/invoices/${d.id}" tabindex="0" role="link">
    ${compactRow ? '' : `<span class="cell-main num">${esc(d.number)}</span>`}
    <div class="cell-2" data-m="a"><span class="cell-main">${esc(clientName(d))}</span><span class="cell-sub">${compactRow ? esc(d.number) : `<span class="m-only">${esc(d.number)}</span>`}</span></div>
    <span class="t2">${esc(fmtShort(d.issueDate))}</span>
    <span data-m="c"><span class="m-only">Due </span>${due}</span>
    <span class="amount r" data-m="b">${esc(money(t.total, d.currency))}</span>
    ${compactRow ? '' : `<span class="amount r ${b.balanceCents ? '' : 'muted'}">${esc(money(b.balance, d.currency))}</span>`}
    <span data-m="d">${badge(d)}</span>
    <button class="icon-btn sm row-menu" data-act="doc-menu" data-id="${d.id}" aria-label="Actions for ${esc(d.number)}" aria-haspopup="menu">${ic('more')}</button>
  </div>`;
}
const INV_COLS = '110px minmax(0,1.5fr) 92px 92px 124px 124px 128px 34px';
function invoiceTableHTML() {
  const list = filteredInvoices();
  if (loadingData()) return `<div class="tbl">${skeletonRows(8)}</div>`;
  if (!invoices().length) return emptyHTML('invoice', 'No invoices yet', 'Invoices you create appear here with their payment status.', '<a class="btn btn-primary" href="#/invoices/new">Create invoice</a>');
  const page = pageSlice('invoices', list);
  return `<div class="tbl" role="table">
    <div class="tbl-row tbl-head" role="row" style="--cols:${INV_COLS}">${sortBtn('invoices', 'number', 'Number')}${sortBtn('invoices', 'client', 'Client')}${sortBtn('invoices', 'issueDate', 'Issued')}${sortBtn('invoices', 'dueDate', 'Due')}<span class="r">${sortBtn('invoices', 'amount', 'Amount')}</span><span class="r">${sortBtn('invoices', 'balance', 'Balance')}</span><span>Status</span><span></span></div>
    <div class="tbl-body">${page.length ? page.map(d => invoiceRow(d, INV_COLS)).join('') : emptyHTML('search', 'No invoices match', 'Try a different search, status or date range.', '<button class="btn btn-secondary btn-sm" data-act="clear-filters" data-list="invoices">Clear filters</button>')}</div>
  </div>${pagerHTML('invoices', list.length)}`;
}
function invoiceChips() {
  return INV_FILTERS.map(([k, l]) => { const n = k === 'all' ? 0 : invoices().filter(d => invMatches(d, k)).length;
    return `<button class="chip${LS.invoices.status === k ? ' on' : ''}" data-act="inv-status" data-k="${k}">${l}${n ? `<span class="n">${n}</span>` : ''}</button>`; }).join('');
}
function viewInvoices() {
  const st = LS.invoices;
  return {
    title: 'Invoices',
    topbar: { crumbs: [['Invoices']], actions: `<a class="btn btn-primary btn-sm hide-sm" href="#/invoices/new">${ic('plus')}New invoice</a>` },
    html: `<div class="content">
      ${pageHead('Invoices', 'Every invoice, its balance and where it stands.', `<button class="btn btn-secondary" data-act="export-csv" data-k="invoices">${ic('download')}Export</button><a class="btn btn-primary" href="#/invoices/new">${ic('plus')}New invoice</a>`)}
      <section class="card">
        <div class="toolbar">
          <div class="input-affix grow">${ic('search')}<input class="input" id="list-q" data-list="invoices" type="search" placeholder="Search number, client or item" value="${esc(st.q)}" autocomplete="off"></div>
          ${periodSelect('invoices', st)}
        </div>
        <div class="toolbar" style="padding-top:8px;padding-bottom:8px"><div class="filter-chips" id="inv-chips">${invoiceChips()}</div></div>
        <div id="list-body">${invoiceTableHTML()}</div>
      </section>
    </div><a class="btn btn-primary fab" href="#/invoices/new">${ic('plus')}New invoice</a>`,
    mount: bindListControls
  };
}
function refreshList() {
  const n = current.name, body = $('#list-body'); if (!body) return;
  body.innerHTML = n === 'invoices' ? invoiceTableHTML() : n === 'receipts' ? receiptTableHTML() : clientTableHTML();
  const chips = $('#inv-chips'); if (chips) chips.innerHTML = invoiceChips();
}
function bindListControls(el) {
  const q = $('#list-q', el);
  if (q) q.addEventListener('input', debounce(() => { LS[q.dataset.list].q = q.value; LS[q.dataset.list].page = 1; refreshList(); }, 120));
  el.addEventListener('change', e => {
    const t = e.target; if (!t.dataset.lf) return;
    const st = LS[t.dataset.list]; st[t.dataset.lf] = t.value; st.page = 1;
    if (t.dataset.lf === 'period') renderRoute(true); else refreshList();
  });
}

/* ---------- invoice detail ---------- */
function viewInvoice(id) {
  const d = findDoc(id);
  if (!d || d.type !== 'invoice') return notFound('Invoice', '#/invoices');
  const b = balances(d), st = invoiceStatus(d), pays = receipts().filter(r => r.linkedInvoiceId === d.id).sort((a, c) => (a.issueDate || '').localeCompare(c.issueDate || ''));
  const pct = b.totalCents ? Math.min(100, Math.round(b.paidCents / b.totalCents * 100)) : 0;
  const canPay = countsAsIssued(d) && b.balanceCents > 0;
  const overdueDays = st === 'overdue' ? daysBetween(d.dueDate, todayISO()) : 0;
  const termsLabel = (TERMS.find(t => t[0] === String(d.terms)) || [])[1];
  return {
    title: d.number,
    topbar: { crumbs: [['Invoices', '#/invoices'], [d.number]], actions: `<button class="btn btn-secondary btn-sm hide-sm" data-act="dl" data-id="${d.id}">${ic('download')}PDF</button>` },
    html: `<div class="detail">
      <div class="workspace ws-scroll">
        <div class="ws-bar"><span>${esc(STATUS[st])} invoice</span><span id="pg-count"></span></div>
        <div id="preview" data-pad="0" data-max="1" style="max-width:820px;margin:0 auto"></div>
      </div>
      <aside class="side" aria-label="Invoice summary">
        <div class="side-sec">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px"><a class="cell-main ellipsis" href="${d.clientId ? '#/clients/' + d.clientId : '#/clients'}" style="font-size:15px">${esc(clientName(d))}</a>${badge(d)}</div>
          <div class="big-amt num"><span class="cur">${esc(d.currency)}</span>${esc(plainAmount(b.total))}</div>
          ${countsAsIssued(d) ? `<div class="progress" aria-label="${pct}% paid"><i style="width:${pct}%"></i></div>
          <div class="kv" style="padding:0"><span>${esc(money(b.paid, d.currency))} paid</span><b>${b.balanceCents ? esc(money(b.balance, d.currency)) + ' due' : 'Fully paid'}</b></div>` : ''}
        </div>
        <div class="side-sec" style="display:grid;gap:10px">
          ${d.status === 'draft' && !d.cancelledAt ? `<button class="btn btn-primary btn-block" data-act="finalize" data-id="${d.id}">${ic('check')}Finalize invoice</button>` : ''}
          ${canPay ? `<a class="btn btn-primary btn-block" href="#/receipts/new?invoice=${d.id}">${ic('wallet')}Record payment</a>` : ''}
          <div class="actions-grid">
            <a class="act" href="#/invoices/${d.id}/edit">${ic('edit')}Edit</a>
            <button class="act" data-act="dl" data-id="${d.id}">${ic('download')}PDF</button>
            <button class="act" data-act="print" data-id="${d.id}">${ic('print')}Print</button>
            <button class="act" data-act="share" data-id="${d.id}">${ic('share')}Share</button>
          </div>
          <button class="btn btn-ghost btn-sm" data-act="doc-menu" data-id="${d.id}" data-detail="1" style="justify-self:center">${ic('more')}More actions</button>
        </div>
        <div class="side-sec"><h3>Details</h3>
          <div class="kv"><span>Number</span><b>${esc(d.number)}</b></div>
          <div class="kv"><span>Issued</span><b>${esc(fmtDate(d.issueDate))}</b></div>
          <div class="kv"><span>Due</span><b ${overdueDays ? 'style="color:var(--red)"' : ''}>${esc(fmtDate(d.dueDate))}${overdueDays ? `, ${plural(overdueDays, 'day')} late` : ''}</b></div>
          ${termsLabel && d.terms !== 'custom' ? `<div class="kv"><span>Terms</span><b>${esc(termsLabel)}</b></div>` : ''}
          <div class="kv"><span>Currency</span><b>${esc(d.currency)}</b></div>
          ${d.sentAt ? `<div class="kv"><span>Sent</span><b>${esc(fmtDate(d.sentAt.slice(0, 10)))}</b></div>` : ''}
          ${d.cancelledAt ? `<div class="kv"><span>Cancelled</span><b>${esc(fmtDate(d.cancelledAt.slice(0, 10)))}</b></div>` : ''}
        </div>
        <div class="side-sec"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><h3 style="margin:0">Payments</h3>${canPay ? `<a class="btn btn-ghost btn-sm" href="#/receipts/new?invoice=${d.id}">${ic('plus')}Add</a>` : ''}</div>
          ${pays.length ? `<div class="timeline">${pays.map(r => `<div class="tl-item${isVoid(r) ? ' void' : ''}" data-href="#/receipts/${r.id}" tabindex="0" role="link"><span class="tl-dot"></span><div><b>${esc(r.number)}</b><small>${esc(fmtDate(r.issueDate))}, ${esc(r.paymentMethod || '')}${isVoid(r) ? ', void' : ''}</small></div><span class="amount" ${isVoid(r) ? 'style="text-decoration:line-through;color:var(--text-3)"' : ''}>${esc(money(receiptAmount(r), r.currency))}</span></div>`).join('')}</div>`
            : d.status === 'paid' && !pays.length ? '<p class="muted" style="margin:0;font-size:13px">Marked as paid in the earlier version, without a receipt.</p>' : '<p class="muted" style="margin:0;font-size:13px">No payments recorded yet.</p>'}
        </div>
      </aside>
    </div>`,
    mount(el) { const n = renderPreview($('#preview', el), d); $('#pg-count', el).textContent = plural(n, 'page'); }
  };
}
function notFound(kind, back) {
  return { title: 'Not found', topbar: { crumbs: [[kind]] }, html: `<div class="content">${emptyHTML('alert', `${kind} not found`, 'It may have been deleted on another device.', `<a class="btn btn-secondary" href="${back}">Go back</a>`)}</div>` };
}

/* ---------- document actions ---------- */
async function withBusy(btn, label, fn) {
  const old = btn ? btn.innerHTML : '';
  if (btn) { btn.classList.add('loading'); if (label) btn.innerHTML = esc(label); }
  try { await fn(); } catch (e) { console.error(e); toast(e.message || 'Something went wrong', { error: true }); }
  finally { if (btn && btn.isConnected) { btn.classList.remove('loading'); btn.innerHTML = old; } }
}
const actDownload = (d, btn) => withBusy(btn, 'Preparing…', async () => { await downloadPDF(d); toast(`${d.number}.pdf downloaded`); });
function markSent(d) { if (d.type === 'invoice' && countsAsIssued(d) && !d.sentAt) putDoc({ ...d, sentAt: new Date().toISOString() }); }
function shareText(d) {
  const s = S(), first = ((d.client && d.client.name) || '').split(/\s+/)[0] || 'there';
  if (d.type === 'receipt') return `Hello ${first},\n\nThank you. This confirms we received ${money(receiptAmount(d), d.currency)} on ${fmtDate(d.issueDate)} by ${d.paymentMethod}.\nReceipt no. ${d.number}${d.linkedInvoiceId && findDoc(d.linkedInvoiceId) ? `\nBalance remaining on ${findDoc(d.linkedInvoiceId).number}: ${money(balances(findDoc(d.linkedInvoiceId)).balance, d.currency)}` : ''}\n\n${s.businessName}`;
  const b = balances(d);
  return `Hello ${first},\n\nHere is invoice ${d.number} from ${s.businessName}.\n${b.paidCents ? `Balance due: ${money(b.balance, d.currency)} (of ${money(b.total, d.currency)})` : `Amount due: ${money(b.total, d.currency)}`}\nDue date: ${fmtDate(d.dueDate)}${d.showPayment !== false && s.payment ? `\n\nHow to pay:\n${s.payment}` : ''}\n\nThank you,\n${s.businessName}`;
}
function waPhone(p) {
  let x = String(p || '').replace(/\D/g, '');
  if (!x) return '';
  if (x.startsWith('00')) x = x.slice(2); else if (x.startsWith('0')) x = String(S().countryCode || '').replace(/\D/g, '') + x.slice(1);
  return x;
}
function actShare(d) {
  const c = d.client || {}, msg = shareText(d), label = d.type === 'receipt' ? 'receipt' : 'invoice';
  const canFiles = !!(navigator.canShare && navigator.share);
  const dlg = openDialog({
    title: `Share ${esc(d.number)}`, width: 460,
    body: `<div style="display:grid;gap:6px">
      ${canFiles ? `<button class="menu-item" style="height:52px" data-sh="native">${ic('share')}<div class="cell-2"><span class="cell-main">Share PDF</span><span class="cell-sub">Send the document to WhatsApp, Mail or any app</span></div></button>` : ''}
      <a class="menu-item" style="height:52px" data-sh="wa" href="https://wa.me/${waPhone(c.phone)}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">${ic('chat')}<div class="cell-2"><span class="cell-main">WhatsApp message</span><span class="cell-sub">${c.phone ? esc(c.phone) : 'Choose a chat'}, attach the PDF after</span></div></a>
      <a class="menu-item" style="height:52px" data-sh="mail" href="mailto:${encodeURIComponent(c.email || '')}?subject=${encodeURIComponent(`${d.type === 'receipt' ? 'Receipt' : 'Invoice'} ${d.number} from ${S().businessName}`)}&body=${encodeURIComponent(msg)}">${ic('mail')}<div class="cell-2"><span class="cell-main">Email</span><span class="cell-sub">${c.email ? esc(c.email) : 'No email saved for this client'}</span></div></a>
      <button class="menu-item" style="height:52px" data-sh="copy">${ic('copy')}<div class="cell-2"><span class="cell-main">Copy message</span><span class="cell-sub">Paste it anywhere</span></div></button>
      <button class="menu-item" style="height:52px" data-sh="pdf">${ic('download')}<div class="cell-2"><span class="cell-main">Download PDF</span><span class="cell-sub">Keep a copy or attach it yourself</span></div></button>
    </div>`,
    onMount(b) {
      b.addEventListener('click', async e => {
        const t = e.target.closest('[data-sh]'); if (!t) return;
        const k = t.dataset.sh;
        if (k === 'wa' || k === 'mail') { markSent(d); setTimeout(() => dlg.close(), 200); return; }
        e.preventDefault();
        if (k === 'copy') { try { await navigator.clipboard.writeText(msg); toast('Message copied'); markSent(d); dlg.close(); } catch { toast('Couldn’t copy on this browser', { error: true }); } }
        if (k === 'pdf') { dlg.close(); actDownload(d); }
        if (k === 'native') await withBusy(t, '', async () => {
          const file = await pdfFile(d);
          const data = { files: [file], title: `${label} ${d.number}`, text: msg };
          if (navigator.canShare(data)) { try { await navigator.share(data); markSent(d); dlg.close(); } catch (err) { if (err.name !== 'AbortError') throw err; } }
          else { await navigator.share({ title: `${label} ${d.number}`, text: msg }).catch(() => {}); }
        });
      });
    }
  });
}
function docMenu(d, anchor, detail) {
  const isInv = d.type === 'invoice', st = docStatus(d);
  const hasReceipts = isInv && receipts().some(r => r.linkedInvoiceId === d.id);
  const items = isInv ? [
    !detail && { label: 'View', icon: 'eye', onClick: () => go(`#/invoices/${d.id}`) },
    !detail && { label: 'Edit', icon: 'edit', onClick: () => go(`#/invoices/${d.id}/edit`) },
    { label: 'Duplicate', icon: 'copy', onClick: () => { pendingDraft = duplicateOf(d); go('#/invoices/new'); } },
    !detail && 'sep',
    !detail && { label: 'Download PDF', icon: 'download', onClick: () => actDownload(d) },
    !detail && { label: 'Print', icon: 'print', onClick: () => printDoc(d) },
    !detail && { label: 'Share', icon: 'share', onClick: () => actShare(d) },
    'sep',
    countsAsIssued(d) && balances(d).balanceCents > 0 && { label: 'Record payment', icon: 'wallet', onClick: () => go(`#/receipts/new?invoice=${d.id}`) },
    countsAsIssued(d) && !d.sentAt && { label: 'Mark as sent', icon: 'send', onClick: () => { markSent(d); toast(`${d.number} marked as sent`); refreshView(); } },
    countsAsIssued(d) && d.sentAt && st !== 'paid' && { label: 'Mark as not sent', icon: 'send', onClick: () => { putDoc({ ...d, sentAt: null }); refreshView(); } },
    d.cancelledAt ? { label: 'Restore invoice', icon: 'sync', onClick: () => { putDoc({ ...d, cancelledAt: null }); toast(`${d.number} restored`); refreshView(); } }
      : d.status !== 'draft' && { label: 'Cancel invoice', icon: 'ban', danger: true, onClick: () => cancelInvoice(d) },
    { label: 'Delete', icon: 'trash', danger: true, disabled: hasReceipts, onClick: () => deleteInvoice(d) }
  ] : [
    !detail && { label: 'View', icon: 'eye', onClick: () => go(`#/receipts/${d.id}`) },
    !detail && { label: 'Edit details', icon: 'edit', onClick: () => go(`#/receipts/${d.id}/edit`) },
    !detail && 'sep',
    !detail && { label: 'Download PDF', icon: 'download', onClick: () => actDownload(d) },
    !detail && { label: 'Print', icon: 'print', onClick: () => printDoc(d) },
    !detail && { label: 'Share', icon: 'share', onClick: () => actShare(d) },
    d.linkedInvoiceId && findDoc(d.linkedInvoiceId) && { label: `Open ${findDoc(d.linkedInvoiceId).number}`, icon: 'invoice', onClick: () => go(`#/invoices/${d.linkedInvoiceId}`) },
    'sep',
    isVoid(d) ? { label: 'Restore receipt', icon: 'sync', onClick: () => restoreReceipt(d) } : { label: 'Void receipt', icon: 'ban', danger: true, onClick: () => voidReceipt(d) }
  ];
  const clean = items.filter(Boolean).filter((it, i, a) => !(it === 'sep' && (i === 0 || a[i - 1] === 'sep' || i === a.length - 1)));
  showMenu(anchor, clean, { width: 210 });
}
function duplicateOf(d) {
  const c = JSON.parse(JSON.stringify(d)), t = todayISO();
  const days = c.terms && c.terms !== 'custom' ? num(c.terms) : num(S().dueDays);
  Object.assign(c, { id: uid(), number: nextNumber('invoice'), issueDate: t, dueDate: addDays(t, days), status: 'issued', sentAt: null, cancelledAt: null, paidDate: '', createdAt: Date.now() });
  delete c.updatedAt;
  c.items.forEach(i => i.id = uid());
  return c;
}
async function cancelInvoice(d) {
  if (paymentsFor(d).length) { toast('This invoice has payments. Void its receipts before cancelling it.', { error: true }); return; }
  if (!(await confirmDialog({ title: `Cancel ${d.number}?`, message: 'It stays on record, marked cancelled, and no longer counts as money owed. You can restore it later.', ok: 'Cancel invoice', cancel: 'Keep it', danger: true }))) return;
  putDoc({ ...d, cancelledAt: new Date().toISOString() }); toast(`${d.number} cancelled`); refreshView();
}
async function deleteInvoice(d) {
  if (receipts().some(r => r.linkedInvoiceId === d.id)) { toast('Invoices with payment records can’t be deleted. Cancel it instead.', { error: true }); return; }
  if (!(await confirmDialog({ title: `Delete ${d.number}?`, message: 'It will be removed everywhere. You can undo straight after.', ok: 'Delete', danger: true }))) return;
  const copy = { ...d };
  delDoc(d.id);
  if (current.parts[0] === d.id) go('#/invoices'); else refreshView();
  toast(`${d.number} deleted`, { action: 'Undo', onAction: () => { putDoc(copy); refreshView(); } });
}
async function voidReceipt(r) {
  let reason = '';
  const ok = await new Promise(res => {
    let done = false;
    const dlg = openDialog({
      title: `Void ${esc(r.number)}?`, width: 440,
      body: `<p style="margin-bottom:14px">The receipt stays on record, marked void, and the payment no longer counts${r.linkedInvoiceId ? ' toward its invoice' : ''}.</p><div class="field"><label for="vr">Reason</label><input class="input" id="vr" placeholder="e.g. Recorded twice, payment reversed"></div>`,
      foot: `<button class="btn btn-secondary" data-c="0">Keep receipt</button><button class="btn btn-danger" data-c="1">Void receipt</button>`,
      onMount(b) { b.addEventListener('click', e => { const c = e.target.closest('[data-c]'); if (c) { reason = $('#vr', b).value.trim(); done = true; res(c.dataset.c === '1'); dlg.close(); } }); },
      onClose() { if (!done) res(false); }
    });
  });
  if (!ok) return;
  putDoc({ ...r, voidedAt: new Date().toISOString(), voidReason: reason });
  toast(`${r.number} voided`); refreshView();
}
function restoreReceipt(r) {
  const inv = r.linkedInvoiceId && findDoc(r.linkedInvoiceId);
  if (inv && receiptCents(r) > balances(inv).balanceCents) { toast(`Restoring would overpay ${inv.number}. Check its other payments first.`, { error: true }); return; }
  putDoc({ ...r, voidedAt: null, voidReason: '' }); toast(`${r.number} restored`); refreshView();
}

/* =====================================================================
   Client picker (shared by both editors)
   ===================================================================== */
function attachCombo(input, { source, onPick }) {
  const wrap = input.closest('.combo'); let list = null, opts = [], hl = 0;
  const close = () => { if (list) { list.remove(); list = null; input.setAttribute('aria-expanded', 'false'); } };
  const render = () => {
    opts = source(input.value.trim());
    if (!opts.length) { close(); return; }
    if (!list) { list = document.createElement('div'); list.className = 'combo-list'; list.setAttribute('role', 'listbox'); wrap.appendChild(list); input.setAttribute('aria-expanded', 'true'); }
    list.innerHTML = opts.map((o, i) => `<button type="button" class="combo-opt${i === hl ? ' hl' : ''}" data-i="${i}" role="option">${o.icon ? ic(o.icon) : ''}<span class="ellipsis">${esc(o.label)}</span>${o.sub ? `<small>${esc(o.sub)}</small>` : ''}</button>`).join('');
  };
  const pick = o => { close(); onPick(o); };
  input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list');
  input.addEventListener('focus', () => { hl = 0; render(); });
  input.addEventListener('input', () => { hl = 0; render(); });
  input.addEventListener('blur', () => setTimeout(close, 160));
  input.addEventListener('keydown', e => {
    if (!list) { if (e.key === 'ArrowDown') render(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); hl = Math.min(opts.length - 1, hl + 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); hl = Math.max(0, hl - 1); render(); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(opts[hl]); }
    else if (e.key === 'Escape') close();
  });
  wrap.addEventListener('mousedown', e => { const b = e.target.closest('.combo-opt'); if (b) { e.preventDefault(); pick(opts[+b.dataset.i]); } });
}
function clientSource(q) {
  const nq = q.toLowerCase();
  const out = DB.clients.filter(c => !nq || [c.name, c.email, c.phone].join(' ').toLowerCase().includes(nq)).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 7)
    .map(c => ({ icon: 'user', label: c.name, sub: c.phone || c.email || '', client: c }));
  if (q) out.push({ icon: 'plus', label: `Add “${q}” as a new client`, newName: q });
  else out.push({ icon: 'plus', label: 'Add a new client', newName: '' });
  return out;
}
function clientSectionHTML(d, locked) {
  const c = d.client;
  if (locked) return `<div class="client-card"><span class="avatar">${esc(initials(c.name))}</span><div class="who"><b>${esc(c.name || 'No client')}</b><small>${esc([c.phone, c.email].filter(Boolean).join('  ') || 'No contact details')}</small></div></div>`;
  if (d._cmode === 'new' || d._cmode === 'edit') {
    return `<div class="ed-fields">
      <div class="field"><label for="cf-name">${d._cmode === 'new' ? 'New client name' : 'Client name'}</label><input class="input" id="cf-name" data-f="client.name" value="${esc(c.name)}" placeholder="Full name or business"></div>
      <div class="grid-2"><div class="field"><label for="cf-phone">Phone</label><input class="input" id="cf-phone" data-f="client.phone" inputmode="tel" value="${esc(c.phone)}" placeholder="Optional"></div>
      <div class="field"><label for="cf-email">Email</label><input class="input" id="cf-email" type="email" data-f="client.email" value="${esc(c.email)}" placeholder="Optional"></div></div>
      <div class="field"><label for="cf-addr">Billing address</label><textarea class="input" id="cf-addr" rows="2" data-f="client.address" placeholder="Optional">${esc(c.address)}</textarea></div>
      ${d._cmode === 'edit' ? `<label class="checkbox"><input type="checkbox" data-f="_updateClient"${d._updateClient !== false ? ' checked' : ''}>Also update the saved client</label>` : ''}
      <div><button class="btn btn-ghost btn-sm" data-act="client-pick" type="button">${d._cmode === 'new' ? 'Choose an existing client instead' : 'Done'}</button></div>
    </div>`;
  }
  if (d.clientId || c.name) {
    return `<div class="client-card"><span class="avatar">${esc(initials(c.name))}</span><div class="who"><b>${esc(c.name)}</b><small>${esc([c.phone, c.email].filter(Boolean).join('  ') || 'No contact details')}${c.address ? '\n' + esc(c.address) : ''}</small></div>
      <div style="display:flex;gap:4px"><button class="btn btn-ghost btn-sm" type="button" data-act="client-edit-inline">Edit</button><button class="btn btn-secondary btn-sm" type="button" data-act="client-change">Change</button></div></div>`;
  }
  return `<div class="field"><div class="combo"><div class="input-affix">${ic('search')}<input class="input" id="client-combo" placeholder="Search clients or add a new one" autocomplete="off" aria-label="Client"></div></div><div class="err"></div></div>`;
}
function bindClientSection(sec, d, rerender) {
  const input = $('#client-combo', sec);
  if (input) attachCombo(input, {
    source: clientSource,
    onPick(o) {
      if (o.client) { d.clientId = o.client.id; d.client = { name: o.client.name, email: o.client.email || '', phone: o.client.phone || '', address: o.client.address || '' }; d._cmode = 'card'; }
      else { d.clientId = null; d.client = { name: o.newName, email: '', phone: '', address: '' }; d._cmode = 'new'; }
      dirty = true; rerender(); const f = $('#cf-phone', sec) && !o.newName ? $('#cf-name', sec) : $('#cf-phone', sec); if (f) f.focus();
    }
  });
}

/* =====================================================================
   Invoice editor
   ===================================================================== */
let draft = null;
function viewInvoiceEditor(id) {
  let isNew = !id;
  if (id) {
    const d = findDoc(id);
    if (!d || d.type !== 'invoice') return notFound('Invoice', '#/invoices');
    draft = JSON.parse(JSON.stringify(d));
    if (!draft.items || !draft.items.length) draft.items = [{ id: uid(), desc: '', qty: 1, price: '' }];
    draft.items.forEach(i => { if (!i.id) i.id = uid(); });
    if (draft.terms === undefined) draft.terms = 'custom';
    if (draft.discountType === undefined) draft.discountType = 'amt';
    if (draft.showPayment === undefined) draft.showPayment = true;
    if (draft.status === 'unpaid') draft.status = 'issued';
    draft._cmode = draft.client && draft.client.name ? 'card' : 'pick';
  } else {
    const client = current.query.client && findClient(current.query.client);
    draft = pendingDraft || newInvoice(client);
    pendingDraft = null;
    draft._cmode = draft.client && draft.client.name ? 'card' : 'pick';
  }
  draft._isNew = isNew;
  const paidC = isNew ? 0 : balances(findDoc(id)).paidCents;
  const title = isNew ? 'New invoice' : `Edit ${draft.number}`;
  const tpl = draft.template || S().template || 'classic';
  return {
    title,
    topbar: {
      crumbs: [['Invoices', '#/invoices'], [title]],
      actions: `${isNew || draft.status === 'draft' ? `<button class="btn btn-secondary btn-sm hide-sm" data-act="inv-save" data-mode="draft">Save draft</button>` : ''}
        <button class="btn btn-primary btn-sm hide-sm" data-act="inv-save" data-mode="final">${ic('check')}${isNew || draft.status === 'draft' ? 'Save invoice' : 'Save changes'}</button>
        <button class="icon-btn hide-sm" data-act="ed-more" aria-label="More">${ic('more')}</button>`
    },
    html: `<div class="editor" data-tab="edit" id="editor">
      <div class="ed-tabs"><div class="seg"><button class="on" data-act="ed-tab" data-k="edit">${ic('edit')}Edit</button><button data-act="ed-tab" data-k="preview">${ic('eye')}Preview</button></div></div>
      <div class="ed-panel"><div class="ed-panel-inner" id="ed-form">
        <section class="ed-sec" id="sec-client"><div class="ed-sec-h"><h3><span class="stepn">1</span>Bill to</h3></div><div id="client-slot">${clientSectionHTML(draft)}</div></section>
        <section class="ed-sec"><div class="ed-sec-h"><h3><span class="stepn">2</span>Invoice details</h3></div>
          <div class="ed-fields">
            <div class="grid-2">
              <div class="field"><label for="f-num">Invoice number</label><input class="input num" id="f-num" data-f="number" value="${esc(draft.number)}"><div class="err"></div></div>
              <div class="field"><label for="f-cur">Currency</label><select class="input" id="f-cur" data-f="currency" ${paidC ? 'disabled' : ''}>${CURRENCIES.map(([c, n]) => `<option value="${c}"${c === draft.currency ? ' selected' : ''}>${c} · ${n}</option>`).join('')}</select></div>
            </div>
            <div class="grid-3">
              <div class="field"><label for="f-issue">Issue date</label><input class="input" type="date" id="f-issue" data-f="issueDate" value="${esc(draft.issueDate)}"></div>
              <div class="field"><label for="f-terms">Payment terms</label><select class="input" id="f-terms" data-f="terms">${TERMS.map(([k, l]) => `<option value="${k}"${String(draft.terms) === k ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
              <div class="field"><label for="f-due">Due date</label><input class="input" type="date" id="f-due" data-f="dueDate" value="${esc(draft.dueDate)}"><div class="err"></div></div>
            </div>
          </div>
        </section>
        <section class="ed-sec"><div class="ed-sec-h"><h3><span class="stepn">3</span>Items and services</h3><span class="muted" id="item-count" style="font-size:12.5px"></span></div>
          <div class="items" id="items"></div>
        </section>
        <section class="ed-sec"><div class="ed-sec-h"><h3><span class="stepn">4</span>Discount and tax</h3></div>
          <div class="grid-2">
            <div class="field"><label for="f-disc">Discount</label><div class="input-group"><input class="input num" id="f-disc" data-f="discount" inputmode="decimal" placeholder="0" value="${esc(draft.discount)}">
              <div class="seg" id="disc-seg"><button type="button" data-act="disc-type" data-v="pct" class="${draft.discountType === 'pct' ? 'on' : ''}">%</button><button type="button" data-act="disc-type" data-v="amt" class="${draft.discountType !== 'pct' ? 'on' : ''}" id="disc-sym">${esc(symbolOf(draft.currency))}</button></div></div></div>
            <div class="field"><label for="f-tax">${esc(S().taxLabel || 'Tax')} rate (%)</label><input class="input num" id="f-tax" data-f="taxRate" inputmode="decimal" placeholder="0" value="${esc(draft.taxRate)}"></div>
          </div>
        </section>
        <section class="ed-sec"><div class="ed-sec-h"><h3><span class="stepn">5</span>Payment and notes</h3></div>
          <div class="ed-fields">
            <label class="checkbox"><input type="checkbox" data-f="showPayment"${draft.showPayment !== false ? ' checked' : ''}>Include payment details</label>
            <p class="hint" style="margin:-4px 0 0 25px;font-size:12.5px;color:var(--text-3);white-space:pre-line">${S().payment ? esc(S().payment) : 'No payment details yet. <a href="#/settings/payments" style="text-decoration:underline">Add them in Settings</a>.'}</p>
            <div class="field"><label for="f-notes">Notes</label><textarea class="input" id="f-notes" data-f="notes" rows="2" placeholder="Shown on the invoice">${esc(draft.notes || '')}</textarea></div>
            <div class="field"><label for="f-tt">Terms and conditions</label><textarea class="input" id="f-tt" data-f="termsText" rows="2" placeholder="Optional">${esc(draft.termsText || '')}</textarea></div>
            <div class="field"><label for="f-foot">Closing line</label><input class="input" id="f-foot" data-f="footer" value="${esc(draft.footer ?? S().footer)}"></div>
          </div>
        </section>
        <section class="ed-sec"><div class="totals" id="ed-totals"></div></section>
      </div></div>
      <div class="ed-preview workspace ws-scroll">
        <div class="ws-bar"><div class="seg" aria-label="Template">${['classic', 'modern', 'minimal'].map(t => `<button data-act="tpl" data-k="${t}" class="${tpl === t ? 'on' : ''}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div><span id="pg-count"></span></div>
        <div id="preview" style="max-width:820px;margin:0 auto"></div>
      </div>
      <div class="ed-mobile-bar">
        ${isNew || draft.status === 'draft' ? `<button class="btn btn-secondary" data-act="inv-save" data-mode="draft">Save draft</button>` : ''}
        <button class="btn btn-primary" data-act="inv-save" data-mode="final">${isNew || draft.status === 'draft' ? 'Save invoice' : 'Save changes'}</button>
      </div>
    </div>`,
    mount(el) {
      const form = $('#ed-form', el);
      renderItems(); refreshInvoice();
      const sec = $('#sec-client', el);
      const rerenderClient = () => { $('#client-slot', sec).innerHTML = clientSectionHTML(draft); bindClientSection(sec, draft, rerenderClient); refreshInvoice(); };
      draft._rerenderClient = rerenderClient;
      bindClientSection(sec, draft, rerenderClient);
      form.addEventListener('input', onInvoiceInput);
      form.addEventListener('change', onInvoiceInput);
      if (isNew && !draft.client.name) setTimeout(() => { const c = $('#client-combo'); if (c && mq('(min-width:1100px)')) c.focus(); }, 60);
    }
  };
}
function setPath(o, p, v) { const ks = p.split('.'); let x = o; for (let i = 0; i < ks.length - 1; i++) x = x[ks[i]]; x[ks[ks.length - 1]] = v; }
function onInvoiceInput(e) {
  const t = e.target; if (!draft) return;
  if (t.dataset.f) {
    const v = t.type === 'checkbox' ? t.checked : t.value;
    setPath(draft, t.dataset.f, v);
    if (t.dataset.f === 'terms' && v !== 'custom') { draft.dueDate = addDays(draft.issueDate || todayISO(), num(v)); $('#f-due').value = draft.dueDate; }
    if (t.dataset.f === 'issueDate' && draft.terms !== 'custom' && v) { draft.dueDate = addDays(v, num(draft.terms)); $('#f-due').value = draft.dueDate; }
    if (t.dataset.f === 'dueDate') { const match = TERMS.find(([k]) => k !== 'custom' && addDays(draft.issueDate, num(k)) === v); draft.terms = match ? match[0] : 'custom'; $('#f-terms').value = draft.terms; }
    if (t.dataset.f === 'currency') { $('#disc-sym').textContent = symbolOf(draft.currency); renderItems(); }
    if (t.dataset.f === 'number') setFieldError(t, numberTaken(t.value, draft.id) ? 'This number is already used.' : '');
  } else if (t.dataset.item) {
    const it = draft.items.find(i => i.id === t.dataset.item); if (it) it[t.dataset.k] = t.value;
    const lt = $(`#lt-${t.dataset.item}`); if (lt && it) lt.textContent = money(fromCents(lineCents(it)), draft.currency);
  } else return;
  dirty = true; refreshInvoice();
}
function renderItems() {
  const box = $('#items'); if (!box) return;
  const cur = draft.currency;
  box.innerHTML = `<div class="items-head"><span></span><span style="text-align:center">Qty</span><span>Unit price</span><span style="text-align:right">Amount</span><span></span></div>
    ${draft.items.map(it => `<div class="item-row" data-row="${it.id}">
      <span class="grip" title="Drag to reorder" aria-hidden="true">${ic('grip')}</span>
      <input class="input i-desc" data-item="${it.id}" data-k="desc" placeholder="Item or service" value="${esc(it.desc)}" aria-label="Description">
      <div class="i-nums"><span class="i-qty"><input class="input num" data-item="${it.id}" data-k="qty" inputmode="decimal" value="${esc(it.qty)}" aria-label="Quantity"></span>
      <span class="i-price"><input class="input num" data-item="${it.id}" data-k="price" inputmode="decimal" placeholder="0.00" value="${esc(it.price)}" aria-label="Unit price"></span>
      <span class="lt" id="lt-${it.id}">${esc(money(fromCents(lineCents(it)), cur))}</span></div>
      <button class="icon-btn sm i-x" type="button" data-act="item-del" data-id="${it.id}" aria-label="Remove item">${ic('close')}</button>
    </div>`).join('')}
    <div class="items-actions"><button class="btn btn-secondary btn-sm" type="button" data-act="item-add">${ic('plus')}Add item</button>
      <button class="btn btn-ghost btn-sm" type="button" data-act="item-catalog">${ic('box')}From products</button></div>`;
  bindDrag(box);
}
function bindDrag(box) {
  let dragId = null;
  $$('.item-row', box).forEach(row => {
    const grip = $('.grip', row);
    grip.addEventListener('pointerdown', () => { row.draggable = true; });
    row.addEventListener('dragstart', e => { dragId = row.dataset.row; row.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', dragId); } catch {} });
    row.addEventListener('dragend', () => { row.draggable = false; row.classList.remove('dragging'); $$('.drop-before', box).forEach(r => r.classList.remove('drop-before')); });
    row.addEventListener('dragover', e => { if (!dragId) return; e.preventDefault(); $$('.drop-before', box).forEach(r => r.classList.remove('drop-before')); row.classList.add('drop-before'); });
    row.addEventListener('drop', e => {
      e.preventDefault(); if (!dragId || dragId === row.dataset.row) return;
      const from = draft.items.findIndex(i => i.id === dragId), item = draft.items.splice(from, 1)[0];
      draft.items.splice(draft.items.findIndex(i => i.id === row.dataset.row), 0, item);
      dragId = null; dirty = true; renderItems(); refreshInvoice();
    });
  });
  // keyboard reordering: Alt + ↑/↓ in a description field
  box.addEventListener('keydown', e => {
    if (!e.altKey || !['ArrowUp', 'ArrowDown'].includes(e.key) || !e.target.dataset.item) return;
    e.preventDefault();
    const id = e.target.dataset.item, i = draft.items.findIndex(x => x.id === id), j = i + (e.key === 'ArrowUp' ? -1 : 1);
    if (j < 0 || j >= draft.items.length) return;
    [draft.items[i], draft.items[j]] = [draft.items[j], draft.items[i]];
    dirty = true; renderItems(); refreshInvoice(); $(`[data-item="${id}"][data-k="desc"]`).focus();
  });
}
let pvRaf = 0;
function refreshInvoice() {
  if (!draft) return;
  const t = totals(draft), cur = draft.currency, s = S();
  const orig = !draft._isNew && findDoc(draft.id), paid = orig ? balances(orig).paid : 0;
  const n = draft.items.filter(i => String(i.desc).trim() || num(i.price)).length;
  const cnt = $('#item-count'); if (cnt) cnt.textContent = n ? plural(n, 'item') : '';
  $('#ed-totals').innerHTML = `
    <div class="ln"><span>Subtotal</span><b>${esc(money(t.sub, cur))}</b></div>
    ${t.disc ? `<div class="ln"><span>Discount${draft.discountType === 'pct' ? ` (${esc(num(draft.discount))}%)` : ''}</span><b>−${esc(money(t.disc, cur))}</b></div>` : ''}
    ${t.tax ? `<div class="ln"><span>${esc(s.taxLabel || 'Tax')} (${esc(num(draft.taxRate))}%)</span><b>${esc(money(t.tax, cur))}</b></div>` : ''}
    <div class="ln grand"><span>Total</span><b>${esc(money(t.total, cur))}</b></div>
    ${paid ? `<div class="ln"><span>Amount paid</span><b>−${esc(money(paid, cur))}</b></div><div class="ln"><span>Outstanding balance</span><b>${esc(money(Math.max(0, t.total - paid), cur))}</b></div>` : ''}`;
  cancelAnimationFrame(pvRaf);
  pvRaf = requestAnimationFrame(() => { const p = $('#preview'); if (p && draft) { const pages = renderPreview(p, draft); const c = $('#pg-count'); if (c) c.textContent = plural(pages, 'page'); } });
}
function addItem(fields = {}) {
  const blank = draft.items.length === 1 && !draft.items[0].desc && !num(draft.items[0].price);
  const it = { id: uid(), desc: '', qty: 1, price: '', ...fields };
  if (blank && fields.desc) draft.items[0] = it; else draft.items.push(it);
  dirty = true; renderItems(); refreshInvoice();
  if (!fields.desc) { const el = $(`[data-item="${it.id}"][data-k="desc"]`); if (el) el.focus(); }
}
async function saveInvoice(mode, btn) {
  const d = draft; if (!d) return;
  clearErrors($('#ed-form'));
  const final = mode === 'final';
  d.number = String(d.number || '').trim();
  d.client.name = String(d.client.name || '').trim();
  const items = d.items.filter(i => String(i.desc).trim() || num(i.price));
  const problems = [];
  if (!d.number) { problems.push('Add an invoice number.'); setFieldError($('#f-num'), 'Required'); }
  else if (numberTaken(d.number, d.id)) { problems.push(`${d.number} is already used.`); setFieldError($('#f-num'), 'This number is already used.'); }
  if (final) {
    if (!d.client.name) { problems.push('Choose or add a client.'); const c = $('#client-combo') || $('#cf-name'); if (c) setFieldError(c, 'Choose a client or add a new one.'); }
    if (!items.length) problems.push('Add at least one item.');
    if (items.some(i => !String(i.desc).trim())) problems.push('Every item needs a description.');
    if (items.some(i => num(i.qty) <= 0)) problems.push('Quantities must be more than zero.');
    if (d.dueDate && d.issueDate && d.dueDate < d.issueDate) { problems.push('The due date is before the issue date.'); setFieldError($('#f-due'), 'Must be on or after the issue date.'); }
  }
  const t = totals({ ...d, items });
  const orig = !d._isNew && findDoc(d.id);
  if (orig && t.totalCents < balances(orig).paidCents) problems.push(`The new total is less than the ${money(balances(orig).paid, d.currency)} already paid. Void a receipt first.`);
  if (problems.length) { toast(problems[0], { error: true }); if (mq('(max-width:1099px)')) setEditorTab('edit'); return; }

  // client record: reuse, create, or update, never duplicate silently
  let client = d.clientId && findClient(d.clientId);
  if (d.client.name && !client) {
    const dup = findDuplicateClient(d.client);
    if (dup) {
      const use = await confirmDialog({ title: `Use existing client ${dup.name}?`, message: `A client with matching ${dup.name.toLowerCase() === d.client.name.toLowerCase() ? 'name' : 'contact details'} already exists. Link this invoice to them instead of creating a duplicate.`, ok: `Use ${dup.name}`, cancel: 'Create new' });
      if (use) client = dup;
    }
    if (!client) client = putClient({ id: uid(), name: d.client.name, email: d.client.email.trim(), phone: d.client.phone.trim(), address: d.client.address.trim(), notes: '', createdAt: Date.now() }, true);
  } else if (client && d._cmode === 'edit' && d._updateClient !== false) {
    putClient({ ...client, name: d.client.name || client.name, email: d.client.email.trim(), phone: d.client.phone.trim(), address: d.client.address.trim() }, true);
  }
  const clean = {
    ...d, clientId: client ? client.id : null,
    client: client ? { name: d.client.name || client.name, email: d.client.email || client.email || '', phone: d.client.phone || client.phone || '', address: d.client.address || client.address || '' } : { ...d.client },
    items: items.map(i => ({ id: i.id, desc: String(i.desc).trim(), qty: num(i.qty) || 1, price: num(i.price), ...(i.productId ? { productId: i.productId } : {}) })),
    discount: num(d.discount), taxRate: num(d.taxRate),
    status: final ? (orig && orig.status === 'paid' && !receipts().some(r => r.linkedInvoiceId === orig.id) ? 'paid' : 'issued') : 'draft'
  };
  if (!final && orig && orig.status !== 'draft') clean.status = orig.status;   // never demote an issued invoice to draft
  Object.keys(clean).filter(k => k.startsWith('_')).forEach(k => delete clean[k]);
  if (btn) btn.classList.add('loading');
  putDoc(clean);
  dirty = false; draft = null;
  toast(`${clean.number} ${clean.status === 'draft' ? 'saved as draft' : d._isNew ? 'created' : 'saved'}`);
  location.replace(`#/invoices/${clean.id}`);
}
function setEditorTab(k) {
  const ed = $('#editor'); if (!ed) return;
  ed.dataset.tab = k;
  $$('.ed-tabs [data-k]').forEach(b => b.classList.toggle('on', b.dataset.k === k));
  if (k === 'preview') { if (draft && draft.type === 'invoice') refreshInvoice(); else refreshReceipt(); }
  scrollTo(0, 0);
}

/* =====================================================================
   Receipts
   ===================================================================== */
function filteredReceipts() {
  const st = LS.receipts, q = st.q.trim().toLowerCase(), range = rangeOf(st);
  const list = receipts().filter(r => (st.period === 'all' || inRange(r.issueDate, range)) && (!st.client || r.clientId === st.client)
    && (!q || [r.number, r.client && r.client.name, r.reference, r.description, r.invoiceNumber, (findDoc(r.linkedInvoiceId) || {}).number].join(' ').toLowerCase().includes(q)));
  return sortBy(list, st.sort, st.dir, (r, k) => k === 'amount' ? receiptCents(r) : k === 'client' ? clientName(r).toLowerCase() : k === 'number' ? String(r.number) : r[k] || '');
}
const RC_COLS = '110px minmax(0,1.4fr) 100px minmax(0,1fr) 120px 128px 34px';
function receiptRow(r) {
  const inv = r.linkedInvoiceId && findDoc(r.linkedInvoiceId);
  return `<div class="tbl-row" style="--cols:${RC_COLS}" data-href="#/receipts/${r.id}" tabindex="0" role="link">
    <span class="cell-main num">${esc(r.number)}</span>
    <div class="cell-2" data-m="a"><span class="cell-main">${esc(clientName(r))}</span><span class="cell-sub m-only">${esc(r.number)}</span></div>
    <span class="t2" data-m="c">${esc(fmtShort(r.issueDate))}<span class="m-only">, ${esc(r.paymentMethod || '')}</span></span>
    <span class="t2 ellipsis">${inv ? `<a href="#/invoices/${inv.id}" style="text-decoration:underline;text-underline-offset:3px">${esc(inv.number)}</a>` : r.invoiceNumber ? esc(r.invoiceNumber) : '<span class="muted">Standalone</span>'}</span>
    <span class="amount r" data-m="b" ${isVoid(r) ? 'style="text-decoration:line-through;color:var(--text-3)"' : ''}>${esc(money(receiptAmount(r), r.currency))}</span>
    <span data-m="d">${isVoid(r) ? badge(r) : `<span class="badge plain">${esc(r.paymentMethod || 'Payment')}</span>`}</span>
    <button class="icon-btn sm row-menu" data-act="doc-menu" data-id="${r.id}" aria-label="Actions for ${esc(r.number)}" aria-haspopup="menu">${ic('more')}</button>
  </div>`;
}
function receiptTableHTML() {
  const list = filteredReceipts();
  if (loadingData()) return `<div class="tbl">${skeletonRows(8)}</div>`;
  if (!receipts().length) return emptyHTML('receipt', 'No receipts yet', 'Receipts are created when you record a payment on an invoice, or on their own for any payment.', '<a class="btn btn-primary" href="#/receipts/new">New receipt</a>');
  const page = pageSlice('receipts', list);
  const total = list.filter(r => !isVoid(r) && r.currency === S().currency).reduce((a, r) => a + receiptCents(r), 0);
  return `<div class="tbl" role="table">
    <div class="tbl-row tbl-head" style="--cols:${RC_COLS}">${sortBtn('receipts', 'number', 'Number')}${sortBtn('receipts', 'client', 'Received from')}${sortBtn('receipts', 'issueDate', 'Date')}<span>Invoice</span><span class="r">${sortBtn('receipts', 'amount', 'Amount')}</span><span>Method</span><span></span></div>
    <div class="tbl-body">${page.length ? page.map(receiptRow).join('') : emptyHTML('search', 'No receipts match', 'Try a different search, client or date range.', '<button class="btn btn-secondary btn-sm" data-act="clear-filters" data-list="receipts">Clear filters</button>')}</div>
  </div>${pagerHTML('receipts', list.length).replace('</span>', `</span><span>${list.length ? `Total ${esc(money(fromCents(total), S().currency))}` : ''}</span>`)}`;
}
function viewReceipts() {
  const st = LS.receipts;
  return {
    title: 'Receipts',
    topbar: { crumbs: [['Receipts']], actions: `<a class="btn btn-primary btn-sm hide-sm" href="#/receipts/new">${ic('plus')}New receipt</a>` },
    html: `<div class="content">
      ${pageHead('Receipts', 'Every payment received, linked to its invoice where there is one.', `<button class="btn btn-secondary" data-act="export-csv" data-k="receipts">${ic('download')}Export</button><a class="btn btn-primary" href="#/receipts/new">${ic('plus')}New receipt</a>`)}
      <section class="card">
        <div class="toolbar">
          <div class="input-affix grow">${ic('search')}<input class="input" id="list-q" data-list="receipts" type="search" placeholder="Search number, client, reference" value="${esc(st.q)}" autocomplete="off"></div>
          <select class="input" data-lf="client" data-list="receipts" aria-label="Client"><option value="">All clients</option>${[...DB.clients].sort((a, b) => a.name.localeCompare(b.name)).map(c => `<option value="${c.id}"${st.client === c.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
          ${periodSelect('receipts', st)}
        </div>
        <div id="list-body">${receiptTableHTML()}</div>
      </section>
    </div><a class="btn btn-primary fab" href="#/receipts/new">${ic('plus')}New receipt</a>`,
    mount: bindListControls
  };
}
function viewReceipt(id) {
  const r = findDoc(id);
  if (!r || r.type !== 'receipt') return notFound('Receipt', '#/receipts');
  const inv = r.linkedInvoiceId && findDoc(r.linkedInvoiceId), b = inv && balances(inv);
  return {
    title: r.number,
    topbar: { crumbs: [['Receipts', '#/receipts'], [r.number]], actions: `<button class="btn btn-secondary btn-sm hide-sm" data-act="dl" data-id="${r.id}">${ic('download')}PDF</button>` },
    html: `<div class="detail">
      <div class="workspace ws-scroll"><div class="ws-bar"><span>${isVoid(r) ? 'Void receipt' : 'Receipt'}</span><span id="pg-count"></span></div><div id="preview" style="max-width:820px;margin:0 auto"></div></div>
      <aside class="side" aria-label="Receipt summary">
        <div class="side-sec">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px"><a class="cell-main ellipsis" href="${r.clientId ? '#/clients/' + r.clientId : '#/clients'}" style="font-size:15px">${esc(clientName(r))}</a>${isVoid(r) ? badge(r) : '<span class="badge paid">Received</span>'}</div>
          <div class="big-amt num" ${isVoid(r) ? 'style="text-decoration:line-through;color:var(--text-3)"' : ''}><span class="cur">${esc(r.currency)}</span>${esc(plainAmount(receiptAmount(r)))}</div>
          ${isVoid(r) ? `<p class="muted" style="margin:10px 0 0;font-size:13px">Voided ${esc(fmtDate(r.voidedAt.slice(0, 10)))}${r.voidReason ? `: ${esc(r.voidReason)}` : ''}</p>` : ''}
        </div>
        <div class="side-sec" style="display:grid;gap:10px">
          <div class="actions-grid">
            <a class="act" href="#/receipts/${r.id}/edit">${ic('edit')}Edit</a>
            <button class="act" data-act="dl" data-id="${r.id}">${ic('download')}PDF</button>
            <button class="act" data-act="print" data-id="${r.id}">${ic('print')}Print</button>
            <button class="act" data-act="share" data-id="${r.id}">${ic('share')}Share</button>
          </div>
          ${isVoid(r) ? `<button class="btn btn-ghost btn-sm" data-act="rc-restore" data-id="${r.id}">${ic('sync')}Restore receipt</button>` : `<button class="btn btn-ghost btn-sm" data-act="rc-void" data-id="${r.id}" style="color:var(--red)">${ic('ban')}Void receipt</button>`}
        </div>
        <div class="side-sec"><h3>Payment</h3>
          <div class="kv"><span>Number</span><b>${esc(r.number)}</b></div>
          <div class="kv"><span>Date</span><b>${esc(fmtDate(r.issueDate))}</b></div>
          <div class="kv"><span>Method</span><b>${esc(r.paymentMethod || '—')}</b></div>
          ${r.reference ? `<div class="kv"><span>Reference</span><b>${esc(r.reference)}</b></div>` : ''}
          ${r.description ? `<div class="kv"><span>For</span><b>${esc(r.description)}</b></div>` : ''}
        </div>
        ${inv ? `<div class="side-sec"><h3>Invoice</h3>
          <div class="kv"><span>Invoice</span><b><a href="#/invoices/${inv.id}">${esc(inv.number)}</a></b></div>
          <div class="kv"><span>Total</span><b>${esc(money(b.total, inv.currency))}</b></div>
          <div class="kv"><span>Paid to date</span><b>${esc(money(b.paid, inv.currency))}</b></div>
          <div class="kv"><span>Balance</span><b>${b.balanceCents ? esc(money(b.balance, inv.currency)) : 'Fully paid'}</b></div>
          <div style="margin-top:6px">${badge(inv)}</div>
        </div>` : r.invoiceNumber ? `<div class="side-sec"><h3>Invoice</h3><p class="muted" style="margin:0;font-size:13px">${esc(r.invoiceNumber)} has been deleted. This receipt is kept as a record.</p></div>` : ''}
      </aside>
    </div>`,
    mount(el) { const n = renderPreview($('#preview', el), r); $('#pg-count', el).textContent = plural(n, 'page'); }
  };
}

/* ---------- receipt editor ---------- */
function openInvoicesFor(clientId) {
  return invoices().filter(d => countsAsIssued(d) && balances(d).balanceCents > 0 && (!clientId || d.clientId === clientId)).sort(byDateDesc);
}
function viewReceiptEditor(id, query = {}) {
  const isNew = !id;
  if (id) {
    const r = findDoc(id);
    if (!r || r.type !== 'receipt') return notFound('Receipt', '#/receipts');
    draft = JSON.parse(JSON.stringify(r));
    if (draft.amount === undefined || draft.amount === null || draft.amount === '') draft.amount = String(receiptAmount(r));
  } else {
    const inv = query.invoice && findDoc(query.invoice);
    const client = query.client && findClient(query.client);
    draft = newReceipt(inv && countsAsIssued(inv) ? inv : null, client);
    draft._mode = inv ? 'invoice' : (query.mode === 'standalone' || client ? 'standalone' : (openInvoicesFor().length ? 'invoice' : 'standalone'));
  }
  draft._isNew = isNew;
  if (!isNew) draft._mode = draft.linkedInvoiceId ? 'invoice' : 'standalone';
  draft._cmode = draft.client && draft.client.name ? 'card' : 'pick';
  const title = isNew ? 'New receipt' : `Edit ${draft.number}`;
  return {
    title,
    topbar: { crumbs: [['Receipts', '#/receipts'], [title]], actions: `<button class="btn btn-primary btn-sm hide-sm" data-act="rc-save">${ic('check')}${isNew ? 'Save receipt' : 'Save changes'}</button>` },
    html: `<div class="editor" data-tab="edit" id="editor">
      <div class="ed-tabs"><div class="seg"><button class="on" data-act="ed-tab" data-k="edit">${ic('edit')}Edit</button><button data-act="ed-tab" data-k="preview">${ic('eye')}Preview</button></div></div>
      <div class="ed-panel"><div class="ed-panel-inner" id="ed-form"></div></div>
      <div class="ed-preview workspace ws-scroll"><div class="ws-bar"><span>Live preview</span><span id="pg-count"></span></div><div id="preview" style="max-width:820px;margin:0 auto"></div></div>
      <div class="ed-mobile-bar"><button class="btn btn-primary" data-act="rc-save">${isNew ? 'Save receipt' : 'Save changes'}</button></div>
    </div>`,
    mount(el) {
      renderReceiptForm();
      const form = $('#ed-form', el);
      form.addEventListener('input', onReceiptInput);
      form.addEventListener('change', onReceiptInput);
    }
  };
}
function receiptFormHTML() {
  const r = draft, isNew = r._isNew, inv = r.linkedInvoiceId && findDoc(r.linkedInvoiceId);
  const locked = !isNew;
  let invBox = '';
  if (r._mode === 'invoice') {
    if (inv) {
      const b = balances(inv), other = isNew ? b.balanceCents : b.balanceCents + receiptCents(findDoc(r.id) || { amount: 0 });
      invBox = `<div class="client-card"><span class="avatar">${ic('invoice')}</span><div class="who"><b>${esc(inv.number)}, ${esc(clientName(inv))}</b>
        <small>Total ${esc(money(b.total, inv.currency))}, paid ${esc(money(b.paid, inv.currency))}\nBalance ${esc(money(fromCents(isNew ? b.balanceCents : other), inv.currency))}</small></div>
        ${isNew && !current.query.invoice ? '<button class="btn btn-secondary btn-sm" type="button" data-act="rc-inv-change">Change</button>' : ''}</div>`;
    } else invBox = `<div class="field"><div class="combo"><div class="input-affix">${ic('search')}<input class="input" id="inv-combo" placeholder="Search open invoices by number or client" autocomplete="off" aria-label="Invoice"></div></div><div class="err"></div>
      ${openInvoicesFor().length ? '' : '<div class="hint">There are no open invoices. Record a standalone receipt instead.</div>'}</div>`;
  }
  return `
    ${isNew ? `<section class="ed-sec"><div class="seg full" role="tablist"><button data-act="rc-mode" data-k="invoice" class="${r._mode === 'invoice' ? 'on' : ''}">${ic('invoice')}Payment on an invoice</button><button data-act="rc-mode" data-k="standalone" class="${r._mode === 'standalone' ? 'on' : ''}">${ic('receipt')}Standalone</button></div></section>` : ''}
    ${r._mode === 'invoice' ? `<section class="ed-sec"><div class="ed-sec-h"><h3><span class="stepn">1</span>Invoice</h3></div>${invBox}</section>`
      : `<section class="ed-sec" id="sec-client"><div class="ed-sec-h"><h3><span class="stepn">1</span>Received from</h3></div><div id="client-slot">${clientSectionHTML(r)}</div></section>`}
    <section class="ed-sec"><div class="ed-sec-h"><h3><span class="stepn">2</span>Payment</h3></div>
      <div class="ed-fields">
        <div class="grid-2">
          <div class="field"><label for="r-amt">Amount received</label><input class="input num" id="r-amt" data-f="amount" inputmode="decimal" placeholder="0.00" value="${esc(r.amount)}" ${locked ? 'readonly' : ''}><div class="err"></div>
            ${locked ? '<div class="hint">Amounts can’t be edited. Void this receipt and record a new one to correct it.</div>' : inv ? `<div class="hint"><button type="button" class="link" data-act="rc-full" style="text-decoration:underline;text-underline-offset:3px">Pay full balance</button></div>` : ''}</div>
          <div class="field"><label for="r-cur">Currency</label><select class="input" id="r-cur" data-f="currency" ${inv || locked ? 'disabled' : ''}>${CURRENCIES.map(([c, n]) => `<option value="${c}"${c === r.currency ? ' selected' : ''}>${c} · ${n}</option>`).join('')}</select></div>
        </div>
        <div class="grid-2">
          <div class="field"><label for="r-date">Payment date</label><input class="input" type="date" id="r-date" data-f="issueDate" value="${esc(r.issueDate)}" ${locked ? 'readonly' : ''}><div class="err"></div></div>
          <div class="field"><label for="r-m">Payment method</label><select class="input" id="r-m" data-f="paymentMethod">${METHODS.map(m => `<option${m === r.paymentMethod ? ' selected' : ''}>${m}</option>`).join('')}</select></div>
        </div>
        <div class="grid-2">
          <div class="field"><label for="r-ref">Reference</label><input class="input" id="r-ref" data-f="reference" value="${esc(r.reference || '')}" placeholder="MoMo or bank transaction ID"></div>
          <div class="field"><label for="r-num">Receipt number</label><input class="input num" id="r-num" data-f="number" value="${esc(r.number)}" ${locked ? 'readonly' : ''}><div class="err"></div></div>
        </div>
        <div class="field"><label for="r-desc">Payment for</label><input class="input" id="r-desc" data-f="description" value="${esc(r.description || '')}" placeholder="e.g. Deposit for bridal fitting"></div>
        <div class="field"><label for="r-notes">Notes</label><textarea class="input" id="r-notes" data-f="notes" rows="2" placeholder="Optional, shown on the receipt">${esc(r.notes || '')}</textarea></div>
      </div>
    </section>`;
}
function renderReceiptForm() {
  const form = $('#ed-form'); form.innerHTML = receiptFormHTML();
  const sec = $('#sec-client', form);
  if (sec) { const rer = () => { $('#client-slot', sec).innerHTML = clientSectionHTML(draft); bindClientSection(sec, draft, rer); refreshReceipt(); }; draft._rerenderClient = rer; bindClientSection(sec, draft, rer); }
  const ic_ = $('#inv-combo', form);
  if (ic_) attachCombo(ic_, {
    source: q => openInvoicesFor().filter(d => !q || [d.number, clientName(d)].join(' ').toLowerCase().includes(q.toLowerCase())).slice(0, 8)
      .map(d => ({ icon: 'invoice', label: `${d.number}  ${clientName(d)}`, sub: `${money(balances(d).balance, d.currency)} due`, inv: d })),
    onPick(o) { const fresh = newReceipt(o.inv); Object.assign(draft, { linkedInvoiceId: o.inv.id, invoiceNumber: o.inv.number, currency: o.inv.currency, clientId: o.inv.clientId, client: { ...o.inv.client }, amount: fresh.amount, description: fresh.description }); dirty = true; renderReceiptForm(); }
  });
  refreshReceipt();
}
function onReceiptInput(e) {
  const t = e.target; if (!draft || !t.dataset.f) return;
  setPath(draft, t.dataset.f, t.type === 'checkbox' ? t.checked : t.value);
  if (t.dataset.f === 'number') setFieldError(t, numberTaken(t.value, draft.id) ? 'This number is already used.' : '');
  if (t.dataset.f === 'amount') validateAmount(false);
  dirty = true; refreshReceipt();
}
function maxAllowedCents() {
  const inv = draft.linkedInvoiceId && findDoc(draft.linkedInvoiceId); if (!inv) return Infinity;
  const self = !draft._isNew && findDoc(draft.id);
  return balances(inv).balanceCents + (self && !isVoid(self) ? receiptCents(self) : 0);
}
function validateAmount(strict) {
  const el = $('#r-amt'); if (!el) return true;
  const c = toCents(draft.amount), max = maxAllowedCents();
  let msg = '';
  if (strict && c <= 0) msg = 'Enter the amount received.';
  else if (c > max) msg = `More than the ${money(fromCents(max), draft.currency)} balance.`;
  setFieldError(el, msg);
  return !msg;
}
function refreshReceipt() {
  cancelAnimationFrame(pvRaf);
  pvRaf = requestAnimationFrame(() => { const p = $('#preview'); if (p && draft) { const n = renderPreview(p, draft); const c = $('#pg-count'); if (c) c.textContent = plural(n, 'page'); } });
}
let savingReceipt = false;
async function saveReceipt(btn) {
  const r = draft; if (!r || savingReceipt) return;
  clearErrors($('#ed-form'));
  r.number = String(r.number || '').trim();
  const problems = [];
  if (r._mode === 'invoice' && !r.linkedInvoiceId) { problems.push('Choose the invoice this payment is for.'); const c = $('#inv-combo'); if (c) setFieldError(c, 'Choose an invoice.'); }
  if (r._mode === 'standalone' && !String(r.client.name || '').trim()) { problems.push('Add who the payment is from.'); const c = $('#client-combo') || $('#cf-name'); if (c) setFieldError(c, 'Choose or add a client.'); }
  if (!validateAmount(true)) problems.push($('#r-amt').closest('.field').querySelector('.err').textContent);
  if (!r.number) problems.push('Add a receipt number.');
  else if (numberTaken(r.number, r.id)) { problems.push(`${r.number} is already used.`); setFieldError($('#r-num'), 'This number is already used.'); }
  if (!r.issueDate) problems.push('Add the payment date.');
  if (problems.length) { toast(problems[0], { error: true }); if (mq('(max-width:1099px)')) setEditorTab('edit'); return; }

  const inv = r.linkedInvoiceId && findDoc(r.linkedInvoiceId);
  if (r._isNew && inv) {
    const same = paymentsFor(inv).find(p => receiptCents(p) === toCents(r.amount) && p.issueDate === r.issueDate && (!r.reference || !p.reference || p.reference === r.reference));
    if (same && !(await confirmDialog({ title: 'This looks like a duplicate', message: `${same.number} already records ${money(receiptAmount(same), r.currency)} on ${fmtDate(same.issueDate)} for ${inv.number}. Record another payment anyway?`, ok: 'Record anyway', cancel: 'Go back' }))) return;
  }
  savingReceipt = true;
  try {
    let client = r.clientId && findClient(r.clientId);
    if (!client && r.client.name) {
      const dup = findDuplicateClient(r.client);
      if (dup && await confirmDialog({ title: `Use existing client ${dup.name}?`, message: 'A client with matching details already exists. Link this receipt to them instead of creating a duplicate.', ok: `Use ${dup.name}`, cancel: 'Create new' })) client = dup;
      if (!client) client = putClient({ id: uid(), name: r.client.name.trim(), email: (r.client.email || '').trim(), phone: (r.client.phone || '').trim(), address: (r.client.address || '').trim(), notes: '', createdAt: Date.now() }, true);
    } else if (client && r._cmode === 'edit' && r._updateClient !== false) {
      putClient({ ...client, name: r.client.name || client.name, email: (r.client.email || '').trim(), phone: (r.client.phone || '').trim(), address: (r.client.address || '').trim() }, true);
    }
    const clean = { ...r, clientId: client ? client.id : r.clientId || null, amount: fromCents(toCents(r.amount)), invoiceNumber: inv ? inv.number : r.invoiceNumber || '' };
    if (r._mode === 'standalone') { clean.linkedInvoiceId = null; clean.invoiceNumber = ''; }
    if (client && !r.client.name) clean.client = { name: client.name, email: client.email || '', phone: client.phone || '', address: client.address || '' };
    Object.keys(clean).filter(k => k.startsWith('_')).forEach(k => delete clean[k]);
    putDoc(clean);
    dirty = false; draft = null;
    const after = inv && balances(findDoc(inv.id));
    toast(inv ? `${clean.number} saved. ${inv.number} is now ${STATUS[invoiceStatus(findDoc(inv.id))].toLowerCase()}${after.balanceCents ? `, ${money(after.balance, inv.currency)} left` : ''}.` : `${clean.number} saved`);
    location.replace(`#/receipts/${clean.id}`);
  } finally { savingReceipt = false; }
}

/* =====================================================================
   Clients
   ===================================================================== */
const CL_COLS = 'minmax(0,1.6fr) minmax(0,1.2fr) 130px 130px 130px 34px';
function clientTableHTML() {
  if (loadingData()) return `<div class="tbl">${skeletonRows(8)}</div>`;
  if (!DB.clients.length) return emptyHTML('users', 'No clients yet', 'Clients are saved automatically from invoices and receipts, or add one now.', '<button class="btn btn-primary" data-act="client-new">Add client</button>');
  const st = LS.clients, q = st.q.trim().toLowerCase();
  const rows = DB.clients.filter(c => !q || [c.name, c.email, c.phone, c.address].join(' ').toLowerCase().includes(q)).map(c => ({ c, s: clientSummary(c) }));
  const sorted = sortBy(rows, st.sort, st.dir, (x, k) => k === 'name' ? x.c.name.toLowerCase() : x.s[k]);
  const page = pageSlice('clients', sorted), cur = S().currency;
  return `<div class="tbl" role="table">
    <div class="tbl-row tbl-head" style="--cols:${CL_COLS}">${sortBtn('clients', 'name', 'Client')}<span>Contact</span><span class="r">${sortBtn('clients', 'invoiced', 'Invoiced')}</span><span class="r">${sortBtn('clients', 'paid', 'Paid')}</span><span class="r">${sortBtn('clients', 'outstanding', 'Outstanding')}</span><span></span></div>
    <div class="tbl-body">${page.length ? page.map(({ c, s }) => `<div class="tbl-row" style="--cols:${CL_COLS}" data-href="#/clients/${c.id}" tabindex="0" role="link">
      <div style="display:flex;align-items:center;gap:10px;min-width:0" data-m="a"><span class="avatar">${esc(initials(c.name))}</span><div class="cell-2"><span class="cell-main">${esc(c.name)}</span><span class="cell-sub">${plural(s.invoices.length, 'invoice')}</span></div></div>
      <div class="cell-2" data-m="c"><span class="t2">${esc(c.phone || '—')}</span><span class="cell-sub">${esc(c.email || '')}</span></div>
      <span class="amount r">${esc(money(s.invoiced, cur))}</span>
      <span class="amount r">${esc(money(s.paid, cur))}</span>
      <span class="amount r" data-m="b" ${s.outstanding ? '' : 'style="color:var(--text-3)"'}>${esc(money(s.outstanding, cur))}</span>
      <button class="icon-btn sm row-menu" data-act="client-menu" data-id="${c.id}" aria-label="Actions for ${esc(c.name)}">${ic('more')}</button>
    </div>`).join('') : emptyHTML('search', 'No clients match', 'Check the spelling, or add them as a new client.')}</div>
  </div>${pagerHTML('clients', sorted.length)}`;
}
function viewClients() {
  if (current.query.new) setTimeout(() => clientDialog(), 50);
  return {
    title: 'Clients',
    topbar: { crumbs: [['Clients']], actions: `<button class="btn btn-primary btn-sm hide-sm" data-act="client-new">${ic('plus')}Add client</button>` },
    html: `<div class="content">
      ${pageHead('Clients', 'People and businesses you bill, with what they owe.', `<button class="btn btn-primary" data-act="client-new">${ic('plus')}Add client</button>`)}
      <section class="card">
        <div class="toolbar"><div class="input-affix grow">${ic('search')}<input class="input" id="list-q" data-list="clients" type="search" placeholder="Search name, phone or email" value="${esc(LS.clients.q)}" autocomplete="off"></div></div>
        <div id="list-body">${clientTableHTML()}</div>
      </section>
    </div><button class="btn btn-primary fab" data-act="client-new">${ic('plus')}Add client</button>`,
    mount: bindListControls
  };
}
function clientDialog(id, onSaved) {
  const c = id ? findClient(id) : { name: '', email: '', phone: '', address: '', notes: '' };
  if (!c) return;
  const dlg = openDialog({
    title: id ? 'Edit client' : 'New client', width: 520,
    body: `<form id="cform" class="ed-fields" novalidate>
      <div class="field"><label for="c-name">Name</label><input class="input" id="c-name" value="${esc(c.name)}" placeholder="Full name or business name" autofocus><div class="err"></div></div>
      <div class="grid-2"><div class="field"><label for="c-phone">Phone</label><input class="input" id="c-phone" inputmode="tel" value="${esc(c.phone || '')}" placeholder="024 000 0000"></div>
      <div class="field"><label for="c-email">Email</label><input class="input" id="c-email" type="email" value="${esc(c.email || '')}" placeholder="name@example.com"><div class="err"></div></div></div>
      <div class="field"><label for="c-addr">Billing address</label><textarea class="input" id="c-addr" rows="2">${esc(c.address || '')}</textarea></div>
      <div class="field"><label for="c-notes">Notes</label><textarea class="input" id="c-notes" rows="2" placeholder="Only you see these">${esc(c.notes || '')}</textarea></div>
      <button type="submit" hidden></button></form>`,
    foot: `<button class="btn btn-secondary" data-close>Cancel</button><button class="btn btn-primary" id="c-save">${id ? 'Save changes' : 'Add client'}</button>`,
    onMount(b) {
      const save = async () => {
        clearErrors(b);
        const rec = { ...(id ? c : { id: uid(), createdAt: Date.now() }), name: $('#c-name', b).value.trim(), phone: $('#c-phone', b).value.trim(), email: $('#c-email', b).value.trim(), address: $('#c-addr', b).value.trim(), notes: $('#c-notes', b).value.trim() };
        if (!rec.name) { setFieldError($('#c-name', b), 'Add a name.'); $('#c-name', b).focus(); return; }
        if (rec.email && !/^\S+@\S+\.\S+$/.test(rec.email)) { setFieldError($('#c-email', b), 'This email doesn’t look right.'); return; }
        const dup = findDuplicateClient(rec, id);
        if (dup && !(await confirmDialog({ title: `${dup.name} already exists`, message: 'Another client has the same name, phone or email. Save this one as a separate client anyway?', ok: 'Save anyway', cancel: 'Go back' }))) return;
        putClient(rec); dlg.close();
        toast(id ? 'Client saved' : `${rec.name} added`);
        if (onSaved) onSaved(rec); else refreshView();
      };
      $('#c-save', b).onclick = save;
      $('#cform', b).addEventListener('submit', e => { e.preventDefault(); save(); });
    }
  });
}
async function deleteClient(c) {
  const s = clientSummary(c);
  if (!(await confirmDialog({ title: `Delete ${c.name}?`, message: s.docs.length ? `Their ${plural(s.docs.length, 'document')} stay as they are, with the client’s details printed on them.` : 'This removes the client from your list.', ok: 'Delete client', danger: true }))) return;
  delClient(c.id); toast(`${c.name} deleted`);
  if (current.name === 'clients' && current.parts[0]) go('#/clients'); else refreshView();
}
let clientTab = 'invoices';
function viewClient(id) {
  const c = findClient(id); if (!c) return notFound('Client', '#/clients');
  const s = clientSummary(c), cur = S().currency;
  const invs = s.invoices.sort(byDateDesc), rcs = s.receipts.sort(byDateDesc);
  const ICOLS = '110px 92px 92px 124px 124px 128px 34px';
  return {
    title: c.name,
    topbar: { crumbs: [['Clients', '#/clients'], [c.name]], actions: `<button class="btn btn-secondary btn-sm hide-sm" data-act="client-edit" data-id="${c.id}">${ic('edit')}Edit</button>` },
    html: `<div class="content stack">
      <div class="page-head" style="margin-bottom:0;align-items:center">
        <div class="profile-head"><span class="avatar">${esc(initials(c.name))}</span><div><h1>${esc(c.name)}</h1><p>${esc([c.phone, c.email].filter(Boolean).join('  ') || 'No contact details')}</p></div></div>
        <div class="page-actions" style="display:flex">
          <button class="icon-btn bordered" data-act="client-menu" data-id="${c.id}" data-detail="1" aria-label="More">${ic('more')}</button>
          <a class="btn btn-secondary" href="#/receipts/new?client=${c.id}&mode=standalone">${ic('receipt')}Receipt</a>
          <a class="btn btn-primary" href="#/invoices/new?client=${c.id}">${ic('plus')}Invoice</a>
        </div>
      </div>
      <section class="kpis" style="grid-template-columns:repeat(4,minmax(0,1fr))">
        <div class="kpi"><div class="k-label">Total invoiced</div><div class="k-value num">${moneyHTML(s.invoiced, cur)}</div></div>
        <div class="kpi"><div class="k-label">Total paid</div><div class="k-value num">${moneyHTML(s.paid, cur)}</div></div>
        <div class="kpi ${s.outstanding ? '' : ''}"><div class="k-label">Outstanding</div><div class="k-value num">${moneyHTML(s.outstanding, cur)}</div></div>
        <div class="kpi"><div class="k-label">Last payment</div><div class="k-value" style="font-size:18px">${s.lastPay ? esc(fmtDate(s.lastPay)) : '—'}</div></div>
      </section>
      <section class="card">
        <div class="tabs" role="tablist">
          <button class="tab ${clientTab === 'invoices' ? 'on' : ''}" data-act="client-tab" data-k="invoices">Invoices <span class="n">${invs.length}</span></button>
          <button class="tab ${clientTab === 'payments' ? 'on' : ''}" data-act="client-tab" data-k="payments">Payments <span class="n">${rcs.length}</span></button>
          <button class="tab ${clientTab === 'details' ? 'on' : ''}" data-act="client-tab" data-k="details">Details</button>
        </div>
        ${clientTab === 'invoices' ? (invs.length ? `<div class="tbl"><div class="tbl-row tbl-head" style="--cols:${ICOLS}"><span>Number</span><span>Issued</span><span>Due</span><span class="r">Amount</span><span class="r">Balance</span><span>Status</span><span></span></div><div class="tbl-body">${invs.map(d => {
            const b = balances(d); return `<div class="tbl-row" style="--cols:${ICOLS}" data-href="#/invoices/${d.id}" tabindex="0" role="link"><span class="cell-main num" data-m="a">${esc(d.number)}</span><span class="t2">${esc(fmtShort(d.issueDate))}</span><span class="t2" data-m="c">Due ${esc(fmtShort(d.dueDate))}</span><span class="amount r" data-m="b">${esc(money(b.total, d.currency))}</span><span class="amount r">${esc(money(b.balance, d.currency))}</span><span data-m="d">${badge(d)}</span><button class="icon-btn sm row-menu" data-act="doc-menu" data-id="${d.id}" aria-label="Actions">${ic('more')}</button></div>`; }).join('')}</div></div>`
          : emptyHTML('invoice', 'No invoices for this client', 'Create one and it will show here.', `<a class="btn btn-secondary btn-sm" href="#/invoices/new?client=${c.id}">New invoice</a>`))
        : clientTab === 'payments' ? (rcs.length ? `<div class="tbl"><div class="tbl-row tbl-head" style="--cols:${RC_COLS}"><span>Number</span><span>Received from</span><span>Date</span><span>Invoice</span><span class="r">Amount</span><span>Method</span><span></span></div><div class="tbl-body">${rcs.map(receiptRow).join('')}</div></div>`
          : emptyHTML('receipt', 'No payments yet', 'Payments recorded for this client will show here.'))
        : `<div class="card-body" style="display:grid;gap:4px;max-width:560px">
            <div class="kv"><span>Phone</span><b>${esc(c.phone || '—')}</b></div><div class="kv"><span>Email</span><b>${esc(c.email || '—')}</b></div>
            <div class="kv"><span>Billing address</span><b style="white-space:pre-line">${esc(c.address || '—')}</b></div>
            <div class="kv"><span>Notes</span><b style="white-space:pre-line;font-weight:400">${esc(c.notes || '—')}</b></div>
            <div style="margin-top:12px"><button class="btn btn-secondary btn-sm" data-act="client-edit" data-id="${c.id}">${ic('edit')}Edit details</button></div></div>`}
      </section>
    </div>`
  };
}

/* =====================================================================
   Products & services
   ===================================================================== */
function viewProducts() {
  const cols = 'minmax(0,1.3fr) minmax(0,2fr) 140px 34px';
  const list = [...DB.products].sort((a, b) => a.name.localeCompare(b.name));
  return {
    title: 'Products & services',
    topbar: { crumbs: [['Products & services']], actions: `<button class="btn btn-primary btn-sm hide-sm" data-act="product-new">${ic('plus')}Add item</button>` },
    html: `<div class="content">
      ${pageHead('Products & services', 'Things you sell often. Add them to an invoice in one click.', `<button class="btn btn-primary" data-act="product-new">${ic('plus')}Add item</button>`)}
      <section class="card">${list.length ? `<div class="tbl"><div class="tbl-row tbl-head" style="--cols:${cols}"><span>Name</span><span>Description</span><span class="r">Default price</span><span></span></div>
        <div class="tbl-body">${list.map(p => `<div class="tbl-row" style="--cols:${cols}" data-act="product-edit" data-id="${p.id}" tabindex="0" role="button">
          <span class="cell-main" data-m="a">${esc(p.name)}</span><span class="t2 ellipsis" data-m="c">${esc(p.description || '—')}</span>
          <span class="amount r" data-m="b">${esc(money(num(p.price), p.currency || S().currency))}</span>
          <button class="icon-btn sm row-menu" data-act="product-menu" data-id="${p.id}" aria-label="Actions">${ic('more')}</button></div>`).join('')}</div></div>`
        : emptyHTML('box', 'No saved products or services', 'Save the things you sell often, like a bridal fitting or alterations, with a default price.', '<button class="btn btn-primary" data-act="product-new">Add item</button>')}</section>
    </div><button class="btn btn-primary fab" data-act="product-new">${ic('plus')}Add item</button>`
  };
}
function productDialog(id) {
  const p = id ? DB.products.find(x => x.id === id) : { name: '', description: '', price: '', currency: S().currency };
  if (!p) return;
  const dlg = openDialog({
    title: id ? 'Edit item' : 'New product or service', width: 480,
    body: `<div class="ed-fields">
      <div class="field"><label for="p-name">Name</label><input class="input" id="p-name" value="${esc(p.name)}" placeholder="e.g. Custom kaba and slit" autofocus><div class="err"></div></div>
      <div class="field"><label for="p-desc">Description</label><textarea class="input" id="p-desc" rows="2" placeholder="Optional, printed under the name">${esc(p.description || '')}</textarea></div>
      <div class="grid-2"><div class="field"><label for="p-price">Default price</label><input class="input num" id="p-price" inputmode="decimal" value="${esc(p.price)}" placeholder="0.00"><div class="err"></div></div>
      <div class="field"><label for="p-cur">Currency</label><select class="input" id="p-cur">${CURRENCIES.map(([c]) => `<option${c === (p.currency || S().currency) ? ' selected' : ''}>${c}</option>`).join('')}</select></div></div></div>`,
    foot: `<button class="btn btn-secondary" data-close>Cancel</button><button class="btn btn-primary" id="p-save">${id ? 'Save changes' : 'Add item'}</button>`,
    onMount(b) {
      $('#p-save', b).onclick = () => {
        clearErrors(b);
        const name = $('#p-name', b).value.trim(), price = $('#p-price', b).value;
        if (!name) { setFieldError($('#p-name', b), 'Add a name.'); return; }
        if (num(price) < 0) { setFieldError($('#p-price', b), 'Price can’t be negative.'); return; }
        putProduct({ ...(id ? p : { id: uid(), createdAt: Date.now() }), name, description: $('#p-desc', b).value.trim(), price: fromCents(toCents(price)), currency: $('#p-cur', b).value });
        dlg.close(); toast(id ? 'Item saved' : `${name} added`); refreshView();
      };
    }
  });
}

/* =====================================================================
   Reports
   ===================================================================== */
let RP = { period: 'this-year', from: '', to: '' };
function viewReports() {
  const cur = S().currency, range = periodRange(RP.period, RP);
  const ag = aggregate(range, cur);
  const all = invoices().filter(d => countsAsIssued(d) && d.currency === cur);
  const earliest = all.concat(receipts()).map(d => d.issueDate).filter(Boolean).sort()[0] || todayISO();
  const from = RP.period === 'all' ? earliest : range.from, to = RP.period === 'all' ? todayISO() : (range.to > todayISO() && RP.period !== 'custom' ? todayISO() : range.to);
  const months = monthsBetween(from, to).slice(-24);
  const series = monthlySeries(months, cur);
  const open = all.filter(d => balances(d).balanceCents > 0);
  const today = todayISO();
  const buckets = [['Not yet due', d => !d.dueDate || d.dueDate >= today], ['1–30 days', d => daysBetween(d.dueDate, today) >= 1 && daysBetween(d.dueDate, today) <= 30], ['31–60 days', d => daysBetween(d.dueDate, today) > 30 && daysBetween(d.dueDate, today) <= 60], ['61–90 days', d => daysBetween(d.dueDate, today) > 60 && daysBetween(d.dueDate, today) <= 90], ['Over 90 days', d => daysBetween(d.dueDate, today) > 90]]
    .map(([l, f]) => { const xs = open.filter(f); return { l, n: xs.length, v: fromCents(xs.reduce((a, d) => a + balances(d).balanceCents, 0)) }; });
  const maxB = Math.max(1, ...buckets.map(b => b.v));
  const clientRows = DB.clients.map(c => {
    const invs = all.filter(d => d.clientId === c.id && inRange(d.issueDate, range));
    const pays = ag.payments.filter(r => r.clientId === c.id);
    return { c, invoiced: fromCents(invs.reduce((a, d) => a + totals(d).totalCents, 0)), paid: fromCents(pays.reduce((a, r) => a + receiptCents(r), 0)), owed: fromCents(all.filter(d => d.clientId === c.id).reduce((a, d) => a + balances(d).balanceCents, 0)), last: receipts().filter(r => r.clientId === c.id && !isVoid(r)).map(r => r.issueDate).sort().pop() };
  }).filter(x => x.invoiced || x.paid || x.owed).sort((a, b) => b.invoiced - a.invoiced || b.owed - a.owed);
  const rate = ag.invoiced ? Math.round(ag.received / ag.invoiced * 100) : 0;
  const CC = 'minmax(0,1.6fr) 130px 130px 130px 110px';
  const OC = '110px minmax(0,1.4fr) 100px 110px 130px';
  return {
    title: 'Reports',
    topbar: { crumbs: [['Reports']] },
    html: `<div class="content stack">
      ${pageHead('Reports', `${esc(range.label)}${RP.period === 'all' ? '' : `, ${esc(fmtDate(range.from))} to ${esc(fmtDate(range.to))}`}. Figures in ${cur}.`, `<button class="btn btn-secondary" data-act="export-csv" data-k="report">${ic('download')}Export CSV</button>`)}
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:-6px">
        <div class="seg">${[['this-month', 'This month'], ['last-month', 'Last month'], ['this-year', 'This year'], ['last-year', 'Last year'], ['all', 'All time'], ['custom', 'Custom']].map(([k, l]) => `<button data-act="rp-period" data-k="${k}" class="${RP.period === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        ${RP.period === 'custom' ? `<input class="input" type="date" id="rp-from" value="${esc(range.from)}" style="width:auto;height:34px" aria-label="From"><input class="input" type="date" id="rp-to" value="${esc(range.to)}" style="width:auto;height:34px" aria-label="To">` : ''}
      </div>
      <section class="kpis" style="grid-template-columns:repeat(4,minmax(0,1fr))">
        <div class="kpi"><div class="k-label">Invoiced</div><div class="k-value num">${moneyHTML(ag.invoiced, cur)}</div><div class="k-sub">${plural(ag.invoicedCount, 'invoice')}</div></div>
        <div class="kpi"><div class="k-label">Payments received</div><div class="k-value num">${moneyHTML(ag.received, cur)}</div><div class="k-sub">${ag.invoiced ? `${rate}% of amount invoiced` : plural(ag.payments.length, 'payment')}</div></div>
        <div class="kpi"><div class="k-label">Outstanding today</div><div class="k-value num">${moneyHTML(ag.outstanding, cur)}</div><div class="k-sub">${plural(ag.openCount, 'open invoice')}</div></div>
        <div class="kpi ${ag.overdueList.length ? 'alert' : ''}"><div class="k-label">Overdue today</div><div class="k-value num">${moneyHTML(ag.overdue, cur)}</div><div class="k-sub">${plural(ag.overdueList.length, 'invoice')}</div></div>
      </section>
      <div class="split-2">
        <section class="card"><div class="card-head"><div><h2>Revenue and payments</h2><div class="sub">By month</div></div>${legend}</div><div class="card-body"><div id="rp-chart"></div></div></section>
        <section class="card"><div class="card-head"><div><h2>Receivables by age</h2><div class="sub">Open balances, by days past due</div></div></div>
          <div class="card-body" style="display:grid;gap:14px">${buckets.map(b => `<div><div class="kv" style="padding:0 0 6px"><span>${b.l} <span class="muted">(${b.n})</span></span><b>${esc(money(b.v, cur))}</b></div><div class="progress" style="margin:0"><i style="width:${Math.round(b.v / maxB * 100)}%;${b.l === 'Not yet due' ? 'background:var(--chart-b)' : ''}"></i></div></div>`).join('')}</div></section>
      </div>
      <section class="card"><div class="card-head"><div><h2>Client payment summary</h2><div class="sub">Invoiced and paid within the period, outstanding today</div></div></div>
        ${clientRows.length ? `<div class="tbl"><div class="tbl-row tbl-head" style="--cols:${CC}"><span>Client</span><span class="r">Invoiced</span><span class="r">Paid</span><span class="r">Outstanding</span><span class="r">Last payment</span></div><div class="tbl-body">${clientRows.map(x => `<div class="tbl-row" style="--cols:${CC}" data-href="#/clients/${x.c.id}" tabindex="0" role="link"><span class="cell-main" data-m="a">${esc(x.c.name)}</span><span class="amount r">${esc(money(x.invoiced, cur))}</span><span class="amount r" data-m="c">${esc(money(x.paid, cur))} paid</span><span class="amount r" data-m="b">${esc(money(x.owed, cur))}</span><span class="t2 r" data-m="d">${x.last ? esc(fmtShort(x.last)) : '—'}</span></div>`).join('')}</div></div>`
          : emptyHTML('users', 'Nothing in this period', 'Choose a wider date range to see client activity.')}</section>
      <section class="card"><div class="card-head"><div><h2>Overdue invoices</h2><div class="sub">Oldest first</div></div></div>
        ${ag.overdueList.length ? `<div class="tbl"><div class="tbl-row tbl-head" style="--cols:${OC}"><span>Invoice</span><span>Client</span><span>Due</span><span>Days late</span><span class="r">Balance</span></div><div class="tbl-body">${[...ag.overdueList].sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map(d => `<div class="tbl-row" style="--cols:${OC}" data-href="#/invoices/${d.id}" tabindex="0" role="link"><span class="cell-main num">${esc(d.number)}</span><span class="cell-main" data-m="a">${esc(clientName(d))}</span><span class="t2">${esc(fmtShort(d.dueDate))}</span><span style="color:var(--red)" data-m="c">${plural(daysBetween(d.dueDate, today), 'day')} late</span><span class="amount r" data-m="b">${esc(money(balances(d).balance, d.currency))}</span></div>`).join('')}</div></div>`
          : emptyHTML('check', 'Nothing overdue', 'Every invoice is paid or still within its terms.')}</section>
    </div>`,
    mount(el) {
      mountChart($('#rp-chart', el), series, cur);
      const f = $('#rp-from', el), t = $('#rp-to', el);
      if (f) [f, t].forEach(i => i.addEventListener('change', () => { RP.from = f.value; RP.to = t.value; renderRoute(true); }));
    }
  };
}

/* =====================================================================
   Settings
   ===================================================================== */
const SET_TABS = [['business', 'Business profile', 'user'], ['documents', 'Documents', 'invoice'], ['payments', 'Payment details', 'wallet'], ['appearance', 'Appearance', 'sun'], ['data', 'Data and account', 'lock']];
function sampleDoc(tpl) {
  const s = S();
  return { id: 'sample', type: 'invoice', template: tpl, number: formatNumber('invoice', 42), status: 'issued', issueDate: todayISO(), dueDate: addDays(todayISO(), 14), currency: s.currency, client: { name: 'Ama Mensah', address: 'East Legon, Accra', phone: '024 555 1234', email: '' }, items: [{ desc: 'Custom kaba and slit', qty: 1, price: 1450 }, { desc: 'Alterations', qty: 2, price: 120 }], discount: 0, taxRate: 0, notes: '', showPayment: true };
}
function viewSettings(tab) {
  if (!SET_TABS.some(t => t[0] === tab)) tab = 'business';
  const s = S();
  const row = (label, help, control) => `<div class="set-row"><div class="lbl"><b>${label}</b>${help ? `<small>${help}</small>` : ''}</div><div>${control}</div></div>`;
  const inp = (k, o = {}) => o.area ? `<textarea class="input" data-s="${k}" rows="${o.rows || 3}" placeholder="${esc(o.ph || '')}">${esc(s[k] ?? '')}</textarea>` : `<input class="input${o.num ? ' num' : ''}" data-s="${k}" value="${esc(s[k] ?? '')}" placeholder="${esc(o.ph || '')}"${o.type ? ` type="${o.type}"` : ''}${o.im ? ` inputmode="${o.im}"` : ''}${o.w ? ` style="max-width:${o.w}px"` : ''}>`;
  let body = '';
  if (tab === 'business') body = `
    ${row('Logo', 'Shown at the top of every document. PNG or JPG, ideally on a transparent or white background.', `<div class="logo-drop"><div class="logo-box">${s.logo === 'none' ? `<span class="muted" style="font-size:12px">No logo</span>` : `<img src="${s.logo || LOGO}" alt="Logo">`}</div>
      <div style="display:grid;gap:6px;justify-items:start"><button class="btn btn-secondary btn-sm" data-act="logo-upload">${ic('upload')}Upload logo</button>
      <div style="display:flex;gap:4px">${s.logo ? '<button class="btn btn-ghost btn-sm" data-act="logo-reset">Use Kuzelle logo</button>' : ''}${s.logo !== 'none' ? '<button class="btn btn-ghost btn-sm" data-act="logo-none">Show name instead</button>' : ''}</div></div></div>`)}
    ${row('Business name', '', inp('businessName'))}
    ${row('Contact', 'Printed under “From” on documents.', `<div class="grid-2">${inp('phone', { im: 'tel', ph: 'Phone' })}${inp('email', { type: 'email', ph: 'Email' })}</div>`)}
    ${row('Address', '', inp('address', { area: true, rows: 2 }))}
    ${row('Website or social', '', inp('website', { ph: 'kuzelle.com or @kuzelle' }))}
    ${row('Tax identification number', 'Optional. Your GRA TIN or VAT number, if you have one.', inp('taxId', { ph: 'e.g. P0000000000' }))}`;
  if (tab === 'documents') body = `
    ${row('Template', 'The look of every invoice and receipt. You can also switch per document in the editor.', `<div class="tpl-pick">${['classic', 'modern', 'minimal'].map(t => `<button class="tpl-opt ${s.template === t ? 'on' : ''}" data-act="set-tpl" data-k="${t}"><div class="thumb">${paginate(sampleDoc(t))[0].replace('class="page', 'style="transform:scale(.2)" class="page')}</div><b>${t[0].toUpperCase() + t.slice(1)}</b><small>${{ classic: 'Serif headings, ruled lines', modern: 'Bold, shaded table', minimal: 'Light and spacious' }[t]}</small></button>`).join('')}</div>`)}
    ${row('Default currency', 'New invoices and receipts start in this currency. Dashboard totals use it too.', `<select class="input" data-s="currency" style="max-width:320px">${CURRENCIES.map(([c, n]) => `<option value="${c}"${c === s.currency ? ' selected' : ''}>${c} · ${n}</option>`).join('')}</select>`)}
    ${row('Invoice numbers', `Next invoice: <b id="next-inv">${esc(nextNumber('invoice'))}</b>`, `<div class="grid-3"><div class="field"><label>Prefix</label>${inp('invPrefix')}</div><div class="field"><label>Start at</label>${inp('nextInv', { im: 'numeric', num: true })}</div><div class="field"><label>Digits</label>${inp('numberDigits', { im: 'numeric', num: true })}</div></div>`)}
    ${row('Receipt numbers', `Next receipt: <b id="next-rct">${esc(nextNumber('receipt'))}</b>`, `<div class="grid-3"><div class="field"><label>Prefix</label>${inp('rctPrefix')}</div><div class="field"><label>Start at</label>${inp('nextRct', { im: 'numeric', num: true })}</div><div></div></div>`)}
    ${row('Default payment terms', '', `<select class="input" data-s="dueDays" style="max-width:240px">${TERMS.filter(t => t[0] !== 'custom').map(([k, l]) => `<option value="${k}"${String(s.dueDays) === k ? ' selected' : ''}>${l}</option>`).join('')}</select>`)}
    ${row('Tax', 'Leave the rate at 0 if you don’t charge tax.', `<div class="grid-2"><div class="field"><label>Name</label>${inp('taxLabel', { ph: 'VAT' })}</div><div class="field"><label>Default rate (%)</label>${inp('taxRate', { im: 'decimal', num: true })}</div></div>`)}
    ${row('Default notes', 'Added to new invoices.', inp('defaultNotes', { area: true, rows: 2 }))}
    ${row('Default terms and conditions', '', inp('defaultTerms', { area: true, rows: 3, ph: 'e.g. 50% deposit before work begins. Balance on collection.' }))}
    ${row('Closing line', 'The last line on every document.', inp('footer'))}`;
  if (tab === 'payments') body = `
    ${row('Payment instructions', 'Printed under “How to pay” on invoices.', inp('payment', { area: true, rows: 5, ph: 'MTN MoMo: 024 000 0000 (Kuzelle)\nBank: GCB Bank, Accra Main\nAccount name: Kuzelle\nAccount number: 0000000000000' }))}
    ${row('Include by default', '', `<label class="checkbox"><input type="checkbox" data-s="showPayment"${s.showPayment !== false ? ' checked' : ''}>Add payment instructions to new invoices</label>`)}
    ${row('WhatsApp country code', 'Turns local numbers like 024… into WhatsApp links.', inp('countryCode', { im: 'numeric', w: 120 }))}`;
  if (tab === 'appearance') body = `
    ${row('Theme', 'Documents always print on white, whatever the app theme.', `<div class="seg">${[['system', 'System', 'monitor'], ['light', 'Light', 'sun'], ['dark', 'Dark', 'moon']].map(([k, l, i]) => `<button data-act="set-theme" data-theme-opt="${k}" data-k="${k}" class="${(UI.theme || 'system') === k ? 'on' : ''}">${ic(i)}${l}</button>`).join('')}</div>`)}
    ${row('Sidebar', '', `<div class="seg">${[['expanded', 'Expanded'], ['collapsed', 'Collapsed']].map(([k, l]) => `<button data-act="set-sidebar" data-k="${k}" class="${(UI.sidebar || (mq('(min-width:1200px)') ? 'expanded' : 'collapsed')) === k ? 'on' : ''}">${l}</button>`).join('')}</div>`)}`;
  if (tab === 'data') body = `
    ${row('Storage', MODE === 'cloud' ? 'Saved to your Netlify database and shared by every device you sign in on.' : 'Saved in this browser only.', `<div style="display:grid;gap:8px;justify-items:start"><div class="sync-pill" data-sync style="padding:0;height:auto"><span class="sdot"></span><span class="stxt"></span></div>
      ${MODE === 'cloud' ? `<button class="btn btn-secondary btn-sm" data-act="sync-now">${ic('sync')}Sync now</button>` : ''}</div>`)}
    ${row('Backup', `Last export: ${UI.lastBackup ? esc(new Date(UI.lastBackup).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })) : 'never'}`, `<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-secondary btn-sm" data-act="backup">${ic('download')}Export backup</button><button class="btn btn-secondary btn-sm" data-act="import">${ic('upload')}Restore backup</button></div>`)}
    ${row('Spreadsheets', 'CSV files that open in Excel or Google Sheets.', `<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-secondary btn-sm" data-act="export-csv" data-k="invoices">Invoices</button><button class="btn btn-secondary btn-sm" data-act="export-csv" data-k="receipts">Receipts</button><button class="btn btn-secondary btn-sm" data-act="export-csv" data-k="clients">Clients</button></div>`)}
    ${row('Session', 'The access code is set in Netlify (ACCESS_CODE).', `<button class="btn btn-secondary btn-sm" data-act="lock">${ic('lock')}Lock now</button>`)}
    ${row('Erase all data', `Deletes every document, client and setting${MODE === 'cloud' ? ' from the database and all devices' : ''}.`, `<button class="btn btn-danger-soft btn-sm" data-act="wipe">${ic('trash')}Erase everything</button>`)}`;
  return {
    title: 'Settings',
    topbar: { crumbs: [['Settings', '#/settings'], [SET_TABS.find(t => t[0] === tab)[1]]] },
    html: `<div class="content">
      ${pageHead('Settings', 'Changes save automatically.')}
      <div class="settings">
        <nav class="settings-nav" aria-label="Settings sections">${SET_TABS.map(([k, l, i]) => `<a class="nav-link ${k === tab ? 'active' : ''}" href="#/settings/${k}">${ic(i)}<span>${l}</span></a>`).join('')}</nav>
        <section class="card"><div class="card-body" style="padding-top:4px;padding-bottom:4px">${body}</div></section>
      </div>
    </div>`,
    mount(el) {
      const NUMS = ['taxRate', 'dueDays', 'nextInv', 'nextRct', 'numberDigits'];
      const saveSettings = debounce(() => { putSettings(); }, 400);
      el.addEventListener('input', e => {
        const k = e.target.dataset.s; if (!k) return;
        let v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
        if (NUMS.includes(k)) v = k === 'taxRate' ? num(v) : Math.max(k === 'dueDays' ? 0 : 1, Math.floor(num(v)) || (k === 'dueDays' ? 0 : k === 'numberDigits' ? 4 : 1));
        if (k === 'numberDigits') v = Math.min(8, v);
        S()[k] = v; saveSettings();
        const ni = $('#next-inv', el), nr = $('#next-rct', el);
        if (ni) ni.textContent = nextNumber('invoice'); if (nr) nr.textContent = nextNumber('receipt');
        if (k === 'businessName') paintAccount();
      });
    }
  };
}
function handleLogoFile(file) {
  if (!file || !/^image\//.test(file.type)) { toast('Choose a PNG or JPG image.', { error: true }); return; }
  const img = new Image();
  img.onload = () => {
    const max = 640, scale = Math.min(1, max / Math.max(img.width, img.height * 3));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    let url = c.toDataURL('image/png');
    if (url.length > 300000) url = c.toDataURL('image/webp', .9);
    if (url.length > 300000) { toast('That image is too large. Try a smaller file.', { error: true }); return; }
    S().logo = url; putSettings(); toast('Logo updated'); renderRoute(true); URL.revokeObjectURL(img.src);
  };
  img.onerror = () => toast('Couldn’t read that image.', { error: true });
  img.src = URL.createObjectURL(file);
}

/* =====================================================================
   Data tools
   ===================================================================== */
function download(name, text, type) {
  const blob = new Blob([text], { type }); const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
}
const csvq = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
const csv = (head, rows) => '\ufeff' + [head, ...rows].map(r => r.map(csvq).join(',')).join('\n');
function exportCSV(kind) {
  const date = todayISO();
  if (kind === 'invoices') download(`invoices-${date}.csv`, csv(['Number', 'Client', 'Phone', 'Issued', 'Due', 'Status', 'Currency', 'Subtotal', 'Discount', 'Tax', 'Total', 'Paid', 'Balance', 'Items'],
    invoices().sort(byDateDesc).map(d => { const t = totals(d), b = balances(d); return [d.number, clientName(d), d.client && d.client.phone, d.issueDate, d.dueDate, STATUS[invoiceStatus(d)], d.currency, t.sub, t.disc, t.tax, t.total, b.paid, b.balance, (d.items || []).map(i => `${i.desc} x${i.qty}`).join('; ')]; })), 'text/csv');
  if (kind === 'receipts') download(`receipts-${date}.csv`, csv(['Number', 'Received from', 'Date', 'Amount', 'Currency', 'Method', 'Reference', 'Invoice', 'For', 'Void'],
    receipts().sort(byDateDesc).map(r => [r.number, clientName(r), r.issueDate, receiptAmount(r), r.currency, r.paymentMethod, r.reference, (findDoc(r.linkedInvoiceId) || {}).number || r.invoiceNumber || '', r.description, isVoid(r) ? 'Yes' : ''])), 'text/csv');
  if (kind === 'clients') download(`clients-${date}.csv`, csv(['Name', 'Phone', 'Email', 'Address', 'Invoiced', 'Paid', 'Outstanding'],
    DB.clients.map(c => { const s = clientSummary(c); return [c.name, c.phone, c.email, c.address, s.invoiced, s.paid, s.outstanding]; })), 'text/csv');
  if (kind === 'report') {
    const range = periodRange(RP.period, RP), cur = S().currency;
    const invs = invoices().filter(d => countsAsIssued(d) && d.currency === cur && inRange(d.issueDate, range));
    const pays = receipts().filter(r => !isVoid(r) && r.currency === cur && inRange(r.issueDate, range));
    download(`report-${range.from}-to-${range.to}.csv`, csv(['Type', 'Number', 'Client', 'Date', 'Amount', 'Balance', 'Status'],
      [...invs.map(d => ['Invoice', d.number, clientName(d), d.issueDate, totals(d).total, balances(d).balance, STATUS[invoiceStatus(d)]]), ...pays.map(r => ['Payment', r.number, clientName(r), r.issueDate, receiptAmount(r), '', r.paymentMethod])]), 'text/csv');
  }
  toast('Spreadsheet exported');
}
function exportBackup() {
  download(`kuzelle-backup-${todayISO()}.json`, JSON.stringify({ app: 'kuzelle-invoices', version: 3, exportedAt: new Date().toISOString(), ...DB }, null, 2), 'application/json');
  UI.lastBackup = Date.now(); saveUI(); toast('Backup exported'); if (current.name === 'settings') renderRoute(true);
}

/* =====================================================================
   Actions (event delegation)
   ===================================================================== */
const ACTIONS = {
  drawer: () => setDrawer(!$('#app').classList.contains('drawer-open')),
  collapse: () => { const c = !$('#app').classList.contains('collapsed'); UI.sidebar = c ? 'collapsed' : 'expanded'; saveUI(); applySidebarMode(); },
  'toggle-theme': () => setTheme(effectiveTheme() === 'dark' ? 'light' : 'dark'),
  'set-theme': ds => setTheme(ds.k),
  'set-sidebar': ds => { UI.sidebar = ds.k; saveUI(); applySidebarMode(); renderRoute(true); },
  'search-mobile': openMobileSearch,
  account: (ds, el) => showMenu(el, [
    { heading: S().businessName },
    { label: 'Business profile', icon: 'user', onClick: () => go('#/settings/business') },
    { label: 'Appearance', icon: 'sun', onClick: () => go('#/settings/appearance') },
    { label: 'Data and backups', icon: 'download', onClick: () => go('#/settings/data') },
    'sep', { label: 'Lock', icon: 'lock', onClick: () => lockApp() }
  ], { above: true, alignLeft: true, width: 220 }),
  'sync-now': () => {
    if (MODE !== 'cloud') { toast('Records are saved on this device only.'); return; }
    if (!navigator.onLine) { toast('You’re offline. Changes are kept and upload when you reconnect.'); return; }
    sync().then(() => { if (syncState === 'synced') toast('Everything is up to date'); });
  },
  'dash-period': ds => { UI.dashPeriod = ds.k; saveUI(); renderRoute(true); },
  'dash-months': ds => { UI.dashMonths = +ds.k; saveUI(); renderRoute(true); },
  'goto-filter': ds => { LS.invoices.status = ds.f; LS.invoices.page = 1; go('#/invoices'); },
  sort: ds => { const st = LS[ds.list]; if (st.sort === ds.k) st.dir = st.dir === 'asc' ? 'desc' : 'asc'; else { st.sort = ds.k; st.dir = ['client', 'name', 'number'].includes(ds.k) ? 'asc' : 'desc'; } refreshList(); },
  page: ds => { LS[ds.list].page += +ds.d; refreshList(); $('#list-body').scrollIntoView({ block: 'start', behavior: 'smooth' }); },
  'inv-status': ds => { LS.invoices.status = ds.k; LS.invoices.page = 1; refreshList(); },
  'clear-filters': ds => { Object.assign(LS[ds.list], { q: '', status: 'all', period: 'all', client: '', page: 1 }); renderRoute(true); },
  'doc-menu': (ds, el) => { const d = findDoc(ds.id); if (d) docMenu(d, el, !!ds.detail); },
  dl: (ds, el) => { const d = findDoc(ds.id); if (d) actDownload(d, el); },
  print: ds => { const d = findDoc(ds.id); if (d) printDoc(d); },
  share: ds => { const d = findDoc(ds.id); if (d) actShare(d); },
  finalize: ds => { const d = findDoc(ds.id); if (!d) return; if (!d.client || !d.client.name || !(d.items || []).some(i => i.desc)) { toast('Add a client and items before finalizing.', { error: true }); go(`#/invoices/${d.id}/edit`); return; } putDoc({ ...d, status: 'issued' }); toast(`${d.number} is ready to send`); refreshView(); },
  'rc-void': ds => { const r = findDoc(ds.id); if (r) voidReceipt(r); },
  'rc-restore': ds => { const r = findDoc(ds.id); if (r) restoreReceipt(r); },
  // editors
  'ed-tab': ds => setEditorTab(ds.k),
  'ed-more': (ds, el) => showMenu(el, [
    { label: 'Download PDF', icon: 'download', onClick: () => actDownload(draft) },
    { label: 'Print', icon: 'print', onClick: () => printDoc(draft) },
    'sep', { label: 'Discard changes', icon: 'close', danger: true, onClick: () => { dirty = false; go(draft && !draft._isNew ? `#/invoices/${draft.id}` : '#/invoices'); } }
  ]),
  'inv-save': (ds, el) => saveInvoice(ds.mode, el),
  'rc-save': (ds, el) => saveReceipt(el),
  'item-add': () => addItem(),
  'item-del': ds => { draft.items = draft.items.length > 1 ? draft.items.filter(i => i.id !== ds.id) : [{ id: uid(), desc: '', qty: 1, price: '' }]; dirty = true; renderItems(); refreshInvoice(); },
  'item-catalog': (ds, el) => {
    if (!DB.products.length) { showMenu(el, [{ heading: 'No saved products yet' }, { label: 'Add products and services', icon: 'plus', onClick: () => { dirty = false; go('#/products'); } }], { alignLeft: true, width: 260 }); return; }
    showMenu(el, [...DB.products].sort((a, b) => a.name.localeCompare(b.name)).map(p => ({ label: `${p.name}   ${money(num(p.price), p.currency || draft.currency)}`, icon: 'box', onClick: () => addItem({ desc: p.description ? `${p.name}\n${p.description}` : p.name, price: String(num(p.price)), productId: p.id }) })), { alignLeft: true, width: 300 });
  },
  'disc-type': ds => { draft.discountType = ds.v; $$('#disc-seg button').forEach(b => b.classList.toggle('on', b.dataset.v === ds.v)); dirty = true; refreshInvoice(); },
  tpl: ds => { draft.template = ds.k; $$('[data-act="tpl"]').forEach(b => b.classList.toggle('on', b.dataset.k === ds.k)); dirty = true; refreshInvoice(); },
  'client-change': () => { draft.clientId = null; draft.client = { name: '', email: '', phone: '', address: '' }; draft._cmode = 'pick'; dirty = true; draft._rerenderClient(); setTimeout(() => { const c = $('#client-combo'); if (c) c.focus(); }, 30); },
  'client-edit-inline': () => { draft._cmode = 'edit'; draft._rerenderClient(); },
  'client-pick': () => { if (draft._cmode === 'new') { draft.client = { name: '', email: '', phone: '', address: '' }; draft._cmode = 'pick'; } else draft._cmode = 'card'; draft._rerenderClient(); },
  'rc-mode': ds => { if (draft._mode === ds.k) return; draft._mode = ds.k; if (ds.k === 'standalone') { draft.linkedInvoiceId = null; draft.invoiceNumber = ''; draft.description = ''; draft.client = { name: '', email: '', phone: '', address: '' }; draft.clientId = null; draft._cmode = 'pick'; } else { draft.linkedInvoiceId = null; } dirty = true; renderReceiptForm(); },
  'rc-inv-change': () => { draft.linkedInvoiceId = null; draft.amount = ''; renderReceiptForm(); },
  'rc-full': () => { const max = maxAllowedCents(); if (isFinite(max)) { draft.amount = String(fromCents(max)); $('#r-amt').value = draft.amount; validateAmount(false); dirty = true; refreshReceipt(); } },
  // clients & products
  'client-new': () => clientDialog(),
  'client-edit': ds => clientDialog(ds.id),
  'client-tab': ds => { clientTab = ds.k; renderRoute(true); },
  'client-menu': (ds, el) => { const c = findClient(ds.id); if (!c) return; showMenu(el, [
    !ds.detail && { label: 'View profile', icon: 'eye', onClick: () => go(`#/clients/${c.id}`) },
    { label: 'Edit', icon: 'edit', onClick: () => clientDialog(c.id) },
    { label: 'New invoice', icon: 'invoice', onClick: () => go(`#/invoices/new?client=${c.id}`) },
    { label: 'New receipt', icon: 'receipt', onClick: () => go(`#/receipts/new?client=${c.id}&mode=standalone`) },
    'sep', { label: 'Delete client', icon: 'trash', danger: true, onClick: () => deleteClient(c) }].filter(Boolean)); },
  'product-new': () => productDialog(),
  'product-edit': ds => productDialog(ds.id),
  'product-menu': (ds, el) => { const p = DB.products.find(x => x.id === ds.id); if (!p) return; showMenu(el, [
    { label: 'Edit', icon: 'edit', onClick: () => productDialog(p.id) },
    { label: 'Delete', icon: 'trash', danger: true, onClick: async () => { if (await confirmDialog({ title: `Delete ${p.name}?`, message: 'Invoices that already use it are not affected.', ok: 'Delete', danger: true })) { delProduct(p.id); toast(`${p.name} deleted`); refreshView(); } } }]); },
  // reports & settings
  'rp-period': ds => { RP.period = ds.k; renderRoute(true); },
  'set-tpl': ds => { S().template = ds.k; putSettings(); renderRoute(true); },
  'logo-upload': () => $('#logo-file').click(),
  'logo-reset': () => { S().logo = ''; putSettings(); renderRoute(true); },
  'logo-none': () => { S().logo = 'none'; putSettings(); renderRoute(true); },
  'export-csv': ds => exportCSV(ds.k),
  backup: exportBackup,
  import: () => $('#import-file').click(),
  lock: () => lockApp(),
  wipe: async () => {
    if (!(await confirmDialog({ title: 'Erase all data?', message: `Every document, client, product and setting will be deleted${MODE === 'cloud' ? ' from the database and every device' : ''}. Export a backup first if you might need them.`, ok: 'Erase everything', danger: true }))) return;
    replaceAll(normalize({ settings: defaultSettings() })); go('#/dashboard'); toast('All data erased');
  }
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (el && ACTIONS[el.dataset.act]) { e.preventDefault(); e.stopPropagation(); ACTIONS[el.dataset.act](el.dataset, el, e); return; }
  const row = e.target.closest('[data-href]');
  if (row && !e.target.closest('a,button,input,select,textarea')) { go(row.dataset.href); return; }
  if (e.target.closest('.sidebar a') && mq('(max-width:767px)')) setDrawer(false);
});
$('#scrim').addEventListener('click', () => setDrawer(false));
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (dialogs.length) { dialogs[dialogs.length - 1].close(); return; }
    if ($('#app').classList.contains('drawer-open')) { setDrawer(false); return; }
    closeMenu();
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !$('#app').hidden) { e.preventDefault(); const g = $('#gsearch'); if (g && g.offsetParent) g.focus(); else openMobileSearch(); }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's' && draft) { e.preventDefault(); if (draft.type === 'invoice') saveInvoice('final'); else saveReceipt(); }
  if (e.key === 'Enter' && e.target.matches('[data-href]')) go(e.target.dataset.href);
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"][data-act]')) { e.preventDefault(); e.target.click(); }
});
$('#import-file').addEventListener('change', async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  let data; try { data = JSON.parse(await file.text()); } catch { toast('That file isn’t a Kuzelle backup.', { error: true }); return; }
  if (!data || !Array.isArray(data.docs) || !data.settings) { toast('That file isn’t a Kuzelle backup.', { error: true }); return; }
  if (!(await confirmDialog({ title: 'Restore this backup?', message: `It has ${plural(data.docs.length, 'document')} and ${plural((data.clients || []).length, 'client')}. It replaces the current records${MODE === 'cloud' ? ' on every device' : ''}.`, ok: 'Restore' }))) return;
  replaceAll(normalize(data)); toast('Backup restored'); renderRoute();
});
$('#logo-file').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; handleLogoFile(f); });

/* =====================================================================
   Lock screen
   ===================================================================== */
let code = '', checking = false, cdTimer = 0;
const lockMsg = (t, err) => { const m = $('#lock-msg'); m.className = 'lock-msg' + (err ? ' err' : ''); m.textContent = t; };
const attempts = () => readJSON(ATTKEY, { n: 0, until: 0 }) || { n: 0, until: 0 };
const lockoutLeft = () => Math.max(0, Math.ceil((attempts().until - Date.now()) / 1000));
function buildLock() {
  $('#lock-logo').src = LOGO;
  $('#dots').innerHTML = Array.from({ length: CONFIG.CODE_LENGTH }, () => '<span class="dot"></span>').join('');
  $('#keypad').innerHTML = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map(k => k === '' ? '<span></span>'
    : `<button class="key${k === 'del' ? ' ghost' : ''}" data-key="${k}" aria-label="${k === 'del' ? 'Delete' : k}">${k === 'del' ? ic('del') : k}</button>`).join('');
  $('#keypad').addEventListener('click', e => { const b = e.target.closest('[data-key]'); if (b) press(b.dataset.key); });
}
const renderDots = () => $$('#dots .dot').forEach((d, i) => d.classList.toggle('on', i < code.length));
function startLockout(seconds) {
  if (seconds) writeJSON(ATTKEY, { n: 0, until: Date.now() + seconds * 1000 });
  clearInterval(cdTimer);
  const tick = () => { const left = lockoutLeft(); $$('.key').forEach(k => k.disabled = left > 0);
    if (left > 0) lockMsg(`Too many tries. Wait ${left >= 60 ? Math.ceil(left / 60) + ' min' : left + 's'}.`, true); else { clearInterval(cdTimer); lockMsg('Invoices and receipts'); } };
  tick(); cdTimer = setInterval(tick, 1000);
}
function press(k) {
  if (checking || lockoutLeft()) return;
  if (k === 'del') code = code.slice(0, -1); else if (code.length < CONFIG.CODE_LENGTH) code += k;
  renderDots();
  if (code.length === CONFIG.CODE_LENGTH) check();
}
async function check() {
  checking = true; $('#dots').classList.add('busy');
  const res = await login(code);
  $('#dots').classList.remove('busy');
  if (res.ok) { code = ''; checking = false; renderDots(); unlock(); return; }
  if (res.wrong) { const a = attempts(); a.n++; if (a.n >= CONFIG.MAX_ATTEMPTS) { a.until = Date.now() + CONFIG.LOCKOUT_SECONDS * 1000; a.n = 0; } writeJSON(ATTKEY, a); }
  const dots = $('#dots'); dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake');
  if (navigator.vibrate) navigator.vibrate(80);
  lockMsg(res.msg || 'That code isn’t right', true);
  setTimeout(() => { code = ''; renderDots(); checking = false; if (res.wait) startLockout(res.wait); else if (lockoutLeft()) startLockout(); }, 420);
}
function unlock() {
  $('#lock').hidden = true; $('#app').hidden = false;
  $('#sidebar').innerHTML = sidebarHTML();
  applySidebarMode();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  renderRoute();
  if (MODE === 'cloud') sync();
}
function lockApp(message) {
  endSession(); closeAllDialogs(); closeMenu(); dirty = false; draft = null;
  $('#app').hidden = true; $('#lock').hidden = false;
  code = ''; renderDots(); lockMsg(message || 'Invoices and receipts', !!message);
}
document.addEventListener('keydown', e => {
  if ($('#lock').hidden) return;
  if (/^[0-9]$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('del');
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden || $('#lock').hidden === false) return;
  if (!sessionValid()) { lockApp(); return; }
  sync();
});

/* =====================================================================
   Boot
   ===================================================================== */
applyTheme();
buildLock();
if (lockoutLeft()) startLockout();
if (canResume()) unlock();
if ('serviceWorker' in navigator && location.protocol === 'https:') addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
window.kuzelleHash = async c => { const { sha256 } = await import('./util.js'); const h = await sha256(String(c)); console.log(h); return h; };
