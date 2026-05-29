import { jsonResponse, errorResponse } from '../../_shared/response.js';
import { verifyPassword, hashPassword } from '../../_shared/password.js';
import { bumpAdminSessionVersion } from '../../_shared/kv.js';
import { generateSessionToken, SESSION_TTL_MS } from '../../_shared/auth.js';

export async function onRequestPost(context) {
  const { env, request } = context;
  const body = await request.json();
  const { currentPassword, newPassword } = body;

  if (!currentPassword || !newPassword) {
    return errorResponse('Vyplnte stavajici i nove heslo', 400);
  }

  if (newPassword.length < 6) {
    return errorResponse('Nove admin heslo musi mit alespon 6 znaku', 400);
  }

  const currentFromKv = await env.FIO_KV.get('admin:password');
  const actualCurrent = currentFromKv || env.ADMIN_SECRET;

  const ok = await verifyPassword(currentPassword, actualCurrent);
  if (!ok) {
    return errorResponse('Stavajici heslo je nespravne', 401);
  }

  const hashed = await hashPassword(newPassword);
  await env.FIO_KV.put('admin:password', hashed);
  // Invalidate all existing admin sessions and issue fresh one for current tab
  const newVer = await bumpAdminSessionVersion(env.FIO_KV);
  const newToken = await generateSessionToken(env.SESSION_SECRET, newVer);

  return jsonResponse({
    success: true,
    message: 'Heslo zmeneno',
    adminToken: newToken,
    expiresIn: SESSION_TTL_MS / 1000
  });
}
