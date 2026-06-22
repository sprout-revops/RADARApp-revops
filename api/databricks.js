const https = require('https');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-db-host, x-db-token');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const host  = req.headers['x-db-host'];
  const token = req.headers['x-db-token'];
  if (!host || !token) return res.status(400).json({ error: 'Missing Databricks credentials.' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch(e) {
      return res.status(400).json({ error: 'Invalid JSON body.' });
    }
  }

  // Force immediate return — Vercel Hobby times out at 10s so we never wait for results.
  // Databricks returns a statement_id instantly; the client polls via /api/databricks-poll.
  const payload = JSON.stringify(Object.assign({}, body, {
    wait_timeout: '0s',
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
