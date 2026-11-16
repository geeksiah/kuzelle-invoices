// Document engine. One renderer feeds the live preview, printing and PDF export,
// so what you see is exactly what the client receives.
import { $, $$, esc, num, money, fmtDate, amountInWords, fromCents, toCents } from './util.js';
import { S, totals, balances, invoiceStatus, receiptCents, receiptAmount, findDoc, paymentsFor, isVoid, lineCents } from './store.js';
import { LOGO } from './brand.js';

const W = 794, H = 1123;   // A4 at 96 dpi

/* ---------- building blocks ---------- */
function logoHTML(s) {
  if (s.logo === 'none') return `<div class="d-bizname">${esc(s.businessName)}</div>`;
  return `<img class="d-logo" src="${s.logo || LOGO}" alt="${esc(s.businessName)}">`;
}
const lines = arr => arr.filter(Boolean).map(esc).join('\n');
function headBlock(d, s, title) {
  return `<div class="d-blk d-head">${logoHTML(s)}<div class="d-title"><div class="d-kind">${title}</div><div class="d-no">No. ${esc(d.number || '—')}</div></div></div>`;
}
function contBlock(d, s, title) {
  return `<div class="d-blk"><div class="d-cont"><b>${title} ${esc(d.number || '')}</b><span>${esc(s.businessName)}, continued</span></div></div>`;
}
function fromCol(s) {
  return `<div><div class="d-lbl">From</div><div class="d-strong">${esc(s.businessName)}</div><div class="d-muted">${lines([s.address, s.phone, s.email, s.website, s.taxId ? `Tax ID: ${s.taxId}` : ''])}</div></div>`;
}
function clientCol(d, label) {
  const c = d.client || {};
  return `<div><div class="d-lbl">${label}</div><div class="d-strong">${c.name ? esc(c.name) : '<span style="color:#A3A3AB">Client name</span>'}</div><div class="d-muted">${lines([c.address, c.phone, c.email])}</div></div>`;
}
const TH = `<div class="d-blk"><div class="d-th"><span></span><span>Description</span><span class="d-r">Qty</span><span class="d-r">Unit price</span><span class="d-r">Amount</span></div></div>`;
const rowHTML = (i, k, cur) => `<div class="d-blk"><div class="d-tr"><span class="idx">${k + 1}</span><span class="desc">${esc(i.desc) || '<span style="color:#A3A3AB">Item</span>'}</span><span class="d-r">${esc(num(i.qty))}</span><span class="d-r">${esc(money(num(i.price), cur))}</span><span class="d-r am">${esc(money(fromCents(lineCents(i)), cur))}</span></div></div>`;
const visibleItems = d => (d.items || []).filter(i => String(i.desc || '').trim() || num(i.price));

function invoiceBlocks(d) {
  const s = S(), cur = d.currency || s.currency, t = totals(d), m = n => esc(money(n, cur));
  const st = invoiceStatus(d), b = balances(d);
  const items = visibleItems(d);
  const pays = paymentsFor(d);
  const lastPay = pays.length ? pays[pays.length - 1].issueDate : d.paidDate;
  const stamp = st === 'paid' ? `<div class="d-stamp"><b>PAID</b><span>${esc(fmtDate(lastPay))}</span></div>`
    : st === 'partial' || (st === 'overdue' && b.paidCents > 0) ? `<div class="d-stamp partial"><b>PART PAID</b><span>${m(b.paid)} received</span></div>`
    : st === 'cancelled' ? `<div class="d-stamp void"><b>CANCELLED</b></div>`
    : st === 'draft' ? `<div class="d-stamp void" style="border-color:#8A8A93;color:#8A8A93"><b>DRAFT</b></div>` : '';
  const blocks = [
    { k: 'head', html: headBlock(d, s, 'Invoice') },
    { k: 'meta', html: `<div class="d-blk"><div class="d-meta">${clientCol(d, 'Billed to')}${fromCol(s)}<div class="d-dates"><div><div class="d-lbl">Issued</div>${esc(fmtDate(d.issueDate))}</div><div><div class="d-lbl">Due</div>${esc(fmtDate(d.dueDate))}</div></div></div></div>` },
    { k: 'th', html: TH }
  ];
  (items.length ? items : [{ desc: '', qty: 1, price: 0 }]).forEach((i, k) => blocks.push({ k: 'row', html: rowHTML(i, k, cur) }));
  blocks.push({ k: 'sum', html: `<div class="d-blk"><div class="d-sum"><div>${stamp}</div><div class="d-totals">
    <div class="ln"><span>Subtotal</span><span>${m(t.sub)}</span></div>
    ${t.disc ? `<div class="ln"><span>Discount${d.discountType === 'pct' ? ` (${esc(num(d.discount))}%)` : ''}</span><span>−${m(t.disc)}</span></div>` : ''}
    ${t.tax ? `<div class="ln"><span>${esc(s.taxLabel || 'Tax')} (${esc(num(d.taxRate))}%)</span><span>${m(t.tax)}</span></div>` : ''}
    <div class="ln grand"><span>${b.paidCents ? 'Total' : 'Total due'}</span><span class="v">${m(t.total)}</span></div>
    ${b.paidCents ? `<div class="ln sub"><span>Amount paid</span><span>−${m(b.paid)}</span></div><div class="ln bal"><span>Balance due</span><span>${m(b.balance)}</span></div>` : ''}
  </div></div></div>` });
  const pay = d.showPayment !== false && s.payment;
  if (pay || d.notes || d.termsText) {
    blocks.push({ k: 'extra', html: `<div class="d-blk"><div class="d-extra">
      ${pay ? `<div><div class="d-lbl">How to pay</div><p>${esc(s.payment)}</p></div>` : ''}
      ${d.notes ? `<div><div class="d-lbl">Notes</div><p>${esc(d.notes)}</p></div>` : ''}
      ${d.termsText ? `<div class="${pay && d.notes ? 'full' : ''}"><div class="d-lbl">Terms</div><p>${esc(d.termsText)}</p></div>` : ''}
    </div></div>` });
  }
  if (d.footer ?? s.footer) blocks.push({ k: 'close', html: `<div class="d-blk"><div class="d-close">${esc(d.footer ?? s.footer)}</div></div>` });
  return blocks;
}

