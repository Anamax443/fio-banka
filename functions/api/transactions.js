import { verifySessionToken } from '../_shared/auth.js';
import { getAccounts } from '../_shared/accounts.js';
import { jsonResponse, errorResponse } from '../_shared/response.js';

export async function onRequestPost(context) {
  const { env, request } = context;
  const body = await request.json();
  const { sessionToken, accountId, dateFrom, dateTo } = body;

  const validSession = await verifySessionToken(sessionToken, env.SESSION_SECRET);
  if (!validSession) {
    return errorResponse('Neplatná nebo vypršelá session', 401);
  }

  const accounts = getAccounts(env);

  if (!accountId || !accounts[accountId]) {
    return errorResponse('Neplatný účet', 400);
  }

  if (!dateFrom || !dateTo) {
    return errorResponse('Chybí datum od nebo do', 400);
  }

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(dateFrom) || !dateRegex.test(dateTo)) {
    return errorResponse('Neplatný formát data (použijte YYYY-MM-DD)', 400);
  }

  const tokenVar = accounts[accountId].tokenVar;
  const fioToken = env[tokenVar];

  if (!fioToken) {
    return errorResponse('Token pro tento účet není nakonfigurován', 500);
  }

  const fioUrl = `https://fioapi.fio.cz/v1/rest/periods/${fioToken}/${dateFrom}/${dateTo}/transactions.json`;

  try {
    const fioResponse = await fetch(fioUrl, {
      headers: { 'Accept': 'application/json' }
    });

    if (!fioResponse.ok) {
      const status = fioResponse.status;
      if (status === 409) return errorResponse('Příliš častý požadavek. Počkejte 30 sekund mezi dotazy.', 429);
      if (status === 422) return errorResponse('Data starší 90 dnů vyžadují autorizaci v internetovém bankovnictví.', 422);
      if (status === 500) return errorResponse('Neplatný nebo neaktivní token.', 500);
      return errorResponse(`Chyba Fio API: ${status}`, status);
    }

    const data = await fioResponse.json();
    const result = formatTransactions(data, accounts[accountId].name);
    return jsonResponse(result);
  } catch (error) {
    console.error('Fio API error:', error);
    return errorResponse('Chyba při komunikaci s Fio API', 502);
  }
}

function formatTransactions(data, accountName) {
  const statement = data.accountStatement;
  const info = statement.info;
  const transactions = statement.transactionList?.transaction || [];

  const formattedTransactions = transactions.map(tx => ({
    id: col(tx, 'column22'),
    date: fmtDate(col(tx, 'column0')),
    amount: col(tx, 'column1'),
    currency: col(tx, 'column14'),
    counterAccount: col(tx, 'column2'),
    counterAccountName: col(tx, 'column10'),
    bankCode: col(tx, 'column3'),
    bankName: col(tx, 'column12'),
    ks: col(tx, 'column4'),
    vs: col(tx, 'column5'),
    ss: col(tx, 'column6'),
    userIdentification: col(tx, 'column7'),
    messageForRecipient: col(tx, 'column16'),
    type: col(tx, 'column8'),
    executor: col(tx, 'column9'),
    specification: col(tx, 'column18'),
    comment: col(tx, 'column25'),
    bic: col(tx, 'column26'),
    orderId: col(tx, 'column17')
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
      from: fmtDate(info.dateStart),
      to: fmtDate(info.dateEnd)
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

function col(transaction, columnName) {
  const column = transaction[columnName];
  return column ? column.value : null;
}

function fmtDate(dateValue) {
  if (!dateValue) return null;
  if (typeof dateValue === 'string') return dateValue.split('+')[0].split('T')[0];
  if (typeof dateValue === 'number') return new Date(dateValue).toISOString().split('T')[0];
  return dateValue;
}
