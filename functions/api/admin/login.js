import { generateSessionToken, verifyTOTP } from '../../_shared/auth.js';
import { jsonResponse, errorResponse } from '../../_shared/response.js';
import { logEvent } from '../../_shared/audit.js';
import { checkRateLimit, recordFailure, clearFailures } from '../../_shared/ratelimit.js';
import { verifyPassword, isHashed, hashPassword } from '../../_shared/password.js';

async function getAdminPassword(env) {
  const fromKv = await env.FIO_KV.get('admin:password');
  return fromKv || env.ADMIN_SECRET;
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const ua = request.headers.get('User-Agent') || 'unknown';
  const country = request.cf?.country || 'unknown';

  const adminPass = await getAdminPassword(env);
  if (!adminPass) {
    return errorResponse('Admin not configured', 500);
  }

  const rl = await checkRateLimit(env.FIO_KV, 'admin_login', ip);
  if (!rl.allowed) {
    await logEvent(env.FIO_KV, { type: 'admin_login_fail', reason: 'rate_limited', ip, ua, country });
    return errorResponse(`Příliš mnoho neúspěšných pokusů. Zkuste znovu za ${Math.ceil(rl.retryInSec / 60)} minut.`, 429);
  }

  const body = await request.json();
  const pwOk = body.password ? await verifyPassword(body.password, adminPass) : false;
  if (!pwOk) {
    await recordFailure(env.FIO_KV, 'admin_login', ip);
    await logEvent(env.FIO_KV, { type: 'admin_login_fail', reason: 'bad_password', ip, ua, country });
    return errorResponse('Nesprávné admin heslo', 401);
  }

  // Auto-migrate plaintext admin password to hash on successful login
  if (!isHashed(adminPass)) {
    const hashed = await hashPassword(body.password);
    await env.FIO_KV.put('admin:password', hashed);
  }

  if (env.ADMIN_TOTP_SECRET) {
    if (!body.totpCode) {
      return errorResponse('Chybí TOTP kód', 400);
    }
    const valid = await verifyTOTP(env.ADMIN_TOTP_SECRET, body.totpCode);
    if (!valid) {
      await recordFailure(env.FIO_KV, 'admin_login', ip);
      await logEvent(env.FIO_KV, { type: 'admin_login_fail', reason: 'bad_totp', ip, ua, country });
      return errorResponse('Nesprávný TOTP kód', 401);
    }
  }

  await clearFailures(env.FIO_KV, 'admin_login', ip);
  await logEvent(env.FIO_KV, { type: 'admin_login_ok', ip, ua, country });
  const token = await generateSessionToken(env.SESSION_SECRET);
  return jsonResponse({ success: true, adminToken: token, mfaActive: !!env.ADMIN_TOTP_SECRET });
}

export async function onRequestGet(context) {
  return jsonResponse({ mfaRequired: !!context.env.ADMIN_TOTP_SECRET });
}
