import { verifyTOTP, generateReauthToken, REAUTH_TTL_MS } from '../../_shared/auth.js';
import { requireClientSession, clientSessionVersion } from '../../_shared/kv.js';
import { jsonResponse, errorResponse } from '../../_shared/response.js';
import { verifyPassword } from '../../_shared/password.js';
import { logEvent } from '../../_shared/audit.js';
import { checkRateLimit, recordFailure, clearFailures } from '../../_shared/ratelimit.js';

export async function onRequestPost(context) {
  const { env, request } = context;
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const ua = request.headers.get('User-Agent') || 'unknown';
  const country = request.cf?.country || 'unknown';

  const body = await request.json();
  const { sessionToken, clientId, password, totpCode } = body;

  // Step 1: must have valid session (already logged in)
  const auth = await requireClientSession(env, sessionToken, clientId);
  if (auth.error) return auth.error;
  const client = auth.client;

  // Step 2: rate limit per IP for reauth attempts
  const rl = await checkRateLimit(env.FIO_KV, 'client_reauth', ip);
  if (!rl.allowed) {
    await logEvent(env.FIO_KV, { type: 'client_reauth_fail', clientId, reason: 'rate_limited', ip, ua, country });
    return errorResponse(`Příliš mnoho pokusů. Zkuste znovu za ${Math.ceil(rl.retryInSec / 60)} minut.`, 429);
  }

  // Step 3: verify password
  if (!password) return errorResponse('Chybí heslo', 400);
  const pwOk = await verifyPassword(password, client.password);
  if (!pwOk) {
    await recordFailure(env.FIO_KV, 'client_reauth', ip);
    await logEvent(env.FIO_KV, { type: 'client_reauth_fail', clientId, reason: 'bad_password', ip, ua, country });
    return errorResponse('Nesprávné heslo', 401);
  }

  // Step 4: verify TOTP if MFA is enabled and enrolled
  if (client.mfaRequired && client.totpEnrolled) {
    if (!totpCode) return errorResponse('Chybí TOTP kód', 400);
    const totpOk = await verifyTOTP(client.totpSecret, totpCode);
    if (!totpOk) {
      await recordFailure(env.FIO_KV, 'client_reauth', ip);
      await logEvent(env.FIO_KV, { type: 'client_reauth_fail', clientId, reason: 'bad_totp', ip, ua, country });
      return errorResponse('Nesprávný TOTP kód', 401);
    }
  }

  await clearFailures(env.FIO_KV, 'client_reauth', ip);
  await logEvent(env.FIO_KV, { type: 'client_reauth_ok', clientId, ip, ua, country });

  const reauthToken = await generateReauthToken(env.SESSION_SECRET, clientSessionVersion(client));
  return jsonResponse({
    success: true,
    reauthToken,
    expiresIn: REAUTH_TTL_MS / 1000
  });
}
