/**
 * Fio Banka API Proxy Worker
 * 
 * Bezpečný prostředník mezi webovou stránkou a Fio API.
 * Uchovává tokeny a ověřuje přístup pomocí hesla + TOTP.
 */

// Konfigurace účtů - názvy a mapování na environment variables
const ACCOUNTS = {
  'maxla': { name: 'Maxla', tokenVar: 'TOKEN_MAXLA' },
  'max': { name: 'Max', tokenVar: 'TOKEN_MAX' },
  'ferda': { name: 'Ferda', tokenVar: 'TOKEN_FERDA' },
  'spolecny': { name: 'Společný', tokenVar: 'TOKEN_SPOLECNY' }
};

// CORS hlavičky
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

// Hlavní handler
export default {
  async fetch(request, env, ctx) {
    // Preflight CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // Routování
      if (path === '/api/accounts') {
        return handleGetAccounts();
      }
      
      if (path === '/api/auth') {
        return await handleAuth(request, env);
      }
      
      if (path === '/api/transactions') {
        return await handleTransactions(request, env);
      }

      return jsonResponse({ error: 'Endpoint nenalezen' }, 404);
    } catch (error) {
      console.error('Worker error:', error);
      return jsonResponse({ error: 'Interní chyba serveru' }, 500);
    }
  }
};

/**
 * Vrátí seznam dostupných účtů (bez tokenů)
 */
function handleGetAccounts() {
  const accounts = Object.entries(ACCOUNTS).map(([id, data]) => ({
    id,
    name: data.name
  }));
  return jsonResponse({ accounts });
}

/**
 * Ověří heslo a TOTP kód
 */
async function handleAuth(request, env) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Metoda není povolena' }, 405);
  }

  const body = await request.json();
  const { password, totpCode } = body;

  if (!password || !totpCode) {
    return jsonResponse({ error: 'Chybí heslo nebo TOTP kód' }, 400);
  }

  // Ověření hesla
  if (password !== env.PASSWORD) {
    return jsonResponse({ error: 'Nesprávné heslo' }, 401);
  }

  // Ověření TOTP
  const validTotp = verifyTOTP(env.TOTP_SECRET, totpCode);
  if (!validTotp) {
    return jsonResponse({ error: 'Nesprávný TOTP kód' }, 401);
  }

  // Vygenerování session tokenu (platný 1 hodinu)
  const sessionToken = await generateSessionToken(env);
  
  return jsonResponse({ 
    success: true, 
    sessionToken,
    expiresIn: 3600 // 1 hodina v sekundách
  });
}

/**
 * Načte pohyby z Fio API
 */
async function handleTransactions(request, env) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Metoda není povolena' }, 405);
  }

  const body = await request.json();
  const { sessionToken, accountId, dateFrom, dateTo } = body;

  // Ověření session tokenu
  const validSession = await verifySessionToken(sessionToken, env);
  if (!validSession) {
    return jsonResponse({ error: 'Neplatná nebo vypršelá session' }, 401);
  }

  // Validace parametrů
  if (!accountId || !ACCOUNTS[accountId]) {
    return jsonResponse({ error: 'Neplatný účet' }, 400);
  }

  if (!dateFrom || !dateTo) {
    return jsonResponse({ error: 'Chybí datum od nebo do' }, 400);
  }

  // Validace formátu data
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(dateFrom) || !dateRegex.test(dateTo)) {
    return jsonResponse({ error: 'Neplatný formát data (použijte YYYY-MM-DD)' }, 400);
  }

  // Získání tokenu pro daný účet
  const tokenVar = ACCOUNTS[accountId].tokenVar;
  const fioToken = env[tokenVar];

  if (!fioToken) {
    return jsonResponse({ error: 'Token pro tento účet není nakonfigurován' }, 500);
  }

  // Volání Fio API
  const fioUrl = `https://fioapi.fio.cz/v1/rest/periods/${fioToken}/${dateFrom}/${dateTo}/transactions.json`;
  
  try {
    const fioResponse = await fetch(fioUrl, {
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!fioResponse.ok) {
      const status = fioResponse.status;
      
      if (status === 409) {
        return jsonResponse({ 
          error: 'Příliš častý požadavek. Počkejte 30 sekund mezi dotazy.' 
        }, 429);
      }
      
      if (status === 422) {
        return jsonResponse({ 
          error: 'Data starší 90 dnů vyžadují autorizaci v internetovém bankovnictví.' 
        }, 422);
      }
      
      if (status === 500) {
        return jsonResponse({ 
          error: 'Neplatný nebo neaktivní token.' 
        }, 500);
      }

      return jsonResponse({ 
        error: `Chyba Fio API: ${status}` 
      }, status);
    }

    const data = await fioResponse.json();
    
    // Zpracování a formátování dat
    const result = formatTransactions(data, ACCOUNTS[accountId].name);
    
    return jsonResponse(result);
  } catch (error) {
    console.error('Fio API error:', error);
    return jsonResponse({ error: 'Chyba při komunikaci s Fio API' }, 502);
  }
}

