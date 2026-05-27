import { verifyTOTP, generateSessionToken, SESSION_TTL_MS } from '../_shared/auth.js';
import { jsonResponse, errorResponse } from '../_shared/response.js';
import { getClient, putClient } from '../_shared/kv.js';

export async function onRequestPost(context) {
  const { env, request } = context;

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
    return errorResponse('Nesprávné přihlašovací údaje', 401);
  }

  if (password !== client.password) {
    return errorResponse('Nesprávné přihlašovací údaje', 401);
  }

  if (client.mfaRequired && client.totpEnrolled) {
    if (!totpCode) {
      return errorResponse('Chybí TOTP kód', 400);
    }
    const validTotp = await verifyTOTP(client.totpSecret, totpCode);
    if (!validTotp) {
      return errorResponse('Nesprávný TOTP kód', 401);
    }
  }

  const needsEnrollment = client.mfaRequired && !client.totpEnrolled;

  const sessionToken = await generateSessionToken(env.SESSION_SECRET);

  return jsonResponse({
    success: true,
    sessionToken,
    expiresIn: SESSION_TTL_MS / 1000,
    clientId,
    clientName: client.name,
    needsTotpEnrollment: needsEnrollment
  });
}
