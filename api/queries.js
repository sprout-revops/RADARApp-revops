const https = require('https');
const { verifyGoogleToken } = require('./_verify.js');

// Saved Queries ("Data Recipes"): named, reusable SQL queries against shared.revops that
// RevOps authors once and app teams connect to via the Connect flow. Stored as a registry
// index in the RADAR repo (served same-origin from Vercel). No Databricks views needed.
const REPO     = 'sprout-revops/RADARApp-revops';
const BRANCH   = 'master';
const REG_PATH = 'saved-queries/registry.json';
const DASH_ADMINS = ['lurbina@sprout.ph', 'apanares@sprout.ph'];

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

function slugify(s) {
  return String(s || 'query').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'query';
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-radar-token');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.GITHUB_TOKEN;
  if (!token) return res.status(500).json({ error: 'GITHUB_TOKEN not configured in Vercel env vars.' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch(e) { return res.status(400).json({ error: 'Invalid JSON body.' }); }
  }
  body = body || {};
  const action = body.action;

  // @sprout.ph gate; authoring (save/delete) is restricted to the RevOps admins.
  let email = '';
  try {
    const v = await verifyGoogleToken(req.headers['x-radar-token']);
    email = v.email;
  } catch (e) {
    return res.status(401).json({ error: 'Sign in with your @sprout.ph account. (' + e.message + ')' });
  }
  if (DASH_ADMINS.indexOf(email) === -1) {
    return res.status(403).json({ error: 'Only the RevOps team can author saved queries.' });
  }

  const authHeaders = {
    'Authorization': 'token ' + token,
    'User-Agent':    'RADAR-RevOps',
    'Accept':        'application/vnd.github.v3+json'
  };

  async function getRegistry() {
    const r = await ghRequest({
      hostname: 'api.github.com',
      path: `/repos/${REPO}/contents/${REG_PATH}?ref=${BRANCH}`,
      method: 'GET', headers: authHeaders
    });
    if (r.status === 200) {
      const json = JSON.parse(Buffer.from(r.body.content, 'base64').toString('utf-8'));
      return { data: json.queries ? json : { queries: [] }, sha: r.body.sha };
    }
    return { data: { queries: [] }, sha: undefined };
  }

  async function putRegistry(data, sha, message) {
    const putBody = JSON.stringify({
      message, branch: BRANCH,
      content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
      ...(sha ? { sha } : {})
    });
    return ghRequest({
      hostname: 'api.github.com',
      path: `/repos/${REPO}/contents/${REG_PATH}`,
      method: 'PUT',
      headers: { ...authHeaders, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(putBody) }
    }, putBody);
  }

  try {
    if (action === 'save') {
      if (!body.name || !body.sql) return res.status(400).json({ error: 'Missing name or sql.' });
      const id = body.id || (slugify(body.name) + '-' + Date.now().toString(36));
      const { data, sha } = await getRegistry();
      const now = new Date().toISOString();
      let entry = data.queries.find(q => q.id === id);
      if (entry) {
        entry.name = body.name; entry.description = body.description || '';
        entry.tags = body.tags || entry.tags || []; entry.sql = body.sql;
        entry.updatedAt = now;
      } else {
        entry = {
          id, name: body.name, description: body.description || '',
          tags: body.tags || [], sql: body.sql,
          ownerEmail: email, ownerName: body.ownerName || email.split('@')[0],
          createdAt: now, updatedAt: now
        };
        data.queries.push(entry);
      }
      const r = await putRegistry(data, sha, `Saved query: ${id} (${email})`);
      if (r.status !== 200 && r.status !== 201) return res.status(r.status).json({ error: r.body });
      return res.status(200).json({ ok: true, id });
    }

    if (action === 'delete') {
      const { data, sha } = await getRegistry();
      if (!data.queries.find(q => q.id === body.id)) return res.status(404).json({ error: 'Query not found.' });
      data.queries = data.queries.filter(q => q.id !== body.id);
      const r = await putRegistry(data, sha, `Delete saved query: ${body.id}`);
      if (r.status !== 200 && r.status !== 201) return res.status(r.status).json({ error: r.body });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
