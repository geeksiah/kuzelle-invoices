// Data layer. Every change goes through a mutation here, is written to the device
// immediately, and is queued for upload to the Netlify function (Netlify Blobs).
import { uid, num, toCents, fromCents, todayISO, readJSON, writeJSON, sha256, addDays } from './util.js';

export const CONFIG = {
  CODE_LENGTH: 6,
  // Used only when the app runs without its server (opened as a file). On Netlify the code is ACCESS_CODE.
  LOCAL_CODE_HASH: '6dcd932e017833c58b1340b6d8a8f40294430c122cb84544a48ffeea7d275927',
  SESSION_HOURS: 12,
  MAX_ATTEMPTS: 5,
  LOCKOUT_SECONDS: 60,
  API: '/api'
};
// Storage keys are unchanged from V1 so existing devices keep their data and session.
const KEY = 'kuzelle.data.v1', SESSKEY = 'kuzelle.session', TOKKEY = 'kuzelle.token', MODEKEY = 'kuzelle.mode', OUTKEY = 'kuzelle.outbox', OFFKEY = 'kuzelle.offline';
export const UIKEY = 'kuzelle.ui.v1', ATTKEY = 'kuzelle.attempts';

export const bus = new EventTarget();
const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));

export function defaultSettings() {
  return {
    businessName: 'Kuzelle', email: '', phone: '', address: 'Accra, Ghana', website: '', taxId: '', logo: '',
    currency: 'GHS', taxRate: 0, taxLabel: 'VAT',
    invPrefix: 'INV-', rctPrefix: 'RCT-', nextInv: 1, nextRct: 1, numberDigits: 4,
    dueDays: 14, payment: '', showPayment: true, defaultNotes: '', defaultTerms: '',
    footer: 'Thank you for choosing Kuzelle.', template: 'classic', countryCode: '233', defaultMethod: 'Mobile Money', updatedAt: 0
  };
}
export function normalize(d) {
  const base = defaultSettings();
  const s = { ...base, ...((d && d.settings) || {}) };
  if (s.showPayment === undefined) s.showPayment = true;
  return {
    settings: s,
    clients: Array.isArray(d && d.clients) ? d.clients.filter(c => c && c.id) : [],
    products: Array.isArray(d && d.products) ? d.products.filter(p => p && p.id) : [],
    assets: Array.isArray(d && d.assets) ? d.assets.filter(a => a && a.id) : [],
    docs: Array.isArray(d && d.docs) ? d.docs.filter(x => x && x.id && (x.type === 'invoice' || x.type === 'receipt')) : []
  };
}

export let DB = normalize(readJSON(KEY, null));
export const S = () => DB.settings;
export let MODE = localStorage.getItem(MODEKEY) || 'local';
let outbox = readJSON(OUTKEY, []);
export const pendingCount = () => outbox.length;

function saveLocal() { if (!writeJSON(KEY, DB)) emit('storage-error'); }
function changed(source = 'local') { emit('change', { source }); }

