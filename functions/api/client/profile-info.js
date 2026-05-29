import { requireClientSession } from '../../_shared/kv.js';
import { jsonResponse, errorResponse } from '../../_shared/response.js';

export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const sessionToken = url.searchParams.get('sessionToken');
  const clientId = url.searchParams.get('clientId');

  const auth = await requireClientSession(env, sessionToken, clientId);
  if (auth.error) return auth.error;
  const client = auth.client;

  return jsonResponse({
    name: client.name,
    mfaRequired: client.mfaRequired || false,
    totpEnrolled: client.totpEnrolled || false,
    passwordChangedByClient: client.passwordChangedByClient || false,
    canDisableMfa: client.passwordChangedByClient === true
  });
}
