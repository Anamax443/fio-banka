import { putClient, requireClientSession, requireClientReauth } from '../../_shared/kv.js';
import { jsonResponse, errorResponse } from '../../_shared/response.js';
import { logEvent } from '../../_shared/audit.js';

function reqMeta(request) {
  return {
    ip: request.headers.get('CF-Connecting-IP') || 'unknown',
    ua: request.headers.get('User-Agent') || 'unknown',
    country: request.cf?.country || 'unknown'
  };
}

async function authenticatedClient(env, request, requireReauth = false) {
  const body = request.method === 'GET' ? null : await request.json();
  let sessionToken, clientId, reauthToken;
  if (body) {
    sessionToken = body.sessionToken;
    clientId = body.clientId;
    reauthToken = body.reauthToken;
  } else {
    const url = new URL(request.url);
    sessionToken = url.searchParams.get('sessionToken');
    clientId = url.searchParams.get('clientId');
  }
  if (requireReauth) {
    const auth = await requireClientReauth(env, sessionToken, clientId, reauthToken);
    if (auth.error) return { error: auth.error };
    return { client: auth.client, clientId, body };
  }
  const auth = await requireClientSession(env, sessionToken, clientId);
  if (auth.error) return { error: auth.error };
  return { client: auth.client, clientId, body };
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const auth = await authenticatedClient(env, request);
  if (auth.error) return auth.error;
  const safe = (auth.client.accounts || []).map((a, i) => ({
    index: i,
    name: a.name,
    hasToken: !!a.fioToken,
    tokenPreview: a.fioToken ? a.fioToken.substring(0, 8) + '...' : ''
  }));
  return jsonResponse({ accounts: safe });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const auth = await authenticatedClient(env, request, true);
  if (auth.error) return auth.error;
  const { name, fioToken } = auth.body;
  if (!name) return errorResponse('Chybí název účtu', 400);
  if (!fioToken) return errorResponse('Chybí API klíč', 400);
  auth.client.accounts = auth.client.accounts || [];
  auth.client.accounts.push({ name: name.trim(), fioToken: fioToken.trim() });
  await putClient(env.FIO_KV, auth.clientId, auth.client);
  const meta = reqMeta(request);
  await logEvent(env.FIO_KV, { type: 'client_account_added', clientId: auth.clientId, accountIndex: auth.client.accounts.length - 1, accountName: name.trim(), ...meta });
  return jsonResponse({ success: true, index: auth.client.accounts.length - 1 });
}

export async function onRequestPut(context) {
  const { env, request } = context;
  const auth = await authenticatedClient(env, request, true);
  if (auth.error) return auth.error;
  const { index, name, fioToken } = auth.body;
  const i = parseInt(index, 10);
  if (isNaN(i) || !auth.client.accounts?.[i]) {
    return errorResponse('Neplatný index účtu', 400);
  }
  const tokenChanged = !!fioToken;
  if (name !== undefined) auth.client.accounts[i].name = String(name).trim();
  if (fioToken) auth.client.accounts[i].fioToken = String(fioToken).trim();
  await putClient(env.FIO_KV, auth.clientId, auth.client);
  const meta = reqMeta(request);
  await logEvent(env.FIO_KV, { type: 'client_account_updated', clientId: auth.clientId, accountIndex: i, tokenChanged, ...meta });
  return jsonResponse({ success: true });
}

export async function onRequestDelete(context) {
  const { env, request } = context;
  const auth = await authenticatedClient(env, request, true);
  if (auth.error) return auth.error;
  const i = parseInt(auth.body.index, 10);
  if (isNaN(i) || !auth.client.accounts?.[i]) {
    return errorResponse('Neplatný index účtu', 400);
  }
  const removedName = auth.client.accounts[i]?.name;
  auth.client.accounts.splice(i, 1);
  await putClient(env.FIO_KV, auth.clientId, auth.client);
  const meta = reqMeta(request);
  await logEvent(env.FIO_KV, { type: 'client_account_removed', clientId: auth.clientId, accountIndex: i, accountName: removedName, ...meta });
  return jsonResponse({ success: true });
}
