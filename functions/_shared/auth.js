const SESSION_TTL_MS = 60 * 60 * 1000;
const REAUTH_TTL_MS = 5 * 60 * 1000;

export { SESSION_TTL_MS, REAUTH_TTL_MS };

// Reauth token format: r.{ts}.{nonce}.{version}.{HMAC(secret, "r.{ts}.{nonce}.{version}")}
// Distinct prefix prevents using a regular session token where reauth is required.
export async function generateReauthToken(secret, version = 1) {
  const timestamp = Date.now();
  const nonceBytes = new Uint8Array(16);
  crypto.getRandomValues(nonceBytes);
  const nonce = bytesToHex(nonceBytes);
  const verStr = String(version);
  const payload = `r.${timestamp}.${nonce}.${verStr}`;
  const sig = await hmacSha256Hex(secret, payload);
  return `${payload}.${sig}`;
}

export async function verifyReauthToken(token, secret, expectedVersion) {
  if (!token || typeof token !== 'string' || !secret) return false;
  const parts = token.split('.');
  if (parts.length !== 5 || parts[0] !== 'r') return false;
  const [, tsStr, nonce, verStr, providedSig] = parts;
  const ts = parseInt(tsStr, 10);
  const version = parseInt(verStr, 10);
  if (isNaN(ts) || isNaN(version)) return false;
  const now = Date.now();
  if (now - ts > REAUTH_TTL_MS) return false;
  if (now < ts) return false;
  if (expectedVersion != null && version !== expectedVersion) return false;
  const expectedSig = await hmacSha256Hex(secret, `r.${tsStr}.${nonce}.${verStr}`);
  return timingSafeEqualStr(providedSig, expectedSig);
}

export async function verifyTOTP(secret, code) {
  if (!secret || !code) return false;
  const now = Math.floor(Date.now() / 1000);
  const timeStep = 30;
  for (let i = -1; i <= 1; i++) {
    const counter = Math.floor((now + i * timeStep) / timeStep);
    const expectedCode = await generateTOTP(secret, counter);
    if (timingSafeEqualStr(expectedCode, code)) return true;
  }
  return false;
}

async function generateTOTP(secret, counter) {
  const key = base32Decode(secret);
  const counterBuf = new ArrayBuffer(8);
  new DataView(counterBuf).setUint32(4, counter, false);

  const cryptoKey = await crypto.subtle.importKey(
    'raw', key, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
  );
  const hmac = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, counterBuf));

  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  ) % 1000000;
  return code.toString().padStart(6, '0');
}

function base32Decode(encoded) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  encoded = encoded.toUpperCase().replace(/=+$/, '');
  let bits = '';
  for (const char of encoded) {
    const val = alphabet.indexOf(char);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.substr(i, 8), 2));
  }
  return new Uint8Array(bytes);
}

// Session token format v2: {ts}.{nonce}.{version}.{HMAC(secret, "{ts}.{nonce}.{version}")}
// Version is the sessionVersion stored in KV for the principal (client or admin).
// Incrementing the KV value invalidates all previously-issued tokens.
export async function generateSessionToken(secret, version = 1) {
  const timestamp = Date.now();
  const nonceBytes = new Uint8Array(16);
  crypto.getRandomValues(nonceBytes);
  const nonce = bytesToHex(nonceBytes);
  const verStr = String(version);
  const payload = `${timestamp}.${nonce}.${verStr}`;
  const sig = await hmacSha256Hex(secret, payload);
  return `${payload}.${sig}`;
}

// Verifies signature + TTL only. Caller MUST also check version match.
// Returns { ts, nonce, version } if valid, or null.
export async function parseAndVerifySession(sessionToken, secret) {
  if (!sessionToken || typeof sessionToken !== 'string' || !secret) return null;
  const parts = sessionToken.split('.');
  if (parts.length !== 4) return null;
  const [tsStr, nonce, verStr, providedSig] = parts;

  const ts = parseInt(tsStr, 10);
  const version = parseInt(verStr, 10);
  if (isNaN(ts) || isNaN(version)) return null;
  const now = Date.now();
  if (now - ts > SESSION_TTL_MS) return null;
  if (now < ts) return null;

  const expectedSig = await hmacSha256Hex(secret, `${tsStr}.${nonce}.${verStr}`);
  if (!timingSafeEqualStr(providedSig, expectedSig)) return null;
  return { ts, nonce, version };
}

// Convenience: verifies signature + TTL + version against expected.
// expectedVersion = null skips version check (use only for short-lived flows
// that don't have a stored version yet, e.g. logout).
export async function verifySessionToken(sessionToken, secret, expectedVersion = null) {
  const parsed = await parseAndVerifySession(sessionToken, secret);
  if (!parsed) return false;
  if (expectedVersion !== null && parsed.version !== expectedVersion) return false;
  return true;
}

async function hmacSha256Hex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return bytesToHex(new Uint8Array(sig));
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
