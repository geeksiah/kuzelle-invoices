// Kuzelle — application shell, routes and screens.
// Principle: configure once in Settings, create documents effortlessly. Each screen has one job.
import {
  $, $$, esc, uid, num, toCents, fromCents, readJSON, writeJSON, mq, initials, plural, debounce,
  todayISO, addDays, daysBetween, fmtDate, fmtShort, monthLabel, monthsBetween, periodRange, inRange,
  CURRENCIES, money, moneyHTML, plainAmount, symbolOf, ic
} from './util.js';
import {
  CONFIG, UIKEY, ATTKEY, bus, DB, S, MODE, syncState, lastSync, firstSyncDone, pendingCount,
  putDoc, delDoc, putClient, delClient, putProduct, delProduct, putSettings, replaceAll, normalize, defaultSettings,
  login, canResume, sessionValid, endSession, sync,
  findDoc, findClient, invoices, receipts, byDateDesc, totals, balances, invoiceStatus, docStatus, STATUS,
  receiptAmount, receiptCents, paymentsFor, isVoid, countsAsIssued, nextNumber, numberTaken, formatNumber, claimNumber, snapshotBiz,
  findDuplicateClient, clientSummary, aggregate, monthlySeries, newInvoice, newReceipt, METHODS, TERMS, lineCents
} from './store.js';
import { renderPreview, paginate, printDoc, downloadPDF, pdfFile } from './document.js';
import { toast, openDialog, closeAllDialogs, confirmDialog, showMenu, closeMenu, showTip, hideTip, setFieldError, clearErrors, skeletonRows, dialogs } from './ui.js';
import { LOGO, MARK } from './brand.js';

/* =====================================================================
   Preferences & theme
   ===================================================================== */
let UI = readJSON(UIKEY, {}) || {};
const saveUI = () => writeJSON(UIKEY, UI);
const isPhone = () => mq('(max-width:767px)');
const isWide = () => mq('(min-width:1100px)');
const effectiveTheme = () => { const t = UI.theme || 'system'; return t === 'system' ? (mq('(prefers-color-scheme: dark)') ? 'dark' : 'light') : t; };
function applyTheme() {
  const dark = effectiveTheme() === 'dark';
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const meta = $('meta[name="theme-color"]'); if (meta) meta.content = dark ? '#0E0E10' : '#F7F7F8';
  $$('[data-act="toggle-theme"]').forEach(b => { b.innerHTML = ic(dark ? 'sun' : 'moon'); b.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme'); b.title = dark ? 'Light theme' : 'Dark theme'; });
  $$('[data-theme-opt]').forEach(b => b.classList.toggle('on', b.dataset.themeOpt === (UI.theme || 'system')));
}
function setTheme(t) { UI.theme = t; saveUI(); applyTheme(); if (current.name === 'reports') renderRoute(true); }
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if ((UI.theme || 'system') === 'system') applyTheme(); });

/* =====================================================================
   Shell: sidebar on desktop and tablet, bottom tabs on phones
   ===================================================================== */
