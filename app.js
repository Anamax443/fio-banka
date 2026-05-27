let sessionToken = null;
let accounts = [];
let currentData = null;
let mfaEnabled = true;

const loginScreen = document.getElementById('loginScreen');
const appScreen = document.getElementById('appScreen');
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');
const logoutBtn = document.getElementById('logoutBtn');
const accountSelect = document.getElementById('accountSelect');
const dateFrom = document.getElementById('dateFrom');
const dateTo = document.getElementById('dateTo');
const loadBtn = document.getElementById('loadBtn');
const exportBtn = document.getElementById('exportBtn');
const errorBanner = document.getElementById('errorBanner');
const errorMessage = document.getElementById('errorMessage');
const resultsSection = document.getElementById('resultsSection');
const loadingState = document.getElementById('loadingState');
const emptyState = document.getElementById('emptyState');
const accountInfo = document.getElementById('accountInfo');
const summaryCards = document.getElementById('summaryCards');
const transactionsBody = document.getElementById('transactionsBody');
const transactionCount = document.getElementById('transactionCount');
const quickPeriodBtns = document.querySelectorAll('.quick-period-btn');
const totpSection = document.getElementById('totpSection');

document.addEventListener('DOMContentLoaded', async () => {
    await loadConfig();
    checkSession();
    setupEventListeners();
    setDefaultDates();
});

async function loadConfig() {
    try {
        const res = await fetch('/api/config');
        const data = await res.json();
        mfaEnabled = data.mfaEnabled;
        if (!mfaEnabled) {
            totpSection.classList.add('hidden');
            document.getElementById('totpCode').removeAttribute('required');
        }
    } catch {
        // default: MFA enabled
    }
}

function checkSession() {
    const saved = sessionStorage.getItem('fioSession');
    if (saved) {
        const session = JSON.parse(saved);
        if (session.expiresAt > Date.now()) {
            sessionToken = session.token;
            showApp();
            return;
        }
        sessionStorage.removeItem('fioSession');
    }
    showLogin();
}

function setupEventListeners() {
    loginForm.addEventListener('submit', handleLogin);
    logoutBtn.addEventListener('click', handleLogout);
    loadBtn.addEventListener('click', loadTransactions);
    exportBtn.addEventListener('click', exportCSV);

    quickPeriodBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            quickPeriodBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            setQuickPeriod(btn.dataset.period);
        });
    });
}

function setDefaultDates() {
    const today = new Date();
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    dateTo.value = formatDateForInput(today);
    dateFrom.value = formatDateForInput(firstDayOfMonth);

    document.querySelector('[data-period="month"]').classList.add('active');
}

function setQuickPeriod(period) {
    const today = new Date();
    let from, to;

    switch (period) {
        case 'today':
            from = to = today;
            break;
        case 'yesterday':
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            from = to = yesterday;
            break;
        case 'week':
            const dayOfWeek = today.getDay();
            const monday = new Date(today);
            monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
            from = monday;
            to = today;
            break;
        case 'month':
            from = new Date(today.getFullYear(), today.getMonth(), 1);
            to = today;
            break;
        case '30days':
            from = new Date(today);
            from.setDate(from.getDate() - 30);
            to = today;
            break;
        case '90days':
            from = new Date(today);
            from.setDate(from.getDate() - 90);
            to = today;
            break;
    }

    dateFrom.value = formatDateForInput(from);
    dateTo.value = formatDateForInput(to);
}

function formatDateForInput(date) {
    return date.toISOString().split('T')[0];
}

function showLogin() {
    loginScreen.classList.remove('hidden');
    appScreen.classList.add('hidden');
}

function showApp() {
    loginScreen.classList.add('hidden');
    appScreen.classList.remove('hidden');
    loadAccounts();
}

async function handleLogin(e) {
    e.preventDefault();

    const password = document.getElementById('password').value;
    const totpCode = document.getElementById('totpCode').value;

    loginError.classList.remove('visible');
    loginForm.querySelector('button').disabled = true;

    const payload = { password };
    if (mfaEnabled && totpCode) payload.totpCode = totpCode;

    try {
        const response = await fetch('/api/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Chyba prihlaseni');
        }

        sessionToken = data.sessionToken;
        sessionStorage.setItem('fioSession', JSON.stringify({
            token: sessionToken,
            expiresAt: Date.now() + (data.expiresIn * 1000)
        }));

        showApp();
    } catch (error) {
        loginError.textContent = error.message;
        loginError.classList.add('visible');
    } finally {
        loginForm.querySelector('button').disabled = false;
    }
}

function handleLogout() {
    sessionToken = null;
    sessionStorage.removeItem('fioSession');
    currentData = null;
    document.getElementById('password').value = '';
    document.getElementById('totpCode').value = '';
    showLogin();
}

async function loadAccounts() {
    try {
        const response = await fetch('/api/accounts');
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Chyba nacitani uctu');
        }

        accounts = data.accounts;
        accountSelect.innerHTML = accounts.map(acc =>
            `<option value="${acc.id}">${acc.name}</option>`
        ).join('');
    } catch (error) {
        showError('Nepodarilo se nacist seznam uctu');
    }
}

async function loadTransactions() {
    const accountId = accountSelect.value;
    const from = dateFrom.value;
    const to = dateTo.value;

    if (!accountId || !from || !to) {
        showError('Vyberte ucet a obdobi');
        return;
    }

    hideError();
    resultsSection.classList.add('hidden');
    emptyState.classList.add('hidden');
    loadingState.classList.remove('hidden');
    loadBtn.disabled = true;

    try {
        const response = await fetch('/api/transactions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionToken,
                accountId,
                dateFrom: from,
                dateTo: to
            })
        });

        const data = await response.json();

        if (!response.ok) {
            if (response.status === 401) {
                handleLogout();
                return;
            }
            throw new Error(data.error || 'Chyba nacitani dat');
        }

        currentData = data;
        displayResults(data);
    } catch (error) {
        showError(error.message);
        emptyState.classList.remove('hidden');
    } finally {
        loadingState.classList.add('hidden');
        loadBtn.disabled = false;
    }
}

