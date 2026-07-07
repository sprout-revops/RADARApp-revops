// Verified per-dashboard access check. A published dashboard's injected guard calls this
// with the viewer's Google token; we verify it server-side (@sprout.ph) and check the email
// against the dashboard's access list. Owner + DASH_ADMINS always have edit access.
const https = require('https');
const { verifyGoogleToken } = require('./_verify.js');

// Vercel-served copy honors cache-busting (GitHub raw CDN ignores query strings and lags ~5 min)
const REGISTRY_RAW = 'https://radar-revops.vercel.app/user-dashboards/registry.json';
const DASH_ADMINS = ['lurbina@sprout.ph', 'apanares@sprout.ph'];

function getJson(url) {
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': 'RADAR-RevOps' } }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve(null); } });
    }).on('error', () => resolve(null));
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-radar-token');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const id = req.query.id;
  if (!id) return res.status(400).json({ allowed: false, reason: 'missing-id' });

  let email = '';
  try {
    const v = await verifyGoogleToken(req.headers['x-radar-token']);
    email = v.email;
  } catch (e) {
    return res.status(200).json({ allowed: false, reason: 'signin' });
  }

  const reg = await getJson(REGISTRY_RAW + '?_=' + Date.now());
  const list = (reg && reg.dashboards) || [];
  const d = list.find(x => x.id === id);
  if (!d) return res.status(200).json({ allowed: false, reason: 'notfound', email });

  const isOwner = (d.ownerEmail || '').toLowerCase() === email;
  const isAdmin = DASH_ADMINS.indexOf(email) !== -1;
  const acc = (d.access || []).find(a => (a.email || '').toLowerCase() === email);

  let allowed = false, level = 'view';
  if (isOwner || isAdmin) { allowed = true; level = 'edit'; }
  else if (acc) { allowed = true; level = (acc.level === 'edit') ? 'edit' : 'view'; }

  return res.status(200).json({ allowed, level, email });
};
