import { verifySessionToken } from '../_shared/auth.js';
import { getClient } from '../_shared/kv.js';
import { jsonResponse, errorResponse } from '../_shared/response.js';

export async function onRequestPost(context) {
  const { env, request } = context;
  const body = await request.json();
  const { sessionToken, clientId } = body;

  const valid = await verifySessionToken(sessionToken, env.SESSION_SECRET);
  if (!valid) {
    return errorResponse('Neplatná session', 401);
  }

  const client = await getClient(env.FIO_KV, clientId);
  if (!client) {
    return errorResponse('Klient nenalezen', 404);
  }

  const accounts = (client.accounts || []).map((acc, i) => ({
    id: String(i),
    name: acc.name
  }));

  return jsonResponse({ accounts });
}
