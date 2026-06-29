const https = require('https');

// User-dashboard storage + Team Dashboards request/approval flow.
// Stores generated HTML under user-dashboards/<id>.html and a registry.json
// index in the RADAR app repo itself, so files are served from the same origin.
const REPO     = 'sprout-revops/RADARApp-revops';
const BRANCH   = 'master';
const REG_PATH = 'user-dashboards/registry.json';
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
  return String(s || 'dashboard').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'dashboard';
}

// Safety net: never let a Databricks token (or host/warehouse) land in the repo. Convert any
// literal credentials into runtime localStorage lookups — saved dashboards are same-origin
// with RADAR, so each viewer's own connection is used. Idempotent (already-converted code
// won't re-match). Applies regardless of whether the caller is the web UI or an MCP client.
function stripSecrets(html) {
  if (!html) return html;
  return String(html)
    .replace(/(['"])dapi[a-z0-9]{16,}\1/gi,                              "(localStorage.getItem('radar_db_token')||'')")
    .replace(/(['"])adb-[0-9]+\.[0-9]+\.azuredatabricks\.net\1/gi,       "(localStorage.getItem('radar_db_host')||'')")
    .replace(/(warehouse_?[Ii]d\s*:\s*)(['"])[a-z0-9]{8,}\2/g,          "$1((localStorage.getItem('radar_db_path')||'').split('/').pop())")
    .replace(/(['"])__DB_HOST__\1/g,                                     "(localStorage.getItem('radar_db_host')||'')")
    .replace(/(['"])__DB_TOKEN__\1/g,                                    "(localStorage.getItem('radar_db_token')||'')")
    .replace(/(['"])__DB_WAREHOUSE__\1/g,                                "((localStorage.getItem('radar_db_path')||'').split('/').pop())");
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');

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
  const email  = (body.ownerEmail || body.adminEmail || '').toLowerCase();

  const authHeaders = {
    'Authorization': 'token ' + token,
    'User-Agent':    'RADAR-RevOps',
    'Accept':        'application/vnd.github.v3+json'
  };

  // ── helpers to read/write the registry ──
  async function getRegistry() {
    const r = await ghRequest({
      hostname: 'api.github.com',
      path: `/repos/${REPO}/contents/${REG_PATH}?ref=${BRANCH}`,
      method: 'GET', headers: authHeaders
    });
    if (r.status === 200) {
      const json = JSON.parse(Buffer.from(r.body.content, 'base64').toString('utf-8'));
      return { data: json.dashboards ? json : { dashboards: [] }, sha: r.body.sha };
    }
    return { data: { dashboards: [] }, sha: undefined };
  }

  async function putFile(path, contentStr, message, sha) {
    const putBody = JSON.stringify({
      message, branch: BRANCH,
      content: Buffer.from(contentStr).toString('base64'),
      ...(sha ? { sha } : {})
    });
    return ghRequest({
      hostname: 'api.github.com',
      path: `/repos/${REPO}/contents/${path}`,
      method: 'PUT',
      headers: { ...authHeaders, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(putBody) }
    }, putBody);
  }

  async function getFileSha(path) {
    const r = await ghRequest({
      hostname: 'api.github.com',
      path: `/repos/${REPO}/contents/${path}?ref=${BRANCH}`,
      method: 'GET', headers: authHeaders
    });
    return r.status === 200 ? r.body.sha : undefined;
  }

  try {
    if (action === 'save') {
      if (!email || !body.html) return res.status(400).json({ error: 'Missing ownerEmail or html.' });
      const id   = body.id || (slugify(body.name) + '-' + Date.now().toString(36));
      const path = `user-dashboards/${id}.html`;
      const fileSha = body.id ? await getFileSha(path) : undefined;
      const safeHtml = stripSecrets(body.html);
      const putResp = await putFile(path, safeHtml, `Save dashboard ${id} (${email})`, fileSha);
      if (putResp.status !== 200 && putResp.status !== 201) {
        return res.status(putResp.status).json({ error: putResp.body });
      }
      const url = `https://radar-revops.vercel.app/${path}`;
      const { data, sha } = await getRegistry();
      const now = new Date().toISOString();
      let entry = data.dashboards.find(d => d.id === id);
      if (entry) {
        entry.name = body.name || entry.name;
        entry.desc = body.desc || entry.desc;
        entry.tags = body.tags || entry.tags;
        entry.updatedAt = now;
      } else {
        entry = {
          id, name: body.name || 'Untitled Dashboard',
          desc: body.desc || '', tags: body.tags || [],
          ownerEmail: email, ownerName: body.ownerName || email.split('@')[0],
          file: path, url, status: 'private',
          createdAt: now, updatedAt: now, requestedAt: null, publishedAt: null
        };
        data.dashboards.push(entry);
      }
      const regResp = await putFile(REG_PATH, JSON.stringify(data, null, 2), `Registry: save ${id}`, sha);
      if (regResp.status !== 200 && regResp.status !== 201) {
        return res.status(regResp.status).json({ error: regResp.body });
      }
      return res.status(200).json({ ok: true, id, url });
    }

    if (action === 'request' || action === 'delete' || action === 'approve' || action === 'reject') {
      const { data, sha } = await getRegistry();
      const entry = data.dashboards.find(d => d.id === body.id);
      if (!entry) return res.status(404).json({ error: 'Dashboard not found.' });
      const now = new Date().toISOString();
      const isAdmin = DASH_ADMINS.includes(email);
      const isOwner = entry.ownerEmail.toLowerCase() === email;

      if (action === 'request') {
        if (!isOwner) return res.status(403).json({ error: 'Only the owner can submit this dashboard.' });
        entry.status = 'requested'; entry.requestedAt = now;
      } else if (action === 'delete') {
        if (!isOwner && !isAdmin) return res.status(403).json({ error: 'Not allowed.' });
        // Remove the HTML file too, not just the registry entry
        if (entry.file) {
          const fsha = await getFileSha(entry.file);
          if (fsha) {
            const delBody = JSON.stringify({ message: `Delete dashboard ${body.id}`, sha: fsha, branch: BRANCH });
            await ghRequest({
              hostname: 'api.github.com',
              path: `/repos/${REPO}/contents/${entry.file}`,
              method: 'DELETE',
              headers: { ...authHeaders, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(delBody) }
            }, delBody);
          }
        }
        data.dashboards = data.dashboards.filter(d => d.id !== body.id);
      } else if (action === 'approve' || action === 'reject') {
        if (!isAdmin) return res.status(403).json({ error: 'Admin only.' });
        entry.status = action === 'approve' ? 'published' : 'rejected';
        if (action === 'approve') entry.publishedAt = now;
      }
      const regResp = await putFile(REG_PATH, JSON.stringify(data, null, 2), `Registry: ${action} ${body.id}`, sha);
      if (regResp.status !== 200 && regResp.status !== 201) {
        return res.status(regResp.status).json({ error: regResp.body });
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
