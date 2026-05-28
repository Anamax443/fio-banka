import { verifyTOTP, generateSessionToken, SESSION_TTL_MS } from '../_shared/auth.js';
import { jsonResponse, errorResponse } from '../_shared/response.js';
import { getClient, putClient } from '../_shared/kv.js';
import { logEvent } from '../_shared/audit.js';
import { isIpAllowed } from '../_shared/ip.js';

export async function onRequestPost(context) {
  const { env, request } = context;
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const ua = request.headers.get('User-Agent') || 'unknown';
  const country = request.cf?.country || 'unknown';

  if (!env.SESSION_SECRET) {
    return errorResponse('Server není správně nakonfigurován', 500);
  }

  const body = await request.json();
  const { clientId, password, totpCode } = body;

  if (!clientId || !password) {
    return errorResponse('Chybí clientId nebo heslo', 400);
  }

  const client = await getClient(env.FIO_KV, clientId);
  if (!client) {
    await logEvent(env.FIO_KV, { type: 'client_login_fail', clientId, reason: 'no_client', ip, ua, country });
    return errorResponse('Nesprávné přihlašovací údaje', 401);
  }

  if (!isIpAllowed(ip, client.ipAllowlist)) {
    await logEvent(env.FIO_KV, { type: 'client_login_fail', clientId, reason: 'ip_blocked', ip, ua, country });
    return errorResponse('Přístup z této IP adresy není povolen', 403);
  }

  if (password !== client.password) {
    await logEvent(env.FIO_KV, { type: 'client_login_fail', clientId, reason: 'bad_password', ip, ua, country });
    return errorResponse('Nesprávné přihlašovací údaje', 401);
  }

  if (client.mfaRequired && client.totpEnrolled) {
    if (!totpCode) {
      return errorResponse('Chybí TOTP kód', 400);
    }
    const validTotp = await verifyTOTP(client.totpSecret, totpCode);
    if (!validTotp) {
      await logEvent(env.FIO_KV, { type: 'client_login_fail', clientId, reason: 'bad_totp', ip, ua, country });
      return errorResponse('Nesprávný TOTP kód', 401);
    }
  }

  const needsEnrollment = client.mfaRequired && !client.totpEnrolled;

  const sessionToken = await generateSessionToken(env.SESSION_SECRET);

  await logEvent(env.FIO_KV, {
    type: needsEnrollment ? 'client_login_needs_enrollment' : 'client_login_ok',
    clientId, ip, ua, country
  });

  return jsonResponse({
    success: true,
    sessionToken,
    expiresIn: SESSION_TTL_MS / 1000,
    clientId,
    clientName: client.name,
    needsTotpEnrollment: needsEnrollment
  });
}
