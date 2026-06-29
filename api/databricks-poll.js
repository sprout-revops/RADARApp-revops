const https = require('https');
const { verifyGoogleToken } = require('./_verify.js');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-db-host, x-db-token, x-radar-token');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const id = req.query.id;
  if (!id) return res.status(400).json({ error: 'Missing statement id.' });

  // Same shared-credential fallback + @sprout.ph gate as /api/databricks.
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
    if (!host || !token) return res.status(500).json({ error: 'Shared Databricks credentials not configured in Vercel env vars.' });
  }

  return new Promise(function(resolve) {
    const options = {
      hostname: host,
      path: '/api/2.0/sql/statements/' + id,
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
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

    req2.end();
  });
};
