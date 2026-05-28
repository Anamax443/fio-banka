const WINDOW_SECONDS = 15 * 60;
const MAX_FAILS = 10;

export async function checkRateLimit(kv, scope, ip) {
  const key = `ratelimit:${scope}:${ip}`;
  const raw = await kv.get(key);
  if (!raw) return { allowed: true, count: 0, remaining: MAX_FAILS };

  const data = JSON.parse(raw);
  const now = Date.now();
  const recent = (data.timestamps || []).filter(ts => now - ts < WINDOW_SECONDS * 1000);

  if (recent.length >= MAX_FAILS) {
    const oldest = Math.min(...recent);
    const retryInSec = Math.ceil((oldest + WINDOW_SECONDS * 1000 - now) / 1000);
    return { allowed: false, count: recent.length, retryInSec };
  }
  return { allowed: true, count: recent.length, remaining: MAX_FAILS - recent.length };
}

export async function recordFailure(kv, scope, ip) {
  const key = `ratelimit:${scope}:${ip}`;
  const raw = await kv.get(key);
  const data = raw ? JSON.parse(raw) : { timestamps: [] };
  const now = Date.now();
  data.timestamps = (data.timestamps || []).filter(ts => now - ts < WINDOW_SECONDS * 1000);
  data.timestamps.push(now);
  await kv.put(key, JSON.stringify(data), { expirationTtl: WINDOW_SECONDS + 60 });
}

export async function clearFailures(kv, scope, ip) {
  const key = `ratelimit:${scope}:${ip}`;
  await kv.delete(key);
}

export const RATELIMIT_CONFIG = { WINDOW_SECONDS, MAX_FAILS };
