let sessionToken = null;
let currentClientId = null;
let currentClientName = null;
let accounts = [];
let currentData = null;

const loginScreen = document.getElementById('loginScreen');
const appScreen = document.getElementById('appScreen');
const totpEnrollScreen = document.getElementById('totpEnrollScreen');
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

document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const clientIdParam = params.get('c');
    if (clientIdParam) {
        const cidInput = document.getElementById('clientId');
        if (cidInput) {
            cidInput.value = clientIdParam;
            cidInput.readOnly = true;
            cidInput.style.opacity = '0.6';
            setTimeout(() => document.getElementById('password')?.focus(), 100);
        }
    }
    checkSession();
    setupEventListeners();
    setDefaultDates();
    const enrollBtn = document.getElementById('totpEnrollBtn');
    if (enrollBtn) enrollBtn.addEventListener('click', verifyTotpEnrollment);
    const profileBtn = document.getElementById('profileBtn');
    if (profileBtn) profileBtn.addEventListener('click', toggleProfile);
    const addBtn = document.getElementById('addProfileAccountBtn');
    if (addBtn) addBtn.addEventListener('click', () => addProfileAccountRow());
});

function toggleProfile() {
    const sec = document.getElementById('profileSection');
    const isHidden = sec.classList.contains('hidden');
    document.getElementById('resultsSection').classList.add('hidden');
    document.getElementById('emptyState').classList.add('hidden');
    document.getElementById('loadingState').classList.add('hidden');
    if (isHidden) {
        sec.classList.remove('hidden');
        loadProfileAccounts();
    } else {
        sec.classList.add('hidden');
        document.getElementById('emptyState').classList.remove('hidden');
    }
}

async function loadProfileAccounts() {
    const list = document.getElementById('profileAccountsList');
    list.innerHTML = '<p style="color:var(--text-secondary);">Nacitam...</p>';
    try {
        const url = '/api/client/accounts?sessionToken=' + encodeURIComponent(sessionToken) + '&clientId=' + encodeURIComponent(currentClientId);
        const r = await fetch(url);
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        list.innerHTML = '';
        if (data.accounts.length === 0) {
            list.innerHTML = '<p style="color:var(--text-secondary);">Zatim nemate zadne ucty. Pridejte prvni.</p>';
            return;
        }
        data.accounts.forEach(a => renderProfileAccountRow(list, a));
    } catch (e) {
        list.innerHTML = '<p style="color:var(--danger);">Chyba: ' + e.message + '</p>';
    }
}

function renderProfileAccountRow(container, account) {
    const row = document.createElement('div');
    row.style.cssText = 'border:1px solid var(--border-color);border-radius:8px;padding:16px;margin-bottom:12px;';
    row.innerHTML =
        '<div style="display:grid;grid-template-columns:1fr 2fr auto auto;gap:10px;align-items:center;">' +
        '<input type="text" class="form-input pa-name" value="' + (account.name || '').replace(/"/g, '&quot;') + '" placeholder="Nazev uctu">' +
        '<input type="password" class="form-input pa-token" placeholder="' + (account.tokenPreview || 'Fio API klic') + ' (prazdne = zachovat)">' +
        '<button type="button" class="btn btn-secondary btn-sm pa-save">Ulozit</button>' +
        '<button type="button" class="btn btn-danger btn-sm pa-del">Smazat</button>' +
        '</div>' +
        '<div class="pa-msg" style="margin-top:8px;font-size:0.8125rem;"></div>';
    row.dataset.index = account.index;
    row.querySelector('.pa-save').addEventListener('click', () => saveProfileAccount(row, account.index));
    row.querySelector('.pa-del').addEventListener('click', () => deleteProfileAccount(row, account.index));
    container.appendChild(row);
}

function addProfileAccountRow() {
    const list = document.getElementById('profileAccountsList');
    const placeholder = list.querySelector('p');
    if (placeholder) placeholder.remove();
    const row = document.createElement('div');
    row.style.cssText = 'border:1px dashed var(--accent);border-radius:8px;padding:16px;margin-bottom:12px;';
    row.innerHTML =
        '<div style="display:grid;grid-template-columns:1fr 2fr auto auto;gap:10px;align-items:center;">' +
        '<input type="text" class="form-input pa-name" placeholder="Nazev uctu">' +
        '<input type="password" class="form-input pa-token" placeholder="Fio API klic">' +
        '<button type="button" class="btn btn-primary btn-sm pa-add">Pridat</button>' +
        '<button type="button" class="btn btn-secondary btn-sm pa-cancel">Zrusit</button>' +
        '</div>' +
        '<div class="pa-msg" style="margin-top:8px;font-size:0.8125rem;"></div>';
    row.querySelector('.pa-add').addEventListener('click', () => createProfileAccount(row));
    row.querySelector('.pa-cancel').addEventListener('click', () => row.remove());
    list.appendChild(row);
}

async function createProfileAccount(row) {
    const name = row.querySelector('.pa-name').value.trim();
    const token = row.querySelector('.pa-token').value.trim();
    const msg = row.querySelector('.pa-msg');
    if (!name || !token) {
        msg.style.color = 'var(--danger)';
        msg.textContent = 'Vyplnte nazev i token';
        return;
    }
    try {
        const r = await fetch('/api/client/accounts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken, clientId: currentClientId, name, fioToken: token })
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        loadProfileAccounts();
    } catch (e) {
        msg.style.color = 'var(--danger)';
        msg.textContent = e.message;
    }
}

async function saveProfileAccount(row, index) {
    const name = row.querySelector('.pa-name').value.trim();
    const token = row.querySelector('.pa-token').value.trim();
    const msg = row.querySelector('.pa-msg');
    try {
        const r = await fetch('/api/client/accounts', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken, clientId: currentClientId, index, name, fioToken: token })
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        msg.style.color = 'var(--success)';
        msg.textContent = 'Ulozeno';
        setTimeout(() => loadProfileAccounts(), 800);
    } catch (e) {
        msg.style.color = 'var(--danger)';
        msg.textContent = e.message;
    }
}

async function deleteProfileAccount(row, index) {
    if (!confirm('Opravdu smazat tento ucet?')) return;
    try {
        const r = await fetch('/api/client/accounts', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken, clientId: currentClientId, index })
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        loadProfileAccounts();
    } catch (e) {
        alert(e.message);
    }
}

