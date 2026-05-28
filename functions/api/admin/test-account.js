import { getClient } from '../../_shared/kv.js';
import { jsonResponse, errorResponse } from '../../_shared/response.js';

export async function onRequestPost(context) {
  const { env, request } = context;
  const { clientId, accountIndex } = await request.json();

  if (!clientId) return errorResponse('Chybí clientId', 400);

  const client = await getClient(env.FIO_KV, clientId);
  if (!client) return errorResponse('Klient nenalezen', 404);

  const i = parseInt(accountIndex, 10);
  const account = client.accounts?.[i];
  if (!account) return errorResponse('Účet neexistuje', 404);
  if (!account.fioToken) return errorResponse('Klient zatím nezadal API klíč pro tento účet', 400);

  const today = new Date().toISOString().split('T')[0];
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  const url = `https://fioapi.fio.cz/v1/rest/periods/${account.fioToken}/${weekAgo}/${today}/transactions.json`;

  try {
    const r = await fetch(url, { headers: { 'Accept': 'application/json' } });

    if (r.status === 409) {
      return jsonResponse({ success: true, message: 'Token je platný (rate limit — počkejte 30s)' });
    }
    if (!r.ok) {
      if (r.status === 500) return errorResponse('Neplatný nebo neaktivní token', 400);
      return errorResponse(`Fio API chyba: ${r.status}`, 400);
    }

    const data = await r.json();
    const info = data.accountStatement?.info;
    return jsonResponse({
      success: true,
      message: 'Token funguje',
      account: {
        accountId: info?.accountId,
        bankId: info?.bankId,
        currency: info?.currency,
        iban: info?.iban
      }
    });
  } catch (error) {
    return errorResponse('Chyba připojení k Fio API: ' + error.message, 502);
  }
}
