import { getClient } from '../../_shared/kv.js';
import { jsonResponse, errorResponse } from '../../_shared/response.js';

export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const id = url.searchParams.get('id');

  if (!id) {
    return errorResponse('Chybí id', 400);
  }

  const client = await getClient(env.FIO_KV, id);
  if (!client) {
    return errorResponse('Klient nenalezen', 404);
  }

  const safeAccounts = (client.accounts || []).map(a => ({
    name: a.name,
    hasToken: !!a.fioToken,
    tokenPreview: a.fioToken ? a.fioToken.substring(0, 8) + '...' : ''
  }));

  return jsonResponse({
    id,
    name: client.name,
    totpEnrolled: client.totpEnrolled || false,
    mfaRequired: client.mfaRequired || false,
    accounts: safeAccounts,
    ipAllowlist: client.ipAllowlist || []
  });
}
