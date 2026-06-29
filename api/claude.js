const https = require('https');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-api-key');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: { message: 'Method not allowed' } });

  // Only allow calls coming from the RADAR app itself — this endpoint spends the shared
  // Anthropic key, so it must not become an open Claude proxy for outside sites.
  const ALLOWED_HOSTS = ['radar-revops.vercel.app', 'sprout-revops.github.io'];
  const origin = (req.headers['origin'] || '') + ' ' + (req.headers['referer'] || '');
  if (!ALLOWED_HOSTS.some(h => origin.indexOf(h) !== -1)) {
    return res.status(403).json({ error: { message: 'Forbidden: requests must originate from RADAR.' } });
  }

  // Shared server-side key (set ANTHROPIC_API_KEY in Vercel env vars). Falls back to a
  // per-user key header only if no shared key is configured yet.
  const apiKey = process.env.ANTHROPIC_API_KEY || req.headers['x-api-key'];
  if (!apiKey) return res.status(500).json({ error: { message: 'ANTHROPIC_API_KEY not configured in Vercel env vars.' } });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch(e) {
      return res.status(400).json({ error: { message: 'Invalid JSON body.' } });
    }
  }

  const payload = JSON.stringify(Object.assign({}, body, { stream: false }));

  return new Promise(function(resolve) {
    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload)
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
          res.status(500).json({ error: { message: 'Invalid response from Anthropic.' } });
        }
        resolve();
      });
    });

    req2.on('error', function(e) {
      res.status(500).json({ error: { message: e.message } });
      resolve();
    });

    req2.write(payload);
    req2.end();
  });
};
