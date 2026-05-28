const AUDIT_TTL_DAYS = 90;

export async function logEvent(kv, event) {
  const ts = Date.now();
  const id = ts + '-' + Math.random().toString(36).substring(2, 8);
  const key = 'audit:' + id;
  const data = { ts, ...event };
  const expirationTtl = AUDIT_TTL_DAYS * 86400;
  await kv.put(key, JSON.stringify(data), { expirationTtl });
}

export async function listEvents(kv, limit = 100) {
  const list = await kv.list({ prefix: 'audit:', limit });
  const events = [];
  for (const key of list.keys) {
    const data = await kv.get(key.name, 'json');
    if (data) events.push(data);
  }
  events.sort((a, b) => b.ts - a.ts);
  return events;
}
