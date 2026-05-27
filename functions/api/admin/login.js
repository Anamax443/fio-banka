import { generateSessionToken } from '../../_shared/auth.js';
import { jsonResponse, errorResponse } from '../../_shared/response.js';

export async function onRequestPost(context) {
  const { env, request } = context;

  if (!env.ADMIN_SECRET) {
    return errorResponse('Admin not configured', 500);
  }

  const body = await request.json();
  if (!body.password || body.password !== env.ADMIN_SECRET) {
    return errorResponse('Nesprávné admin heslo', 401);
  }

  const token = await generateSessionToken(env.SESSION_SECRET);
  return jsonResponse({ success: true, adminToken: token });
}
