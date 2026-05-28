import { listEvents } from '../../_shared/audit.js';
import { jsonResponse } from '../../_shared/response.js';

export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit') || '100', 10);

  const events = await listEvents(env.FIO_KV, Math.min(limit, 500));
  return jsonResponse({ events });
}
