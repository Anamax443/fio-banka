export function isIpAllowed(clientIp, allowlist) {
  if (!allowlist || !Array.isArray(allowlist) || allowlist.length === 0) return true;
  if (allowlist.includes('*')) return true;
  return allowlist.some(entry => matchIp(clientIp, entry.trim()));
}

function matchIp(ip, pattern) {
  if (!pattern) return false;
  if (pattern === ip) return true;
  if (pattern.includes('/')) return matchCidr(ip, pattern);
  return false;
}

function matchCidr(ip, cidr) {
  const [range, bitsStr] = cidr.split('/');
  const bits = parseInt(bitsStr, 10);
  if (isNaN(bits)) return false;

  if (ip.includes('.') && range.includes('.')) {
    return matchCidr4(ip, range, bits);
  }
  return false;
}

function matchCidr4(ip, range, bits) {
  const ipNum = ip4ToNum(ip);
  const rangeNum = ip4ToNum(range);
  if (ipNum === null || rangeNum === null) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipNum & mask) === (rangeNum & mask);
}

function ip4ToNum(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let num = 0;
  for (const p of parts) {
    const n = parseInt(p, 10);
    if (isNaN(n) || n < 0 || n > 255) return null;
    num = (num << 8) | n;
  }
  return num >>> 0;
}

export function allowlistStatus(allowlist) {
  if (!allowlist || !Array.isArray(allowlist) || allowlist.length === 0) return 'unrestricted';
  if (allowlist.includes('*')) return 'unrestricted';
  return 'restricted';
}
