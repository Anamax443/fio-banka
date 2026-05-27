import { jsonResponse } from '../_shared/response.js';

export async function onRequestGet(context) {
  const mfaEnabled = context.env.MFA_ENABLED !== 'false';
  return jsonResponse({ mfaEnabled });
}
