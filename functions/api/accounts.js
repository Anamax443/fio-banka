import { getAccounts } from '../_shared/accounts.js';
import { jsonResponse } from '../_shared/response.js';

export async function onRequestGet(context) {
  const accountsMap = getAccounts(context.env);
  const accounts = Object.entries(accountsMap).map(([id, data]) => ({
    id,
    name: data.name
  }));
  return jsonResponse({ accounts });
}
