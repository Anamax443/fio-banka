export async function getClient(kv, clientId) {
  const data = await kv.get(`client:${clientId}`, 'json');
  return data;
}

export async function putClient(kv, clientId, clientData) {
  await kv.put(`client:${clientId}`, JSON.stringify(clientData));
}

export async function deleteClient(kv, clientId) {
  await kv.delete(`client:${clientId}`);
}

import { verifySessionToken, verifyReauthToken } from './auth.js';

// Combined check: load client + verify session token (signature + TTL + version match).
// Returns { client } on success, or { error: Response } on failure.
export async function requireClientSession(env, sessionToken, clientId) {
  if (!clientId) {
    return { error: new Response(JSON.stringify({ error: 'Chybí clientId' }), { status: 400, headers: { 'Content-Type': 'application/json' } }) };
  }
  const client = await getClient(env.FIO_KV, clientId);
  if (!client) {
    return { error: new Response(JSON.stringify({ error: 'Klient nenalezen' }), { status: 404, headers: { 'Content-Type': 'application/json' } }) };
  }
  const valid = await verifySessionToken(sessionToken, env.SESSION_SECRET, clientSessionVersion(client));
  if (!valid) {
    return { error: new Response(JSON.stringify({ error: 'Neplatná session' }), { status: 401, headers: { 'Content-Type': 'application/json' } }) };
  }
  return { client };
}

// Like requireClientSession but ALSO requires a fresh reauth token (5 min TTL).
// Use for sensitive operations: managing Fio tokens, changing password.
export async function requireClientReauth(env, sessionToken, clientId, reauthToken) {
  const sess = await requireClientSession(env, sessionToken, clientId);
  if (sess.error) return sess;
  const expectedVer = clientSessionVersion(sess.client);
  const reauthOk = await verifyReauthToken(reauthToken, env.SESSION_SECRET, expectedVer);
  if (!reauthOk) {
    return { error: new Response(JSON.stringify({ error: 'Tato akce vyžaduje ověření hesla/TOTP', code: 'reauth_required' }), { status: 403, headers: { 'Content-Type': 'application/json' } }) };
  }
  return { client: sess.client };
}

export function clientSessionVersion(client) {
  return Number.isInteger(client?.sessionVersion) ? client.sessionVersion : 1;
}

export async function bumpClientSessionVersion(kv, clientId) {
  const c = await getClient(kv, clientId);
  if (!c) return null;
  c.sessionVersion = clientSessionVersion(c) + 1;
  await putClient(kv, clientId, c);
  return c.sessionVersion;
}

export async function getAdminSessionVersion(kv) {
  const v = await kv.get('admin:sessionVersion');
  const n = parseInt(v, 10);
  return Number.isInteger(n) ? n : 1;
}

export async function bumpAdminSessionVersion(kv) {
  const next = (await getAdminSessionVersion(kv)) + 1;
  await kv.put('admin:sessionVersion', String(next));
  return next;
}

export async function listClients(kv) {
  const list = await kv.list({ prefix: 'client:' });
  const clients = [];
  for (const key of list.keys) {
    const data = await kv.get(key.name, 'json');
    if (data) {
      const id = key.name.replace('client:', '');
      const allowlist = data.ipAllowlist || [];
      const ipRestricted = allowlist.length > 0 && !allowlist.includes('*');
      clients.push({
        id,
        name: data.name,
        accountCount: data.accounts?.length || 0,
        totpEnrolled: data.totpEnrolled || false,
        mfaRequired: data.mfaRequired !== false,
        passwordChangedByClient: data.passwordChangedByClient === true,
        ipRestricted,
        ipCount: allowlist.length
      });
    }
  }
  return clients;
}
