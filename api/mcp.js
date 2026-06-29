// RADAR remote MCP server (Streamable HTTP, JSON-RPC 2.0, dependency-free).
// Lets Claude Desktop publish DIY dashboards straight to RADAR by calling the same
// /api/dashboards endpoint the web UI uses. Add as a custom connector in Claude Desktop
// with URL: https://radar-revops.vercel.app/api/mcp
const https = require('https');

const BASE     = 'https://radar-revops.vercel.app';
const REG_URL  = 'https://raw.githubusercontent.com/sprout-revops/RADARApp-revops/master/user-dashboards/registry.json';
const PROTOCOL = '2025-06-18';

function httpsRequest(method, urlStr, headers, bodyStr) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method,
      headers: headers || {}
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(data) }); } catch(e) { resolve({ status: res.statusCode, json: null, raw: data }); } });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function callSave(args) {
  const body = JSON.stringify({
    action: 'save', name: args.name, html: args.html,
    desc: args.desc || '', tags: args.tags || [],
    ownerEmail: args.ownerEmail, ownerName: args.ownerName || (args.ownerEmail || '').split('@')[0],
    id: args.id || undefined
  });
  return httpsRequest('POST', BASE + '/api/dashboards',
    { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, body);
}

function callRequest(args) {
  const body = JSON.stringify({ action: 'request', id: args.id, ownerEmail: args.ownerEmail });
  return httpsRequest('POST', BASE + '/api/dashboards',
    { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, body);
}

const TOOLS = [
  {
    name: 'publish_dashboard',
    description: 'Save a self-contained HTML dashboard to RADAR. Returns its live URL. Any Databricks token in the HTML is stripped automatically. Use the user\'s sprout.ph email as ownerEmail.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Display name for the dashboard' },
        html: { type: 'string', description: 'The complete HTML file contents' },
        ownerEmail: { type: 'string', description: 'Owner sprout.ph email' },
        desc: { type: 'string', description: 'Short description (optional)' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Category tags (optional)' },
        id: { type: 'string', description: 'Existing dashboard id to overwrite (optional)' }
      },
      required: ['name', 'html', 'ownerEmail']
    }
  },
  {
    name: 'list_my_dashboards',
    description: 'List dashboards saved in RADAR by a given owner email, with their status and URLs.',
    inputSchema: {
      type: 'object',
      properties: { ownerEmail: { type: 'string', description: 'Owner sprout.ph email' } },
      required: ['ownerEmail']
    }
  },
  {
    name: 'submit_to_team',
    description: 'Submit a saved dashboard (by id) to be reviewed and added to the RADAR Team Dashboards tab.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Dashboard id (from list_my_dashboards)' },
        ownerEmail: { type: 'string', description: 'Owner sprout.ph email' }
      },
      required: ['id', 'ownerEmail']
    }
  }
];

function text(t) { return { content: [{ type: 'text', text: t }] }; }

async function runTool(name, args) {
  args = args || {};
  if (name === 'publish_dashboard') {
    if (!args.html || !args.name || !args.ownerEmail) return { ...text('Missing required fields: name, html, ownerEmail.'), isError: true };
    const r = await callSave(args);
    if (r.status === 200 && r.json && r.json.ok) return text(`✅ Published "${args.name}". Live URL (ready in ~1–2 min): ${r.json.url}\nId: ${r.json.id}\nUse submit_to_team with this id to request it for the Team Dashboards tab.`);
    return { ...text('Publish failed: ' + JSON.stringify(r.json || r.raw)), isError: true };
  }
  if (name === 'list_my_dashboards') {
    const r = await httpsRequest('GET', REG_URL + '?_=' + Date.now(), {});
    const all = (r.json && r.json.dashboards) ? r.json.dashboards : [];
    const mine = all.filter(d => (d.ownerEmail || '').toLowerCase() === (args.ownerEmail || '').toLowerCase());
    if (!mine.length) return text('No dashboards found for ' + args.ownerEmail + '.');
    return text(mine.map(d => `• ${d.name} — ${d.status} — id: ${d.id}\n  ${d.url}`).join('\n'));
  }
  if (name === 'submit_to_team') {
    const r = await callRequest(args);
    if (r.status === 200 && r.json && r.json.ok) return text('📤 Submitted for Team Dashboards review.');
    return { ...text('Submit failed: ' + JSON.stringify(r.json || r.raw)), isError: true };
  }
  return { ...text('Unknown tool: ' + name), isError: true };
}

async function handleRpc(msg) {
  const { id, method, params } = msg;
  // Notifications (no id) get no response.
  if (id === undefined || id === null) return null;
  try {
    if (method === 'initialize') {
      return { jsonrpc: '2.0', id, result: {
        protocolVersion: (params && params.protocolVersion) || PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: 'radar-revops', version: '1.0.0' }
      }};
    }
    if (method === 'ping') return { jsonrpc: '2.0', id, result: {} };
    if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
    if (method === 'tools/call') {
      const result = await runTool(params && params.name, params && params.arguments);
      return { jsonrpc: '2.0', id, result };
    }
    return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found: ' + method } };
  } catch (e) {
    return { jsonrpc: '2.0', id, error: { code: -32603, message: e.message } };
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, mcp-session-id, mcp-protocol-version');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'GET') return res.status(405).json({ error: 'This MCP server uses POST (JSON-RPC) only.' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) { return res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); } }

  if (Array.isArray(body)) {
    const out = [];
    for (const m of body) { const r = await handleRpc(m); if (r) out.push(r); }
    if (!out.length) return res.status(202).end();
    return res.status(200).json(out);
  }

  const result = await handleRpc(body || {});
  if (!result) return res.status(202).end();
  return res.status(200).json(result);
};