function checkSession() {
    const saved = sessionStorage.getItem('fioSession');
    if (saved) {
        const session = JSON.parse(saved);
        if (session.expiresAt > Date.now()) {
            sessionToken = session.token;
            currentClientId = session.clientId;
            currentClientName = session.clientName;
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
        case 'today': from = to = today; break;
        case 'yesterday':
            const y = new Date(today); y.setDate(y.getDate() - 1);
            from = to = y; break;
        case 'week':
            const d = today.getDay();
            const m = new Date(today); m.setDate(today.getDate() - (d === 0 ? 6 : d - 1));
            from = m; to = today; break;
        case 'month':
            from = new Date(today.getFullYear(), today.getMonth(), 1); to = today; break;
        case '30days':
            from = new Date(today); from.setDate(from.getDate() - 30); to = today; break;
        case '90days':
            from = new Date(today); from.setDate(from.getDate() - 90); to = today; break;
    }
    dateFrom.value = formatDateForInput(from);
    dateTo.value = formatDateForInput(to);
}

function formatDateForInput(date) { return date.toISOString().split('T')[0]; }

function showLogin() {
    loginScreen.classList.remove('hidden');
    appScreen.classList.add('hidden');
    if (totpEnrollScreen) totpEnrollScreen.classList.add('hidden');
}

function showApp() {
    loginScreen.classList.add('hidden');
    appScreen.classList.remove('hidden');
    if (totpEnrollScreen) totpEnrollScreen.classList.add('hidden');
    const userBadge = document.getElementById('userNameBadge');
    if (userBadge) userBadge.textContent = currentClientName || currentClientId;
    loadAccounts();
}

async function handleLogin(e) {
    e.preventDefault();

    const clientId = document.getElementById('clientId').value.trim();
    const password = document.getElementById('password').value;
    const totpCode = document.getElementById('totpCode')?.value;

    loginError.classList.remove('visible');
    loginForm.querySelector('button[type="submit"]').disabled = true;

    const payload = { clientId, password };
    if (totpCode) payload.totpCode = totpCode;

    try {
        const response = await fetch('/api/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Chyba prihlaseni');

        sessionToken = data.sessionToken;
        currentClientId = data.clientId;
        currentClientName = data.clientName;

        sessionStorage.setItem('fioSession', JSON.stringify({
            token: sessionToken,
            clientId: currentClientId,
            clientName: currentClientName,
            expiresAt: Date.now() + (data.expiresIn * 1000)
        }));

        if (data.needsTotpEnrollment) {
            showTotpEnrollment();
        } else {
            showApp();
        }
    } catch (error) {
        loginError.textContent = error.message;
        loginError.classList.add('visible');
    } finally {
        loginForm.querySelector('button[type="submit"]').disabled = false;
    }
}

async function showTotpEnrollment() {
    loginScreen.classList.add('hidden');
    appScreen.classList.add('hidden');
    totpEnrollScreen.classList.remove('hidden');

    try {
        const r = await fetch('/api/totp-enroll', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken, clientId: currentClientId, action: 'generate' })
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);

        document.getElementById('totpQrImg').src = data.qrUrl;
        document.getElementById('totpSecretText').textContent = data.secret;
    } catch (error) {
        alert('Chyba pri generovani TOTP: ' + error.message);
    }
}

async function verifyTotpEnrollment() {
    const code = document.getElementById('totpVerifyCode').value.trim();
    if (!code || code.length !== 6) { alert('Zadejte 6-mistny kod'); return; }

    try {
        const r = await fetch('/api/totp-enroll', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken, clientId: currentClientId, action: 'verify', totpCode: code })
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);

        showApp();
    } catch (error) {
        document.getElementById('totpEnrollError').textContent = error.message;
        document.getElementById('totpEnrollError').classList.add('visible');
    }
}

