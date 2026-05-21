/**
 * Fio Banka API Proxy Worker
 *
 * Bezpečný prostředník mezi webovou stránkou a Fio API.
 * Uchovává tokeny a ověřuje přístup pomocí hesla + TOTP.
 */

const ACCOUNTS = {
  'maxla': { name: 'Maxla', tokenVar: 'TOKEN_MAXLA' },
  'max': { name: 'Max', tokenVar: 'TOKEN_MAX' },
  'ferda': { name: 'Ferda', tokenVar: 'TOKEN_FERDA' },
  'spolecny': { name: 'Společný', tokenVar: 'TOKEN_SPOLECNY' }
};

const ALLOWED_ORIGINS = new Set([
  'https://fio-banka.pages.dev',
  'http://localhost:8080',
  'http://localhost:3000',
  'http://127.0.0.1:8080'
]);

const SESSION_TTL_MS = 60 * 60 * 1000;

function corsHeadersFor(origin) {
  const allowed = origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://fio-banka.pages.dev';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin');
    const cors = corsHeadersFor(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === '/api/accounts') return handleGetAccounts(cors);
      if (path === '/api/auth') return await handleAuth(request, env, cors);
      if (path === '/api/transactions') return await handleTransactions(request, env, cors);
      return jsonResponse({ error: 'Endpoint nenalezen' }, 404, cors);
    } catch (error) {
      console.error('Worker error:', error);
      return jsonResponse({ error: 'Interní chyba serveru' }, 500, cors);
    }
  }
};

function handleGetAccounts(cors) {
  const accounts = Object.entries(ACCOUNTS).map(([id, data]) => ({
    id,
    name: data.name
  }));
  return jsonResponse({ accounts }, 200, cors);
}

async function handleAuth(request, env, cors) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Metoda není povolena' }, 405, cors);
  }

  if (!env.SESSION_SECRET) {
    console.error('SESSION_SECRET env var not configured');
    return jsonResponse({ error: 'Server není správně nakonfigurován' }, 500, cors);
  }

  const body = await request.json();
  const { password, totpCode } = body;

  if (!password || !totpCode) {
    return jsonResponse({ error: 'Chybí heslo nebo TOTP kód' }, 400, cors);
  }

  if (password !== env.PASSWORD) {
    return jsonResponse({ error: 'Nesprávné heslo' }, 401, cors);
  }

  const validTotp = await verifyTOTP(env.TOTP_SECRET, totpCode);
  if (!validTotp) {
    return jsonResponse({ error: 'Nesprávný TOTP kód' }, 401, cors);
  }

  const sessionToken = await generateSessionToken(env.SESSION_SECRET);

  return jsonResponse({
    success: true,
    sessionToken,
    expiresIn: SESSION_TTL_MS / 1000
  }, 200, cors);
}

async function handleTransactions(request, env, cors) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Metoda není povolena' }, 405, cors);
  }

  const body = await request.json();
  const { sessionToken, accountId, dateFrom, dateTo } = body;

  const validSession = await verifySessionToken(sessionToken, env.SESSION_SECRET);
  if (!validSession) {
    return jsonResponse({ error: 'Neplatná nebo vypršelá session' }, 401, cors);
  }

  if (!accountId || !ACCOUNTS[accountId]) {
    return jsonResponse({ error: 'Neplatný účet' }, 400, cors);
  }

  if (!dateFrom || !dateTo) {
    return jsonResponse({ error: 'Chybí datum od nebo do' }, 400, cors);
  }

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(dateFrom) || !dateRegex.test(dateTo)) {
    return jsonResponse({ error: 'Neplatný formát data (použijte YYYY-MM-DD)' }, 400, cors);
  }

  const tokenVar = ACCOUNTS[accountId].tokenVar;
  const fioToken = env[tokenVar];

  if (!fioToken) {
    return jsonResponse({ error: 'Token pro tento účet není nakonfigurován' }, 500, cors);
  }

  const fioUrl = `https://fioapi.fio.cz/v1/rest/periods/${fioToken}/${dateFrom}/${dateTo}/transactions.json`;

  try {
    const fioResponse = await fetch(fioUrl, {
      headers: { 'Accept': 'application/json' }
    });

    if (!fioResponse.ok) {
      const status = fioResponse.status;
      if (status === 409) return jsonResponse({ error: 'Příliš častý požadavek. Počkejte 30 sekund mezi dotazy.' }, 429, cors);
      if (status === 422) return jsonResponse({ error: 'Data starší 90 dnů vyžadují autorizaci v internetovém bankovnictví.' }, 422, cors);
      if (status === 500) return jsonResponse({ error: 'Neplatný nebo neaktivní token.' }, 500, cors);
      return jsonResponse({ error: `Chyba Fio API: ${status}` }, status, cors);
    }

    const data = await fioResponse.json();
    const result = formatTransactions(data, ACCOUNTS[accountId].name);
    return jsonResponse(result, 200, cors);
  } catch (error) {
    console.error('Fio API error:', error);
    return jsonResponse({ error: 'Chyba při komunikaci s Fio API' }, 502, cors);
  }
}

