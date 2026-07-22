// Publish the Accelerator snapshot (manual hit/miss marks) to the shared file so all users see it.
// Admin-only (@sprout.ph, on the accel admin list). Writes the embedded Sales-dashboard copy that
// RADAR serves, so the standalone + RADAR views stay in sync via the mirror on the next data push.
const https = require('https');
const { verifyGoogleToken } = require('./_verify.js');

const REPO   = 'sprout-revops/RADARApp-revops';
const BRANCH = 'master';
const ACCEL_PATH = 'dashboards/sales-dashboard/accel_snapshot.json';
const ACCEL_ADMINS = ['apanares@sprout.ph', 'lurbina@sprout.ph', 'louieb@sprout.ph'];

function ghRequest(opts, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-radar-token');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.GITHUB_TOKEN;
  if (!token) return res.status(500).json({ error: 'GITHUB_TOKEN not configured in Vercel env vars.' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) { return res.status(400).json({ error: 'Invalid JSON body.' }); } }
  body = body || {};

  // Identity gate — verified @sprout.ph token, must be on the accel admin list.
  let email = '';
  try { const v = await verifyGoogleToken(req.headers['x-radar-token']); email = (v.email || '').toLowerCase(); }
  catch (e) { return res.status(401).json({ error: 'Sign in with your @sprout.ph account. (' + e.message + ')' }); }
  if (!ACCEL_ADMINS.includes(email)) return res.status(403).json({ error: 'Only Accelerator admins can publish.' });

  const snapshot = body.snapshot;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return res.status(400).json({ error: 'Missing or invalid snapshot object.' });
  }
  // Only allow known values (defensive).
  for (const k of Object.keys(snapshot)) {
    if (!['hit','miss','skip'].includes(snapshot[k])) delete snapshot[k];
  }

  const authHeaders = { 'Authorization': 'token ' + token, 'User-Agent': 'RADAR-RevOps', 'Accept': 'application/vnd.github.v3+json' };

  try {
    // current sha (if the file exists)
    const cur = await ghRequest({
      hostname: 'api.github.com', path: `/repos/${REPO}/contents/${ACCEL_PATH}?ref=${BRANCH}`,
      method: 'GET', headers: authHeaders
    });
    const sha = cur.status === 200 ? cur.body.sha : undefined;

    const content = JSON.stringify(snapshot);
    const putBody = JSON.stringify({
      message: `Accelerator: publish snapshot (${email})`,
      branch: BRANCH,
      content: Buffer.from(content).toString('base64'),
      ...(sha ? { sha } : {})
    });
    const put = await ghRequest({
      hostname: 'api.github.com', path: `/repos/${REPO}/contents/${ACCEL_PATH}`,
      method: 'PUT', headers: { ...authHeaders, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(putBody) }
    }, putBody);
    if (put.status !== 200 && put.status !== 201) return res.status(put.status).json({ error: put.body });

    return res.status(200).json({ ok: true, count: Object.keys(snapshot).length });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