/* ---------- mutations ---------- */
function enqueue(kind, id, op, data) {
  if (MODE !== 'cloud') return;
  const key = `${kind}:${id}`;
  outbox = outbox.filter(o => o.key !== key);
  outbox.push({ key, kind, id, op, data: data ? JSON.parse(JSON.stringify(data)) : undefined, updatedAt: (data && data.updatedAt) || Date.now() });
  writeJSON(OUTKEY, outbox);
  scheduleSync();
}
function upsert(list, rec) { const i = list.findIndex(x => x.id === rec.id); if (i < 0) list.push(rec); else list[i] = rec; }
export function putDoc(d, quiet) { d.updatedAt = Date.now(); upsert(DB.docs, d); saveLocal(); enqueue('doc', d.id, 'put', d); if (!quiet) changed(); return d; }
export function delDoc(id) { DB.docs = DB.docs.filter(x => x.id !== id); saveLocal(); enqueue('doc', id, 'del'); changed(); }
export function putClient(c, quiet) { c.updatedAt = Date.now(); upsert(DB.clients, c); saveLocal(); enqueue('client', c.id, 'put', c); if (!quiet) changed(); return c; }
export function delClient(id) { DB.clients = DB.clients.filter(x => x.id !== id); saveLocal(); enqueue('client', id, 'del'); changed(); }
export function putProduct(p) { p.updatedAt = Date.now(); upsert(DB.products, p); saveLocal(); enqueue('product', p.id, 'put', p); changed(); return p; }
export function delProduct(id) { DB.products = DB.products.filter(x => x.id !== id); saveLocal(); enqueue('product', id, 'del'); changed(); }
export function putAsset(a) { a.updatedAt = Date.now(); upsert(DB.assets, a); saveLocal(); enqueue('asset', a.id, 'put', a); return a; }
export function putSettings(quiet) { S().updatedAt = Date.now(); saveLocal(); enqueue('settings', 'settings', 'put', S()); if (!quiet) changed(); }
function enqueueEverything() {
  DB.docs.forEach(d => enqueue('doc', d.id, 'put', d));
  DB.clients.forEach(c => enqueue('client', c.id, 'put', c));
  DB.products.forEach(p => enqueue('product', p.id, 'put', p));
  if (!S().updatedAt) S().updatedAt = Date.now();
  enqueue('settings', 'settings', 'put', S());
}
export function replaceAll(next) {
  const keep = k => new Set(next[k].map(x => x.id));
  const kd = keep('docs'), kc = keep('clients'), kp = keep('products');
  DB.docs.filter(d => !kd.has(d.id)).forEach(d => enqueue('doc', d.id, 'del'));
  DB.clients.filter(c => !kc.has(c.id)).forEach(c => enqueue('client', c.id, 'del'));
  DB.products.filter(p => !kp.has(p.id)).forEach(p => enqueue('product', p.id, 'del'));
  next.assets = DB.assets.concat((next.assets || []).filter(a => !DB.assets.some(x => x.id === a.id)));
  DB = next;
  const now = Date.now();
  DB.docs.forEach(d => { d.updatedAt = now; enqueue('doc', d.id, 'put', d); });
  DB.clients.forEach(c => { c.updatedAt = now; enqueue('client', c.id, 'put', c); });
  DB.products.forEach(p => { p.updatedAt = now; enqueue('product', p.id, 'put', p); });
  S().updatedAt = now; enqueue('settings', 'settings', 'put', S());
  saveLocal(); changed();
}

