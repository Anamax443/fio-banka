import { putClient, requireClientSession } from '../../_shared/kv.js';
import { jsonResponse, errorResponse } from '../../_shared/response.js';
import { logEvent } from '../../_shared/audit.js';
import { generateSessionToken, SESSION_TTL_MS } from '../../_shared/auth.js';

export async function onRequestPost(context) {
  const { env, request } = context;
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const ua = request.headers.get('User-Agent') || 'unknown';
  const country = request.cf?.country || 'unknown';

  const body = await request.json();
  const { sessionToken, clientId, enabled } = body;

  const auth = await requireClientSession(env, sessionToken, clientId);
  if (auth.error) return auth.error;
  const client = auth.client;

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
  // Bump sessionVersion: MFA změna invaliduje všechny existující session
  client.sessionVersion = (Number.isInteger(client.sessionVersion) ? client.sessionVersion : 1) + 1;
  await putClient(env.FIO_KV, clientId, client);

  // Vystavit nový token aby aktuální tab zůstal přihlášený
  const newToken = await generateSessionToken(env.SESSION_SECRET, client.sessionVersion);

  await logEvent(env.FIO_KV, {
    type: enabled ? 'client_mfa_enabled' : 'client_mfa_disabled',
    clientId, ip, ua, country
  });

  return jsonResponse({
    success: true,
    mfaRequired: client.mfaRequired,
    needsReenrollment: enabled && !client.totpEnrolled,
    sessionToken: newToken,
    expiresIn: SESSION_TTL_MS / 1000
  });
}
