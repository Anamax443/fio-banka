import { putClient, requireClientSession } from '../../_shared/kv.js';
import { jsonResponse, errorResponse } from '../../_shared/response.js';

async function authenticatedClient(env, request) {
  const body = request.method === 'GET' ? null : await request.json();
  let sessionToken, clientId;
  if (body) {
    sessionToken = body.sessionToken;
    clientId = body.clientId;
  } else {
    const url = new URL(request.url);
    sessionToken = url.searchParams.get('sessionToken');
    clientId = url.searchParams.get('clientId');
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
  const auth = await authenticatedClient(env, request);
  if (auth.error) return auth.error;
  const { name, fioToken } = auth.body;
  if (!name) return errorResponse('Chybí název účtu', 400);
  if (!fioToken) return errorResponse('Chybí API klíč', 400);
  auth.client.accounts = auth.client.accounts || [];
  auth.client.accounts.push({ name: name.trim(), fioToken: fioToken.trim() });
  await putClient(env.FIO_KV, auth.clientId, auth.client);
  return jsonResponse({ success: true, index: auth.client.accounts.length - 1 });
}

export async function onRequestPut(context) {
  const { env, request } = context;
  const auth = await authenticatedClient(env, request);
  if (auth.error) return auth.error;
  const { index, name, fioToken } = auth.body;
  const i = parseInt(index, 10);
  if (isNaN(i) || !auth.client.accounts?.[i]) {
    return errorResponse('Neplatný index účtu', 400);
  }
  if (name !== undefined) auth.client.accounts[i].name = String(name).trim();
  if (fioToken) auth.client.accounts[i].fioToken = String(fioToken).trim();
  await putClient(env.FIO_KV, auth.clientId, auth.client);
  return jsonResponse({ success: true });
}

export async function onRequestDelete(context) {
  const { env, request } = context;
  const auth = await authenticatedClient(env, request);
  if (auth.error) return auth.error;
  const i = parseInt(auth.body.index, 10);
  if (isNaN(i) || !auth.client.accounts?.[i]) {
    return errorResponse('Neplatný index účtu', 400);
  }
  auth.client.accounts.splice(i, 1);
  await putClient(env.FIO_KV, auth.clientId, auth.client);
  return jsonResponse({ success: true });
}
