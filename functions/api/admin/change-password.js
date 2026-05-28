import { jsonResponse, errorResponse } from '../../_shared/response.js';

export async function onRequestPost(context) {
  const { env, request } = context;
  const body = await request.json();
  const { currentPassword, newPassword } = body;

  if (!currentPassword || !newPassword) {
    return errorResponse('Vyplnte stavajici i nove heslo', 400);
  }

  if (newPassword.length < 4) {
    return errorResponse('Nove heslo musi mit alespon 4 znaky', 400);
  }

  const currentFromKv = await env.FIO_KV.get('admin:password');
  const actualCurrent = currentFromKv || env.ADMIN_SECRET;

  if (currentPassword !== actualCurrent) {
    return errorResponse('Stavajici heslo je nespravne', 401);
  }

  await env.FIO_KV.put('admin:password', newPassword);

  return jsonResponse({ success: true, message: 'Heslo zmeneno' });
}
