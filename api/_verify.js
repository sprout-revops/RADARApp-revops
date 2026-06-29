// Server-side verification of Google Sign-In ID tokens (RS256), dependency-free.
// Confirms the token is a genuine, unexpired Google token issued for the RADAR client
// and that the email is a verified @sprout.ph account. Used to gate sensitive endpoints.
const https = require('https');
const crypto = require('crypto');

const CLIENT_ID = '1083460218316-p1tf3fg79257vp77s8rvmf6e9ver6uts.apps.googleusercontent.com';
const ALLOWED_DOMAIN = 'sprout.ph';

let _jwks = null, _jwksAt = 0;

function fetchJwks() {
  return new Promise((resolve, reject) => {
    https.get('https://www.googleapis.com/oauth2/v3/certs', res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d).keys); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

async function getKeys() {
  const now = Date.now();
  if (_jwks && (now - _jwksAt) < 3600000) return _jwks;   // cache 1h
  _jwks = await fetchJwks();
  _jwksAt = now;
  return _jwks;
}

function b64urlJson(seg) {
  return JSON.parse(Buffer.from(seg.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
}

// Returns { email } for a valid @sprout.ph token, or throws with a reason.
async function verifyGoogleToken(token) {
  if (!token) throw new Error('No sign-in token provided.');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed token.');

  const header = b64urlJson(parts[0]);
  const keys = await getKeys();
  const jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) throw new Error('Unknown signing key.');

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

module.exports = { verifyGoogleToken };
