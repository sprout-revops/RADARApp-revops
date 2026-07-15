// Server-side verification of Google Sign-In ID tokens (RS256), dependency-free.
// Confirms the token is a genuine, unexpired Google token issued for the RADAR client
// and that the email is a verified @sprout.ph account. Used to gate sensitive endpoints.
const https = require('https');
const crypto = require('crypto');

const CLIENT_ID = '1083460218316-p1tf3fg79257vp77s8rvmf6e9ver6uts.apps.googleusercontent.com';
const ALLOWED_DOMAIN = 'sprout.ph';

// Cache one JWKS key-set per URL (Google's, and — for RAN — the gateway's), each 1h.
const _jwksCache = {};   // url -> { keys, at }

function fetchJwks(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d).keys); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

async function getKeysFor(url, force) {
  const now = Date.now();
  const c = _jwksCache[url];
  if (!force && c && (now - c.at) < 3600000) return c.keys;   // cache 1h
  const keys = await fetchJwks(url);
  _jwksCache[url] = { keys, at: now };
  return keys;
}

// Back-compat shim for the Google verifier below.
function getKeys(force) { return getKeysFor(GOOGLE_JWKS_URL, force); }

function b64urlJson(seg) {
  return JSON.parse(Buffer.from(seg.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
}

// Returns { email } for a valid @sprout.ph token, or throws with a reason.
async function verifyGoogleToken(token) {
  if (!token) throw new Error('No sign-in token provided.');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed token.');

  const header = b64urlJson(parts[0]);
  let keys = await getKeys();
  let jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) { keys = await getKeys(true); jwk = keys.find(k => k.kid === header.kid); }  // re-fetch on rotation
  if (!jwk) throw new Error('Sign-in expired — please sign out and sign in again.');

  const pub = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const sig = Buffer.from(parts[2].replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const ok = crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), pub, sig);
  if (!ok) throw new Error('Invalid token signature.');

  const p = b64urlJson(parts[1]);
  const now = Math.floor(Date.now() / 1000);
  if (p.aud !== CLIENT_ID) throw new Error('Token not issued for RADAR.');
  if (p.iss !== 'https://accounts.google.com' && p.iss !== 'accounts.google.com') throw new Error('Untrusted issuer.');
  if (p.exp && p.exp < now) throw new Error('Sign-in expired — please sign in again.');
  if (p.email_verified === false) throw new Error('Email not verified.');
  const email = (p.email || '').toLowerCase();
  if (!email.endsWith('@' + ALLOWED_DOMAIN)) throw new Error('Access restricted to @' + ALLOWED_DOMAIN + ' accounts.');
  return { email };
}

// ── RAN (RevOps Authentication Network) token verification — Phase 2 ──────────
// Verifies a RAN-issued access token (JWT, RS256) so RADAR's own /api endpoints can
// authorize requests after the Google cutover. NOT yet wired into any handler — it goes
// live only once the RAN team exposes a bearer token in their /auth/exchange (or /api/verify)
// response AND publishes a JWKS endpoint. Configure via env before flipping the handlers:
//   RAN_JWKS_URL  — RAN's public JWKS endpoint (required)
//   RAN_ISSUER    — expected `iss` claim (required)
//   RAN_AUDIENCE  — expected `aud` claim (optional; checked only if set)
// Allowed sign-in domains match RAN's policy.
const RAN_ALLOWED_DOMAINS = ['sprout.ph', 'sproutsolutions.io'];

async function verifyRanToken(token) {
  if (!token) throw new Error('No session token provided.');
  const jwksUrl = process.env.RAN_JWKS_URL;
  const issuer  = process.env.RAN_ISSUER;
  if (!jwksUrl || !issuer) throw new Error('RAN verification is not configured (RAN_JWKS_URL / RAN_ISSUER).');

  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed token.');

  const header = b64urlJson(parts[0]);
  let keys = await getKeysFor(jwksUrl);
  let jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) { keys = await getKeysFor(jwksUrl, true); jwk = keys.find(k => k.kid === header.kid); }  // re-fetch on rotation
  if (!jwk) throw new Error('Session expired — please sign in again.');

  const pub = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const sig = Buffer.from(parts[2].replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const ok = crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), pub, sig);
  if (!ok) throw new Error('Invalid token signature.');

  const p = b64urlJson(parts[1]);
  const now = Math.floor(Date.now() / 1000);
  if (p.iss !== issuer) throw new Error('Untrusted issuer.');
  if (process.env.RAN_AUDIENCE) {
    const aud = Array.isArray(p.aud) ? p.aud : [p.aud];
    if (!aud.includes(process.env.RAN_AUDIENCE)) throw new Error('Token not issued for RADAR.');
  }
  if (p.exp && p.exp < now) throw new Error('Session expired — please sign in again.');
  const email = (p.email || '').toLowerCase();
  if (!RAN_ALLOWED_DOMAINS.some(d => email.endsWith('@' + d))) {
    throw new Error('Access restricted to ' + RAN_ALLOWED_DOMAINS.map(d => '@' + d).join(' / ') + ' accounts.');
  }
  return { email, user_id: p.sub || p.user_id || null };
}

module.exports = { verifyGoogleToken, verifyRanToken };
