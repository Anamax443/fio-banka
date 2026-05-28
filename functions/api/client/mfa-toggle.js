import { verifySessionToken } from '../../_shared/auth.js';
import { getClient, putClient } from '../../_shared/kv.js';
import { jsonResponse, errorResponse } from '../../_shared/response.js';
import { logEvent } from '../../_shared/audit.js';

export async function onRequestPost(context) {
  const { env, request } = context;
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const ua = request.headers.get('User-Agent') || 'unknown';
  const country = request.cf?.country || 'unknown';

  const body = await request.json();
  const { sessionToken, clientId, enabled } = body;

  const valid = await verifySessionToken(sessionToken, env.SESSION_SECRET);
  if (!valid) return errorResponse('Neplatná session', 401);

  const client = await getClient(env.FIO_KV, clientId);
  if (!client) return errorResponse('Klient nenalezen', 404);

  if (typeof enabled !== 'boolean') {
    return errorResponse('Chybí parametr enabled (true/false)', 400);
  }

  if (enabled === false && !client.passwordChangedByClient) {
    return errorResponse('MFA lze vypnout až po vlastní změně hesla', 403);
  }

  client.mfaRequired = enabled;
  if (enabled === false) {
    client.totpSecret = null;
    client.totpEnrolled = false;
  }
  if (enabled === true && client.totpEnrolled === false) {
    client.totpSecret = null;
  }
  await putClient(env.FIO_KV, clientId, client);

  await logEvent(env.FIO_KV, {
    type: enabled ? 'client_mfa_enabled' : 'client_mfa_disabled',
    clientId, ip, ua, country
  });

  return jsonResponse({
    success: true,
    mfaRequired: client.mfaRequired,
    needsReenrollment: enabled && !client.totpEnrolled
  });
}
