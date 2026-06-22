const https = require('https');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-db-host, x-db-token');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const host  = req.headers['x-db-host'];
  const token = req.headers['x-db-token'];
  const id    = req.query.id;
  if (!host || !token || !id) return res.status(400).json({ error: 'Missing required parameters.' });

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
