// Reusable interface pieces. Dialogs become bottom sheets on phones via CSS.
import { $, $$, esc, ic } from './util.js';

/* ---------- toasts ---------- */
export function toast(msg, opts = {}) {
  const host = $('#toasts');
  const t = document.createElement('div');
  t.className = 'toast' + (opts.error ? ' err' : '');
  t.setAttribute('role', opts.error ? 'alert' : 'status');
  t.innerHTML = `${ic(opts.error ? 'alert' : 'check')}<span>${esc(msg)}</span>${opts.action ? `<button type="button">${esc(opts.action)}</button>` : ''}`;
  const kill = () => { t.classList.add('out'); setTimeout(() => t.remove(), 200); };
  if (opts.action) t.querySelector('button').onclick = () => { kill(); opts.onAction(); };
  host.appendChild(t);
  while (host.children.length > 3) host.firstElementChild.remove();
  setTimeout(kill, opts.action ? 6000 : opts.error ? 5000 : 2800);
}

/* ---------- dialogs ---------- */
export const dialogs = [];
let lastFocus = null;
export function openDialog({ title, body, foot, width, onMount, onClose, bare }) {
  lastFocus = document.activeElement;
  const o = document.createElement('div');
  o.className = 'overlay';
  o.innerHTML = `<div class="overlay-bg"></div><div class="dialog" role="dialog" aria-modal="true"${title ? ' aria-labelledby="dlg-t"' : ''}${width ? ` style="--w:${width}px"` : ''}>
    <div class="grabber"></div>
    ${bare ? body : `${title ? `<div class="dlg-head"><h2 id="dlg-t">${title}</h2><button class="icon-btn" data-close aria-label="Close">${ic('close')}</button></div>` : ''}
    <div class="dlg-body">${body || ''}</div>${foot ? `<div class="dlg-foot">${foot}</div>` : ''}`}</div>`;
  document.body.appendChild(o);
  document.body.classList.add('no-scroll');
  const api = { el: o, body: $('.dialog', o), closed: false, close };
  function close(val) {
    if (api.closed) return; api.closed = true;
    o.classList.remove('open');
    dialogs.splice(dialogs.indexOf(api), 1);
    if (!dialogs.length) document.body.classList.remove('no-scroll');
    setTimeout(() => o.remove(), 220);
    onClose && onClose(val);
    if (lastFocus && lastFocus.focus) try { lastFocus.focus({ preventScroll: true }); } catch {}
  }
  dialogs.push(api);
  $('.overlay-bg', o).addEventListener('click', () => close());
  o.addEventListener('click', e => { if (e.target.closest('[data-close]')) close(); });
  o.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const f = $$('button,input,select,textarea,a[href],[tabindex]:not([tabindex="-1"])', api.body).filter(x => !x.disabled && x.offsetParent);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  });
  onMount && onMount(api.body, api);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    o.classList.add('open');
    const first = $('[autofocus]', api.body) || $('input:not([type=hidden]),select,textarea', api.body) || $('.dlg-foot .btn-primary,.dlg-foot .btn-danger', api.body);
    if (first && matchMedia('(min-width:768px)').matches) first.focus({ preventScroll: true });
  }));
  return api;
}
export function closeAllDialogs() { [...dialogs].forEach(d => d.close()); }
export function confirmDialog({ title, message, ok = 'Confirm', cancel = 'Cancel', danger = false }) {
  return new Promise(res => {
    let done = false;
    const d = openDialog({
      title: esc(title), width: 420,
      body: `<p>${esc(message)}</p>`,
      foot: `<button class="btn btn-secondary" data-c="0">${esc(cancel)}</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-c="1">${esc(ok)}</button>`,
      onMount(b) { b.addEventListener('click', e => { const c = e.target.closest('[data-c]'); if (c) { done = true; res(c.dataset.c === '1'); d.close(); } }); },
      onClose() { if (!done) res(false); }
    });
  });
}

