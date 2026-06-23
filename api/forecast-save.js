const https = require('https');

const REPO   = 'sprout-revops/sales-dashboard';
const FILE   = 'forecast_snapshot.json';
const BRANCH = 'master';

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
  res.setHeader('Access-Control-Allow-Methods', 'PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.GITHUB_TOKEN;
  if (!token) return res.status(500).json({ error: 'GITHUB_TOKEN not configured in Vercel env vars.' });

  const authHeaders = {
    'Authorization': 'token ' + token,
    'User-Agent':    'RADAR-RevOps',
    'Accept':        'application/vnd.github.v3+json'
  };

  // 1. Get current file SHA (needed for updates)
  const getResp = await ghRequest({
    hostname: 'api.github.com',
    path:     `/repos/${REPO}/contents/${FILE}`,
    method:   'GET',
    headers:  authHeaders
  });
  const sha = getResp.status === 200 ? getResp.body.sha : undefined;

  // 2. Commit updated content
  const content  = Buffer.from(JSON.stringify(req.body, null, 2)).toString('base64');
  const putBody  = JSON.stringify({
    message: `Update forecast snapshot [${new Date().toISOString().slice(0, 10)}]`,
    content,
    branch: BRANCH,
    ...(sha ? { sha } : {})
  });

  const putResp = await ghRequest({
    hostname: 'api.github.com',
    path:     `/repos/${REPO}/contents/${FILE}`,
    method:   'PUT',
    headers:  { ...authHeaders, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(putBody) }
  }, putBody);

  if (putResp.status === 200 || putResp.status === 201) {
    return res.status(200).json({ ok: true });
  }
  return res.status(putResp.status).json({ error: putResp.body });
};