function receiptBlocks(r) {
  const s = S(), cur = r.currency || s.currency, m = n => esc(money(n, cur));
  const amount = receiptAmount(r);
  const inv = r.linkedInvoiceId && findDoc(r.linkedInvoiceId);
  const legacyItems = (r.amount === undefined || r.amount === null || r.amount === '') && visibleItems(r).length;
  const blocks = [
    { k: 'head', html: headBlock(r, s, 'Receipt') },
    { k: 'meta', html: `<div class="d-blk"><div class="d-meta">${clientCol(r, 'Received from')}${fromCol(s)}<div class="d-dates"><div><div class="d-lbl">Date received</div>${esc(fmtDate(r.issueDate))}</div><div><div class="d-lbl">Payment method</div>${esc(r.paymentMethod || '—')}</div>${r.reference ? `<div><div class="d-lbl">Reference</div>${esc(r.reference)}</div>` : ''}</div></div></div>` },
    { k: 'amount', html: `<div class="d-blk"><div class="r-amount"><div><div class="lbl">Amount received</div><div class="v">${m(amount)}</div><div class="words">${esc(amountInWords(amount, cur))}</div></div>
      ${isVoid(r) ? `<div class="d-stamp void"><b>VOID</b><span>${esc(fmtDate((r.voidedAt || '').slice(0, 10)))}</span></div>` : `<div class="d-stamp"><b>PAID</b><span>${esc(fmtDate(r.issueDate))}</span></div>`}</div></div>` }
  ];
  const rows = [];
  rows.push(['Payment for', r.description || (inv ? `Invoice ${inv.number}` : r.invoiceNumber ? `Invoice ${r.invoiceNumber}` : '—')]);
  if (inv && !legacyItems) {
    const total = totals(inv).totalCents;
    const before = paymentsFor(inv).filter(p => p.id !== r.id && ((p.issueDate || '') < (r.issueDate || '') || ((p.issueDate || '') === (r.issueDate || '') && (p.createdAt || 0) < (r.createdAt || 0)))).reduce((a, p) => a + receiptCents(p), 0);
    const after = Math.max(total - before - receiptCents(r), 0);
    rows.push(['Invoice', `${inv.number}, issued ${fmtDate(inv.issueDate)}`]);
    rows.push(['Invoice total', money(fromCents(total), cur)]);
    if (before) rows.push(['Paid before this receipt', money(fromCents(before), cur)]);
    rows.push(['This payment', money(amount, cur)]);
    rows.push(['Balance remaining', after ? money(fromCents(after), cur) : 'Fully paid', 'strong']);
  } else if (r.invoiceNumber && !inv) rows.push(['Invoice', `${r.invoiceNumber} (removed)`]);
  blocks.push({ k: 'rrows', html: `<div class="d-blk"><div class="r-rows">${rows.map(([a, b, c]) => `<div class="r-row${c ? ' ' + c : ''}"><span>${esc(a)}</span><b>${esc(b)}</b></div>`).join('')}</div></div>` });
  if (legacyItems) {
    blocks.push({ k: 'gap', html: '<div class="d-blk" style="height:26px"></div>' }, { k: 'th', html: TH });
    visibleItems(r).forEach((i, k) => blocks.push({ k: 'row', html: rowHTML(i, k, cur) }));
  }
  if (r.notes) blocks.push({ k: 'extra', html: `<div class="d-blk"><div class="d-extra"><div class="full"><div class="d-lbl">Notes</div><p>${esc(r.notes)}</p></div></div></div>` });
  if (s.footer) blocks.push({ k: 'close', html: `<div class="d-blk"><div class="d-close">${esc(s.footer)}</div></div>` });
  return blocks;
}

