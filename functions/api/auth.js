import { verifyTOTP, generateSessionToken, SESSION_TTL_MS } from '../_shared/auth.js';
import { jsonResponse, errorResponse } from '../_shared/response.js';

export async function onRequestPost(context) {
  const { env, request } = context;

  if (!env.SESSION_SECRET) {
    console.error('SESSION_SECRET not configured');
    return errorResponse('Server není správně nakonfigurován', 500);
  }

  const body = await request.json();
  const { password, totpCode } = body;

  if (!password) {
    return errorResponse('Chybí heslo', 400);
  }

  if (password !== env.PASSWORD) {
    return errorResponse('Nesprávné heslo', 401);
  }

  const mfaEnabled = env.MFA_ENABLED !== 'false';

  if (mfaEnabled) {
    if (!totpCode) {
      return errorResponse('Chybí TOTP kód', 400);
    }
    if (!env.TOTP_SECRET) {
      console.error('TOTP_SECRET not configured but MFA is enabled');
      return errorResponse('Server není správně nakonfigurován', 500);
    }
    const validTotp = await verifyTOTP(env.TOTP_SECRET, totpCode);
    if (!validTotp) {
      return errorResponse('Nesprávný TOTP kód', 401);
    }
  }

  const sessionToken = await generateSessionToken(env.SESSION_SECRET);

  return jsonResponse({
    success: true,
    sessionToken,
    expiresIn: SESSION_TTL_MS / 1000
  });
}
