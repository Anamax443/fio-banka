export async function getClient(kv, clientId) {
  const data = await kv.get(`client:${clientId}`, 'json');
  return data;
}

export async function putClient(kv, clientId, clientData) {
  await kv.put(`client:${clientId}`, JSON.stringify(clientData));
}

export async function deleteClient(kv, clientId) {
  await kv.delete(`client:${clientId}`);
}

export async function listClients(kv) {
  const list = await kv.list({ prefix: 'client:' });
  const clients = [];
  for (const key of list.keys) {
    const data = await kv.get(key.name, 'json');
    if (data) {
      const id = key.name.replace('client:', '');
      const allowlist = data.ipAllowlist || [];
      const ipRestricted = allowlist.length > 0 && !allowlist.includes('*');
      clients.push({
        id,
        name: data.name,
        accountCount: data.accounts?.length || 0,
        totpEnrolled: data.totpEnrolled || false,
        ipRestricted,
        ipCount: allowlist.length
      });
    }
  }
  return clients;
}
