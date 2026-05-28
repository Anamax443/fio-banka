import { getClient, putClient, deleteClient, listClients } from '../../_shared/kv.js';
import { jsonResponse, errorResponse } from '../../_shared/response.js';
import { hashPassword } from '../../_shared/password.js';

export async function onRequestGet(context) {
  const clients = await listClients(context.env.FIO_KV);
  return jsonResponse({ clients });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const body = await request.json();
  const { id, name, password, accounts, ipAllowlist } = body;

  if (!id || !name || !password) {
    return errorResponse('Chybí id, name nebo password', 400);
  }

  if (!id.match(/^[a-z0-9-]+$/)) {
    return errorResponse('ID může obsahovat jen malá písmena, čísla a pomlčky', 400);
  }

  const existing = await getClient(env.FIO_KV, id);
  if (existing) {
    return errorResponse('Klient s tímto ID již existuje', 409);
  }

  const clientData = {
    name,
    password: await hashPassword(password),
    totpSecret: null,
    totpEnrolled: false,
    mfaRequired: true,
    accounts: accounts || [],
    ipAllowlist: Array.isArray(ipAllowlist) ? ipAllowlist : []
  };

  await putClient(env.FIO_KV, id, clientData);
  return jsonResponse({ success: true, id });
}

export async function onRequestPut(context) {
  const { env, request } = context;
  const body = await request.json();
  const { id, name, password, accounts, ipAllowlist, mfaRequired } = body;

  if (!id) {
    return errorResponse('Chybí id', 400);
  }

  const existing = await getClient(env.FIO_KV, id);
  if (!existing) {
    return errorResponse('Klient nenalezen', 404);
  }

  if (name !== undefined) existing.name = name;
  if (ipAllowlist !== undefined) existing.ipAllowlist = Array.isArray(ipAllowlist) ? ipAllowlist : [];
  if (password !== undefined) {
    existing.password = await hashPassword(password);
    existing.mfaRequired = true;
    existing.totpSecret = null;
    existing.totpEnrolled = false;
    existing.passwordChangedByClient = false;
  }
  if (mfaRequired !== undefined) {
    existing.mfaRequired = !!mfaRequired;
    if (mfaRequired === true) {
      // Admin force-enable: invalidate any existing TOTP enrollment + revoke client's
      // self-disable privilege until they change password again
      existing.totpSecret = null;
      existing.totpEnrolled = false;
      existing.passwordChangedByClient = false;
    }
  }
  if (accounts !== undefined) {
    const merged = accounts.map((newAcc, i) => {
      const oldAcc = existing.accounts?.[i];
      if (!newAcc.fioToken && oldAcc?.fioToken) {
        return { ...newAcc, fioToken: oldAcc.fioToken };
      }
      return newAcc;
    });
    existing.accounts = merged;
  }

  await putClient(env.FIO_KV, id, existing);
  return jsonResponse({ success: true });
}

export async function onRequestDelete(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const id = url.searchParams.get('id');

  if (!id) {
    return errorResponse('Chybí id', 400);
  }

  await deleteClient(env.FIO_KV, id);
  return jsonResponse({ success: true });
}
