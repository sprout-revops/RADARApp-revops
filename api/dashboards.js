const https = require('https');
const { verifyGoogleToken } = require('./_verify.js');

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

// Access guard injected into a published dashboard's HTML. On load it verifies the viewer's
// @sprout.ph token against the dashboard's access list (via /api/dashboard-access) and blocks
// the view for anyone not on the list. Injected once (marker: data-radar-access-guard).
function buildGuard(id) {
  const jid = JSON.stringify(id);
  return `<script data-radar-access-guard>(function(){
  var ID=${jid};
  document.documentElement.style.visibility='hidden';
  function block(msg){try{document.documentElement.style.visibility='';document.body.innerHTML='<div style="font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;background:#0a0a0a;color:#e2e8f0;padding:24px"><div><div style="font-size:44px">&#128274;</div><div style="font-size:18px;font-weight:700;margin-top:14px">'+msg+'</div></div></div>';}catch(e){}}
  fetch('https://radar-revops.vercel.app/api/dashboard-access?id='+encodeURIComponent(ID)+'&_='+Date.now(),{headers:{'x-radar-token':localStorage.getItem('radar_id_token')||''}})
    .then(function(r){return r.json();})
    .then(function(j){
      if(j&&j.allowed){document.documentElement.style.visibility='';}
      else if(j&&j.reason==='signin'){block('Sign in to RADAR with your @sprout.ph account to view this dashboard.');}
      else{block('You do not have access to this dashboard.<br><span style="font-size:13px;font-weight:400;color:#94a3b8">Ask the owner to share it with your account.</span>');}
    })
    .catch(function(){document.documentElement.style.visibility='';});
})();</script>`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-radar-token, x-internal-secret');

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

  // Identity gate. Web callers present a verified @sprout.ph Google token; the verified
  // email is authoritative (clients can't spoof owner/admin). The MCP server may instead
  // present the shared INTERNAL_SECRET (only enabled if that env var is set).
  let email = '';
  const internalSecret = process.env.INTERNAL_SECRET;
  if (internalSecret && req.headers['x-internal-secret'] === internalSecret) {
    email = (body.ownerEmail || body.adminEmail || '').toLowerCase();
  } else {
    try {
      const v = await verifyGoogleToken(req.headers['x-radar-token']);
      email = v.email;
    } catch (e) {
      return res.status(401).json({ error: 'Sign in with your @sprout.ph account. (' + e.message + ')' });
    }
  }

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

  async function getFile(path) {
    const r = await ghRequest({
      hostname: 'api.github.com',
      path: `/repos/${REPO}/contents/${path}?ref=${BRANCH}`,
      method: 'GET', headers: authHeaders
    });
    if (r.status === 200) return { sha: r.body.sha, content: Buffer.from(r.body.content, 'base64').toString('utf-8') };
    return null;
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
        if (body.config) entry.config = body.config;
        entry.updatedAt = now;
      } else {
        entry = {
          id, name: body.name || 'Untitled Dashboard',
          desc: body.desc || '', tags: body.tags || [],
          config: body.config || null,
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

    if (action === 'publish' || action === 'unpublish') {
      const { data, sha } = await getRegistry();
      const entry = data.dashboards.find(d => d.id === body.id);
      if (!entry) return res.status(404).json({ error: 'Dashboard not found.' });
      const isAdmin = DASH_ADMINS.includes(email);
      const isOwner = entry.ownerEmail.toLowerCase() === email;
      if (!isOwner && !isAdmin) return res.status(403).json({ error: 'Only the owner can publish or share this dashboard.' });
      const now = new Date().toISOString();

      if (action === 'unpublish') {
        entry.status = 'private';
      } else {
        entry.status = 'published';
        entry.publishedAt = entry.publishedAt || now;
        entry.access = Array.isArray(body.access)
          ? body.access.map(a => ({ email: (a.email || '').trim().toLowerCase(), level: a.level === 'edit' ? 'edit' : 'view' })).filter(a => a.email)
          : (entry.access || []);
        // Process the saved HTML: heal older credential patterns + inject the access guard.
        if (entry.file) {
          const f = await getFile(entry.file);
          if (f) {
            let html = f.content, changed = false;
            // Older dashboards call /api/databricks with x-db-token (empty in shared mode) and
            // no x-radar-token, so shared viewers get "no sign-in token". Add the RADAR token to
            // any x-db-token headers so the shared-Databricks proxy can authorize the viewer.
            if (html.indexOf('radar-db-token-upgraded') === -1 && /['"]x-db-token['"]/.test(html)) {
              html = html.replace(/(['"]x-db-token['"]\s*:\s*[^,}\n]+)/g, "$1, 'x-radar-token': (localStorage.getItem('radar_id_token')||'')");
              html += '\n<!--radar-db-token-upgraded-->';
              changed = true;
            }
            if (html.indexOf('data-radar-access-guard') === -1) {
              const guard = buildGuard(entry.id);
              html = /<body[^>]*>/i.test(html) ? html.replace(/<body[^>]*>/i, m => m + guard) : (guard + html);
              changed = true;
            }
            if (changed) await putFile(entry.file, html, `Publish processing: ${entry.id}`, f.sha);
          }
        }
      }
      const regResp = await putFile(REG_PATH, JSON.stringify(data, null, 2), `Registry: ${action} ${body.id}`, sha);
      if (regResp.status !== 200 && regResp.status !== 201) return res.status(regResp.status).json({ error: regResp.body });
      return res.status(200).json({ ok: true, url: entry.url });
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
