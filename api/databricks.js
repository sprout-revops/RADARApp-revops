const https = require('https');
const { verifyGoogleToken } = require('./_verify.js');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-db-host, x-db-token, x-radar-token');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch(e) {
      return res.status(400).json({ error: 'Invalid JSON body.' });
    }
  }
  body = body || {};

  // Credentials: a user may supply their own (x-db-host/x-db-token). Otherwise we fall back
  // to the SHARED Databricks credentials in env vars — but only for verified @sprout.ph users,
  // since that token is powerful and the proxy must not be an open query gateway.
  let host  = req.headers['x-db-host'];
  let token = req.headers['x-db-token'];
  if (!host || !token) {
    try {
      await verifyGoogleToken(req.headers['x-radar-token']);
    } catch(e) {
      return res.status(401).json({ error: 'Sign in with your @sprout.ph account to query data. (' + e.message + ')' });
    }
    host  = (process.env.DATABRICKS_HOST || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
    token = process.env.DATABRICKS_TOKEN;
    const whid = (process.env.DATABRICKS_HTTP_PATH || '').split('/').filter(Boolean).pop();
    if (whid) body.warehouse_id = whid;
    if (!host || !token) return res.status(500).json({ error: 'Shared Databricks credentials not configured in Vercel env vars.' });
  }

  // Wait up to 8s inline (within Vercel's 10s function limit). Warm-warehouse queries
  // usually finish inside this window and return SUCCEEDED with results — no polling needed.
  // Slow/cold queries hit the timeout, return a statement_id, and the client polls via
  // /api/databricks-poll. wait_timeout must be 0s or 5s–50s (Databricks rule).
  const payload = JSON.stringify(Object.assign({}, body, {
    wait_timeout: '8s',
    on_wait_timeout: 'CONTINUE',
    format: body.format || 'JSON_ARRAY'
  }));

  return new Promise(function(resolve) {
    const options = {
      hostname: host,
      path: '/api/2.0/sql/statements',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req2 = https.request(options, function(apiRes) {
      let data = '';
      apiRes.on('data', function(chunk) { data += chunk; });
      apiRes.on('end', function() {
        try {
          const parsed = JSON.parse(data);
          res.status(apiRes.statusCode).json(parsed);
        } catch(e) {
          res.status(500).json({ error: 'Invalid response from Databricks.' });
        }
        resolve();
      });
    });

    req2.on('error', function(e) {
      res.status(500).json({ error: e.message });
      resolve();
    });

    req2.write(payload);
    req2.end();
  });
};