/* ---------- popover menu ---------- */
let openMenu = null;
export function closeMenu() { if (openMenu) { openMenu.anchor.setAttribute('aria-expanded', 'false'); openMenu.el.remove(); openMenu = null; } }
/* items: [{label, icon, onClick, danger, disabled}] | 'sep' | {heading} */
export function showMenu(anchor, items, opts = {}) {
  if (openMenu && openMenu.anchor === anchor) { closeMenu(); return; }
  closeMenu();
  const el = document.createElement('div');
  el.className = 'menu'; el.setAttribute('role', 'menu');
  el.innerHTML = items.filter(Boolean).map((it, i) => it === 'sep' ? '<div class="menu-sep"></div>'
    : it.heading ? `<div class="menu-label">${esc(it.heading)}</div>`
    : `<button class="menu-item${it.danger ? ' danger' : ''}${it.on ? ' on' : ''}" role="menuitem" data-i="${i}"${it.disabled ? ' disabled' : ''}>${it.icon ? ic(it.icon) : ''}<span>${esc(it.label)}</span>${it.on ? `<span style="margin-left:auto">${ic('check')}</span>` : ''}</button>`).join('');
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect(), mw = Math.max(el.offsetWidth, opts.width || 0), mh = el.offsetHeight;
  let left = opts.alignLeft ? r.left : r.right - mw; left = Math.max(8, Math.min(left, innerWidth - mw - 8));
  let top = r.bottom + 6; if (top + mh > innerHeight - 8) top = Math.max(8, r.top - mh - 6);
  if (opts.above) top = Math.max(8, r.top - mh - 6);
  Object.assign(el.style, { left: left + 'px', top: top + 'px', minWidth: (opts.width || 200) + 'px' });
  anchor.setAttribute('aria-expanded', 'true');
  openMenu = { el, anchor };
  requestAnimationFrame(() => el.classList.add('open'));
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-i]'); if (!b) return;
    const it = items.filter(Boolean)[+b.dataset.i]; closeMenu(); it.onClick && it.onClick();
  });
  el.addEventListener('keydown', e => {
    const btns = $$('.menu-item:not(:disabled)', el), i = btns.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length].focus(); }
  });
  if (opts.focus !== false && document.activeElement === anchor) { const f = $('.menu-item:not(:disabled)', el); if (f) f.focus(); }
}
document.addEventListener('pointerdown', e => { if (openMenu && !openMenu.el.contains(e.target) && !openMenu.anchor.contains(e.target)) closeMenu(); });
addEventListener('resize', closeMenu);
addEventListener('scroll', closeMenu, true);

/* ---------- chart tooltip ---------- */
let tip = null;
export function showTip(e, html) {
  if (!tip) { tip = document.createElement('div'); tip.className = 'chart-tip'; document.body.appendChild(tip); }
  tip.innerHTML = html; tip.classList.add('show');
  const w = tip.offsetWidth;
  tip.style.left = Math.min(innerWidth - w - 8, Math.max(8, e.clientX - w / 2)) + 'px';
  tip.style.top = (e.clientY - tip.offsetHeight - 12) + 'px';
}
export function hideTip() { if (tip) tip.classList.remove('show'); }

/* ---------- small helpers ---------- */
export function setFieldError(input, msg) {
  const f = input.closest('.field'); if (!f) return;
  f.classList.toggle('invalid', !!msg);
  let e = $('.err', f); if (!e) { e = document.createElement('div'); e.className = 'err'; f.appendChild(e); }
  e.textContent = msg || '';
  if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
}
export function clearErrors(root) { $$('.field.invalid', root).forEach(f => f.classList.remove('invalid')); $$('[aria-invalid]', root).forEach(i => i.removeAttribute('aria-invalid')); }
export const skeletonRows = (n = 6, cols = 'minmax(0,1fr) 120px 100px') =>
  Array.from({ length: n }, () => `<div class="tbl-row" style="--cols:${cols}"><span class="sk" style="width:${40 + Math.random() * 40}%"></span><span class="sk" style="width:70%"></span><span class="sk r" style="width:60%"></span></div>`).join('');
