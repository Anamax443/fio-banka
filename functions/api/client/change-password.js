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
  const { sessionToken, clientId, currentPassword, newPassword } = body;

  const valid = await verifySessionToken(sessionToken, env.SESSION_SECRET);
  if (!valid) return errorResponse('Neplatná session', 401);

  const client = await getClient(env.FIO_KV, clientId);
  if (!client) return errorResponse('Klient nenalezen', 404);

  if (!currentPassword || !newPassword) {
    return errorResponse('Vyplňte stávající i nové heslo', 400);
  }

  if (newPassword.length < 6) {
    return errorResponse('Nové heslo musí mít alespoň 6 znaků', 400);
  }

  if (currentPassword !== client.password) {
    await logEvent(env.FIO_KV, { type: 'client_password_change_fail', clientId, reason: 'bad_current', ip, ua, country });
    return errorResponse('Stávající heslo je nesprávné', 401);
  }

  client.password = newPassword;
  client.passwordChangedByClient = true;
  await putClient(env.FIO_KV, clientId, client);

  await logEvent(env.FIO_KV, { type: 'client_password_change_ok', clientId, ip, ua, country });

  return jsonResponse({ success: true, message: 'Heslo změněno' });
}
