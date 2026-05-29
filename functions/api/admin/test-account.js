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
  const fioUrl = `https://fioapi.fio.cz/v1/rest/periods/${account.fioToken}/${weekAgo}/${today}/transactions.json`;
  const safeUrl = fioUrl.replace(account.fioToken, account.fioToken.substring(0, 4) + '***');

  const log = [];
  log.push('GET ' + safeUrl);
  log.push('Účet: ' + account.name + ' (index ' + i + ')');
  log.push('Období: ' + weekAgo + ' -> ' + today);

  try {
    const t0 = Date.now();
    const r = await fetch(fioUrl, { headers: { 'Accept': 'application/json' } });
    const dt = Date.now() - t0;
    log.push('HTTP ' + r.status + ' ' + r.statusText + ' (' + dt + ' ms)');

    if (r.status === 409) {
      log.push('Rate limit — nelze potvrdit funkčnost tokenu, pouze že server reaguje');
      return jsonResponse({ success: false, status: 'rate_limit', message: 'Rate limit (HTTP 409) — token mohl by být platný, ale Fio teď neodpověděl. Počkejte 30s a zkuste znovu.', log });
    }
    if (r.status === 401 || r.status === 403) {
      log.push('Token zamítnut (HTTP ' + r.status + ')');
      return jsonResponse({ success: false, status: 'invalid_token', message: 'Token byl odmítnut (HTTP ' + r.status + ')', log });
    }
    if (r.status === 500) {
      log.push('Token neplatný nebo neaktivní (Fio vrací HTTP 500)');
      return jsonResponse({ success: false, status: 'invalid_token', message: 'Neplatný nebo neaktivní token', log });
    }
    if (!r.ok) {
      const body = await r.text();
      log.push('Body: ' + body.substring(0, 200));
      return jsonResponse({ success: false, status: 'http_error', message: 'Fio API chyba HTTP ' + r.status, log });
    }

    const data = await r.json();
    const info = data.accountStatement?.info;
    const txCount = data.accountStatement?.transactionList?.transaction?.length || 0;
    if (!info) {
      log.push('Response neobsahuje accountStatement.info');
      return jsonResponse({ success: false, status: 'unexpected_response', message: 'Neočekávaný formát odpovědi', log });
    }
    // Privacy: ne-vrace cislo uctu, IBAN ani zustatek do log. Admin vidi jen
    // ze token funguje + pocet transakci v testovacim okne.
    log.push('OK ✓');
    log.push('Transakce v testovacím období: ' + txCount);

    return jsonResponse({
      success: true,
      status: 'ok',
      message: 'Token funguje',
      txCount,
      log
    });
  } catch (error) {
    log.push('Network error: ' + error.message);
    return jsonResponse({ success: false, status: 'network_error', message: 'Chyba připojení: ' + error.message, log }, 502);
  }
}
