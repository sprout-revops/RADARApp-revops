export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type, x-api-key'
      }
    });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const apiKey = req.headers.get('x-api-key');
  if (!apiKey) {
    return new Response(JSON.stringify({ error: { message: 'Missing Claude API key.' } }), {
      status: 400,
      headers: { 'content-type': 'application/json' }
    });
  }

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: { message: 'Invalid JSON body.' } }), {
      status: 400,
      headers: { 'content-type': 'application/json' }
    });
  }

  const anthropicResp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!anthropicResp.ok) {
    const err = await anthropicResp.json().catch(() => ({ error: { message: 'Anthropic API error ' + anthropicResp.status } }));
    return new Response(JSON.stringify(err), {
      status: anthropicResp.status,
      headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }
    });
  }

  // Pipe the SSE stream straight through
  return new Response(anthropicResp.body, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'access-control-allow-origin': '*'
    }
  });
}
