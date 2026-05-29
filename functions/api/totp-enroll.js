import { verifyTOTP } from '../_shared/auth.js';
import { putClient, requireClientSession } from '../_shared/kv.js';
import { jsonResponse, errorResponse } from '../_shared/response.js';

export async function onRequestPost(context) {
  const { env, request } = context;
  const body = await request.json();
  const { sessionToken, clientId, action, totpCode } = body;

  const auth = await requireClientSession(env, sessionToken, clientId);
  if (auth.error) return auth.error;
  const client = auth.client;

  if (!client.mfaRequired) {
    return errorResponse('MFA není vyžadováno', 400);
  }

  if (action === 'generate') {
    const secret = generateBase32Secret();
    client.totpSecret = secret;
    await putClient(env.FIO_KV, clientId, client);

    const otpauthUrl = `otpauth://totp/FioBanka:${clientId}?secret=${secret}&issuer=FioBanka&digits=6&period=30`;

    return jsonResponse({
      secret,
      otpauthUrl,
      qrUrl: `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(otpauthUrl)}`
    });
  }

  if (action === 'verify') {
    if (!totpCode || !client.totpSecret) {
      return errorResponse('Chybí TOTP kód nebo secret', 400);
    }

    const validTotp = await verifyTOTP(client.totpSecret, totpCode);
    if (!validTotp) {
      return errorResponse('Nesprávný TOTP kód — zkuste znovu', 401);
    }

    client.totpEnrolled = true;
    await putClient(env.FIO_KV, clientId, client);

    return jsonResponse({ success: true, message: 'TOTP aktivováno' });
  }

  return errorResponse('Neplatná akce (generate|verify)', 400);
}

function generateBase32Secret() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  let result = '';
  for (const b of bytes) {
    result += alphabet[b % 32];
  }
  return result;
}
