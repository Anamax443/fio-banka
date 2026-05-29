import { verifySessionToken } from '../../_shared/auth.js';
import { getAdminSessionVersion } from '../../_shared/kv.js';
import { errorResponse } from '../../_shared/response.js';

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  if (url.pathname === '/api/admin/login') {
    return next();
  }

  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return errorResponse('Admin auth required', 401);
  }

  const token = authHeader.slice(7);
  const expectedVer = await getAdminSessionVersion(env.FIO_KV);
  const valid = await verifySessionToken(token, env.SESSION_SECRET, expectedVer);
  if (!valid) {
    return errorResponse('Invalid or expired admin token', 401);
  }

  return next();
}