/* ---------- auth & session ---------- */
export const token = () => localStorage.getItem(TOKKEY) || '';
export const sessionValid = () => { try { return Date.now() < +localStorage.getItem(SESSKEY); } catch { return false; } };
export const canResume = () => sessionValid() && (MODE === 'local' || !!token() || !!readJSON(OFFKEY, null));
export async function login(code) {
  let res = await cloudLogin(code);
  if (res.ok) {
    localStorage.setItem(TOKKEY, res.token);
    const salt = uid(); writeJSON(OFFKEY, { salt, hash: await sha256(salt + code) });
    return begin('cloud', res.exp);
  }
  if (res.network) {
    const off = readJSON(OFFKEY, null);
    if (off) {
      if ((await sha256(off.salt + code)) === off.hash) return begin('cloud', Date.now() + CONFIG.SESSION_HOURS * 3600e3);
      return { wrong: true };
    }
    return { msg: 'Can’t reach the server. Check your connection.' };
  }
  if (res.noApi) {
    if ((await sha256(code)) === CONFIG.LOCAL_CODE_HASH) return begin('local', Date.now() + CONFIG.SESSION_HOURS * 3600e3);
    return { wrong: true };
  }
  return res;
}
function begin(mode, exp) {
  MODE = mode; localStorage.setItem(MODEKEY, mode); localStorage.setItem(SESSKEY, String(exp));
  writeJSON(ATTKEY, { n: 0, until: 0 });
  return { ok: true };
}
async function cloudLogin(code) {
  if (location.protocol === 'file:') return { noApi: true };
  let r;
  try { r = await fetch(CONFIG.API + '/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }), cache: 'no-store' }); }
  catch { return { network: true }; }
  if (r.status === 404 || r.status === 405) return { noApi: true };
  const j = await r.json().catch(() => ({}));
  if (r.ok && j.token) return { ok: true, token: j.token, exp: j.exp };
  if (r.status === 429) return { wait: j.retryAfter || 60 };
  if (r.status === 503) return { msg: 'Almost there: add ACCESS_CODE in Netlify’s environment variables.' };
  if (r.status === 401) return { wrong: true };
  return { network: true };
}
export function endSession() { try { localStorage.removeItem(SESSKEY); localStorage.removeItem(TOKKEY); } catch {} }

/* ---------- sync ---------- */
export let syncState = MODE === 'cloud' ? 'syncing' : 'local';
export let lastSync = 0;
export let firstSyncDone = MODE !== 'cloud';
let syncing = false, syncAgain = false, syncTimer = 0, migrated = readJSON(UIKEY, {}).migrated;
function setSync(s) { syncState = s; emit('sync', s); }
export function scheduleSync(ms = 700) { clearTimeout(syncTimer); syncTimer = setTimeout(sync, ms); }
async function api(path, opts = {}) {
  const r = await fetch(CONFIG.API + path, { ...opts, cache: 'no-store', headers: { 'content-type': 'application/json', ...(token() ? { authorization: 'Bearer ' + token() } : {}) } });
  let body = null; try { body = await r.json(); } catch {}
  if (!r.ok) { const e = new Error((body && body.error) || 'http_' + r.status); e.status = r.status; throw e; }
  return body;
}
export async function sync() {
  if (MODE !== 'cloud' || !token()) return;
  if (syncing) { syncAgain = true; return; }
  if (!navigator.onLine) { setSync('offline'); return; }
  syncing = true; setSync('syncing');
  let remote = null, ask = false;
  try {
    while (outbox.length) {
      const batch = outbox.slice(0, 150);
      await api('/sync', { method: 'POST', body: JSON.stringify({ ops: batch.map(({ kind, id, op, data, updatedAt }) => ({ kind, id, op, data, updatedAt })) }) });
      const sent = new Map(batch.map(o => [o.key, o.updatedAt]));
      outbox = outbox.filter(o => sent.get(o.key) !== o.updatedAt);
      writeJSON(OUTKEY, outbox);
    }
    remote = await api('/sync');
    remote.products = remote.products || [];
    const empty = !remote.docs.length && !remote.clients.length && !remote.products.length && !remote.settings;
    if (empty && (DB.docs.length || DB.clients.length) && !migrated) ask = true;
    else applyRemote(remote);
    lastSync = Date.now(); firstSyncDone = true; setSync('synced');
  } catch (e) {
    firstSyncDone = true;
    if (e.status === 401) { setSync('error'); emit('unauthorized'); }
    else setSync(navigator.onLine ? 'error' : 'offline');
  } finally {
    syncing = false;
    if (syncAgain) { syncAgain = false; scheduleSync(300); }
  }
  if (ask) emit('migrate', {
    counts: { docs: DB.docs.length, clients: DB.clients.length },
    resolve: up => { migrated = true; emit('migrated'); if (up) { enqueueEverything(); sync(); } else applyRemote(remote); }
  });
}
function applyRemote(remote) {
  const pending = new Map(outbox.map(o => [o.key, o]));
  const merge = (kind, list) => {
    const out = (list || []).filter(r => r && r.id && !pending.has(`${kind}:${r.id}`));
    outbox.forEach(o => { if (o.kind === kind && o.op === 'put') out.push(o.data); });
    return out;
  };
  const next = normalize({
    settings: pending.has('settings:settings') ? S() : (remote.settings || S()),
    docs: merge('doc', remote.docs), clients: merge('client', remote.clients), products: merge('product', remote.products),
    assets: merge('asset', remote.assets || [])
  });
  const diff = JSON.stringify(next) !== JSON.stringify(DB);
  DB = next; saveLocal();
  if (diff) changed('remote');
}
addEventListener('online', () => scheduleSync(200));
addEventListener('offline', () => { if (MODE === 'cloud') setSync('offline'); });
setInterval(() => { if (!document.hidden && sessionValid()) sync(); }, 45000);

/* =====================================================================
   Business logic
   ===================================================================== */
export const findDoc = id => DB.docs.find(d => d.id === id);
export const findClient = id => DB.clients.find(c => c.id === id);
export const invoices = () => DB.docs.filter(d => d.type === 'invoice');
export const receipts = () => DB.docs.filter(d => d.type === 'receipt');
export const byDateDesc = (a, b) => (b.issueDate || '').localeCompare(a.issueDate || '') || (b.createdAt || 0) - (a.createdAt || 0);

/* Line totals are rounded per line, then summed in cents. */
export const lineCents = i => Math.round(num(i.qty) * toCents(i.price));
export function totals(d) {
  const sub = (d.items || []).reduce((a, i) => a + lineCents(i), 0);
  const disc = d.discountType === 'pct' ? Math.round(sub * num(d.discount) / 100) : Math.min(toCents(d.discount), sub);
  const taxable = Math.max(sub - disc, 0);
  const tax = Math.round(taxable * num(d.taxRate) / 100);
  return { sub: fromCents(sub), disc: fromCents(disc), tax: fromCents(tax), total: fromCents(taxable + tax), totalCents: taxable + tax };
}
/* A receipt is a recorded payment. V1 receipts had no amount and carried the invoice's items. */
export const receiptCents = r => r.amount !== undefined && r.amount !== null && r.amount !== '' ? toCents(r.amount) : totals(r).totalCents;
export const receiptAmount = r => fromCents(receiptCents(r));
export const isVoid = r => !!r.voidedAt;
export const paymentsFor = inv => receipts().filter(r => r.linkedInvoiceId === inv.id && !isVoid(r)).sort((a, b) => (a.issueDate || '').localeCompare(b.issueDate || '') || (a.createdAt || 0) - (b.createdAt || 0));
/* V1 could mark an invoice paid without any receipt. That flag only counts while the
   invoice has never had a receipt; once receipts exist (even voided ones) they are the record. */
export const hasAnyReceipt = inv => receipts().some(r => r.linkedInvoiceId === inv.id);
export const legacyPaid = inv => inv.status === 'paid' && !hasAnyReceipt(inv);
export function paidCents(inv) {
  const pays = paymentsFor(inv);
  if (pays.length) return pays.reduce((a, r) => a + receiptCents(r), 0);
  return legacyPaid(inv) ? totals(inv).totalCents : 0;
}
export function balances(inv) {
  const total = totals(inv).totalCents, paid = paidCents(inv);
  return { total: fromCents(total), paid: fromCents(paid), balance: fromCents(Math.max(total - paid, 0)), totalCents: total, paidCents: paid, balanceCents: Math.max(total - paid, 0) };
}
export const STATUS = {
  draft: 'Draft', issued: 'Unpaid', sent: 'Sent', partial: 'Part paid', paid: 'Paid', overdue: 'Late', cancelled: 'Cancelled', void: 'Void', receipt: 'Receipt'
};
/* Status is derived from the record and its payments, never assigned by hand. */
export function invoiceStatus(inv) {
  if (inv.cancelledAt) return 'cancelled';
  if (inv.status === 'draft') return 'draft';
  const b = balances(inv);
  if (b.totalCents > 0 && b.balanceCents === 0) return 'paid';
  if (inv.dueDate && inv.dueDate < todayISO()) return 'overdue';
  if (b.paidCents > 0) return 'partial';
  if (inv.sentAt) return 'sent';
  return 'issued';
}
export const docStatus = d => d.type === 'receipt' ? (isVoid(d) ? 'void' : 'receipt') : invoiceStatus(d);
export const countsAsIssued = inv => inv.status !== 'draft' && !inv.cancelledAt;

/* Numbering: prefix + zero-padded counter. The next number looks at existing records,
   so a number is never reused, even across devices. */
/* Prefixes may contain {YYYY}, e.g. "INV-{YYYY}-" gives INV-2026-0001. */
export function resolvedPrefix(type) {
  const s = S(), raw = String((type === 'invoice' ? s.invPrefix : s.rctPrefix) ?? '');
  return raw.replace(/\{YYYY\}/g, String(new Date().getFullYear()));
}
const digits = () => Math.min(8, Math.max(1, num(S().numberDigits) || 4));
export const formatNumber = (type, n) => resolvedPrefix(type) + String(n).padStart(digits(), '0');
function nextSeq(type) {
  const s = S(), prefix = resolvedPrefix(type);
  let max = 0;
  for (const d of DB.docs) {
    if (d.type !== type || !String(d.number || '').startsWith(prefix)) continue;
    const n = parseInt(String(d.number).slice(prefix.length), 10);
    if (n > max) max = n;
  }
  return Math.max(Math.max(1, Math.floor(num(type === 'invoice' ? s.nextInv : s.nextRct)) || 1), max + 1);
}
export const nextNumber = type => formatNumber(type, nextSeq(type));
/* Final numbers are claimed from the server when saving, so two devices can never get the
   same one. Offline or without the server, the next local number is used. */
export async function claimNumber(type, docId, exact) {
  if (exact && numberTaken(exact, docId)) return { taken: true };
  const local = () => ({ number: exact || nextNumber(type), local: true });
  if (MODE !== 'cloud' || !token() || !navigator.onLine) return local();
  try {
    const r = await api('/claim', { method: 'POST', body: JSON.stringify({ type, prefix: resolvedPrefix(type), digits: digits(), start: nextSeq(type), docId, exact: exact || undefined }) });
    return { number: r.number };
  } catch (e) {
    if (e.status === 409) return { taken: true };
    if (e.status === 401) { emit('unauthorized'); throw e; }
    return local();
  }
}
/* Business details are copied onto each document when it is saved, so changing Settings
   later never rewrites an invoice that was already issued. */
function logoAssetId() {
  const l = S().logo;
  if (!l) return '';
  if (l === 'none') return 'none';
  let h = 5381; for (let i = 0; i < l.length; i += 3) h = ((h << 5) + h + l.charCodeAt(i)) | 0;
  const id = `logo-${(h >>> 0).toString(36)}-${l.length.toString(36)}`;
  if (!DB.assets.some(a => a.id === id)) putAsset({ id, kind: 'logo', data: l });
  return id;
}
export function snapshotBiz() {
  const s = S();
  return { businessName: s.businessName, address: s.address, phone: s.phone, email: s.email, website: s.website, taxId: s.taxId, payment: s.payment, taxLabel: s.taxLabel, footer: s.footer, logoId: logoAssetId() };
}
export const assetData = id => (DB.assets.find(a => a.id === id) || {}).data;
export const numberTaken = (number, id) => DB.docs.some(d => d.id !== id && String(d.number).trim().toLowerCase() === String(number).trim().toLowerCase());

/* Clients */
export const normName = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
export const normPhone = s => String(s || '').replace(/\D/g, '').replace(/^233/, '0');
export function findDuplicateClient(c, exceptId) {
  return DB.clients.find(x => x.id !== exceptId && (
    (c.name && normName(x.name) === normName(c.name)) ||
    (c.email && x.email && x.email.trim().toLowerCase() === c.email.trim().toLowerCase()) ||
    (c.phone && x.phone && normPhone(x.phone).length >= 9 && normPhone(x.phone) === normPhone(c.phone))));
}
export function clientSummary(c, cur = S().currency) {
  const docs = DB.docs.filter(d => d.clientId === c.id);
  const invs = docs.filter(d => d.type === 'invoice' && countsAsIssued(d) && d.currency === cur);
  const rcts = docs.filter(d => d.type === 'receipt' && !isVoid(d) && d.currency === cur);
  const invoiced = invs.reduce((a, d) => a + totals(d).totalCents, 0);
  const paidOnInvoices = invs.reduce((a, d) => a + paidCents(d), 0);
  const standalone = rcts.filter(r => !r.linkedInvoiceId).reduce((a, r) => a + receiptCents(r), 0);
  const outstanding = invs.reduce((a, d) => a + balances(d).balanceCents, 0);
  const lastPay = rcts.map(r => r.issueDate).sort().pop() || '';
  return { docs, invoices: docs.filter(d => d.type === 'invoice'), receipts: docs.filter(d => d.type === 'receipt'),
    invoiced: fromCents(invoiced), paid: fromCents(paidOnInvoices + standalone), outstanding: fromCents(outstanding), lastPay };
}

/* Aggregates for dashboard & reports, in one currency. */
export function aggregate(range, cur = S().currency) {
  const invs = invoices().filter(d => countsAsIssued(d) && d.currency === cur);
  const inPeriod = invs.filter(d => d.issueDate >= range.from && d.issueDate <= range.to);
  const pays = receipts().filter(r => !isVoid(r) && r.currency === cur && r.issueDate >= range.from && r.issueDate <= range.to);
  // V1 invoices marked paid without a receipt count as a payment on their paid date
  const legacy = invs.filter(d => legacyPaid(d) && (d.paidDate || d.issueDate) >= range.from && (d.paidDate || d.issueDate) <= range.to);
  const open = invs.filter(d => balances(d).balanceCents > 0);
  const overdue = open.filter(d => invoiceStatus(d) === 'overdue');
  const otherCur = DB.docs.filter(d => d.currency && d.currency !== cur).length;
  return {
    invoiced: fromCents(inPeriod.reduce((a, d) => a + totals(d).totalCents, 0)),
    invoicedCount: inPeriod.length,
    received: fromCents(pays.reduce((a, r) => a + receiptCents(r), 0) + legacy.reduce((a, d) => a + totals(d).totalCents, 0)),
    receiptsCount: pays.length,
    outstanding: fromCents(open.reduce((a, d) => a + balances(d).balanceCents, 0)),
    openCount: open.length,
    overdue: fromCents(overdue.reduce((a, d) => a + balances(d).balanceCents, 0)),
    overdueList: overdue,
    otherCur, payments: pays, legacy, invoicesInPeriod: inPeriod
  };
}
export function monthlySeries(months, cur = S().currency) {
  const invs = invoices().filter(d => countsAsIssued(d) && d.currency === cur);
  const pays = receipts().filter(r => !isVoid(r) && r.currency === cur);
  const legacy = invs.filter(legacyPaid);
  return months.map(k => ({
    key: k,
    invoiced: fromCents(invs.filter(d => (d.issueDate || '').startsWith(k)).reduce((a, d) => a + totals(d).totalCents, 0)),
    received: fromCents(pays.filter(r => (r.issueDate || '').startsWith(k)).reduce((a, r) => a + receiptCents(r), 0)
      + legacy.filter(d => (d.paidDate || d.issueDate || '').startsWith(k)).reduce((a, d) => a + totals(d).totalCents, 0))
  }));
}

/* New records */
export function newInvoice(client) {
  const s = S(), t = todayISO(), days = num(s.dueDays);
  return {
    id: uid(), type: 'invoice', number: nextNumber('invoice'), status: 'issued',
    clientId: client ? client.id : null,
    client: client ? { name: client.name, email: client.email || '', phone: client.phone || '', address: client.address || '' } : { name: '', email: '', phone: '', address: '' },
    issueDate: t, terms: String(days), dueDate: addDays(t, days), currency: s.currency,
    items: [{ id: uid(), desc: '', qty: 1, price: '' }],
    discount: '', discountType: 'pct', taxRate: num(s.taxRate) || '',
    notes: s.defaultNotes || '', termsText: s.defaultTerms || '', showPayment: s.showPayment !== false, footer: s.footer || '',
    template: s.template || 'classic', createdAt: Date.now()
  };
}
export function newReceipt(inv, client) {
  const s = S(), t = todayISO();
  const r = {
    id: uid(), type: 'receipt', number: nextNumber('receipt'), issueDate: t, currency: s.currency,
    clientId: null, client: { name: '', email: '', phone: '', address: '' },
    amount: '', paymentMethod: s.defaultMethod || 'Mobile Money', reference: '', description: '', notes: '', linkedInvoiceId: null, createdAt: Date.now()
  };
  if (inv) {
    const b = balances(inv);
    Object.assign(r, { linkedInvoiceId: inv.id, invoiceNumber: inv.number, currency: inv.currency, clientId: inv.clientId, client: { ...inv.client }, amount: b.balance ? b.balance.toFixed(2) : '', description: `Invoice ${inv.number}` });
  } else if (client) {
    Object.assign(r, { clientId: client.id, client: { name: client.name, email: client.email || '', phone: client.phone || '', address: client.address || '' } });
  }
  return r;
}
export const METHODS = ['Mobile Money', 'Cash', 'Bank transfer', 'Card', 'Cheque', 'Other'];
export const TERMS = [['0', 'Due on receipt'], ['7', 'Net 7'], ['14', 'Net 14'], ['30', 'Net 30'], ['60', 'Net 60'], ['custom', 'Custom date']];
