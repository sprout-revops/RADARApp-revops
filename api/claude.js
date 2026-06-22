module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-api-key');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: { message: 'Method not allowed' } });

  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(400).json({ error: { message: 'Missing Claude API key.' } });

  let body = req.body;
  if (!body || typeof body === 'string') {
    try { body = JSON.parse(body); } catch(e) { return res.status(400).json({ error: { message: 'Invalid JSON body.' } }); }
  }

  // Remove stream flag — Node.js runtime returns full response
  body = Object.assign({}, body, { stream: false });

  const anthropicResp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const data = await anthropicResp.json();
  return res.status(anthropicResp.status).json(data);
};
