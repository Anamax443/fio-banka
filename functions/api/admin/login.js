import { generateSessionToken, verifyTOTP } from '../../_shared/auth.js';
import { jsonResponse, errorResponse } from '../../_shared/response.js';

async function getAdminPassword(env) {
  const fromKv = await env.FIO_KV.get('admin:password');
  return fromKv || env.ADMIN_SECRET;
}

export async function onRequestPost(context) {
  const { env, request } = context;

  const adminPass = await getAdminPassword(env);
  if (!adminPass) {
    return errorResponse('Admin not configured', 500);
  }

  const body = await request.json();
  if (!body.password || body.password !== adminPass) {
    return errorResponse('Nesprávné admin heslo', 401);
  }

  if (env.ADMIN_TOTP_SECRET) {
    if (!body.totpCode) {
      return errorResponse('Chybí TOTP kód', 400);
    }
    const valid = await verifyTOTP(env.ADMIN_TOTP_SECRET, body.totpCode);
    if (!valid) {
      return errorResponse('Nesprávný TOTP kód', 401);
    }
  }

  const token = await generateSessionToken(env.SESSION_SECRET);
  return jsonResponse({ success: true, adminToken: token, mfaActive: !!env.ADMIN_TOTP_SECRET });
}

export async function onRequestGet(context) {
  return jsonResponse({ mfaRequired: !!context.env.ADMIN_TOTP_SECRET });
}