const NAV_MAIN = [['dashboard', 'Home', 'home'], ['invoices', 'Invoices', 'invoice'], ['receipts', 'Receipts', 'receipt'], ['clients', 'Clients', 'users']];
const NAV_MORE = [['reports', 'Reports', 'chart'], ['items', 'Saved items', 'box']];
const navLink = ([k, l, i]) => `<a class="nav-link" href="#/${k}" data-nav="${k}" title="${l}">${ic(i)}<span class="nav-text">${l}</span><span class="count" data-count="${k}"></span></a>`;
function sidebarHTML() {
  return `
  <div class="sb-head">
    <img class="sb-logo brand-ink" src="${LOGO}" alt="Kuzelle">
    <img class="sb-mark brand-ink" src="${MARK}" alt="Kuzelle">
    <button class="icon-btn collapse-btn" data-act="collapse" aria-label="Collapse sidebar" title="Collapse sidebar">${ic('sidebar')}</button>
  </div>
  <div class="sb-scroll">
    <div class="sb-cta"><a class="btn btn-primary btn-block" href="#/invoices/new" title="New invoice">${ic('plus')}<span class="nav-text">New invoice</span></a></div>
    <div class="sb-group">${NAV_MAIN.map(navLink).join('')}</div>
    <div class="sb-group"><div class="sb-label">More</div>${NAV_MORE.map(navLink).join('')}</div>
    <div class="sb-group" style="margin-top:auto">${navLink(['settings', 'Settings', 'settings'])}</div>
  </div>
  <div class="sb-foot">
    <div class="sb-row">
      <button class="sync-pill" data-act="sync-now" data-sync><span class="sdot"></span><span class="stxt"></span></button>
      <button class="icon-btn" data-act="toggle-theme"></button>
    </div>
    <button class="account" data-act="account" aria-haspopup="menu">
      <span class="avatar" id="acct-av"></span>
      <span class="who"><b class="ellipsis" id="acct-name"></b><small>${MODE === 'cloud' ? 'Synced on all devices' : 'This device'}</small></span>
    </button>
  </div>`;
}
const TABS = [['dashboard', 'Home', 'home'], ['invoices', 'Invoices', 'invoice'], ['receipts', 'Receipts', 'receipt'], ['clients', 'Clients', 'users'], ['settings', 'Settings', 'settings']];
const tabbarHTML = () => TABS.map(([k, l, i]) => `<a class="tab-i" href="#/${k}" data-nav="${k}">${ic(i)}<span>${l}</span></a>`).join('');
function paintAccount() {
  const s = S();
  const av = $('#acct-av');
  if (av) av.innerHTML = s.logo && s.logo !== 'none' ? `<img src="${s.logo}" alt="">` : esc(initials(s.businessName));
  const n = $('#acct-name'); if (n) n.textContent = s.businessName || 'Kuzelle';
  const late = invoices().filter(d => invoiceStatus(d) === 'overdue').length;
  const c = $('[data-count="invoices"]'); if (c) c.textContent = late ? `${late} late` : '';
}
function paintSync() {
  const label = { synced: 'Saved', syncing: 'Saving…', offline: 'Offline, saved here', error: 'Not saved online', local: 'Saved on this device' }[MODE === 'cloud' ? syncState : 'local'] || '';
  $$('[data-sync]').forEach(el => {
    el.dataset.state = MODE === 'cloud' ? syncState : 'local';
    const t = $('.stxt', el); if (t) t.textContent = label;
    el.title = syncState === 'synced' && lastSync ? `Saved online at ${new Date(lastSync).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : label;
  });
}
function applySidebarMode() {
  const pref = UI.sidebar || (mq('(min-width:1200px)') ? 'expanded' : 'collapsed');
  $('#app').classList.toggle('collapsed', !isPhone() && pref === 'collapsed');
}
['(max-width:767px)', '(min-width:1200px)', '(min-width:1100px)'].forEach(q => matchMedia(q).addEventListener('change', () => { applySidebarMode(); if (!$('#app').hidden && !current.parts.includes('new') && !current.parts.includes('edit')) renderRoute(true); }));

/* topbar: breadcrumbs and search on desktop; back arrow and title on phones */
function setTopbar({ crumbs = [], actions = '', back = '', search = true, badge = '' } = {}) {
  const title = crumbs.length ? crumbs[crumbs.length - 1][0] : '';
  $('#topbar').innerHTML = `
    ${back ? `<a class="icon-btn back-btn" href="${back}" aria-label="Back">${ic('chevLeft')}</a>` : ''}
    <nav class="crumbs" aria-label="Breadcrumb">${crumbs.map((c, i) => {
      const last = i === crumbs.length - 1;
      return `${i ? `<span class="hide-sm">${ic('chevRight')}</span>` : ''}${last ? `<span class="cur">${esc(c[0])}</span>` : `<a class="hide-sm" href="${c[1]}">${esc(c[0])}</a>`}`;
    }).join('')}${badge}</nav>
    <div class="tb-actions">
      ${search ? `<div class="gsearch input-affix">${ic('search')}<input class="input" id="gsearch" type="search" placeholder="Search invoices, receipts, clients" autocomplete="off" aria-label="Search"><kbd>⌘K</kbd></div>
      <button class="icon-btn show-sm" data-act="search-mobile" aria-label="Search">${ic('search')}</button>` : ''}
      ${actions}
    </div>`;
  document.title = `${title || 'Kuzelle'} · Kuzelle`;
  bindGlobalSearch();
}

/* ---------- global search ---------- */
function searchResults(q) {
  q = q.trim().toLowerCase(); if (!q) return [];
  const hit = (...xs) => xs.filter(Boolean).join(' ').toLowerCase().includes(q);
  const inv = invoices().filter(d => hit(d.number, d.client && d.client.name)).sort(byDateDesc).slice(0, 5)
    .map(d => ({ href: `#/invoices/${d.id}`, icon: 'invoice', label: `${(d.client && d.client.name) || 'No client'}  ${d.number}`, sub: money(totals(d).total, d.currency) }));
  const rc = receipts().filter(d => hit(d.number, d.client && d.client.name, d.reference)).sort(byDateDesc).slice(0, 5)
    .map(d => ({ href: `#/receipts/${d.id}`, icon: 'receipt', label: `${(d.client && d.client.name) || ''}  ${d.number}`, sub: money(receiptAmount(d), d.currency) }));
  const cl = DB.clients.filter(c => hit(c.name, c.email, c.phone)).slice(0, 5)
    .map(c => ({ href: `#/clients/${c.id}`, icon: 'users', label: c.name, sub: c.phone || c.email || '' }));
  return [['Invoices', inv], ['Receipts', rc], ['Clients', cl]].filter(g => g[1].length);
}
function searchPopHTML(groups) {
  if (!groups.length) return `<div class="menu-label" style="padding:12px">Nothing found</div>`;
  return groups.map(([h, items]) => `<div class="menu-label">${h}</div>${items.map(it => `<a class="menu-item" href="${it.href}">${ic(it.icon)}<span class="ellipsis" style="flex:1">${esc(it.label)}</span><span class="muted nowrap">${esc(it.sub)}</span></a>`).join('')}`).join('');
}
function bindGlobalSearch() {
  const input = $('#gsearch'); if (!input) return;
  const wrap = input.parentElement; let pop = null;
  const close = () => { if (pop) { pop.remove(); pop = null; } };
  const render = () => {
    if (!input.value.trim()) { close(); return; }
    if (!pop) { pop = document.createElement('div'); pop.className = 'search-pop'; wrap.appendChild(pop); }
    pop.innerHTML = searchPopHTML(searchResults(input.value));
  };
  input.addEventListener('input', render);
  input.addEventListener('focus', render);
  input.addEventListener('blur', () => setTimeout(close, 150));
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') { input.value = ''; close(); input.blur(); }
    if (e.key === 'Enter') { const a = pop && $('a', pop); if (a) { location.hash = a.getAttribute('href'); input.value = ''; close(); input.blur(); } }
  });
  wrap.addEventListener('mousedown', e => { if (e.target.closest('a')) e.preventDefault(); });
  wrap.addEventListener('click', e => { const a = e.target.closest('a'); if (a) { location.hash = a.getAttribute('href'); input.value = ''; close(); } });
}
function openMobileSearch() {
  const d = openDialog({
    title: 'Search', full: true,
    body: `<div class="input-affix">${ic('search')}<input class="input" id="msearch" type="search" placeholder="Name, invoice or receipt number" autocomplete="off"></div><div id="mres" style="margin-top:12px"></div>`,
    onMount(b) {
      const i = $('#msearch', b);
      i.addEventListener('input', () => { $('#mres', b).innerHTML = i.value.trim() ? searchPopHTML(searchResults(i.value)) : ''; });
      b.addEventListener('click', e => { if (e.target.closest('a')) d.close(); });
      setTimeout(() => i.focus(), 280);
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
  if (!parts.length || parts[0] === 'home') return { name: 'dashboard', parts: [], query };
  if (parts[0] === 'documents') return { name: 'invoices', parts: [], query };
  if (parts[0] === 'products') return { name: 'items', parts: [], query };
  if (parts[0] === 'new') return { name: parts[1] === 'receipt' ? 'receipts' : 'invoices', parts: ['new'], query };
  if (parts[0] === 'edit') { const d = findDoc(parts[1]); return { name: d && d.type === 'receipt' ? 'receipts' : 'invoices', parts: [parts[1], 'edit'], query }; }
  return { name: parts[0], parts: parts.slice(1), query };
}
const go = h => { if (location.hash === h) renderRoute(); else location.hash = h; };
addEventListener('hashchange', async () => {
  if (dirty) {
    const target = location.hash;
    history.replaceState(null, '', lastHash || '#/dashboard');
    if (!(await confirmDialog({ title: 'Leave without saving?', message: 'What you’ve entered on this screen will be lost.', ok: 'Leave', cancel: 'Keep editing', danger: true }))) return;
    dirty = false;
    location.hash = target;
    return;
  }
  renderRoute();
});
addEventListener('beforeunload', e => { if (dirty || (MODE === 'cloud' && pendingCount() && navigator.onLine)) { e.preventDefault(); e.returnValue = ''; } });

const ROUTES = {
  dashboard: () => viewHome(),
  invoices: ({ parts }) => parts[0] === 'new' ? viewInvoiceEditor(null) : parts[1] === 'edit' ? viewInvoiceEditor(parts[0]) : parts[0] ? viewInvoice(parts[0]) : viewInvoices(),
  receipts: ({ parts, query }) => parts[0] === 'new' ? viewReceiptEditor(null, query) : parts[1] === 'edit' ? viewReceiptEditor(parts[0]) : parts[0] ? viewReceipt(parts[0]) : viewReceipts(),
  clients: ({ parts }) => parts[0] ? viewClient(parts[0]) : viewClients(),
  items: () => viewItems(),
  reports: () => viewReports(),
  settings: ({ parts }) => viewSettings(parts[0] || '')
};
function renderRoute(keep) {
  const r = parseHash();
  if (!ROUTES[r.name]) { location.replace('#/dashboard'); return; }
  const sameView = keep && r.name === current.name && r.parts.join('/') === current.parts.join('/');
  current = r; lastHash = location.hash;
  if (!keep) { closeAllDialogs(); closeMenu(); dirty = false; }
  const editing = r.parts.includes('new') || r.parts.includes('edit');
  document.body.classList.toggle('editing', editing);
  $$('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === (r.name === 'items' && isPhone() ? 'settings' : r.name)));
  const y = scrollY;
  const view = ROUTES[r.name](r);
  if (!view) return;
  setTopbar(view.topbar);
  $('#view').innerHTML = view.html;
  view.mount && view.mount($('#view'));
  applyTheme(); paintSync(); paintAccount();
  if (sameView) scrollTo(0, y); else scrollTo(0, 0);
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
  resolve(await confirmDialog({ title: 'Move your records online?', message: `This device has ${plural(counts.docs, 'document')} and ${plural(counts.clients, 'client')} that aren’t online yet. Upload them so every device sees the same records.`, ok: 'Upload', cancel: 'Start fresh' }));
});
let waitingForFirstSync = false;
const loadingData = () => MODE === 'cloud' && !firstSyncDone && !DB.docs.length && !DB.clients.length;

/* =====================================================================
   Shared renderers
   ===================================================================== */
const badge = d => { const s = docStatus(d); return `<span class="badge ${s}">${STATUS[s]}</span>`; };
const clientName = d => (d.client && d.client.name) || 'No client';
const emptyHTML = (icon, title, text, btn = '') => `<div class="empty"><div class="e-ic">${ic(icon)}</div><h3>${esc(title)}</h3><p>${esc(text)}</p>${btn}</div>`;
const pageHead = (title, sub, actions = '') => `<div class="page-head"><div><h1>${esc(title)}</h1>${sub ? `<p>${sub}</p>` : ''}</div>${actions ? `<div class="page-actions">${actions}</div>` : ''}</div>`;
const notFound = (kind, back) => ({ topbar: { crumbs: [[kind]], back }, html: `<div class="content">${emptyHTML('alert', `${kind} not found`, 'It may have been deleted on another device.', `<a class="btn btn-secondary" href="${back}">Go back</a>`)}</div>` });
function sortBy(arr, key, dir, get) { const m = dir === 'asc' ? 1 : -1; return [...arr].sort((a, b) => { const x = get(a, key), y = get(b, key); return (x > y ? 1 : x < y ? -1 : 0) * m || byDateDesc(a, b); }); }
/* One row type for every list: readable on a phone, aligned on a desktop. */
function docRow(d) {
  const isR = d.type === 'receipt', st = docStatus(d);
  const amt = isR ? receiptAmount(d) : totals(d).total, b = !isR && balances(d);
  const sub = isR ? `${d.number}, ${fmtShort(d.issueDate)}${d.paymentMethod ? ', ' + d.paymentMethod : ''}`
    : st === 'paid' || st === 'cancelled' || st === 'draft' ? `${d.number}, ${fmtShort(d.issueDate)}`
    : st === 'overdue' ? `${d.number}, was due ${fmtShort(d.dueDate)}` : `${d.number}, due ${fmtShort(d.dueDate)}`;
  return `<a class="row" href="#/${isR ? 'receipts' : 'invoices'}/${d.id}">
    <span class="row-ic">${ic(isR ? 'receipt' : 'invoice')}</span>
    <span class="row-main"><span class="row-t">${esc(clientName(d))}</span><span class="row-s ${st === 'overdue' ? 'late' : ''}">${esc(sub)}</span></span>
    <span class="row-end"><span class="row-amt" ${isR && isVoid(d) ? 'style="text-decoration:line-through;color:var(--text-3)"' : ''}>${esc(money(amt, d.currency))}</span>
      ${isR ? (isVoid(d) ? badge(d) : '') : b.paidCents && b.balanceCents ? `<span class="row-s">${esc(money(b.balance, d.currency))} left</span>` : badge(d)}</span>
  </a>`;
}
const rowsHTML = list => `<div class="rows">${list.map(docRow).join('')}</div>`;
const skeletonList = (n = 5) => `<div class="rows">${Array.from({ length: n }, () => `<div class="row"><span class="row-ic"></span><span class="row-main"><span class="sk" style="width:55%"></span><span class="sk" style="width:35%;margin-top:6px"></span></span><span class="sk" style="width:70px"></span></div>`).join('')}</div>`;

/* =====================================================================
   Charts (used by Reports)
   ===================================================================== */
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
   Home: what have I received, what am I owed, what needs attention
   ===================================================================== */
function viewHome() {
  const s = S(), cur = s.currency, loading = loadingData();
  if (loading) waitingForFirstSync = true;
  const month = aggregate(periodRange('this-month'), cur), all = aggregate(periodRange('all'), cur);
  const today = todayISO(), soon = addDays(today, 7);
  const late = all.overdueList.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const dueSoon = invoices().filter(d => countsAsIssued(d) && d.currency === cur && balances(d).balanceCents > 0 && d.dueDate >= today && d.dueDate <= soon).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const attention = [...late, ...dueSoon].slice(0, 5);
  const tab = UI.homeTab || 'invoices';
  const recent = (tab === 'invoices' ? invoices() : receipts()).sort(byDateDesc).slice(0, 5);
  const hr = new Date().getHours();
  const greet = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  const fig = v => loading ? '<span class="sk" style="height:26px;width:60%"></span>' : moneyHTML(v, cur);
  return {
    topbar: { crumbs: [['Home']] },
    html: `<div class="content narrow-content">
      <div class="home-hello"><h1>${greet}</h1><p>${esc(new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }))}</p></div>
      <section class="stats" aria-label="Summary">
        <a class="stat" href="#/receipts"><span class="stat-l">Money received</span><span class="stat-v num">${fig(month.received)}</span><span class="stat-s">This month</span></a>
        <button class="stat" data-act="goto-filter" data-f="open"><span class="stat-l">Still owed</span><span class="stat-v num">${fig(all.outstanding)}</span><span class="stat-s">${plural(all.openCount, 'unpaid invoice')}</span></button>
        <button class="stat ${late.length ? 'alert' : ''}" data-act="goto-filter" data-f="overdue"><span class="stat-l">Late payments</span><span class="stat-v num">${fig(all.overdue)}</span><span class="stat-s">${late.length ? `${plural(late.length, 'invoice')} past due` : 'Nothing late'}</span></button>
      </section>
      <div class="home-actions">
        <a class="btn btn-primary btn-lg" href="#/invoices/new">${ic('plus')}Create invoice</a>
        <a class="btn btn-secondary btn-lg" href="#/receipts/new">${ic('receipt')}Create receipt</a>
      </div>
      ${attention.length ? `<section class="sec"><div class="sec-h"><h2>Needs your attention</h2></div>
        <div class="rows">${attention.map(d => {
          const days = daysBetween(d.dueDate, today), isLate = days > 0;
          return `<a class="row" href="#/invoices/${d.id}"><span class="row-ic ${isLate ? 'late' : ''}">${ic(isLate ? 'alert' : 'calendar')}</span>
            <span class="row-main"><span class="row-t">${esc(clientName(d))}</span><span class="row-s ${isLate ? 'late' : ''}">${isLate ? `${plural(days, 'day')} late` : days === 0 ? 'Due today' : `Due in ${plural(-days, 'day')}`}, ${esc(d.number)}</span></span>
            <span class="row-end"><span class="row-amt">${esc(money(balances(d).balance, d.currency))}</span><span class="row-s">still owed</span></span></a>`; }).join('')}</div></section>` : ''}
      <section class="sec">
        <div class="sec-h"><div class="seg">${[['invoices', 'Recent invoices'], ['receipts', 'Recent receipts']].map(([k, l]) => `<button data-act="home-tab" data-k="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div><a class="link" href="#/${tab}">See all</a></div>
        ${loading ? skeletonList() : recent.length ? rowsHTML(recent)
          : tab === 'invoices' ? emptyHTML('invoice', 'No invoices yet', 'Your first invoice takes about a minute: pick a client, add what you’re charging for, done.', '<a class="btn btn-primary" href="#/invoices/new">Create invoice</a>')
          : emptyHTML('receipt', 'No receipts yet', 'When a client pays you, record it here and they get a receipt.', '<a class="btn btn-secondary" href="#/receipts/new">Create receipt</a>')}
      </section>
      <a class="quiet-link" href="#/reports">${ic('chart')}See reports and trends</a>
    </div>`
  };
}

/* =====================================================================
   Invoices list: search, three simple filters, the rest in a sheet
   ===================================================================== */
const LS = {
  invoices: { q: '', status: 'all', period: 'all', from: '', to: '', sort: 'issueDate', dir: 'desc', limit: 30 },
  receipts: { q: '', client: '', period: 'all', from: '', to: '', sort: 'issueDate', dir: 'desc', limit: 30 },
  clients: { q: '' }
};
const QUICK = [['all', 'All'], ['open', 'Unpaid'], ['overdue', 'Late'], ['paid', 'Paid']];
const ALL_STATUS = [['all', 'All invoices'], ['open', 'Unpaid (anything still owed)'], ['overdue', 'Late'], ['partial', 'Part paid'], ['paid', 'Paid'], ['draft', 'Drafts'], ['cancelled', 'Cancelled']];
const PERIODS = [['all', 'Any date'], ['this-month', 'This month'], ['last-month', 'Last month'], ['last-90', 'Last 90 days'], ['this-year', 'This year'], ['custom', 'Choose dates']];
function invMatches(d, f) {
  const s = invoiceStatus(d);
  if (f === 'all') return true;
  if (f === 'open') return countsAsIssued(d) && s !== 'paid';
  return s === f;
}
function filteredInvoices() {
  const st = LS.invoices, q = st.q.trim().toLowerCase(), range = periodRange(st.period, st);
  const list = invoices().filter(d => invMatches(d, st.status) && (st.period === 'all' || inRange(d.issueDate, range))
    && (!q || [d.number, d.client && d.client.name, d.client && d.client.phone, ...(d.items || []).map(i => i.desc)].join(' ').toLowerCase().includes(q)));
  return sortBy(list, st.sort, st.dir, (d, k) => k === 'amount' ? totals(d).totalCents : k === 'client' ? clientName(d).toLowerCase() : d[k] || '');
}
const extraFilters = st => (st.period !== 'all' ? 1 : 0) + (st.sort !== 'issueDate' || st.dir !== 'desc' ? 1 : 0) + (st.client ? 1 : 0) + (st.status && !QUICK.some(q => q[0] === st.status) ? 1 : 0);
function listBodyHTML(kind) {
  if (loadingData()) return skeletonList(8);
  const st = LS[kind];
  const all = kind === 'invoices' ? invoices() : receipts();
  if (!all.length) return kind === 'invoices'
    ? emptyHTML('invoice', 'No invoices yet', 'Create one and it will appear here with its payment status.', '<a class="btn btn-primary" href="#/invoices/new">Create invoice</a>')
    : emptyHTML('receipt', 'No receipts yet', 'Record a payment to create a receipt.', '<a class="btn btn-primary" href="#/receipts/new">Create receipt</a>');
  const list = kind === 'invoices' ? filteredInvoices() : filteredReceipts();
  if (!list.length) return emptyHTML('search', 'Nothing matches', 'Try another name or number, or clear the filters.', `<button class="btn btn-secondary" data-act="clear-filters" data-list="${kind}">Clear filters</button>`);
  const shown = list.slice(0, st.limit);
  let total = '';
  if (kind === 'receipts') { const c = list.filter(r => !isVoid(r) && r.currency === S().currency).reduce((a, r) => a + receiptCents(r), 0); total = `, ${money(fromCents(c), S().currency)} received`; }
  return `<div class="list-meta">${plural(list.length, kind === 'invoices' ? 'invoice' : 'receipt')}${esc(total)}</div>${rowsHTML(shown)}
    ${list.length > shown.length ? `<button class="btn btn-secondary btn-block" style="margin-top:12px" data-act="more-rows" data-list="${kind}">Show more</button>` : ''}`;
}
function listToolbar(kind) {
  const st = LS[kind], n = extraFilters(st);
  return `<div class="list-tools">
    <div class="input-affix grow">${ic('search')}<input class="input" id="list-q" data-list="${kind}" type="search" placeholder="${kind === 'invoices' ? 'Search name or invoice number' : 'Search name, number or reference'}" value="${esc(st.q)}" autocomplete="off"></div>
    <button class="btn btn-secondary filter-btn" data-act="filters" data-list="${kind}">${ic('filter')}<span class="hide-xs">Filters</span>${n ? `<span class="fcount">${n}</span>` : ''}</button>
  </div>
  ${kind === 'invoices' ? `<div class="quick" role="tablist">${QUICK.map(([k, l]) => `<button class="chip${st.status === k ? ' on' : ''}" data-act="inv-status" data-k="${k}">${l}</button>`).join('')}</div>` : ''}`;
}
function viewInvoices() {
  return {
    topbar: { crumbs: [['Invoices']], actions: `<a class="btn btn-primary btn-sm hide-sm" href="#/invoices/new">${ic('plus')}New invoice</a>` },
    html: `<div class="content narrow-content">
      ${pageHead('Invoices', '', `<a class="btn btn-primary" href="#/invoices/new">${ic('plus')}New invoice</a>`)}
      ${listToolbar('invoices')}
      <div id="list-body">${listBodyHTML('invoices')}</div>
    </div><a class="btn btn-primary fab" href="#/invoices/new">${ic('plus')}New invoice</a>`,
    mount: bindListSearch
  };
}
function bindListSearch(el) {
  const q = $('#list-q', el);
  if (q) q.addEventListener('input', debounce(() => { const st = LS[q.dataset.list]; st.q = q.value; st.limit = 30; $('#list-body').innerHTML = q.dataset.list === 'clients' ? clientListHTML() : listBodyHTML(q.dataset.list); }, 120));
}
function openFilters(kind) {
  const st = LS[kind];
  const sorts = kind === 'invoices' ? [['issueDate:desc', 'Newest first'], ['issueDate:asc', 'Oldest first'], ['dueDate:asc', 'Due date, soonest first'], ['amount:desc', 'Largest amount'], ['client:asc', 'Client name, A to Z']]
    : [['issueDate:desc', 'Newest first'], ['issueDate:asc', 'Oldest first'], ['amount:desc', 'Largest amount'], ['client:asc', 'Client name, A to Z']];
  const opt = (arr, v) => arr.map(([k, l]) => `<option value="${k}"${k === v ? ' selected' : ''}>${esc(l)}</option>`).join('');
  const dlg = openDialog({
    title: 'Filters', width: 440,
    body: `<div class="form-stack">
      ${kind === 'invoices' ? `<div class="field"><label for="ff-s">Show</label><select class="input" id="ff-s">${opt(ALL_STATUS, st.status)}</select></div>`
        : `<div class="field"><label for="ff-c">Client</label><select class="input" id="ff-c"><option value="">All clients</option>${[...DB.clients].sort((a, b) => a.name.localeCompare(b.name)).map(c => `<option value="${c.id}"${st.client === c.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>`}
      <div class="field"><label for="ff-p">Date</label><select class="input" id="ff-p">${opt(PERIODS, st.period)}</select></div>
      <div class="grid-2" id="ff-range" ${st.period === 'custom' ? '' : 'hidden'}><div class="field"><label for="ff-f">From</label><input class="input" type="date" id="ff-f" value="${esc(st.from)}"></div><div class="field"><label for="ff-t">To</label><input class="input" type="date" id="ff-t" value="${esc(st.to)}"></div></div>
      <div class="field"><label for="ff-o">Order</label><select class="input" id="ff-o">${opt(sorts, `${st.sort}:${st.dir}`)}</select></div>
    </div>`,
    foot: `<button class="btn btn-ghost" data-ff="reset">Reset</button><button class="btn btn-primary" data-ff="apply">Show results</button>`,
    onMount(b) {
      $('#ff-p', b).addEventListener('change', e => { $('#ff-range', b).hidden = e.target.value !== 'custom'; });
      b.addEventListener('click', e => {
        const t = e.target.closest('[data-ff]'); if (!t) return;
        if (t.dataset.ff === 'reset') Object.assign(st, { status: 'all', client: '', period: 'all', from: '', to: '', sort: 'issueDate', dir: 'desc' });
        else {
          if ($('#ff-s', b)) st.status = $('#ff-s', b).value;
          if ($('#ff-c', b)) st.client = $('#ff-c', b).value;
          st.period = $('#ff-p', b).value; st.from = $('#ff-f', b).value; st.to = $('#ff-t', b).value;
          [st.sort, st.dir] = $('#ff-o', b).value.split(':');
        }
        st.limit = 30; dlg.close(); renderRoute(true);
      });
    }
  });
}

/* ---------- invoice detail: summary first, document one tap away on phones ---------- */
function viewInvoice(id) {
  const d = findDoc(id);
  if (!d || d.type !== 'invoice') return notFound('Invoice', '#/invoices');
  const b = balances(d), st = invoiceStatus(d), pays = receipts().filter(r => r.linkedInvoiceId === d.id).sort((a, c) => (a.issueDate || '').localeCompare(c.issueDate || ''));
  const pct = b.totalCents ? Math.min(100, Math.round(b.paidCents / b.totalCents * 100)) : 0;
  const canPay = countsAsIssued(d) && b.balanceCents > 0;
  const lateDays = st === 'overdue' ? daysBetween(d.dueDate, todayISO()) : 0;
  const termsLabel = (TERMS.find(t => t[0] === String(d.terms)) || [])[1];
  return {
    topbar: { crumbs: [['Invoices', '#/invoices'], [d.number]], back: '#/invoices', actions: `<button class="icon-btn" data-act="doc-menu" data-id="${d.id}" data-detail="1" aria-label="More actions">${ic('more')}</button>` },
    html: `<div class="detail">
      <div class="workspace ws-scroll hide-sm-block"><div class="ws-bar"><span>${esc(STATUS[st])} invoice</span><span id="pg-count"></span></div><div id="preview" style="max-width:820px;margin:0 auto"></div></div>
      <aside class="side" aria-label="Invoice summary">
        <div class="side-sec summary">
          <div class="sum-top"><a class="sum-client" href="${d.clientId ? '#/clients/' + d.clientId : '#/clients'}">${esc(clientName(d))}</a>${badge(d)}</div>
          <div class="big-amt num"><span class="cur">${esc(d.currency)}</span>${esc(plainAmount(b.total))}</div>
          ${countsAsIssued(d) ? `<div class="progress" aria-label="${pct}% paid"><i style="width:${pct}%"></i></div>
            <div class="sum-line"><span>${b.paidCents ? `${esc(money(b.paid, d.currency))} paid` : 'Nothing paid yet'}</span><b ${lateDays ? 'style="color:var(--red)"' : ''}>${b.balanceCents ? `${esc(money(b.balance, d.currency))} still owed` : 'Fully paid'}</b></div>
            <div class="sum-due ${lateDays ? 'late' : ''}">${st === 'paid' ? `Paid in full` : lateDays ? `${plural(lateDays, 'day')} late, was due ${esc(fmtDate(d.dueDate))}` : `Due ${esc(fmtDate(d.dueDate))}`}</div>`
          : d.status === 'draft' ? '<div class="sum-due">Draft. Not counted until you finish it.</div>' : '<div class="sum-due">Cancelled. Not counted as money owed.</div>'}
        </div>
        <div class="side-sec actions-sec">
          ${d.status === 'draft' && !d.cancelledAt ? `<button class="btn btn-primary btn-lg btn-block" data-act="finalize" data-id="${d.id}">${ic('check')}Finish invoice</button>` : ''}
          ${canPay ? `<a class="btn btn-primary btn-lg btn-block" href="#/receipts/new?invoice=${d.id}">${ic('wallet')}Record a payment</a>` : ''}
          <div class="act-row">
            <button class="act" data-act="share" data-id="${d.id}">${ic('share')}Send</button>
            <button class="act" data-act="dl" data-id="${d.id}">${ic('download')}PDF</button>
            <button class="act show-sm-flex" data-act="view-doc" data-id="${d.id}">${ic('eye')}View</button>
            <button class="act hide-sm-flex" data-act="print" data-id="${d.id}">${ic('print')}Print</button>
            <a class="act" href="#/invoices/${d.id}/edit">${ic('edit')}Edit</a>
          </div>
        </div>
        <div class="side-sec">
          <div class="sec-h" style="margin:0 0 8px"><h3>Payments</h3>${canPay ? `<a class="link" href="#/receipts/new?invoice=${d.id}">Add</a>` : ''}</div>
          ${pays.length ? `<div class="timeline">${pays.map(r => `<a class="tl-item${isVoid(r) ? ' void' : ''}" href="#/receipts/${r.id}"><span class="tl-dot"></span><div><b>${esc(money(receiptAmount(r), r.currency))}</b><small>${esc(fmtDate(r.issueDate))}, ${esc(r.paymentMethod || '')}${isVoid(r) ? ', void' : ''}</small></div><span class="muted">${esc(r.number)}</span></a>`).join('')}</div>`
            : `<p class="muted small">${d.status === 'paid' ? 'Marked as paid in the earlier version, without a receipt.' : 'No payments yet.'}</p>`}
        </div>
        <details class="side-sec disclosure">
          <summary>Invoice details</summary>
          <div class="kv"><span>Number</span><b>${esc(d.number)}</b></div>
          <div class="kv"><span>Issued</span><b>${esc(fmtDate(d.issueDate))}</b></div>
          <div class="kv"><span>Due</span><b>${esc(fmtDate(d.dueDate))}</b></div>
          ${termsLabel && d.terms !== 'custom' ? `<div class="kv"><span>Payment terms</span><b>${esc(termsLabel)}</b></div>` : ''}
          <div class="kv"><span>Currency</span><b>${esc(d.currency)}</b></div>
          ${d.sentAt ? `<div class="kv"><span>Sent</span><b>${esc(fmtDate(d.sentAt.slice(0, 10)))}</b></div>` : ''}
          ${d.cancelledAt ? `<div class="kv"><span>Cancelled</span><b>${esc(fmtDate(d.cancelledAt.slice(0, 10)))}</b></div>` : ''}
        </details>
      </aside>
    </div>`,
    mount(el) { const p = $('#preview', el); if (p && isWide()) { const n = renderPreview(p, d); $('#pg-count', el).textContent = plural(n, 'page'); } else if (p && !isPhone()) { const n = renderPreview(p, d); $('#pg-count', el).textContent = plural(n, 'page'); } }
  };
}
/* Full-screen document view, used on phones and from the editors */
function openDocView(d, { title, footer } = {}) {
  const dlg = openDialog({
    title: esc(title || `${d.type === 'receipt' ? 'Receipt' : 'Invoice'} ${d.number || ''}`), full: true, width: 900, cls: 'doc-view',
    body: `<div class="workspace doc-ws"><div id="dv-preview"></div></div>`,
    foot: footer === undefined ? `<button class="btn btn-secondary" data-act="dl" data-id="${d.id}">${ic('download')}PDF</button><button class="btn btn-primary" data-act="share" data-id="${d.id}">${ic('share')}Send</button>` : footer,
    onMount(b) { requestAnimationFrame(() => renderPreview($('#dv-preview', b), d)); }
  });
  return dlg;
}

/* =====================================================================
   Document actions
   ===================================================================== */
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
   Client picker: a focused sheet, never a wall of fields
   ===================================================================== */
const blankClient = () => ({ name: '', email: '', phone: '', address: '' });
const snap = c => ({ name: c.name, email: c.email || '', phone: c.phone || '', address: c.address || '' });
function clientRowHTML(d, label = 'Select a client', hint = 'Choose someone you’ve billed before, or add someone new') {
  const c = d.client || {};
  if (!c.name) return `<button class="pick-row empty" data-act="pick-client" type="button"><span class="pr-main"><b>${label}</b><small>${hint}</small></span>${ic('chevRight')}</button>`;
  return `<button class="pick-row" data-act="pick-client" type="button"><span class="avatar">${esc(initials(c.name))}</span><span class="pr-main"><b>${esc(c.name)}</b><small>${esc([c.phone, c.email].filter(Boolean).join('  ') || 'No contact details')}</small></span><span class="pr-change">Change</span></button>`;
}
function pickClient(onPick) {
  let mode = 'list', q = '';
  const dlg = openDialog({
    title: 'Select a client', full: true, width: 520,
    body: `<div id="pc"></div>`,
    onMount(b) { render(b); }
  });
  function render(b = dlg.body) {
    const box = $('#pc', b); if (!box) return;
    if (mode === 'list') {
      const nq = q.toLowerCase();
      const list = DB.clients.filter(c => !nq || [c.name, c.phone, c.email].join(' ').toLowerCase().includes(nq)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 40);
      box.innerHTML = `<div class="input-affix">${ic('search')}<input class="input" id="pc-q" type="search" placeholder="Search by name or phone" value="${esc(q)}" autocomplete="off"></div>
        <button class="pick-row add" data-pc="new" type="button"><span class="pr-plus">${ic('plus')}</span><span class="pr-main"><b>${q ? `Add “${esc(q)}” as a new client` : 'Add a new client'}</b></span></button>
        ${list.length ? `<div class="pick-label">${q ? 'Matches' : 'Your clients'}</div><div class="pick-list">${list.map(c => `<button class="pick-row" data-pc="${c.id}" type="button"><span class="avatar">${esc(initials(c.name))}</span><span class="pr-main"><b>${esc(c.name)}</b><small>${esc(c.phone || c.email || 'No contact details')}</small></span></button>`).join('')}</div>`
          : q ? '' : '<p class="muted small" style="margin:16px 4px">No clients yet. Add your first one above.</p>'}`;
      const i = $('#pc-q', box);
      i.addEventListener('input', () => { q = i.value; const pos = i.selectionStart; render(); const n = $('#pc-q'); n.focus(); n.setSelectionRange(pos, pos); });
      if (!isPhone()) setTimeout(() => i.focus(), 60);
    } else {
      box.innerHTML = `<div class="form-stack">
        <div class="field"><label for="nc-name">Name</label><input class="input" id="nc-name" value="${esc(q)}" placeholder="Person or business name" autocomplete="off"><div class="err"></div></div>
        <div class="field"><label for="nc-phone">Phone number</label><input class="input" id="nc-phone" inputmode="tel" placeholder="Optional"></div>
        <details class="disclosure inline"><summary>Add email and address</summary><div class="form-stack" style="margin-top:12px">
          <div class="field"><label for="nc-email">Email</label><input class="input" id="nc-email" type="email" placeholder="Optional"></div>
          <div class="field"><label for="nc-addr">Address</label><textarea class="input" id="nc-addr" rows="2" placeholder="Optional"></textarea></div></div></details>
        <div class="sheet-actions"><button class="btn btn-secondary" data-pc="back" type="button">Back</button><button class="btn btn-primary" data-pc="save" type="button">Add client</button></div></div>`;
      setTimeout(() => $('#nc-name', box).focus(), 60);
    }
  }
  dlg.body.addEventListener('click', async e => {
    const t = e.target.closest('[data-pc]'); if (!t) return;
    const k = t.dataset.pc;
    if (k === 'new') { mode = 'new'; render(); return; }
    if (k === 'back') { mode = 'list'; render(); return; }
    if (k === 'save') {
      const rec = { id: uid(), createdAt: Date.now(), notes: '', name: $('#nc-name').value.trim(), phone: $('#nc-phone').value.trim(), email: $('#nc-email').value.trim(), address: $('#nc-addr').value.trim() };
      if (!rec.name) { setFieldError($('#nc-name'), 'Add a name'); $('#nc-name').focus(); return; }
      const dup = findDuplicateClient(rec);
      if (dup && await confirmDialog({ title: `${dup.name} is already a client`, message: 'Use the existing client instead of adding a duplicate?', ok: `Use ${dup.name}`, cancel: 'Add new anyway' })) { dlg.close(); onPick(dup); return; }
      putClient(rec); dlg.close(); onPick(rec); return;
    }
    const c = findClient(k); if (c) { dlg.close(); onPick(c); }
  });
}

/* =====================================================================
   Invoice editor. Three things: client, items, total. Everything else
   comes from Settings and lives behind "Customize invoice".
   ===================================================================== */
let draft = null;
function viewInvoiceEditor(id) {
  const isNew = !id;
  if (id) {
    const d = findDoc(id);
    if (!d || d.type !== 'invoice') return notFound('Invoice', '#/invoices');
    draft = JSON.parse(JSON.stringify(d));
    draft.items = (draft.items || []).filter(i => String(i.desc || '').trim() || num(i.price));
    draft.items.forEach(i => { if (!i.id) i.id = uid(); });
    if (draft.terms === undefined) draft.terms = 'custom';
    if (draft.discountType === undefined) draft.discountType = 'amt';
    if (draft.showPayment === undefined) draft.showPayment = true;
    if (draft.status === 'unpaid') draft.status = 'issued';
  } else {
    const client = current.query.client && findClient(current.query.client);
    draft = pendingDraft || newInvoice(client);
    pendingDraft = null;
    draft.items = draft.items.filter(i => String(i.desc || '').trim() || num(i.price));
    draft._planned = draft.number;
  }
  draft._isNew = isNew;
  const isDraft = isNew || draft.status === 'draft';
  const title = isNew ? 'New invoice' : `Edit ${draft.number}`;
  return {
    topbar: {
      crumbs: [['Invoices', '#/invoices'], [title]], back: isNew ? '#/invoices' : `#/invoices/${draft.id}`, search: false,
      badge: isDraft ? '<span class="badge draft tb-badge">Draft</span>' : '',
      actions: `${isDraft ? `<button class="btn btn-ghost btn-sm hide-sm" data-act="inv-save" data-mode="draft">Save as draft</button>` : ''}
        <button class="btn btn-primary btn-sm hide-sm" data-act="inv-save" data-mode="final">${isDraft ? 'Create invoice' : 'Save changes'}</button>`
    },
    html: `<div class="ed2" id="editor">
      <div class="ed2-main"><div class="ed2-inner">
        <section class="blk"><div class="blk-label">Client</div><div id="client-slot">${clientRowHTML(draft)}</div></section>
        <section class="blk"><div class="blk-label">Items</div><div id="item-list"></div>
          <button class="add-dashed" data-act="item-add" type="button">${ic('plus')}Add item</button></section>
        <section class="blk sum" id="sum"></section>
        <button class="btn btn-primary btn-lg btn-block main-cta" data-act="inv-save" data-mode="final">${isDraft ? 'Create invoice' : 'Save changes'}</button>
        <p class="fine" id="auto-note"></p>
        <div class="ed2-links">
          <button class="link" data-act="ed-options" type="button">${ic('settings')}Customize invoice</button>
          <button class="link lt-wide" data-act="ed-preview" type="button">${ic('eye')}Preview</button>
          ${isDraft ? `<button class="link" data-act="inv-save" data-mode="draft" type="button">${ic('file')}Save as draft</button>` : ''}
        </div>
      </div></div>
      <div class="ed2-preview workspace"><div class="ws-bar"><span>Preview</span><span id="pg-count"></span></div><div id="preview" style="max-width:820px;margin:0 auto"></div></div>
    </div>`,
    mount() { renderItemList(); refreshInvoice(); }
  };
}
function renderItemList() {
  const box = $('#item-list'); if (!box) return;
  box.innerHTML = draft.items.length ? `<div class="item-cards">${draft.items.map(it => `<button class="item-card" type="button" data-act="item-edit" data-id="${it.id}">
      <span class="ic-main"><b>${esc(String(it.desc).split('\n')[0] || 'Untitled item')}</b><small>Qty ${esc(num(it.qty))} × ${esc(money(num(it.price), draft.currency))}</small></span>
      <span class="ic-amt">${esc(money(fromCents(lineCents(it)), draft.currency))}</span></button>`).join('')}</div>` : '';
}
let pvRaf = 0;
function refreshInvoice() {
  if (!draft) return;
  const t = totals(draft), cur = draft.currency, s = S();
  const orig = !draft._isNew && findDoc(draft.id), paid = orig ? balances(orig).paid : 0;
  const locked = paid > 0;
  $('#sum').innerHTML = `
    <div class="sum-row"><span>Currency</span>${locked ? `<b>${esc(cur)}</b>` : `<label class="cur-pick"><select data-act-change="currency" aria-label="Currency">${CURRENCIES.map(([c, n]) => `<option value="${c}"${c === cur ? ' selected' : ''}>${c}</option>`).join('')}</select>${ic('chevDown')}</label>`}</div>
    <div class="sum-row"><span>Subtotal</span><span class="num">${esc(money(t.sub, cur))}</span></div>
    ${t.disc ? `<div class="sum-row"><span>Discount${draft.discountType === 'pct' ? ` (${esc(num(draft.discount))}%)` : ''}</span><span class="num">−${esc(money(t.disc, cur))}</span></div>` : ''}
    ${t.tax ? `<div class="sum-row"><span>${esc((draft.biz && draft.biz.taxLabel) || s.taxLabel || 'Tax')} (${esc(num(draft.taxRate))}%)</span><span class="num">${esc(money(t.tax, cur))}</span></div>` : ''}
    <div class="sum-row total"><span>Total</span><b class="num">${esc(money(t.total, cur))}</b></div>
    ${paid ? `<div class="sum-row"><span>Already paid</span><span class="num">−${esc(money(paid, cur))}</span></div><div class="sum-row"><span>Still owed</span><b class="num">${esc(money(Math.max(0, t.total - paid), cur))}</b></div>` : ''}`;
  const sel = $('#sum select'); if (sel) sel.onchange = () => { draft.currency = sel.value; dirty = true; renderItemList(); refreshInvoice(); };
  const days = draft.terms !== 'custom' && draft.terms !== undefined ? num(draft.terms) : daysBetween(draft.issueDate, draft.dueDate);
  $('#auto-note').innerHTML = draft._isNew
    ? `Number ${esc(draft._numberCustom ? draft.number : nextNumber('invoice'))}, due ${esc(fmtDate(draft.dueDate))}${days === 0 ? ' (on receipt)' : ` (${plural(days, 'day')})`}. Number and payment terms are applied automatically.`
    : `${esc(draft.number)}, issued ${esc(fmtDate(draft.issueDate))}, due ${esc(fmtDate(draft.dueDate))}.`;
  if (draft._isNew && !draft._numberCustom) draft.number = nextNumber('invoice');
  cancelAnimationFrame(pvRaf);
  pvRaf = requestAnimationFrame(() => { const p = $('#preview'); if (p && draft && p.offsetParent) { const n = renderPreview(p, draft); const c = $('#pg-count'); if (c) c.textContent = plural(n, 'page'); } });
}
/* Add or edit one item in a focused sheet */
function itemSheet(itemId) {
  const existing = itemId && draft.items.find(i => i.id === itemId);
  const it = existing ? { ...existing } : { id: uid(), desc: '', qty: 1, price: '' };
  const cur = draft.currency;
  const prods = !existing ? [...DB.products].sort((a, b) => a.name.localeCompare(b.name)) : [];
  const dlg = openDialog({
    title: existing ? 'Edit item' : 'Add item', width: 480,
    body: `<div class="form-stack">
      ${prods.length ? `<div><div class="pick-label" style="margin-top:0">Saved items</div><div class="saved-chips">${prods.slice(0, 12).map(p => `<button class="chip-out" type="button" data-prod="${p.id}">${esc(p.name)}<small>${esc(money(num(p.price), p.currency || cur))}</small></button>`).join('')}</div></div>` : ''}
      <div class="field"><label for="it-d">What are you charging for?</label><input class="input" id="it-d" value="${esc(it.desc)}" placeholder="e.g. Custom kaba and slit" autocomplete="off"><div class="err"></div></div>
      <div class="grid-qty">
        <div class="field"><label for="it-q">Quantity</label><div class="stepper"><button type="button" data-step="-1" aria-label="Less">${ic('minus')}</button><input class="input num" id="it-q" inputmode="decimal" value="${esc(it.qty)}"><button type="button" data-step="1" aria-label="More">${ic('plus')}</button></div></div>
        <div class="field"><label for="it-p">Price each</label><div class="money-in"><span>${esc(symbolOf(cur))}</span><input class="input num" id="it-p" inputmode="decimal" value="${esc(it.price)}" placeholder="0.00"></div><div class="err"></div></div>
      </div>
      <div class="line-preview"><span>Line total</span><b id="it-t" class="num"></b></div>
      ${!existing ? `<label class="checkbox"><input type="checkbox" id="it-save">Save to my items for next time</label>` : ''}
    </div>`,
    foot: existing
      ? `<button class="btn btn-ghost danger-text" data-it="del">${ic('trash')}Remove</button><span style="flex:1"></span>${draft.items.length > 1 ? `<button class="icon-btn" data-it="up" aria-label="Move up">${ic('arrowUp')}</button><button class="icon-btn" data-it="down" aria-label="Move down">${ic('arrowDown')}</button>` : ''}<button class="btn btn-primary" data-it="ok">Done</button>`
      : `<button class="btn btn-secondary" data-it="another">Add another</button><button class="btn btn-primary" data-it="ok">Add item</button>`,
    onMount(b, api) {
      const dI = $('#it-d', b), qI = $('#it-q', b), pI = $('#it-p', b);
      const upd = () => { $('#it-t', b).textContent = money(fromCents(Math.round(num(qI.value) * toCents(pI.value))), cur); };
      [qI, pI].forEach(i => i.addEventListener('input', upd)); upd();
      setTimeout(() => (existing ? pI : dI).focus(), 80);
      b.addEventListener('click', e => {
        const st = e.target.closest('[data-step]'); if (st) { qI.value = Math.max(1, num(qI.value) + +st.dataset.step); upd(); return; }
        const pr = e.target.closest('[data-prod]'); if (pr) { const p = DB.products.find(x => x.id === pr.dataset.prod); dI.value = p.description ? `${p.name}\n${p.description}` : p.name; pI.value = String(num(p.price)); it.productId = p.id; upd(); setFieldError(dI, ''); return; }
      });
      const commit = () => {
        clearErrors(b);
        it.desc = dI.value.trim(); it.qty = num(qI.value) > 0 ? num(qI.value) : 1; it.price = pI.value.trim();
        if (!it.desc) { setFieldError(dI, 'Describe the item'); dI.focus(); return false; }
        if (num(it.price) < 0) { setFieldError(pI, 'Price can’t be negative'); return false; }
        it.price = String(fromCents(toCents(it.price)));
        const i = draft.items.findIndex(x => x.id === it.id);
        if (i < 0) draft.items.push(it); else draft.items[i] = it;
        const save = $('#it-save', b);
        if (save && save.checked && !DB.products.some(p => p.name.toLowerCase() === it.desc.split('\n')[0].toLowerCase())) putProduct({ id: uid(), name: it.desc.split('\n')[0], description: it.desc.split('\n').slice(1).join('\n'), price: num(it.price), currency: cur, createdAt: Date.now() });
        dirty = true; renderItemList(); refreshInvoice(); return true;
      };
      $('.dialog', api.el).addEventListener('click', e => {
        const a = e.target.closest('[data-it]'); if (!a) return;
        const k = a.dataset.it;
        if (k === 'ok') { if (commit()) api.close(); }
        if (k === 'another') { if (commit()) { api.close(); setTimeout(() => itemSheet(), 240); } }
        if (k === 'del') { draft.items = draft.items.filter(x => x.id !== it.id); dirty = true; renderItemList(); refreshInvoice(); api.close(); }
        if (k === 'up' || k === 'down') {
          const i = draft.items.findIndex(x => x.id === it.id), j = i + (k === 'up' ? -1 : 1);
          if (i >= 0 && j >= 0 && j < draft.items.length) { [draft.items[i], draft.items[j]] = [draft.items[j], draft.items[i]]; dirty = true; renderItemList(); refreshInvoice(); }
        }
      });
      b.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); if (commit()) api.close(); } });
    }
  });
}
/* Everything that rarely changes, for this one invoice */
function customizeSheet() {
  const d = draft, s = S();
  const dlg = openDialog({
    title: 'Customize this invoice', width: 560, full: true,
    body: `<p class="muted small" style="margin:0 0 16px">These start from your Settings. Changes here apply to this invoice only.</p>
    <div class="form-stack">
      <div class="grid-2">
        <div class="field"><label for="o-issue">Invoice date</label><input class="input" type="date" id="o-issue" data-o="issueDate" value="${esc(d.issueDate)}"></div>
        <div class="field"><label for="o-terms">Payment due</label><select class="input" id="o-terms" data-o="terms">${TERMS.map(([k, l]) => `<option value="${k}"${String(d.terms) === k ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
      </div>
      <div class="field" id="o-due-f" ${d.terms === 'custom' ? '' : 'hidden'}><label for="o-due">Due date</label><input class="input" type="date" id="o-due" data-o="dueDate" value="${esc(d.dueDate)}"><div class="err"></div></div>
      <div class="grid-2">
        <div class="field"><label for="o-disc">Discount</label><div class="input-group"><input class="input num" id="o-disc" data-o="discount" inputmode="decimal" placeholder="0" value="${esc(d.discount)}">
          <div class="seg" id="o-dseg"><button type="button" data-dt="pct" class="${d.discountType === 'pct' ? 'on' : ''}">%</button><button type="button" data-dt="amt" class="${d.discountType !== 'pct' ? 'on' : ''}">${esc(symbolOf(d.currency))}</button></div></div></div>
        <div class="field"><label for="o-tax">${esc((d.biz && d.biz.taxLabel) || s.taxLabel || 'Tax')} (%)</label><input class="input num" id="o-tax" data-o="taxRate" inputmode="decimal" placeholder="0" value="${esc(d.taxRate)}"></div>
      </div>
      <label class="checkbox"><input type="checkbox" data-o="showPayment"${d.showPayment !== false ? ' checked' : ''}>Show my payment details on this invoice</label>
      <div class="field"><label for="o-notes">Note to the client</label><textarea class="input" id="o-notes" data-o="notes" rows="2" placeholder="Optional">${esc(d.notes || '')}</textarea></div>
      <details class="disclosure inline"><summary>More</summary><div class="form-stack" style="margin-top:12px">
        <div class="field"><label for="o-num">Invoice number</label><input class="input num" id="o-num" data-o="number" value="${esc(d._isNew && !d._numberCustom ? nextNumber('invoice') : d.number)}"><div class="hint">Set automatically. Change it only if you need a specific number.</div><div class="err"></div></div>
        <div class="field"><label for="o-tt">Terms and conditions</label><textarea class="input" id="o-tt" data-o="termsText" rows="2">${esc(d.termsText || '')}</textarea></div>
        <div class="field"><label for="o-foot">Closing line</label><input class="input" id="o-foot" data-o="footer" value="${esc(d.footer ?? s.footer)}"></div>
        <div class="field"><label>Look</label><div class="seg">${['classic', 'modern', 'minimal'].map(t => `<button type="button" data-tpl="${t}" class="${(d.template || s.template) === t ? 'on' : ''}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div></div>
      </div></details>
    </div>`,
    foot: `<button class="btn btn-primary btn-block-sm" data-close>Done</button>`,
    onMount(b) {
      b.addEventListener('input', e => {
        const t = e.target, k = t.dataset.o; if (!k) return;
        const v = t.type === 'checkbox' ? t.checked : t.value;
        d[k] = v;
        if (k === 'number') { d._numberCustom = true; setFieldError(t, numberTaken(v, d.id) ? 'This number is already used' : ''); }
        if (k === 'terms') { $('#o-due-f', b).hidden = v !== 'custom'; if (v !== 'custom') { d.dueDate = addDays(d.issueDate || todayISO(), num(v)); $('#o-due', b).value = d.dueDate; } }
        if (k === 'issueDate' && d.terms !== 'custom' && v) { d.dueDate = addDays(v, num(d.terms)); $('#o-due', b).value = d.dueDate; }
        if (k === 'dueDate') setFieldError(t, v < d.issueDate ? 'Must be on or after the invoice date' : '');
        dirty = true; refreshInvoice();
      });
      b.addEventListener('change', e => { if (e.target.tagName === 'SELECT' || e.target.type === 'date') e.target.dispatchEvent(new Event('input', { bubbles: true })); });
      b.addEventListener('click', e => {
        const dt = e.target.closest('[data-dt]'); if (dt) { d.discountType = dt.dataset.dt; $$('[data-dt]', b).forEach(x => x.classList.toggle('on', x === dt)); dirty = true; refreshInvoice(); }
        const tp = e.target.closest('[data-tpl]'); if (tp) { d.template = tp.dataset.tpl; $$('[data-tpl]', b).forEach(x => x.classList.toggle('on', x === tp)); dirty = true; refreshInvoice(); }
      });
    }
  });
}
let saving = false;
async function saveInvoice(mode, btn) {
  const d = draft; if (!d || saving) return;
  const final = mode === 'final';
  if (final && !(d.client && d.client.name)) { toast('Choose who the invoice is for', { error: true }); pickClient(c => { d.clientId = c.id; d.client = snap(c); dirty = true; $('#client-slot').innerHTML = clientRowHTML(d); refreshInvoice(); }); return; }
  if (final && !d.items.length) { toast('Add at least one item', { error: true }); itemSheet(); return; }
  if (d.dueDate && d.issueDate && d.dueDate < d.issueDate) { toast('The due date is before the invoice date. Check Customize invoice.', { error: true }); return; }
  const orig = !d._isNew && findDoc(d.id);
  if (orig && totals(d).totalCents < balances(orig).paidCents) { toast(`The new total is less than the ${money(balances(orig).paid, d.currency)} already paid.`, { error: true }); return; }
  saving = true; if (btn) btn.classList.add('loading');
  try {
    // number: claimed now, so it is unique even if two people create invoices at once
    if (d._isNew || (d._numberCustom && orig && d.number !== orig.number)) {
      const res = await claimNumber('invoice', d.id, d._numberCustom ? String(d.number).trim() : undefined);
      if (res.taken) { toast(`${d.number} is already used. Choose another number in Customize invoice.`, { error: true }); return; }
      d.number = res.number;
    }
    const client = d.clientId && findClient(d.clientId);
    const clean = {
      ...d, client: client ? snap({ ...client, ...d.client }) : { ...blankClient(), ...d.client },
      items: d.items.map(i => ({ id: i.id, desc: String(i.desc).trim(), qty: num(i.qty) || 1, price: num(i.price), ...(i.productId ? { productId: i.productId } : {}) })),
      discount: num(d.discount), taxRate: num(d.taxRate),
      status: final ? (orig && orig.status === 'paid' && !receipts().some(r => r.linkedInvoiceId === orig.id) ? 'paid' : 'issued') : (orig && orig.status !== 'draft' ? orig.status : 'draft'),
      biz: d.biz || snapshotBiz()      // business details are frozen onto the invoice
    };
    Object.keys(clean).filter(k => k.startsWith('_')).forEach(k => delete clean[k]);
    putDoc(clean);
    dirty = false; draft = null;
    toast(clean.status === 'draft' ? `Draft ${clean.number} saved` : d._isNew ? `Invoice ${clean.number} created` : `${clean.number} saved`);
    location.replace(`#/invoices/${clean.id}`);
  } finally { saving = false; if (btn && btn.isConnected) btn.classList.remove('loading'); }
}

/* =====================================================================
   Receipt editor: who paid, how much, how. That's it.
   ===================================================================== */
function openInvoicesFor(clientId) {
  return invoices().filter(d => countsAsIssued(d) && balances(d).balanceCents > 0 && (!clientId || d.clientId === clientId)).sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
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
    draft._fromInvoice = !!(inv && countsAsIssued(inv));
    if (!draft._fromInvoice && client) { const open = openInvoicesFor(client.id); draft._linkChoice = open.length ? null : 'none'; }
  }
  draft._isNew = isNew;
  const title = isNew ? 'New receipt' : `Edit ${draft.number}`;
  return {
    topbar: { crumbs: [['Receipts', '#/receipts'], [title]], back: isNew ? (draft._fromInvoice ? `#/invoices/${draft.linkedInvoiceId}` : '#/receipts') : `#/receipts/${draft.id}`, search: false,
      actions: `<button class="btn btn-primary btn-sm hide-sm" data-act="rc-save">${isNew ? 'Save receipt' : 'Save changes'}</button>` },
    html: `<div class="ed2" id="editor">
      <div class="ed2-main"><div class="ed2-inner" id="rc-form"></div></div>
      <div class="ed2-preview workspace"><div class="ws-bar"><span>Preview</span><span id="pg-count"></span></div><div id="preview" style="max-width:820px;margin:0 auto"></div></div>
    </div>`,
    mount() { renderReceiptForm(); }
  };
}
function renderReceiptForm() {
  const r = draft, box = $('#rc-form'); if (!box) return;
  const locked = !r._isNew;
  const inv = r.linkedInvoiceId && findDoc(r.linkedInvoiceId);
  const open = r.clientId && !r._fromInvoice && r._isNew ? openInvoicesFor(r.clientId) : [];
  const maxC = maxAllowedCents();
  box.innerHTML = `
    <section class="blk"><div class="blk-label">Who paid?</div>
      ${r._fromInvoice || locked ? `<div class="pick-row static"><span class="avatar">${esc(initials(r.client.name))}</span><span class="pr-main"><b>${esc(r.client.name || 'No name')}</b><small>${esc(r.client.phone || r.client.email || '')}</small></span></div>`
        : `<div id="client-slot">${clientRowHTML(r, 'Select who paid', 'A client, or someone new')}</div>`}
    </section>
    ${open.length ? `<section class="blk"><div class="blk-label">Is this for an invoice?</div><div class="choice-list">
      ${open.map(d => `<button type="button" class="choice${r.linkedInvoiceId === d.id ? ' on' : ''}" data-act="rc-link" data-id="${d.id}"><span class="radio"></span><span class="pr-main"><b>${esc(d.number)}</b><small>${esc(money(balances(d).balance, d.currency))} still owed${invoiceStatus(d) === 'overdue' ? ', late' : ''}</small></span></button>`).join('')}
      <button type="button" class="choice${r._linkChoice === 'none' && !r.linkedInvoiceId ? ' on' : ''}" data-act="rc-link" data-id=""><span class="radio"></span><span class="pr-main"><b>No, a separate payment</b></span></button></div></section>` : ''}
    ${inv && (r._fromInvoice || locked) ? `<section class="blk"><div class="inv-chip">${ic('invoice')}<span>For <b>${esc(inv.number)}</b>, ${esc(money(fromCents(maxC === Infinity ? 0 : maxC), inv.currency))} ${locked ? 'open before this payment' : 'still owed'}</span></div></section>` : ''}
    <section class="blk"><div class="blk-label">Amount received</div>
      <div class="amount-in ${locked ? 'locked' : ''}"><span>${esc(symbolOf(r.currency))}</span><input id="r-amt" inputmode="decimal" placeholder="0.00" value="${esc(r.amount)}" ${locked ? 'readonly' : ''} aria-label="Amount received"></div>
      <div class="field" style="margin-top:6px"><div class="err" id="r-amt-err"></div></div>
      ${locked ? '<p class="fine left">To change the amount, void this receipt and record a new one.</p>' : inv ? `<button type="button" class="link small" data-act="rc-full">Use the full ${esc(money(fromCents(maxC), r.currency))}</button>` : ''}
    </section>
    <section class="blk"><div class="blk-label">How did they pay?</div>
      <div class="method-chips">${METHODS.map(m => `<button type="button" class="chip-out${r.paymentMethod === m ? ' on' : ''}" data-act="rc-method" data-m="${esc(m)}">${esc(m)}</button>`).join('')}</div></section>
    <section class="blk"><div class="blk-label">What was it for? <span class="muted">(optional)</span></div>
      <input class="input" id="r-desc" value="${esc(r.description || '')}" placeholder="e.g. Deposit for bridal fitting"></section>
    <button class="btn btn-primary btn-lg btn-block main-cta" data-act="rc-save">${r._isNew ? 'Save receipt' : 'Save changes'}</button>
    <p class="fine">${r._isNew ? `Receipt number and today’s date are added automatically.` : `${esc(r.number)}, received ${esc(fmtDate(r.issueDate))}.`}</p>
    <div class="ed2-links"><button class="link" data-act="rc-options" type="button">${ic('settings')}More options</button><button class="link lt-wide" data-act="ed-preview" type="button">${ic('eye')}Preview</button></div>`;
  const amt = $('#r-amt', box), desc = $('#r-desc', box);
  amt.addEventListener('input', () => { r.amount = amt.value; dirty = true; validateAmount(false); refreshReceipt(); });
  desc.addEventListener('input', () => { r.description = desc.value; dirty = true; refreshReceipt(); });
  refreshReceipt();
}
function maxAllowedCents() {
  const inv = draft.linkedInvoiceId && findDoc(draft.linkedInvoiceId); if (!inv) return Infinity;
  const self = !draft._isNew && findDoc(draft.id);
  return balances(inv).balanceCents + (self && !isVoid(self) ? receiptCents(self) : 0);
}
function validateAmount(strict) {
  const err = $('#r-amt-err'); if (!err) return true;
  const c = toCents(draft.amount), max = maxAllowedCents();
  let msg = '';
  if (strict && c <= 0) msg = 'Enter how much you received.';
  else if (c > max) msg = `That’s more than the ${money(fromCents(max), draft.currency)} still owed.`;
  err.textContent = msg; err.parentElement.classList.toggle('invalid', !!msg);
  $('.amount-in').classList.toggle('invalid', !!msg);
  return !msg;
}
function refreshReceipt() {
  cancelAnimationFrame(pvRaf);
  pvRaf = requestAnimationFrame(() => { const p = $('#preview'); if (p && draft && p.offsetParent) { const n = renderPreview(p, draft); const c = $('#pg-count'); if (c) c.textContent = plural(n, 'page'); } });
}
function receiptOptions() {
  const r = draft, locked = !r._isNew;
  openDialog({
    title: 'More options', width: 520, full: true,
    body: `<div class="form-stack">
      <div class="field"><label for="ro-date">Date received</label><input class="input" type="date" id="ro-date" data-o="issueDate" value="${esc(r.issueDate)}" ${locked ? 'readonly' : ''}></div>
      <div class="field"><label for="ro-ref">Transaction reference</label><input class="input" id="ro-ref" data-o="reference" value="${esc(r.reference || '')}" placeholder="MoMo or bank transaction ID"></div>
      <div class="field"><label for="ro-notes">Note on the receipt</label><textarea class="input" id="ro-notes" data-o="notes" rows="2">${esc(r.notes || '')}</textarea></div>
      ${!r.linkedInvoiceId && !locked ? `<div class="field"><label for="ro-cur">Currency</label><select class="input" id="ro-cur" data-o="currency">${CURRENCIES.map(([c, n]) => `<option value="${c}"${c === r.currency ? ' selected' : ''}>${c}, ${n}</option>`).join('')}</select></div>` : ''}
      <div class="field"><label for="ro-num">Receipt number</label><input class="input num" id="ro-num" data-o="number" value="${esc(r._isNew && !r._numberCustom ? nextNumber('receipt') : r.number)}" ${locked ? 'readonly' : ''}><div class="hint">Set automatically.</div><div class="err"></div></div>
    </div>`,
    foot: `<button class="btn btn-primary btn-block-sm" data-close>Done</button>`,
    onMount(b) {
      const h = e => {
        const t = e.target, k = t.dataset.o; if (!k || t.readOnly) return;
        r[k] = t.value; dirty = true;
        if (k === 'number') { r._numberCustom = true; setFieldError(t, numberTaken(t.value, r.id) ? 'This number is already used' : ''); }
        if (k === 'currency') renderReceiptForm(); else refreshReceipt();
      };
      b.addEventListener('input', h); b.addEventListener('change', h);
    },
    onClose() { renderReceiptForm(); }
  });
}
let savingReceipt = false;
async function saveReceipt(btn) {
  const r = draft; if (!r || savingReceipt) return;
  if (!(r.client && r.client.name)) { toast('Choose who paid', { error: true }); pickClient(c => setReceiptClient(c)); return; }
  if (r._isNew && !r._fromInvoice && r._linkChoice === null && openInvoicesFor(r.clientId).length) { toast('Is this payment for one of their invoices? Choose one, or “No”.', { error: true }); return; }
  if (!validateAmount(true)) { $('#r-amt').focus(); return; }
  const inv = r.linkedInvoiceId && findDoc(r.linkedInvoiceId);
  if (r._isNew && inv) {
    const same = paymentsFor(inv).find(p => receiptCents(p) === toCents(r.amount) && p.issueDate === r.issueDate && (!r.reference || !p.reference || p.reference === r.reference));
    if (same && !(await confirmDialog({ title: 'This looks like a duplicate', message: `${same.number} already records ${money(receiptAmount(same), r.currency)} on ${fmtDate(same.issueDate)} for ${inv.number}. Record another payment anyway?`, ok: 'Record anyway', cancel: 'Go back' }))) return;
  }
  savingReceipt = true; if (btn) btn.classList.add('loading');
  try {
    if (r._isNew) {
      const res = await claimNumber('receipt', r.id, r._numberCustom ? String(r.number).trim() : undefined);
      if (res.taken) { toast(`${r.number} is already used. Change it in More options.`, { error: true }); return; }
      r.number = res.number;
    }
    const client = r.clientId && findClient(r.clientId);
    const clean = { ...r, amount: fromCents(toCents(r.amount)), invoiceNumber: inv ? inv.number : r.invoiceNumber || '', client: client ? snap({ ...client, ...r.client }) : { ...blankClient(), ...r.client }, biz: r.biz || snapshotBiz() };
    if (!clean.description && inv) clean.description = `Invoice ${inv.number}`;
    Object.keys(clean).filter(k => k.startsWith('_')).forEach(k => delete clean[k]);
    putDoc(clean);
    dirty = false; draft = null;
    const after = inv && findDoc(inv.id);
    toast(inv ? `Receipt ${clean.number} saved. ${balances(after).balanceCents ? `${money(balances(after).balance, inv.currency)} still owed on ${inv.number}.` : `${inv.number} is fully paid.`}` : `Receipt ${clean.number} saved`);
    location.replace(`#/receipts/${clean.id}`);
  } finally { savingReceipt = false; if (btn && btn.isConnected) btn.classList.remove('loading'); }
}
function setReceiptClient(c) {
  const r = draft;
  r.clientId = c.id; r.client = snap(c);
  const open = openInvoicesFor(c.id);
  r.linkedInvoiceId = null; r.invoiceNumber = ''; r._linkChoice = open.length ? null : 'none';
  if (open.length === 0 && !r.description) r.description = '';
  dirty = true; renderReceiptForm();
}

/* =====================================================================
   Receipts
   ===================================================================== */
function filteredReceipts() {
  const st = LS.receipts, q = st.q.trim().toLowerCase(), range = periodRange(st.period, st);
  const list = receipts().filter(r => (st.period === 'all' || inRange(r.issueDate, range)) && (!st.client || r.clientId === st.client)
    && (!q || [r.number, r.client && r.client.name, r.reference, r.description, r.invoiceNumber].join(' ').toLowerCase().includes(q)));
  return sortBy(list, st.sort, st.dir, (r, k) => k === 'amount' ? receiptCents(r) : k === 'client' ? clientName(r).toLowerCase() : r[k] || '');
}
function viewReceipts() {
  return {
    topbar: { crumbs: [['Receipts']], actions: `<a class="btn btn-primary btn-sm hide-sm" href="#/receipts/new">${ic('plus')}New receipt</a>` },
    html: `<div class="content narrow-content">
      ${pageHead('Receipts', '', `<a class="btn btn-primary" href="#/receipts/new">${ic('plus')}New receipt</a>`)}
      ${listToolbar('receipts')}
      <div id="list-body">${listBodyHTML('receipts')}</div>
    </div><a class="btn btn-primary fab" href="#/receipts/new">${ic('plus')}New receipt</a>`,
    mount: bindListSearch
  };
}
function viewReceipt(id) {
  const r = findDoc(id);
  if (!r || r.type !== 'receipt') return notFound('Receipt', '#/receipts');
  const inv = r.linkedInvoiceId && findDoc(r.linkedInvoiceId), b = inv && balances(inv);
  return {
    topbar: { crumbs: [['Receipts', '#/receipts'], [r.number]], back: '#/receipts', actions: `<button class="icon-btn" data-act="doc-menu" data-id="${r.id}" data-detail="1" aria-label="More actions">${ic('more')}</button>` },
    html: `<div class="detail">
      <div class="workspace ws-scroll hide-sm-block"><div class="ws-bar"><span>${isVoid(r) ? 'Void receipt' : 'Receipt'}</span><span id="pg-count"></span></div><div id="preview" style="max-width:820px;margin:0 auto"></div></div>
      <aside class="side" aria-label="Receipt summary">
        <div class="side-sec summary">
          <div class="sum-top"><a class="sum-client" href="${r.clientId ? '#/clients/' + r.clientId : '#/clients'}">${esc(clientName(r))}</a>${isVoid(r) ? badge(r) : '<span class="badge paid">Received</span>'}</div>
          <div class="big-amt num" ${isVoid(r) ? 'style="text-decoration:line-through;color:var(--text-3)"' : ''}><span class="cur">${esc(r.currency)}</span>${esc(plainAmount(receiptAmount(r)))}</div>
          <div class="sum-due">${esc(fmtDate(r.issueDate))}, ${esc(r.paymentMethod || '')}${r.description ? `<br>${esc(r.description)}` : ''}</div>
          ${isVoid(r) ? `<p class="small" style="color:var(--red);margin:8px 0 0">Voided ${esc(fmtDate(r.voidedAt.slice(0, 10)))}${r.voidReason ? `: ${esc(r.voidReason)}` : ''}</p>` : ''}
        </div>
        <div class="side-sec actions-sec">
          <button class="btn btn-primary btn-lg btn-block" data-act="share" data-id="${r.id}">${ic('share')}Send receipt</button>
          <div class="act-row">
            <button class="act" data-act="dl" data-id="${r.id}">${ic('download')}PDF</button>
            <button class="act show-sm-flex" data-act="view-doc" data-id="${r.id}">${ic('eye')}View</button>
            <button class="act hide-sm-flex" data-act="print" data-id="${r.id}">${ic('print')}Print</button>
            <a class="act" href="#/receipts/${r.id}/edit">${ic('edit')}Edit</a>
          </div>
        </div>
        ${inv ? `<div class="side-sec"><h3>Invoice ${esc(inv.number)}</h3>
          <div class="kv"><span>Invoice total</span><b>${esc(money(b.total, inv.currency))}</b></div>
          <div class="kv"><span>Paid so far</span><b>${esc(money(b.paid, inv.currency))}</b></div>
          <div class="kv"><span>Still owed</span><b>${b.balanceCents ? esc(money(b.balance, inv.currency)) : 'Nothing, fully paid'}</b></div>
          <a class="link" href="#/invoices/${inv.id}" style="display:inline-block;margin-top:8px">Open invoice</a></div>`
          : r.invoiceNumber ? `<div class="side-sec"><p class="muted small" style="margin:0">Invoice ${esc(r.invoiceNumber)} was deleted. This receipt is kept as a record.</p></div>` : ''}
        <details class="side-sec disclosure"><summary>Receipt details</summary>
          <div class="kv"><span>Number</span><b>${esc(r.number)}</b></div>
          ${r.reference ? `<div class="kv"><span>Reference</span><b>${esc(r.reference)}</b></div>` : ''}
          <div class="kv"><span>Currency</span><b>${esc(r.currency)}</b></div>
          ${isVoid(r) ? `<button class="btn btn-secondary btn-sm" data-act="rc-restore" data-id="${r.id}" style="margin-top:10px">${ic('sync')}Restore receipt</button>` : `<button class="btn btn-ghost btn-sm danger-text" data-act="rc-void" data-id="${r.id}" style="margin-top:10px;padding-left:0">${ic('ban')}Void this receipt</button>`}
        </details>
      </aside>
    </div>`,
    mount(el) { const p = $('#preview', el); if (p && !isPhone()) { const n = renderPreview(p, r); $('#pg-count', el).textContent = plural(n, 'page'); } }
  };
}

/* =====================================================================
   Clients
   ===================================================================== */
function clientListHTML() {
  if (loadingData()) return skeletonList(8);
  if (!DB.clients.length) return emptyHTML('users', 'No clients yet', 'Clients are saved for you when you create an invoice. You can also add one now.', '<button class="btn btn-primary" data-act="client-new">Add client</button>');
  const q = LS.clients.q.trim().toLowerCase(), cur = S().currency;
  const list = DB.clients.filter(c => !q || [c.name, c.email, c.phone].join(' ').toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
  if (!list.length) return emptyHTML('search', 'No client found', 'Check the spelling, or add them as a new client.', '<button class="btn btn-secondary" data-act="client-new">Add client</button>');
  return `<div class="list-meta">${plural(list.length, 'client')}</div><div class="rows">${list.map(c => {
    const s = clientSummary(c);
    return `<a class="row" href="#/clients/${c.id}"><span class="avatar">${esc(initials(c.name))}</span>
      <span class="row-main"><span class="row-t">${esc(c.name)}</span><span class="row-s">${esc(c.phone || c.email || plural(s.invoices.length, 'invoice'))}</span></span>
      <span class="row-end">${s.outstanding ? `<span class="row-amt">${esc(money(s.outstanding, cur))}</span><span class="row-s">still owed</span>` : `<span class="row-s">Nothing owed</span>`}</span></a>`;
  }).join('')}</div>`;
}
function viewClients() {
  if (current.query.new) setTimeout(() => clientDialog(), 50);
  return {
    topbar: { crumbs: [['Clients']], actions: `<button class="btn btn-primary btn-sm hide-sm" data-act="client-new">${ic('plus')}Add client</button>` },
    html: `<div class="content narrow-content">
      ${pageHead('Clients', '', `<button class="btn btn-primary" data-act="client-new">${ic('plus')}Add client</button>`)}
      <div class="list-tools"><div class="input-affix grow">${ic('search')}<input class="input" id="list-q" data-list="clients" type="search" placeholder="Search name or phone" value="${esc(LS.clients.q)}" autocomplete="off"></div></div>
      <div id="list-body">${clientListHTML()}</div>
    </div><button class="btn btn-primary fab" data-act="client-new">${ic('plus')}Add client</button>`,
    mount: bindListSearch
  };
}
let clientTab = 'invoices';
function viewClient(id) {
  const c = findClient(id); if (!c) return notFound('Client', '#/clients');
  const s = clientSummary(c), cur = S().currency;
  const list = (clientTab === 'invoices' ? s.invoices : s.receipts).sort(byDateDesc);
  return {
    topbar: { crumbs: [['Clients', '#/clients'], [c.name]], back: '#/clients', actions: `<button class="icon-btn" data-act="client-menu" data-id="${c.id}" data-detail="1" aria-label="More">${ic('more')}</button>` },
    html: `<div class="content narrow-content">
      <div class="profile-head"><span class="avatar">${esc(initials(c.name))}</span><div style="min-width:0"><h1 class="ellipsis">${esc(c.name)}</h1><p>${esc(c.phone || c.email || 'No contact details')}</p></div></div>
      <section class="stats three" style="margin-top:20px">
        <div class="stat"><span class="stat-l">Still owed</span><span class="stat-v num">${moneyHTML(s.outstanding, cur)}</span></div>
        <div class="stat"><span class="stat-l">Paid</span><span class="stat-v num">${moneyHTML(s.paid, cur)}</span></div>
        <div class="stat"><span class="stat-l">Invoiced</span><span class="stat-v num">${moneyHTML(s.invoiced, cur)}</span></div>
      </section>
      <div class="home-actions">
        <a class="btn btn-primary btn-lg" href="#/invoices/new?client=${c.id}">${ic('plus')}New invoice</a>
        <a class="btn btn-secondary btn-lg" href="#/receipts/new?client=${c.id}">${ic('receipt')}Record payment</a>
      </div>
      <details class="disclosure card-ish"><summary>Contact details</summary>
        <div class="kv"><span>Phone</span><b>${esc(c.phone || '—')}</b></div><div class="kv"><span>Email</span><b>${esc(c.email || '—')}</b></div>
        <div class="kv"><span>Address</span><b style="white-space:pre-line">${esc(c.address || '—')}</b></div>
        ${c.notes ? `<div class="kv"><span>Notes</span><b style="white-space:pre-line;font-weight:400">${esc(c.notes)}</b></div>` : ''}
        <button class="btn btn-secondary btn-sm" data-act="client-edit" data-id="${c.id}" style="margin-top:10px">${ic('edit')}Edit details</button>
      </details>
      <section class="sec">
        <div class="sec-h"><div class="seg">${[['invoices', `Invoices (${s.invoices.length})`], ['payments', `Payments (${s.receipts.length})`]].map(([k, l]) => `<button data-act="client-tab" data-k="${k}" class="${clientTab === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
        ${list.length ? rowsHTML(list) : emptyHTML(clientTab === 'invoices' ? 'invoice' : 'receipt', clientTab === 'invoices' ? 'No invoices yet' : 'No payments yet', clientTab === 'invoices' ? 'Invoices for this client will show here.' : 'Payments from this client will show here.')}
      </section>
    </div>`
  };
}

/* =====================================================================
   Saved items (products & services)
   ===================================================================== */
function itemsListHTML() {
  const list = [...DB.products].sort((a, b) => a.name.localeCompare(b.name));
  if (!list.length) return emptyHTML('box', 'No saved items yet', 'Save the things you charge for often, like a bridal fitting or alterations, so you can add them to an invoice in one tap.', '<button class="btn btn-primary" data-act="product-new">Add an item</button>');
  return `<div class="rows">${list.map(p => `<button class="row" data-act="product-edit" data-id="${p.id}"><span class="row-ic">${ic('box')}</span>
    <span class="row-main"><span class="row-t">${esc(p.name)}</span><span class="row-s">${esc(p.description || 'No description')}</span></span>
    <span class="row-end"><span class="row-amt">${esc(money(num(p.price), p.currency || S().currency))}</span></span></button>`).join('')}</div>`;
}
function viewItems() {
  return {
    topbar: { crumbs: [['Saved items']], back: isPhone() ? '#/settings' : '', actions: `<button class="btn btn-primary btn-sm hide-sm" data-act="product-new">${ic('plus')}Add item</button>` },
    html: `<div class="content narrow-content">${pageHead('Saved items', 'Things you charge for often. Pick them when adding items to an invoice.', `<button class="btn btn-primary" data-act="product-new">${ic('plus')}Add item</button>`)}${itemsListHTML()}</div>
      <button class="btn btn-primary fab" data-act="product-new">${ic('plus')}Add item</button>`
  };
}

/* =====================================================================
   Settings: set once, used everywhere. An index on phones, a side menu on desktop.
   ===================================================================== */
const SET_SECTIONS = [
  ['business', 'Your business', 'Name, logo and contact details', 'user'],
  ['invoices', 'Invoices and receipts', 'Currency, payment terms, tax and numbering', 'invoice'],
  ['content', 'What your invoices say', 'Payment details, thank-you note, terms', 'wallet'],
  ['items', 'Saved items', 'Things you charge for often', 'box'],
  ['appearance', 'Appearance', 'Light or dark', 'sun'],
  ['data', 'Backup and data', 'Export, restore, lock', 'lock']
];
function sampleDoc(tpl) {
  const s = S();
  return { id: 'sample', type: 'invoice', template: tpl, number: formatNumber('invoice', 42), status: 'issued', issueDate: todayISO(), dueDate: addDays(todayISO(), 14), currency: s.currency, client: { name: 'Ama Mensah', address: 'East Legon, Accra', phone: '024 555 1234', email: '' }, items: [{ desc: 'Custom kaba and slit', qty: 1, price: 1450 }, { desc: 'Alterations', qty: 2, price: 120 }], discount: 0, taxRate: 0, notes: '', showPayment: true };
}
function viewSettings(tab) {
  const phoneIndex = !tab && isPhone();
  if (!tab) tab = 'business';
  if (tab === 'items') { const v = viewItems(); v.topbar.back = '#/settings'; return v; }
  if (!SET_SECTIONS.some(t => t[0] === tab)) tab = 'business';
  if (phoneIndex) return {
    topbar: { crumbs: [['Settings']] },
    html: `<div class="content narrow-content">${pageHead('Settings', 'Set these once. Every new invoice and receipt uses them.')}
      <div class="rows">${SET_SECTIONS.map(([k, l, d, i]) => `<a class="row" href="#/settings/${k}"><span class="row-ic">${ic(i)}</span><span class="row-main"><span class="row-t">${l}</span><span class="row-s">${d}</span></span>${ic('chevRight', 'chev')}</a>`).join('')}</div>
      <a class="row plain" href="#/reports" style="margin-top:16px"><span class="row-ic">${ic('chart')}</span><span class="row-main"><span class="row-t">Reports</span><span class="row-s">Trends, late payments, client totals</span></span>${ic('chevRight', 'chev')}</a>
    </div>`
  };
  const s = S();
  const fld = (k, label, o = {}) => `<div class="field"><label for="s-${k}">${label}</label>${o.area ? `<textarea class="input" id="s-${k}" data-s="${k}" rows="${o.rows || 3}" placeholder="${esc(o.ph || '')}">${esc(s[k] ?? '')}</textarea>` : `<input class="input${o.num ? ' num' : ''}" id="s-${k}" data-s="${k}" value="${esc(s[k] ?? '')}" placeholder="${esc(o.ph || '')}"${o.type ? ` type="${o.type}"` : ''}${o.im ? ` inputmode="${o.im}"` : ''}>`}${o.hint ? `<div class="hint">${o.hint}</div>` : ''}</div>`;
  const sel = (k, label, opts, hint) => `<div class="field"><label for="s-${k}">${label}</label><select class="input" id="s-${k}" data-s="${k}">${opts.map(([v, l]) => `<option value="${v}"${String(s[k]) === String(v) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
  let body = '';
  if (tab === 'business') body = `
    <div class="field"><label>Logo</label><div class="logo-drop"><div class="logo-box">${s.logo === 'none' ? `<span class="muted small">No logo</span>` : `<img src="${s.logo || LOGO}" alt="Logo">`}</div>
      <div style="display:grid;gap:6px;justify-items:start"><button class="btn btn-secondary btn-sm" data-act="logo-upload">${ic('upload')}Upload logo</button>
      ${s.logo ? '<button class="link small" data-act="logo-reset">Use the Kuzelle logo</button>' : ''}${s.logo !== 'none' ? '<button class="link small" data-act="logo-none">Show my business name instead</button>' : ''}</div></div></div>
    ${fld('businessName', 'Business name')}
    <div class="grid-2">${fld('phone', 'Phone', { im: 'tel', ph: '024 000 0000' })}${fld('email', 'Email', { type: 'email', ph: 'hello@kuzelle.com' })}</div>
    ${fld('address', 'Address', { area: true, rows: 2 })}
    <details class="disclosure inline"><summary>Website and tax number</summary><div class="form-stack" style="margin-top:12px">
      ${fld('website', 'Website or social page', { ph: 'kuzelle.com or @kuzelle' })}${fld('taxId', 'Tax identification number', { ph: 'e.g. your GRA TIN', hint: 'Shown on documents only if you fill it in.' })}</div></details>`;
  if (tab === 'invoices') body = `
    ${sel('currency', 'Currency', CURRENCIES.map(([c, n]) => [c, `${c}, ${n}`]), 'New invoices and receipts start in this currency. You can still change it on any invoice.')}
    ${sel('dueDays', 'When invoices are due', TERMS.filter(t => t[0] !== 'custom').map(([k, l]) => [k, l === 'Due on receipt' ? 'Straight away' : `${l.replace('Net ', '')} days after the invoice date`]), 'The due date is worked out for you.')}
    ${sel('defaultMethod', 'Usual payment method', METHODS.map(m => [m, m]), 'Pre-selected on new receipts.')}
    <div class="field"><label>Tax</label><div class="grid-2">${fld('taxRate', 'Rate (%)', { im: 'decimal', num: true, hint: 'Leave at 0 if you don’t charge tax.' })}${fld('taxLabel', 'Name on invoices', { ph: 'VAT' })}</div></div>
    <div class="field"><label>Look of your invoices</label><div class="tpl-pick">${['classic', 'modern', 'minimal'].map(t => `<button class="tpl-opt ${s.template === t ? 'on' : ''}" data-act="set-tpl" data-k="${t}" type="button"><div class="thumb">${paginate(sampleDoc(t))[0].replace('class="page', 'style="transform:scale(.2)" class="page')}</div><b>${t[0].toUpperCase() + t.slice(1)}</b></button>`).join('')}</div></div>
    <details class="disclosure inline"><summary>Numbering</summary><div class="form-stack" style="margin-top:12px">
      <p class="muted small" style="margin:0">Numbers are given out automatically and never repeat. Next invoice: <b id="next-inv">${esc(nextNumber('invoice'))}</b>, next receipt: <b id="next-rct">${esc(nextNumber('receipt'))}</b></p>
      <div class="grid-2">${fld('invPrefix', 'Invoice prefix', { hint: 'Add {YYYY} for the year, e.g. INV-{YYYY}-' })}${fld('nextInv', 'Start invoices at', { im: 'numeric', num: true })}</div>
      <div class="grid-2">${fld('rctPrefix', 'Receipt prefix')}${fld('nextRct', 'Start receipts at', { im: 'numeric', num: true })}</div>
      ${fld('numberDigits', 'Digits in the number', { im: 'numeric', num: true, hint: '4 gives 0001' })}</div></details>`;
  if (tab === 'content') body = `
    ${fld('payment', 'How clients can pay you', { area: true, rows: 4, ph: 'MTN MoMo: 024 000 0000 (Kuzelle)\nBank: GCB Bank, Accra Main\nAccount name: Kuzelle\nAccount number: 0000000000000', hint: 'Mobile money and bank details. Printed under “How to pay”.' })}
    <label class="checkbox"><input type="checkbox" data-s="showPayment"${s.showPayment !== false ? ' checked' : ''}>Put these details on every new invoice</label>
    ${fld('footer', 'Thank-you line', { ph: 'Thank you for choosing Kuzelle.', hint: 'The last line on every invoice and receipt.' })}
    <details class="disclosure inline"><summary>Notes and terms</summary><div class="form-stack" style="margin-top:12px">
      ${fld('defaultNotes', 'Note added to new invoices', { area: true, rows: 2 })}
      ${fld('defaultTerms', 'Terms and conditions', { area: true, rows: 3, ph: 'e.g. 50% deposit before work begins. Balance on collection.' })}
      ${fld('countryCode', 'WhatsApp country code', { im: 'numeric', hint: 'Turns numbers like 024… into WhatsApp links. 233 for Ghana.' })}</div></details>
    <p class="muted small">Invoices you’ve already created keep the details they were issued with.</p>`;
  if (tab === 'appearance') body = `
    <div class="field"><label>Theme</label><div class="seg full">${[['system', 'Automatic', 'monitor'], ['light', 'Light', 'sun'], ['dark', 'Dark', 'moon']].map(([k, l, i]) => `<button data-act="set-theme" data-theme-opt="${k}" data-k="${k}" class="${(UI.theme || 'system') === k ? 'on' : ''}">${ic(i)}${l}</button>`).join('')}</div><div class="hint">Invoices and receipts always print on white.</div></div>`;
  if (tab === 'data') body = `
    <div class="field"><label>Where your records are kept</label><p class="small" style="margin:0">${MODE === 'cloud' ? 'Online, in your Netlify database. Every device you sign in on sees the same records, and this device keeps a copy for when you’re offline.' : 'In this browser only.'}</p>
      <div class="sync-pill" data-sync style="padding:0;height:auto;margin-top:8px"><span class="sdot"></span><span class="stxt"></span></div>
      ${MODE === 'cloud' ? `<button class="btn btn-secondary btn-sm" data-act="sync-now" style="margin-top:8px;justify-self:start">${ic('sync')}Save online now</button>` : ''}</div>
    <div class="field"><label>Backup</label><p class="small muted" style="margin:0">Last backup: ${UI.lastBackup ? esc(new Date(UI.lastBackup).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })) : 'never'}</p>
      <div class="btn-row"><button class="btn btn-secondary" data-act="backup">${ic('download')}Download a backup</button><button class="btn btn-secondary" data-act="import">${ic('upload')}Restore a backup</button></div></div>
    <details class="disclosure inline"><summary>Spreadsheets and more</summary><div class="form-stack" style="margin-top:12px">
      <div class="btn-row"><button class="btn btn-secondary btn-sm" data-act="export-csv" data-k="invoices">Invoices (CSV)</button><button class="btn btn-secondary btn-sm" data-act="export-csv" data-k="receipts">Receipts (CSV)</button><button class="btn btn-secondary btn-sm" data-act="export-csv" data-k="clients">Clients (CSV)</button></div>
      <div><button class="btn btn-danger-soft btn-sm" data-act="wipe">${ic('trash')}Erase all data</button><div class="hint" style="margin-top:6px">Deletes everything${MODE === 'cloud' ? ' on every device' : ''}. Download a backup first.</div></div></div></details>
    <div class="field"><label>This device</label><button class="btn btn-secondary" data-act="lock" style="justify-self:start">${ic('lock')}Lock the app</button><div class="hint">The access code is set in Netlify.</div></div>`;
  const sec = SET_SECTIONS.find(t => t[0] === tab);
  return {
    topbar: { crumbs: [['Settings', '#/settings'], [sec[1]]], back: isPhone() ? '#/settings' : '' },
    html: `<div class="content">
      <div class="settings">
        <nav class="settings-nav hide-sm" aria-label="Settings sections">${SET_SECTIONS.map(([k, l, , i]) => `<a class="nav-link ${k === tab ? 'active' : ''}" href="#/settings/${k}">${ic(i)}<span>${l}</span></a>`).join('')}</nav>
        <div class="set-body">${pageHead(sec[1], tab === 'appearance' || tab === 'data' ? '' : 'Saved automatically.')}<div class="form-stack">${body}</div></div>
      </div>
    </div>`,
    mount(el) {
      const NUMS = ['taxRate', 'dueDays', 'nextInv', 'nextRct', 'numberDigits'];
      const save = debounce(() => putSettings(), 400);
      const h = e => {
        const k = e.target.dataset.s; if (!k) return;
        let v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
        if (NUMS.includes(k)) v = k === 'taxRate' ? Math.max(0, num(v)) : k === 'dueDays' ? Math.max(0, Math.floor(num(v))) : Math.max(1, Math.floor(num(v)) || 1);
        if (k === 'numberDigits') v = Math.min(8, v);
        S()[k] = v; save();
        const ni = $('#next-inv', el), nr = $('#next-rct', el);
        if (ni) ni.textContent = nextNumber('invoice'); if (nr) nr.textContent = nextNumber('receipt');
        if (k === 'businessName') paintAccount();
      };
      el.addEventListener('input', h);
      el.addEventListener('change', e => { if (e.target.tagName === 'SELECT' || e.target.type === 'checkbox') h(e); });
    }
  };
}

/* =====================================================================
   Client and item dialogs
   ===================================================================== */
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
    topbar: { crumbs: [['Reports']], back: isPhone() ? '#/dashboard' : '' },
    html: `<div class="content stack">
      ${pageHead('Reports', `${esc(range.label)}${RP.period === 'all' ? '' : `, ${esc(fmtDate(range.from))} to ${esc(fmtDate(range.to))}`}. Figures in ${cur}.`, `<button class="btn btn-secondary" data-act="export-csv" data-k="report">${ic('download')}Export CSV</button>`)}
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:-6px">
        <div class="seg">${[['this-month', 'This month'], ['last-month', 'Last month'], ['this-year', 'This year'], ['last-year', 'Last year'], ['all', 'All time'], ['custom', 'Custom']].map(([k, l]) => `<button data-act="rp-period" data-k="${k}" class="${RP.period === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        ${RP.period === 'custom' ? `<input class="input" type="date" id="rp-from" value="${esc(range.from)}" style="width:auto;height:34px" aria-label="From"><input class="input" type="date" id="rp-to" value="${esc(range.to)}" style="width:auto;height:34px" aria-label="To">` : ''}
      </div>
      <section class="kpis" style="grid-template-columns:repeat(4,minmax(0,1fr))">
        <div class="kpi"><div class="k-label">Invoiced</div><div class="k-value num">${moneyHTML(ag.invoiced, cur)}</div><div class="k-sub">${plural(ag.invoicedCount, 'invoice')}</div></div>
        <div class="kpi"><div class="k-label">Payments received</div><div class="k-value num">${moneyHTML(ag.received, cur)}</div><div class="k-sub">${ag.invoiced ? `${rate}% of amount invoiced` : plural(ag.payments.length, 'payment')}</div></div>
        <div class="kpi"><div class="k-label">Still owed today</div><div class="k-value num">${moneyHTML(ag.outstanding, cur)}</div><div class="k-sub">${plural(ag.openCount, 'open invoice')}</div></div>
        <div class="kpi ${ag.overdueList.length ? 'alert' : ''}"><div class="k-label">Late today</div><div class="k-value num">${moneyHTML(ag.overdue, cur)}</div><div class="k-sub">${plural(ag.overdueList.length, 'invoice')}</div></div>
      </section>
      <div class="split-2">
        <section class="card"><div class="card-head"><div><h2>Revenue and payments</h2><div class="sub">By month</div></div>${legend}</div><div class="card-body"><div id="rp-chart"></div></div></section>
        <section class="card"><div class="card-head"><div><h2>Money owed, by how late</h2><div class="sub">Open balances, by days past due</div></div></div>
          <div class="card-body" style="display:grid;gap:14px">${buckets.map(b => `<div><div class="kv" style="padding:0 0 6px"><span>${b.l} <span class="muted">(${b.n})</span></span><b>${esc(money(b.v, cur))}</b></div><div class="progress" style="margin:0"><i style="width:${Math.round(b.v / maxB * 100)}%;${b.l === 'Not yet due' ? 'background:var(--chart-b)' : ''}"></i></div></div>`).join('')}</div></section>
      </div>
      <section class="card"><div class="card-head"><div><h2>Client payment summary</h2><div class="sub">Invoiced and paid within the period, outstanding today</div></div></div>
        ${clientRows.length ? `<div class="tbl"><div class="tbl-row tbl-head" style="--cols:${CC}"><span>Client</span><span class="r">Invoiced</span><span class="r">Paid</span><span class="r">Outstanding</span><span class="r">Last payment</span></div><div class="tbl-body">${clientRows.map(x => `<div class="tbl-row" style="--cols:${CC}" data-href="#/clients/${x.c.id}" tabindex="0" role="link"><span class="cell-main" data-m="a">${esc(x.c.name)}</span><span class="amount r">${esc(money(x.invoiced, cur))}</span><span class="amount r" data-m="c">${esc(money(x.paid, cur))} paid</span><span class="amount r" data-m="b">${esc(money(x.owed, cur))}</span><span class="t2 r" data-m="d">${x.last ? esc(fmtShort(x.last)) : '—'}</span></div>`).join('')}</div></div>`
          : emptyHTML('users', 'Nothing in this period', 'Choose a wider date range to see client activity.')}</section>
      <section class="card"><div class="card-head"><div><h2>Late payments</h2><div class="sub">Oldest first</div></div></div>
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
   Logo and data tools
   ===================================================================== */
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
  collapse: () => { const c = !$('#app').classList.contains('collapsed'); UI.sidebar = c ? 'collapsed' : 'expanded'; saveUI(); applySidebarMode(); },
  'toggle-theme': () => setTheme(effectiveTheme() === 'dark' ? 'light' : 'dark'),
  'set-theme': ds => setTheme(ds.k),
  'search-mobile': openMobileSearch,
  account: (ds, el) => showMenu(el, [
    { heading: S().businessName },
    { label: 'Your business', icon: 'user', onClick: () => go('#/settings/business') },
    { label: 'Backup and data', icon: 'download', onClick: () => go('#/settings/data') },
    'sep', { label: 'Lock', icon: 'lock', onClick: () => lockApp() }
  ], { above: true, alignLeft: true, width: 220 }),
  'sync-now': () => {
    if (MODE !== 'cloud') { toast('Records are saved on this device only.'); return; }
    if (!navigator.onLine) { toast('You’re offline. Everything is kept and will upload when you reconnect.'); return; }
    sync().then(() => { if (syncState === 'synced') toast('Everything is saved online'); });
  },
  'goto-filter': ds => { Object.assign(LS.invoices, { status: ds.f, period: 'all', limit: 30 }); go('#/invoices'); },
  'home-tab': ds => { UI.homeTab = ds.k; saveUI(); renderRoute(true); },
  'inv-status': ds => { LS.invoices.status = ds.k; LS.invoices.limit = 30; $$('.quick .chip').forEach(c => c.classList.toggle('on', c.dataset.k === ds.k)); $('#list-body').innerHTML = listBodyHTML('invoices'); },
  filters: ds => openFilters(ds.list),
  'clear-filters': ds => { Object.assign(LS[ds.list], { q: '', status: 'all', period: 'all', client: '', sort: 'issueDate', dir: 'desc', limit: 30 }); renderRoute(true); },
  'more-rows': ds => { LS[ds.list].limit += 30; $('#list-body').innerHTML = listBodyHTML(ds.list); },
  'doc-menu': (ds, el) => { const d = findDoc(ds.id); if (d) docMenu(d, el, !!ds.detail); },
  dl: (ds, el) => { const d = findDoc(ds.id); if (d) actDownload(d, el); },
  print: ds => { const d = findDoc(ds.id); if (d) printDoc(d); },
  share: ds => { const d = findDoc(ds.id); if (d) actShare(d); },
  'view-doc': ds => { const d = findDoc(ds.id); if (d) openDocView(d); },
  finalize: ds => { const d = findDoc(ds.id); if (!d) return; if (!d.client || !d.client.name || !(d.items || []).some(i => i.desc)) { toast('Add a client and items first.', { error: true }); go(`#/invoices/${d.id}/edit`); return; } putDoc({ ...d, status: 'issued', biz: d.biz || snapshotBiz() }); toast(`${d.number} is ready to send`); refreshView(); },
  'rc-void': ds => { const r = findDoc(ds.id); if (r) voidReceipt(r); },
  'rc-restore': ds => { const r = findDoc(ds.id); if (r) restoreReceipt(r); },
  // editors
  'pick-client': () => pickClient(c => {
    if (draft.type === 'receipt') { setReceiptClient(c); return; }
    draft.clientId = c.id; draft.client = snap(c); dirty = true;
    $('#client-slot').innerHTML = clientRowHTML(draft); refreshInvoice();
    if (!draft.items.length) setTimeout(() => itemSheet(), 260);   // guide straight to the next step
  }),
  'item-add': () => itemSheet(),
  'item-edit': ds => itemSheet(ds.id),
  'ed-options': () => customizeSheet(),
  'ed-preview': () => {
    if (!draft) return;
    const isR = draft.type === 'receipt';
    if (!isR && draft._isNew && !draft._numberCustom) draft.number = nextNumber('invoice');
    if (isR && draft._isNew && !draft._numberCustom) draft.number = nextNumber('receipt');
    openDocView(draft, { title: 'Preview', footer: isR ? `<button class="btn btn-primary btn-block" data-act="rc-save">${draft._isNew ? 'Save receipt' : 'Save changes'}</button>` : `<button class="btn btn-primary btn-block" data-act="inv-save" data-mode="final">${draft._isNew || draft.status === 'draft' ? 'Create invoice' : 'Save changes'}</button>` });
  },
  'inv-save': (ds, el) => saveInvoice(ds.mode, el),
  'rc-save': (ds, el) => saveReceipt(el),
  'rc-link': ds => {
    const r = draft;
    if (ds.id) { const inv = findDoc(ds.id); r.linkedInvoiceId = inv.id; r.invoiceNumber = inv.number; r.currency = inv.currency; r._linkChoice = inv.id; if (!toCents(r.amount)) r.amount = balances(inv).balance.toFixed(2); if (!r.description || /^Invoice /.test(r.description)) r.description = `Invoice ${inv.number}`; }
    else { r.linkedInvoiceId = null; r.invoiceNumber = ''; r._linkChoice = 'none'; if (/^Invoice /.test(r.description || '')) r.description = ''; }
    dirty = true; renderReceiptForm();
  },
  'rc-full': () => { const max = maxAllowedCents(); if (isFinite(max)) { draft.amount = fromCents(max).toFixed(2); $('#r-amt').value = draft.amount; validateAmount(false); dirty = true; refreshReceipt(); } },
  'rc-method': ds => { draft.paymentMethod = ds.m; $$('[data-act="rc-method"]').forEach(b => b.classList.toggle('on', b.dataset.m === ds.m)); dirty = true; refreshReceipt(); },
  'rc-options': () => receiptOptions(),
  // clients & items
  'client-new': () => clientDialog(),
  'client-edit': ds => clientDialog(ds.id),
  'client-tab': ds => { clientTab = ds.k; renderRoute(true); },
  'client-menu': (ds, el) => { const c = findClient(ds.id); if (!c) return; showMenu(el, [
    { label: 'Edit details', icon: 'edit', onClick: () => clientDialog(c.id) },
    { label: 'New invoice', icon: 'invoice', onClick: () => go(`#/invoices/new?client=${c.id}`) },
    { label: 'Record payment', icon: 'receipt', onClick: () => go(`#/receipts/new?client=${c.id}`) },
    'sep', { label: 'Delete client', icon: 'trash', danger: true, onClick: () => deleteClient(c) }]); },
  'product-new': () => productDialog(),
  'product-edit': ds => productDialog(ds.id),
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
    if (!(await confirmDialog({ title: 'Erase all data?', message: `Every invoice, receipt, client and setting will be deleted${MODE === 'cloud' ? ' on every device' : ''}. Download a backup first if you might need them.`, ok: 'Erase everything', danger: true }))) return;
    replaceAll(normalize({ settings: defaultSettings() })); go('#/dashboard'); toast('All data erased');
  }
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (el && ACTIONS[el.dataset.act]) { e.preventDefault(); ACTIONS[el.dataset.act](el.dataset, el, e); }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { if (dialogs.length) { dialogs[dialogs.length - 1].close(); return; } closeMenu(); }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !$('#app').hidden) { e.preventDefault(); const g = $('#gsearch'); if (g && g.offsetParent) g.focus(); else openMobileSearch(); }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's' && draft) { e.preventDefault(); if (draft.type === 'invoice') saveInvoice('final'); else saveReceipt(); }
});
$('#import-file').addEventListener('change', async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  let data; try { data = JSON.parse(await file.text()); } catch { toast('That file isn’t a Kuzelle backup.', { error: true }); return; }
  if (!data || !Array.isArray(data.docs) || !data.settings) { toast('That file isn’t a Kuzelle backup.', { error: true }); return; }
  if (!(await confirmDialog({ title: 'Restore this backup?', message: `It has ${plural(data.docs.length, 'document')} and ${plural((data.clients || []).length, 'client')}. It replaces what’s here now${MODE === 'cloud' ? ' on every device' : ''}.`, ok: 'Restore' }))) return;
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
  $('#tabbar').innerHTML = tabbarHTML();
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