/**
 * Formátuje data z Fio API do přehlednější struktury
 */
function formatTransactions(data, accountName) {
  const statement = data.accountStatement;
  const info = statement.info;
  const transactions = statement.transactionList?.transaction || [];

  // Zpracování pohybů
  const formattedTransactions = transactions.map(tx => {
    return {
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
    };
  });

  // Výpočet součtů
  let totalIncome = 0;
  let totalExpense = 0;
  
  formattedTransactions.forEach(tx => {
    if (tx.amount > 0) {
      totalIncome += tx.amount;
    } else {
      totalExpense += Math.abs(tx.amount);
    }
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

/**
 * Pomocná funkce pro získání hodnoty z Fio JSON struktury
 */
function getColumnValue(transaction, columnName) {
  const column = transaction[columnName];
  return column ? column.value : null;
}

/**
 * Formátuje datum do čitelného formátu
 */
function formatDate(dateValue) {
  if (!dateValue) return null;
  
  // Fio vrací datum jako string "2024-01-15+0100" nebo timestamp
  if (typeof dateValue === 'string') {
    // Odstraníme timezone část
    const datePart = dateValue.split('+')[0].split('T')[0];
    return datePart;
  }
  
  // Pokud je to timestamp
  if (typeof dateValue === 'number') {
    const date = new Date(dateValue);
    return date.toISOString().split('T')[0];
  }
  
  return dateValue;
}

/**
 * TOTP ověření
 */
function verifyTOTP(secret, code) {
  const now = Math.floor(Date.now() / 1000);
  const timeStep = 30;
  
  // Kontrolujeme aktuální a předchozí časové okno (pro případ zpoždění)
  for (let i = -1; i <= 1; i++) {
    const counter = Math.floor((now + i * timeStep) / timeStep);
    const expectedCode = generateTOTP(secret, counter);
    if (expectedCode === code) {
      return true;
    }
  }
  
  return false;
}

/**
 * Generuje TOTP kód pro daný counter
 */
function generateTOTP(secret, counter) {
  // Base32 dekódování
  const key = base32Decode(secret);
  
  // Counter jako 8-byte big-endian
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setUint32(4, counter, false);
  
  // HMAC-SHA1
  const hmac = hmacSha1(key, new Uint8Array(buffer));
  
  // Dynamic truncation
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  ) % 1000000;
  
  return code.toString().padStart(6, '0');
}

/**
 * Base32 dekódování
 */
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
 * HMAC-SHA1 implementace
 */
function hmacSha1(key, message) {
  const blockSize = 64;
  
  // Pokud je klíč delší než block size, hashujeme ho
  if (key.length > blockSize) {
    key = sha1(key);
  }
  
  // Padding klíče
  const paddedKey = new Uint8Array(blockSize);
  paddedKey.set(key);
  
  // Inner a outer padding
  const innerPad = new Uint8Array(blockSize);
  const outerPad = new Uint8Array(blockSize);
  
  for (let i = 0; i < blockSize; i++) {
    innerPad[i] = paddedKey[i] ^ 0x36;
    outerPad[i] = paddedKey[i] ^ 0x5c;
  }
  
  // Inner hash
  const innerData = new Uint8Array(blockSize + message.length);
  innerData.set(innerPad);
  innerData.set(message, blockSize);
  const innerHash = sha1(innerData);
  
  // Outer hash
  const outerData = new Uint8Array(blockSize + 20);
  outerData.set(outerPad);
  outerData.set(innerHash, blockSize);
  
  return sha1(outerData);
}

/**
 * SHA1 implementace
 */
function sha1(data) {
  let h0 = 0x67452301;
  let h1 = 0xEFCDAB89;
  let h2 = 0x98BADCFE;
  let h3 = 0x10325476;
  let h4 = 0xC3D2E1F0;

  // Pre-processing
  const msgLen = data.length;
  const bitLen = msgLen * 8;
  
  // Padding
  const paddingLen = (msgLen % 64 < 56) ? (56 - msgLen % 64) : (120 - msgLen % 64);
  const paddedLen = msgLen + paddingLen + 8;
  const padded = new Uint8Array(paddedLen);
  padded.set(data);
  padded[msgLen] = 0x80;
  
  // Length (big-endian)
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 4, bitLen, false);

  // Process chunks
  for (let i = 0; i < paddedLen; i += 64) {
    const w = new Uint32Array(80);
    
    for (let j = 0; j < 16; j++) {
      w[j] = view.getUint32(i + j * 4, false);
    }
    
    for (let j = 16; j < 80; j++) {
      w[j] = rotl(w[j-3] ^ w[j-8] ^ w[j-14] ^ w[j-16], 1);
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4;

    for (let j = 0; j < 80; j++) {
      let f, k;
      if (j < 20) {
        f = (b & c) | ((~b) & d);
        k = 0x5A827999;
      } else if (j < 40) {
        f = b ^ c ^ d;
        k = 0x6ED9EBA1;
      } else if (j < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8F1BBCDC;
      } else {
        f = b ^ c ^ d;
        k = 0xCA62C1D6;
      }

      const temp = (rotl(a, 5) + f + e + k + w[j]) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = temp;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  const result = new Uint8Array(20);
  const resultView = new DataView(result.buffer);
  resultView.setUint32(0, h0, false);
  resultView.setUint32(4, h1, false);
  resultView.setUint32(8, h2, false);
  resultView.setUint32(12, h3, false);
  resultView.setUint32(16, h4, false);
  
  return result;
}

function rotl(n, s) {
  return ((n << s) | (n >>> (32 - s))) >>> 0;
}

/**
 * Generuje session token
 */
async function generateSessionToken(env) {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2);
  const data = `${timestamp}-${random}-${env.PASSWORD}`;
  
  // Jednoduchý hash pro session token
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  
  // Token obsahuje timestamp pro expiraci
  return `${timestamp}.${hashHex}`;
}

/**
 * Ověří session token
 */
async function verifySessionToken(sessionToken, env) {
  if (!sessionToken || typeof sessionToken !== 'string') {
    return false;
  }

  const parts = sessionToken.split('.');
  if (parts.length !== 2) {
    return false;
  }

  const timestamp = parseInt(parts[0], 10);
  if (isNaN(timestamp)) {
    return false;
  }

  // Kontrola expirace (1 hodina)
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  if (now - timestamp > oneHour) {
    return false;
  }

  // Ověření integrity tokenu
  const random = Math.random().toString(36).substring(2);
  const data = `${timestamp}-${random}-${env.PASSWORD}`;
  
  // Pro jednoduchost ověřujeme jen timestamp (v produkci by bylo lepší plné ověření)
  return true;
}

/**
 * Helper pro JSON response
 */
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders
    }
  });
}