function formatTransactions(data, accountName) {
  const statement = data.accountStatement;
  const info = statement.info;
  const transactions = statement.transactionList?.transaction || [];

  const formattedTransactions = transactions.map(tx => ({
    id: getColumnValue(tx, 'column22'),
    date: formatDate(getColumnValue(tx, 'column0')),
    amount: getColumnValue(tx, 'column1'),
    currency: getColumnValue(tx, 'column14'),
    counterAccount: getColumnValue(tx, 'column2'),
    counterAccountName: getColumnValue(tx, 'column10'),
    bankCode: getColumnValue(tx, 'column3'),
    bankName: getColumnValue(tx, 'column12'),
    ks: getColumnValue(tx, 'column4'),
    vs: getColumnValue(tx, 'column5'),
    ss: getColumnValue(tx, 'column6'),
    userIdentification: getColumnValue(tx, 'column7'),
    messageForRecipient: getColumnValue(tx, 'column16'),
    type: getColumnValue(tx, 'column8'),
    executor: getColumnValue(tx, 'column9'),
    specification: getColumnValue(tx, 'column18'),
    comment: getColumnValue(tx, 'column25'),
    bic: getColumnValue(tx, 'column26'),
    orderId: getColumnValue(tx, 'column17')
  }));

  let totalIncome = 0;
  let totalExpense = 0;
  formattedTransactions.forEach(tx => {
    if (tx.amount > 0) totalIncome += tx.amount;
    else totalExpense += Math.abs(tx.amount);
  });

  return {
    account: {
      name: accountName,
      accountId: info.accountId,
      bankId: info.bankId,
      currency: info.currency,
      iban: info.iban,
      bic: info.bic
    },
    period: {
      from: formatDate(info.dateStart),
      to: formatDate(info.dateEnd)
    },
    balance: {
      opening: info.openingBalance,
      closing: info.closingBalance
    },
    summary: {
      income: Math.round(totalIncome * 100) / 100,
      expense: Math.round(totalExpense * 100) / 100,
      difference: Math.round((totalIncome - totalExpense) * 100) / 100,
      transactionCount: formattedTransactions.length
    },
    transactions: formattedTransactions
  };
}

function getColumnValue(transaction, columnName) {
  const column = transaction[columnName];
  return column ? column.value : null;
}

function formatDate(dateValue) {
  if (!dateValue) return null;
  if (typeof dateValue === 'string') return dateValue.split('+')[0].split('T')[0];
  if (typeof dateValue === 'number') return new Date(dateValue).toISOString().split('T')[0];
  return dateValue;
}

/**
 * TOTP — RFC 6238 (SHA-1, 30s window, ±1 step tolerance)
 */
async function verifyTOTP(secret, code) {
  if (!secret || !code) return false;
  const now = Math.floor(Date.now() / 1000);
  const timeStep = 30;
  for (let i = -1; i <= 1; i++) {
    const counter = Math.floor((now + i * timeStep) / timeStep);
    const expectedCode = await generateTOTP(secret, counter);
    if (timingSafeEqualStr(expectedCode, code)) return true;
  }
  return false;
}

async function generateTOTP(secret, counter) {
  const key = base32Decode(secret);
  const counterBuf = new ArrayBuffer(8);
  new DataView(counterBuf).setUint32(4, counter, false);

  const cryptoKey = await crypto.subtle.importKey(
    'raw', key, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
  );
  const hmac = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, counterBuf));

  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  ) % 1000000;
  return code.toString().padStart(6, '0');
}

function base32Decode(encoded) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  encoded = encoded.toUpperCase().replace(/=+$/, '');
  let bits = '';
  for (const char of encoded) {
    const val = alphabet.indexOf(char);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.substr(i, 8), 2));
  }
  return new Uint8Array(bytes);
}

/**
 * Session token format: `${timestamp}.${nonceHex}.${hmacSig}`
 *   timestamp = Date.now() ms
 *   nonce     = 16 crypto-safe random bytes (hex)
 *   sig       = HMAC-SHA256(SESSION_SECRET, `${timestamp}.${nonceHex}`)
 * Verification rejects tampered, expired, or future-dated tokens via timing-safe compare.
 */
async function generateSessionToken(secret) {
  const timestamp = Date.now();
  const nonceBytes = new Uint8Array(16);
  crypto.getRandomValues(nonceBytes);
  const nonce = bytesToHex(nonceBytes);
  const payload = `${timestamp}.${nonce}`;
  const sig = await hmacSha256Hex(secret, payload);
  return `${payload}.${sig}`;
}

async function verifySessionToken(sessionToken, secret) {
  if (!sessionToken || typeof sessionToken !== 'string' || !secret) return false;
  const parts = sessionToken.split('.');
  if (parts.length !== 3) return false;
  const [tsStr, nonce, providedSig] = parts;

  const ts = parseInt(tsStr, 10);
  if (isNaN(ts)) return false;
  const now = Date.now();
  if (now - ts > SESSION_TTL_MS) return false;
  if (now < ts) return false;

  const expectedSig = await hmacSha256Hex(secret, `${tsStr}.${nonce}`);
  return timingSafeEqualStr(providedSig, expectedSig);
}

async function hmacSha256Hex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return bytesToHex(new Uint8Array(sig));
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function jsonResponse(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...cors
    }
  });
}
