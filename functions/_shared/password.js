const ITERATIONS = 100000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;
const VERSION = 'pbkdf2-sha256-v1';

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

async function pbkdf2(password, saltBytes, iterations, hashLen) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' },
    keyMaterial, hashLen * 8
  );
  return new Uint8Array(bits);
}

export async function hashPassword(plain) {
  const saltBytes = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(saltBytes);
  const hashBytes = await pbkdf2(plain, saltBytes, ITERATIONS, HASH_BYTES);
  return `${VERSION}$${ITERATIONS}$${bytesToHex(saltBytes)}$${bytesToHex(hashBytes)}`;
}

export function isHashed(stored) {
  return typeof stored === 'string' && stored.startsWith(VERSION + '$');
}

export async function verifyPassword(plain, stored) {
  if (!isHashed(stored)) {
    return plain === stored;
  }
  const parts = stored.split('$');
  if (parts.length !== 4) return false;
  const iterations = parseInt(parts[1], 10);
  const saltBytes = hexToBytes(parts[2]);
  const expectedHex = parts[3];
  const computedBytes = await pbkdf2(plain, saltBytes, iterations, HASH_BYTES);
  const computedHex = bytesToHex(computedBytes);
  return timingSafeEqual(computedHex, expectedHex);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
