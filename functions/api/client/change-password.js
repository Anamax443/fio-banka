import { putClient, requireClientSession, bumpClientSessionVersion } from '../../_shared/kv.js';
import { jsonResponse, errorResponse } from '../../_shared/response.js';
import { logEvent } from '../../_shared/audit.js';
import { verifyPassword, hashPassword } from '../../_shared/password.js';
import { generateSessionToken, SESSION_TTL_MS } from '../../_shared/auth.js';

export async function onRequestPost(context) {
  const { env, request } = context;
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const ua = request.headers.get('User-Agent') || 'unknown';
  const country = request.cf?.country || 'unknown';

  const body = await request.json();
  const { sessionToken, clientId, currentPassword, newPassword } = body;

  const auth = await requireClientSession(env, sessionToken, clientId);
  if (auth.error) return auth.error;
  const client = auth.client;

  if (!currentPassword || !newPassword) {
    return errorResponse('Vyplňte stávající i nové heslo', 400);
  }

  if (newPassword.length < 4) {
    return errorResponse('Nové heslo musí mít alespoň 4 znaky', 400);
  }

  const ok = await verifyPassword(currentPassword, client.password);
  if (!ok) {
    await logEvent(env.FIO_KV, { type: 'client_password_change_fail', clientId, reason: 'bad_current', ip, ua, country });
    return errorResponse('Stávající heslo je nesprávné', 401);
  }

  client.password = await hashPassword(newPassword);
  client.passwordChangedByClient = true;
  // Invalidate all existing sessions for this client (including any other tabs/devices)
  client.sessionVersion = (Number.isInteger(client.sessionVersion) ? client.sessionVersion : 1) + 1;
  await putClient(env.FIO_KV, clientId, client);

  // Issue a fresh session token so the current tab stays logged in
  const newToken = await generateSessionToken(env.SESSION_SECRET, client.sessionVersion);

  await logEvent(env.FIO_KV, { type: 'client_password_change_ok', clientId, ip, ua, country });

  return jsonResponse({
    success: true,
    message: 'Heslo změněno',
    sessionToken: newToken,
    expiresIn: SESSION_TTL_MS / 1000
  });
}