/* ---------- pagination: measure every block, then fill A4 pages ---------- */
function measureHost() {
  let el = $('#measure');
  if (!el) { el = document.createElement('div'); el.id = 'measure'; el.setAttribute('aria-hidden', 'true'); document.body.appendChild(el); }
  return el;
}
const tplClass = d => `tpl-${d.template || S().template || 'classic'}`;
export function paginate(d) {
  const isR = d.type === 'receipt', s = S();
  const blocks = isR ? receiptBlocks(d) : invoiceBlocks(d);
  const title = isR ? 'Receipt' : 'Invoice';
  const cont = contBlock(d, s, title);
  const host = measureHost();
  host.innerHTML = `<div class="page ${tplClass(d)}" style="height:auto"><div class="pg-body m-flow">${cont}${blocks.map(b => b.html).join('')}</div></div>
    <div class="page ${tplClass(d)}"><div class="pg-body m-empty"></div><div class="pg-foot"><span>x</span></div></div>`;
  const flow = $('.m-flow', host).children;
  const contH = flow[0].offsetHeight;
  blocks.forEach((b, i) => { b.h = flow[i + 1].offsetHeight; });
  const avail = $('.m-empty', host).clientHeight;
  const thH = (blocks.find(b => b.k === 'th') || { h: 0 }).h;

  const pages = []; let cur = { html: [], h: 0 };
  const newPage = withTh => { pages.push(cur); cur = { html: [cont], h: contH }; if (withTh) { cur.html.push(TH); cur.h += thH; } };
  let inTable = false;
  for (const b of blocks) {
    if (b.k === 'th') inTable = true;
    else if (b.k !== 'row') inTable = false;
    if (cur.h + b.h > avail && cur.html.length > 1) newPage(b.k === 'row');
    cur.html.push(b.html); cur.h += b.h;
  }
  pages.push(cur);
  host.innerHTML = '';
  const foot = [s.businessName, s.phone, s.email].filter(Boolean).map(esc).join('&nbsp;&nbsp;/&nbsp;&nbsp;');
  return pages.map((p, i) => `<div class="page ${tplClass(d)}"><div class="pg-body">${p.html.join('')}</div><div class="pg-foot"><span>${foot}</span><span>${esc(d.number || '')}&nbsp;&nbsp;Page ${i + 1} of ${pages.length}</span></div></div>`);
}

/* ---------- live preview ---------- */
const ro = new ResizeObserver(es => es.forEach(e => fit(e.target)));
function fit(host) {
  const pad = host.dataset.pad ? +host.dataset.pad : 0;
  const max = host.dataset.max ? +host.dataset.max : 1;
  const w = host.clientWidth - pad;
  if (w > 0) host.style.setProperty('--s', Math.min(max, w / W).toFixed(4));
}
export function renderPreview(host, d) {
  const pages = paginate(d);
  host.innerHTML = `<div class="pages">${pages.map(p => `<div class="page-fit">${p}</div>`).join('')}</div>`;
  if (!host._ro) { ro.observe(host); host._ro = true; }
  fit(host);
  return pages.length;
}

/* ---------- print & PDF ---------- */
export const docFileName = d => `${d.number || (d.type === 'receipt' ? 'Receipt' : 'Invoice')}${d.client && d.client.name ? ' - ' + d.client.name.replace(/[\\/:*?"<>|]/g, '') : ''}`;
export function printDoc(d) {
  const root = $('#print-root');
  root.innerHTML = paginate(d).join('');
  const old = document.title;
  document.title = docFileName(d);
  const restore = () => { document.title = old; root.innerHTML = ''; removeEventListener('afterprint', restore); };
  addEventListener('afterprint', restore);
  setTimeout(() => window.print(), 80);
}
const loaded = {};
function loadScript(src) {
  return loaded[src] ||= new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => { delete loaded[src]; rej(new Error('Couldn’t load ' + src)); }; document.head.appendChild(s); });
}
async function ensureLibs() {
  if (!window.html2canvas) await loadScript('vendor/html2canvas.min.js');
  if (!window.jspdf) await loadScript('vendor/jspdf.umd.min.js');
}
export async function makePDF(d) {
  await ensureLibs();
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  const host = document.createElement('div');
  host.id = 'pdf-host';
  host.innerHTML = paginate(d).join('');
  document.body.appendChild(host);
  try {
    await Promise.all($$('img', host).map(img => img.complete ? null : new Promise(r => { img.onload = img.onerror = r; })));
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
    const pages = $$('.page', host);
    for (let i = 0; i < pages.length; i++) {
      const canvas = await window.html2canvas(pages[i], { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false, width: W, height: H, windowWidth: W, scrollX: 0, scrollY: 0 });
      if (i) pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.93), 'JPEG', 0, 0, 595.28, 841.89, undefined, 'FAST');
    }
    pdf.setProperties({ title: docFileName(d), creator: S().businessName });
    return pdf;
  } finally { host.remove(); }
}
export async function downloadPDF(d) { const pdf = await makePDF(d); pdf.save(docFileName(d) + '.pdf'); }
export async function pdfFile(d) { const pdf = await makePDF(d); return new File([pdf.output('blob')], docFileName(d) + '.pdf', { type: 'application/pdf' }); }
