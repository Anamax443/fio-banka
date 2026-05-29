import { listClients, getClient } from '../../_shared/kv.js';
import { jsonResponse } from '../../_shared/response.js';
import { logEvent } from '../../_shared/audit.js';

async function testAccount(fioToken) {
  if (!fioToken) return { status: 'no_token', message: 'Klient zatím nezadal API klíč' };
  const today = new Date().toISOString().split('T')[0];
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  const url = `https://fioapi.fio.cz/v1/rest/periods/${fioToken}/${weekAgo}/${today}/transactions.json`;
  try {
    const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (r.status === 409) return { status: 'rate_limit', message: 'Rate limit (Fio API)' };
    if (r.status === 401 || r.status === 403) return { status: 'invalid_token', message: 'Token odmítnut' };
    if (r.status === 500) return { status: 'invalid_token', message: 'Token neplatný/neaktivní' };
    if (!r.ok) return { status: 'http_error', message: 'HTTP ' + r.status };
    const data = await r.json();
    const info = data.accountStatement?.info;
    if (!info) return { status: 'unexpected_response', message: 'Neočekávaný formát' };
    return {
      status: 'ok',
      message: 'OK',
      account: {
        accountId: info.accountId,
        bankId: info.bankId,
        currency: info.currency,
        iban: info.iban,
        closingBalance: info.closingBalance
      }
    };
  } catch (e) {
    return { status: 'network_error', message: 'Network: ' + e.message };
  }
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const trigger = (await request.json().catch(() => ({})))?.trigger || 'manual';
  const startTs = Date.now();

  const clients = await listClients(env.FIO_KV);
  const results = [];
  let okCount = 0, failCount = 0, noTokenCount = 0;

  for (const c of clients) {
    const full = await getClient(env.FIO_KV, c.id);
    const accounts = full?.accounts || [];
    const accountResults = [];
    for (let i = 0; i < accounts.length; i++) {
      const acc = accounts[i];
      const res = await testAccount(acc.fioToken);
      accountResults.push({ index: i, name: acc.name, ...res });
      if (res.status === 'ok') okCount++;
      else if (res.status === 'no_token') noTokenCount++;
      else failCount++;
      await logEvent(env.FIO_KV, {
        type: res.status === 'ok' ? 'api_test_ok' : 'api_test_fail',
        clientId: c.id,
        accountIndex: i,
        accountName: acc.name,
        status: res.status,
        trigger
      });
      // Fio API rate limit 1/30s — back off mezi pokusy
      if (i < accounts.length - 1 || c !== clients[clients.length - 1]) {
        await new Promise(r => setTimeout(r, 100));
      }
    }
    results.push({ id: c.id, name: c.name, accounts: accountResults });
  }

  return jsonResponse({
    success: true,
    trigger,
    durationMs: Date.now() - startTs,
    summary: { ok: okCount, fail: failCount, noToken: noTokenCount, total: okCount + failCount + noTokenCount },
    results
  });
}