function displayResults(data) {
    accountInfo.innerHTML = `
        <div class="info-item">
            <div class="info-label">Ucet</div>
            <div class="info-value">${data.account.name}</div>
        </div>
        <div class="info-item">
            <div class="info-label">Cislo uctu</div>
            <div class="info-value">${data.account.accountId}/${data.account.bankId}</div>
        </div>
        <div class="info-item">
            <div class="info-label">Obdobi</div>
            <div class="info-value">${formatDisplayDate(data.period.from)} – ${formatDisplayDate(data.period.to)}</div>
        </div>
        <div class="info-item">
            <div class="info-label">Konecny zustatek</div>
            <div class="info-value">${formatCurrency(data.balance.closing)} ${data.account.currency}</div>
        </div>
    `;

    summaryCards.innerHTML = `
        <div class="summary-card">
            <div class="summary-icon income">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="12" y1="19" x2="12" y2="5"></line>
                    <polyline points="5 12 12 5 19 12"></polyline>
                </svg>
            </div>
            <div class="summary-content">
                <div class="summary-label">Prijmy</div>
                <div class="summary-value">${formatCurrency(data.summary.income)}</div>
            </div>
        </div>
        <div class="summary-card">
            <div class="summary-icon expense">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <polyline points="19 12 12 19 5 12"></polyline>
                </svg>
            </div>
            <div class="summary-content">
                <div class="summary-label">Vydaje</div>
                <div class="summary-value">${formatCurrency(data.summary.expense)}</div>
            </div>
        </div>
        <div class="summary-card">
            <div class="summary-icon balance">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="12" y1="1" x2="12" y2="23"></line>
                    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                </svg>
            </div>
            <div class="summary-content">
                <div class="summary-label">Rozdil</div>
                <div class="summary-value">${formatCurrency(data.summary.difference)}</div>
            </div>
        </div>
        <div class="summary-card">
            <div class="summary-icon count">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="16" y1="13" x2="8" y2="13"></line>
                    <line x1="16" y1="17" x2="8" y2="17"></line>
                    <polyline points="10 9 9 9 8 9"></polyline>
                </svg>
            </div>
            <div class="summary-content">
                <div class="summary-label">Pocet transakci</div>
                <div class="summary-value">${data.summary.transactionCount}</div>
            </div>
        </div>
    `;

    transactionCount.textContent = `${data.summary.transactionCount} polozek`;

    if (data.transactions.length === 0) {
        transactionsBody.innerHTML = `
            <tr>
                <td colspan="6" class="text-center" style="padding: 48px;">
                    Zadne pohyby v danem obdobi
                </td>
            </tr>
        `;
    } else {
        transactionsBody.innerHTML = data.transactions.map(tx => `
            <tr>
                <td class="date-cell">${formatDisplayDate(tx.date)}</td>
                <td>
                    <div class="amount ${tx.amount >= 0 ? 'positive' : 'negative'}">
                        ${tx.amount >= 0 ? '+' : ''}${formatCurrency(tx.amount)} ${tx.currency}
                    </div>
                </td>
                <td>
                    <div class="counter-account">${tx.counterAccount || '—'}${tx.bankCode ? '/' + tx.bankCode : ''}</div>
                    ${tx.counterAccountName ? `<div class="account-name">${tx.counterAccountName}</div>` : ''}
                </td>
                <td>
                    <div class="symbols">
                        ${tx.vs ? 'VS: ' + tx.vs : ''}
                        ${tx.ks ? ' KS: ' + tx.ks : ''}
                        ${tx.ss ? ' SS: ' + tx.ss : ''}
                        ${!tx.vs && !tx.ks && !tx.ss ? '—' : ''}
                    </div>
                </td>
                <td class="message-cell">
                    <div class="message-text">${tx.messageForRecipient || tx.comment || tx.userIdentification || '—'}</div>
                </td>
                <td>
                    <span class="type-badge">${tx.type || '—'}</span>
                </td>
            </tr>
        `).join('');
    }

    resultsSection.classList.remove('hidden');
    exportBtn.disabled = data.transactions.length === 0;
}

function exportCSV() {
    if (!currentData || !currentData.transactions.length) return;

    const headers = ['Datum', 'Castka', 'Mena', 'Protiucet', 'Nazev protiuctu', 'Kod banky', 'VS', 'KS', 'SS', 'Zprava', 'Typ'];
    const rows = currentData.transactions.map(tx => [
        tx.date,
        tx.amount,
        tx.currency,
        tx.counterAccount || '',
        tx.counterAccountName || '',
        tx.bankCode || '',
        tx.vs || '',
        tx.ks || '',
        tx.ss || '',
        tx.messageForRecipient || tx.comment || '',
        tx.type || ''
    ]);

    const csvContent = [
        headers.join(';'),
        ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(';'))
    ].join('\n');

    const blob = new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `fio_pohyby_${currentData.account.name}_${currentData.period.from}_${currentData.period.to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('cs-CZ', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(amount);
}

function formatDisplayDate(dateStr) {
    if (!dateStr) return '—';
    const [year, month, day] = dateStr.split('-');
    return `${day}.${month}.${year}`;
}

function showError(message) {
    errorMessage.textContent = message;
    errorBanner.classList.add('visible');
}

function hideError() {
    errorBanner.classList.remove('visible');
}
