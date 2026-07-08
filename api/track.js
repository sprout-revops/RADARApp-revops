// Lightweight usage event logger. Pushes {t, action, email, meta} onto a capped Redis list
// via the Upstash/Vercel-KV REST API. Fire-and-forget; if no store is configured it no-ops.
function store() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const tok = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return (url && tok) ? { url, tok } : null;
}
async function redis(cmd) {
  const s = store(); if (!s) return null;
  const r = await fetch(s.url, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + s.tok, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd)
  });
  return r.json();
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!store()) return res.status(200).json({ ok: false, reason: 'no-store' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) { body = {}; } }
  body = body || {};
  const ev = {
    t: new Date().toISOString(),
    action: String(body.action || 'unknown').slice(0, 40),
    email: String(body.email || 'anonymous').toLowerCase().slice(0, 80),
    meta: String(body.meta || '').slice(0, 160)
  };
  try {
    await redis(['LPUSH', 'radar:events', JSON.stringify(ev)]);
    await redis(['LTRIM', 'radar:events', '0', '9999']);   // keep last 10k events
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(200).json({ ok: false });
  }
};
