// Kuzelle API — runs as a Netlify Function, stores data in Netlify Blobs.
// Required environment variable (Netlify → Site configuration → Environment variables):
//   ACCESS_CODE      the login code (digits only, same length as CODE_LENGTH in index.html)
// Optional:
//   SESSION_SECRET   any long random text; if missing, one is derived from ACCESS_CODE
//   SESSION_HOURS    how long a login lasts (default 12)
import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';

export const config = { path: '/api/*' };

const MAX_OPS = 200;
const MAX_RECORD_BYTES = 250_000;
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const LOGIN_LIMIT = 6;            // wrong codes allowed per window, per visitor
const LOGIN_WINDOW_MS = 10 * 60e3;

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
});
const code = () => String(process.env.ACCESS_CODE || '').trim();
const hours = () => Math.max(1, Number(process.env.SESSION_HOURS) || 12);
const secret = () => process.env.SESSION_SECRET || crypto.createHash('sha256').update('kuzelle-session:' + code()).digest('hex');
const sha = s => crypto.createHash('sha256').update(String(s)).digest();
const hmac = s => crypto.createHmac('sha256', secret()).update(s).digest('base64url');
const safeEq = (a, b) => a.length === b.length && crypto.timingSafeEqual(a, b);

function issueToken() {
  const exp = Date.now() + hours() * 3600e3;
  const p = Buffer.from(JSON.stringify({ exp })).toString('base64url');
  return { token: `${p}.${hmac(p)}`, exp };
}
function authed(req) {
  const t = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const [p, s] = t.split('.');
  if (!p || !s || !safeEq(Buffer.from(s), Buffer.from(hmac(p)))) return false;
  try { return JSON.parse(Buffer.from(p, 'base64url').toString()).exp > Date.now(); } catch { return false; }
}

const data = () => getStore({ name: 'kuzelle', consistency: 'strong' });
const auth = () => getStore({ name: 'kuzelle-auth', consistency: 'strong' });
const keyFor = (kind, id) => kind === 'settings' ? 'settings' : kind === 'doc' ? `doc/${id}` : kind === 'client' ? `client/${id}` : null;

async function mapLimit(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

async function readAll() {
  const store = data();
  const read = async prefix => {
    const { blobs } = await store.list({ prefix });
    return (await mapLimit(blobs, 24, b => store.get(b.key, { type: 'json' }))).filter(Boolean);
  };
  const [docs, clients, settings] = await Promise.all([read('doc/'), read('client/'), store.get('settings', { type: 'json' })]);
  return { docs, clients, settings: settings || null, serverTime: Date.now() };
}

async function applyOps(ops) {
  const store = data();
  return mapLimit(ops, 8, async op => {
    const { kind, id, updatedAt } = op || {};
    const key = keyFor(kind, id);
    const res = { kind, id };
    if (!key || (kind !== 'settings' && !ID_RE.test(String(id)))) return { ...res, ok: false, error: 'bad_key' };
    if (op.op === 'del') { await store.delete(key); return { ...res, ok: true }; }
    if (op.op !== 'put' || !op.data || typeof op.data !== 'object') return { ...res, ok: false, error: 'bad_op' };
    if (kind !== 'settings' && op.data.id !== id) return { ...res, ok: false, error: 'id_mismatch' };
    if (JSON.stringify(op.data).length > MAX_RECORD_BYTES) return { ...res, ok: false, error: 'too_large' };
    // last write wins, judged by the time the change was made on the device
    const current = await store.getMetadata(key);
    const ts = Number(updatedAt) || Date.now();
    if (current && Number(current.metadata?.updatedAt) > ts) return { ...res, ok: true, kept: 'server' };
    await store.setJSON(key, op.data, { metadata: { updatedAt: ts } });
    return { ...res, ok: true };
  });
}

async function login(req, context) {
  const who = sha(context?.ip || req.headers.get('x-nf-client-connection-ip') || 'unknown').toString('hex').slice(0, 32);
  const store = auth();
  const key = `ip/${who}`;
  const rec = (await store.get(key, { type: 'json' })) || { n: 0, since: Date.now() };
  if (Date.now() - rec.since > LOGIN_WINDOW_MS) { rec.n = 0; rec.since = Date.now(); }
  if (rec.n >= LOGIN_LIMIT) {
    return json({ error: 'too_many', retryAfter: Math.ceil((rec.since + LOGIN_WINDOW_MS - Date.now()) / 1000) }, 429);
  }
  let body = {};
  try { body = await req.json(); } catch {}
  if (safeEq(sha(body.code ?? ''), sha(code()))) {
    await store.delete(key);
    return json(issueToken());
  }
  rec.n++;
  await store.setJSON(key, rec);
  await new Promise(r => setTimeout(r, 400));
  return json({ error: 'wrong_code', left: LOGIN_LIMIT - rec.n }, 401);
}

export default async (req, context) => {
  const route = new URL(req.url).pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
  try {
    if (route === 'health') return json({ ok: true, configured: !!code() });
    if (!code()) return json({ error: 'not_configured' }, 503);
    if (route === 'login' && req.method === 'POST') return await login(req, context);
    if (!authed(req)) return json({ error: 'unauthorized' }, 401);
    if (route === 'sync' && req.method === 'GET') return json(await readAll());
    if (route === 'sync' && req.method === 'POST') {
      let body = {};
      try { body = await req.json(); } catch { return json({ error: 'bad_json' }, 400); }
      const ops = Array.isArray(body.ops) ? body.ops : [];
      if (ops.length > MAX_OPS) return json({ error: 'too_many_ops', max: MAX_OPS }, 413);
      return json({ results: await applyOps(ops) });
    }
    return json({ error: 'not_found' }, 404);
  } catch (err) {
    console.error(err);
    return json({ error: 'server_error' }, 500);
  }
};
