import { verifySessionToken } from '../../_shared/auth.js';
import { getClient } from '../../_shared/kv.js';
import { jsonResponse, errorResponse } from '../../_shared/response.js';

export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const sessionToken = url.searchParams.get('sessionToken');
  const clientId = url.searchParams.get('clientId');

  const valid = await verifySessionToken(sessionToken, env.SESSION_SECRET);
  if (!valid) return errorResponse('Neplatná session', 401);

  const client = await getClient(env.FIO_KV, clientId);
  if (!client) return errorResponse('Klient nenalezen', 404);

  return jsonResponse({
    name: client.name,
    mfaRequired: client.mfaRequired || false,
    totpEnrolled: client.totpEnrolled || false,
    passwordChangedByClient: client.passwordChangedByClient || false,
    canDisableMfa: client.passwordChangedByClient === true
  });
}