function handleLogout() {
    sessionToken = null;
    currentClientId = null;
    currentClientName = null;
    sessionStorage.removeItem('fioSession');
    currentData = null;
    document.getElementById('clientId').value = '';
    document.getElementById('password').value = '';
    const totpEl = document.getElementById('totpCode');
    if (totpEl) totpEl.value = '';
    showLogin();
}

async function loadAccounts() {
    try {
        const r = await fetch('/api/accounts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken, clientId: currentClientId })
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);

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

    if (!accountId || !from || !to) { showError('Vyberte ucet a obdobi'); return; }

    hideError();
    resultsSection.classList.add('hidden');
    emptyState.classList.add('hidden');
    loadingState.classList.remove('hidden');
    loadBtn.disabled = true;

    try {
        const r = await fetch('/api/transactions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken, clientId: currentClientId, accountId, dateFrom: from, dateTo: to })
        });
        const data = await r.json();
        if (!r.ok) {
            if (r.status === 401) { handleLogout(); return; }
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
        <div class="info-item"><div class="info-label">Ucet</div><div class="info-value">${data.account.name}</div></div>
        <div class="info-item"><div class="info-label">Cislo uctu</div><div class="info-value">${data.account.accountId}/${data.account.bankId}</div></div>
        <div class="info-item"><div class="info-label">Obdobi</div><div class="info-value">${formatDisplayDate(data.period.from)} – ${formatDisplayDate(data.period.to)}</div></div>
        <div class="info-item"><div class="info-label">Zustatek</div><div class="info-value">${formatCurrency(data.balance.closing)} ${data.account.currency}</div></div>
    `;
    summaryCards.innerHTML = `
        <div class="summary-card"><div class="summary-icon income"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg></div><div class="summary-content"><div class="summary-label">Prijmy</div><div class="summary-value">${formatCurrency(data.summary.income)}</div></div></div>
        <div class="summary-card"><div class="summary-icon expense"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg></div><div class="summary-content"><div class="summary-label">Vydaje</div><div class="summary-value">${formatCurrency(data.summary.expense)}</div></div></div>
        <div class="summary-card"><div class="summary-icon balance"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></div><div class="summary-content"><div class="summary-label">Rozdil</div><div class="summary-value">${formatCurrency(data.summary.difference)}</div></div></div>
        <div class="summary-card"><div class="summary-icon count"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></div><div class="summary-content"><div class="summary-label">Transakci</div><div class="summary-value">${data.summary.transactionCount}</div></div></div>
    `;
    transactionCount.textContent = data.summary.transactionCount + ' polozek';
    if (data.transactions.length === 0) {
        transactionsBody.innerHTML = '<tr><td colspan="6" class="text-center" style="padding:48px;">Zadne pohyby</td></tr>';
    } else {
        transactionsBody.innerHTML = data.transactions.map(tx => `
            <tr>
                <td class="date-cell">${formatDisplayDate(tx.date)}</td>
                <td><div class="amount ${tx.amount >= 0 ? 'positive' : 'negative'}">${tx.amount >= 0 ? '+' : ''}${formatCurrency(tx.amount)} ${tx.currency}</div></td>
                <td><div class="counter-account">${tx.counterAccount || '—'}${tx.bankCode ? '/' + tx.bankCode : ''}</div>${tx.counterAccountName ? '<div class="account-name">' + tx.counterAccountName + '</div>' : ''}</td>
                <td><div class="symbols">${tx.vs ? 'VS: ' + tx.vs : ''}${tx.ks ? ' KS: ' + tx.ks : ''}${tx.ss ? ' SS: ' + tx.ss : ''}${!tx.vs && !tx.ks && !tx.ss ? '—' : ''}</div></td>
                <td class="message-cell"><div class="message-text">${tx.messageForRecipient || tx.comment || tx.userIdentification || '—'}</div></td>
                <td><span class="type-badge">${tx.type || '—'}</span></td>
            </tr>
        `).join('');
    }
    resultsSection.classList.remove('hidden');
    exportBtn.disabled = data.transactions.length === 0;
}

function exportCSV() {
    if (!currentData || !currentData.transactions.length) return;
    const h = ['Datum', 'Castka', 'Mena', 'Protiucet', 'Nazev', 'Banka', 'VS', 'KS', 'SS', 'Zprava', 'Typ'];
    const rows = currentData.transactions.map(tx => [tx.date, tx.amount, tx.currency, tx.counterAccount || '', tx.counterAccountName || '', tx.bankCode || '', tx.vs || '', tx.ks || '', tx.ss || '', tx.messageForRecipient || tx.comment || '', tx.type || '']);
    const csv = [h.join(';'), ...rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(';'))].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fio_${currentClientId}_${currentData.period.from}_${currentData.period.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
}

function formatDisplayDate(dateStr) {
    if (!dateStr) return '—';
    const [y, m, d] = dateStr.split('-');
    return d + '.' + m + '.' + y;
}

function showError(msg) { errorMessage.textContent = msg; errorBanner.classList.add('visible'); }
function hideError() { errorBanner.classList.remove('visible'); }
