import { jsonResponse, errorResponse } from '../../_shared/response.js';

export async function onRequestPost(context) {
  const { request } = context;
  const body = await request.json();
  const { fioToken } = body;

  if (!fioToken) {
    return errorResponse('Chybí fioToken', 400);
  }

  const today = new Date().toISOString().split('T')[0];
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  const url = `https://fioapi.fio.cz/v1/rest/periods/${fioToken}/${weekAgo}/${today}/transactions.json`;

  try {
    const r = await fetch(url, { headers: { 'Accept': 'application/json' } });

    if (r.status === 409) {
      return jsonResponse({ success: true, message: 'Token je platny (rate limit — pockejte 30s a zkuste znovu pro detail)' });
    }

    if (!r.ok) {
      const status = r.status;
      if (status === 500) return errorResponse('Neplatny nebo neaktivni token', 400);
      return errorResponse(`Fio API chyba: ${status}`, 400);
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
    return errorResponse('Chyba pripojeni k Fio API: ' + error.message, 502);
  }
}
