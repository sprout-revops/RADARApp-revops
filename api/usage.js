// Admin-only RADAR usage summary. Reads the event list and aggregates it. Gated to verified
// @sprout.ph admins.
const { verifyGoogleToken } = require('./_verify.js');
const DASH_ADMINS = ['lurbina@sprout.ph', 'apanares@sprout.ph'];

function store() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const tok = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return (url && tok) ? { url, tok } : null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-radar-token');
  if (req.method === 'OPTIONS') return res.status(204).end();

  let email = '';
  try { const v = await verifyGoogleToken(req.headers['x-radar-token']); email = v.email; }
  catch (e) { return res.status(401).json({ error: 'Sign in with your @sprout.ph account.' }); }
  if (DASH_ADMINS.indexOf(email) === -1) return res.status(403).json({ error: 'Admin only.' });

  const s = store();
  if (!s) return res.status(200).json({ configured: false });

  let events = [];
  try {
    const r = await fetch(s.url, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + s.tok, 'Content-Type': 'application/json' },
      body: JSON.stringify(['LRANGE', 'radar:events', '0', '-1'])
    });
    const data = await r.json();
    events = (data.result || []).map(function(x){ try { return JSON.parse(x); } catch(e) { return null; } }).filter(Boolean);
  } catch (e) {
    return res.status(200).json({ configured: true, total: 0, error: 'read failed' });
  }

  const now = Date.now(), DAY = 86400000;
  const byAction = {}, byUser = {}, seen7 = {}, seen30 = {};
  events.forEach(function(e){
    byAction[e.action] = (byAction[e.action] || 0) + 1;
    byUser[e.email] = (byUser[e.email] || 0) + 1;
    const age = now - Date.parse(e.t || 0);
    if (age <= 7 * DAY)  seen7[e.email] = 1;
    if (age <= 30 * DAY) seen30[e.email] = 1;
  });
  const topUsers = Object.keys(byUser).map(function(u){ return { email: u, count: byUser[u] }; })
    .sort(function(a, b){ return b.count - a.count; }).slice(0, 50);

  return res.status(200).json({
    configured: true,
    total: events.length,
    activeUsers7: Object.keys(seen7).length,
    activeUsers30: Object.keys(seen30).length,
    uniqueUsers: Object.keys(byUser).length,
    byAction: byAction,
    topUsers: topUsers,
    recent: events.slice(0, 60)   // list is newest-first (LPUSH)
  });
};
