let adminToken = null;
let editingId = null;

async function api(path, method, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (adminToken) opts.headers['Authorization'] = 'Bearer ' + adminToken;
    if (body) opts.body = JSON.stringify(body);
    const r = await fetch('/api/admin/' + path, opts);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Chyba');
    return data;
}

async function adminLogin() {
    const pass = document.getElementById('adminPass').value;
    const totp = document.getElementById('adminTotp').value.trim();
    try {
        const body = { password: pass };
        if (totp) body.totpCode = totp;
        const data = await api('login', 'POST', body);
        adminToken = data.adminToken;
        document.getElementById('loginView').classList.add('hidden');
        document.getElementById('dashView').classList.remove('hidden');
        loadClients();
    } catch (e) {
        const el = document.getElementById('loginMsg');
        el.textContent = e.message;
        el.classList.remove('hidden');
        if (e.message && e.message.toLowerCase().includes('totp')) {
            document.getElementById('adminTotpField').classList.remove('hidden');
            document.getElementById('adminTotp').focus();
        }
    }
}

function showChangePass() {
    document.getElementById('formCard').classList.add('hidden');
    document.getElementById('pCurrent').value = '';
    document.getElementById('pNew').value = '';
    document.getElementById('pNew2').value = '';
    document.getElementById('passMsg').classList.add('hidden');
    document.getElementById('passCard').classList.remove('hidden');
}

function hideChangePass() {
    document.getElementById('passCard').classList.add('hidden');
}

async function savePassword() {
    const current = document.getElementById('pCurrent').value;
    const next = document.getElementById('pNew').value;
    const next2 = document.getElementById('pNew2').value;
    const msg = document.getElementById('passMsg');

    if (!current || !next) {
        msg.textContent = 'Vyplnte vsechna pole';
        msg.className = 'msg msg-err';
        msg.classList.remove('hidden');
        return;
    }
    if (next !== next2) {
        msg.textContent = 'Nova hesla se neshoduji';
        msg.className = 'msg msg-err';
        msg.classList.remove('hidden');
        return;
    }
    if (next.length < 4) {
        msg.textContent = 'Heslo musi mit alespon 4 znaky';
        msg.className = 'msg msg-err';
        msg.classList.remove('hidden');
        return;
    }

    try {
        await api('change-password', 'POST', { currentPassword: current, newPassword: next });
        msg.textContent = 'Heslo zmeneno. Pri pristim prihlaseni pouzij nove heslo.';
        msg.className = 'msg msg-ok';
        msg.classList.remove('hidden');
        setTimeout(hideChangePass, 2500);
    } catch (e) {
        msg.textContent = e.message;
        msg.className = 'msg msg-err';
        msg.classList.remove('hidden');
    }
}

async function showAudit() {
    document.getElementById('formCard').classList.add('hidden');
    document.getElementById('passCard').classList.add('hidden');
    const card = document.getElementById('auditCard');
    card.classList.remove('hidden');
    const body = document.getElementById('auditBody');
    body.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text-muted);">Nacitam...</td></tr>';
    try {
        const data = await api('audit', 'GET');
        if (!data.events.length) {
            body.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text-muted);">Zadne udalosti</td></tr>';
            return;
        }
        body.innerHTML = '';
        data.events.forEach(ev => {
            const tr = document.createElement('tr');
            const date = new Date(ev.ts).toLocaleString('cs-CZ');
            const typeClass = ev.type.includes('fail') ? 'badge-red' : (ev.type.includes('ok') ? 'badge-green' : 'badge-yellow');
            tr.innerHTML =
                '<td style="font-family:var(--mono);font-size:0.75rem;white-space:nowrap;">' + date + '</td>' +
                '<td><span class="badge ' + typeClass + '">' + ev.type + '</span></td>' +
                '<td>' + (ev.clientId || '—') + '</td>' +
                '<td>' + (ev.reason || '—') + '</td>' +
                '<td style="font-family:var(--mono);font-size:0.75rem;">' + (ev.ip || '—') + '</td>' +
                '<td>' + (ev.country || '—') + '</td>';
            body.appendChild(tr);
        });
    } catch (e) {
        body.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--red);">' + e.message + '</td></tr>';
    }
}

function hideAudit() {
    document.getElementById('auditCard').classList.add('hidden');
}

async function detectAdminMfa() {
    try {
        const r = await fetch('/api/admin/login');
        const data = await r.json();
        if (data.mfaRequired) {
            document.getElementById('adminTotpField').classList.remove('hidden');
        }
    } catch {}
}

async function loadClients() {
    try {
        const data = await api('clients', 'GET');
        const tbody = document.getElementById('clientsBody');
        if (data.clients.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:32px;">Zadni klienti</td></tr>';
            return;
        }
        tbody.innerHTML = '';
        const baseUrl = window.location.origin;
        data.clients.forEach(c => {
            const link = baseUrl + '/?c=' + encodeURIComponent(c.id);
            const tr = document.createElement('tr');
            const ipBadge = c.ipRestricted
                ? '<span class="badge badge-yellow" title="Povoleno ' + c.ipCount + ' IP/CIDR">Omezeno (' + c.ipCount + ')</span>'
                : '<span class="badge badge-green">Neomezeno</span>';
            tr.innerHTML =
                '<td style="font-family:var(--mono);font-size:0.8125rem;">' + c.id + '</td>' +
                '<td>' + c.name + '</td>' +
                '<td>' + c.accountCount + '</td>' +
                '<td>' + (c.totpEnrolled ? '<span class="badge badge-green">Aktivni</span>' : '<span class="badge badge-yellow">Ceka</span>') + '</td>' +
                '<td>' + ipBadge + '</td>' +
                '<td class="link-cell"></td>' +
                '<td class="gap"></td>';

            const linkCell = tr.querySelector('.link-cell');
            const linkWrap = document.createElement('div');
            linkWrap.style.cssText = 'display:flex;gap:6px;align-items:center;';

            const linkA = document.createElement('a');
            linkA.href = link;
            linkA.target = '_blank';
            linkA.textContent = '/?c=' + c.id;
            linkA.style.cssText = 'color:var(--accent);font-family:var(--mono);font-size:0.75rem;text-decoration:none;';
            linkA.title = link;

            const copyBtn = document.createElement('button');
            copyBtn.className = 'btn btn-sm';
            copyBtn.style.cssText = 'background:var(--border);color:var(--text);padding:4px 10px;font-size:0.75rem;';
            copyBtn.textContent = 'Kopirovat';
            copyBtn.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(link);
                    copyBtn.textContent = 'Zkopirovano!';
                    setTimeout(() => { copyBtn.textContent = 'Kopirovat'; }, 1500);
                } catch {
                    copyBtn.textContent = 'Chyba';
                }
            });

            linkWrap.appendChild(linkA);
            linkWrap.appendChild(copyBtn);
            linkCell.appendChild(linkWrap);

            const btnCell = tr.querySelector('.gap');
            const testBtn = document.createElement('button');
            testBtn.className = 'btn btn-sm';
            testBtn.style.cssText = 'background:var(--border);color:var(--text);';
            testBtn.textContent = 'Test API';
            testBtn.title = 'Funkčnost API nebyla ověřena';
            testBtn.addEventListener('click', () => testClientAccounts(c.id, c.accountCount, testBtn));
            const editBtn = document.createElement('button');
            editBtn.className = 'btn btn-sm';
            editBtn.style.cssText = 'background:var(--border);color:var(--text);';
            editBtn.textContent = 'Upravit';
            editBtn.addEventListener('click', () => editClient(c.id));
            const delBtn = document.createElement('button');
            delBtn.className = 'btn btn-danger btn-sm';
            delBtn.textContent = 'Smazat';
            delBtn.addEventListener('click', () => delClient(c.id));
            btnCell.appendChild(testBtn);
            btnCell.appendChild(editBtn);
            btnCell.appendChild(delBtn);
            tbody.appendChild(tr);
        });
    } catch (e) {
        showMsg(e.message, true);
    }
}

function addAccountRow(name, token, tokenPreview) {
    const container = document.getElementById('accountRows');
    const row = document.createElement('div');
    row.className = 'account-row';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'Nazev uctu';
    nameInput.value = name || '';
    nameInput.style.flex = '1';

    const tokenInput = document.createElement('input');
    tokenInput.type = 'password';
    tokenInput.placeholder = tokenPreview ? tokenPreview + ' (prazdne = zachovat)' : 'Fio API klic';
    tokenInput.value = token || '';
    tokenInput.style.flex = '2';

    const testBtn = document.createElement('button');
    testBtn.type = 'button';
    testBtn.className = 'btn btn-sm';
    testBtn.style.cssText = 'background:#16a34a;color:white;flex-shrink:0;';
    testBtn.textContent = 'Test';
    testBtn.addEventListener('click', () => testToken(tokenInput.value));

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn-remove';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => row.remove());

    row.appendChild(nameInput);
    row.appendChild(tokenInput);
    row.appendChild(testBtn);
    row.appendChild(removeBtn);
    container.appendChild(row);
}

function openConsole() {
    document.getElementById('testConsoleCard').classList.remove('hidden');
}

function consoleLog(line, color) {
    const c = document.getElementById('testConsole');
    const span = document.createElement('span');
    if (color) span.style.color = color;
    span.textContent = line + '\n';
    c.appendChild(span);
    c.scrollTop = c.scrollHeight;
}

function consoleClear() {
    document.getElementById('testConsole').innerHTML = '';
}

function consoleHr() {
    consoleLog('─'.repeat(60), '#555');
}

async function testClientAccounts(clientId, accountCount, btn) {
    openConsole();
    consoleHr();
    const ts = new Date().toLocaleTimeString('cs-CZ');
    consoleLog('[' + ts + '] Test API klienta: ' + clientId, '#60a5fa');
    consoleLog('Počet účtů: ' + accountCount, '#a1a1aa');

    if (accountCount === 0) {
        consoleLog('✗ Klient nemá žádné účty — nelze testovat', '#ef4444');
        return;
    }

    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Testuji...';

    let okCount = 0, failCount = 0;
    for (let i = 0; i < accountCount; i++) {
        consoleLog('', '#a1a1aa');
        consoleLog('→ Účet #' + i, '#fbbf24');
        try {
            const data = await api('test-account', 'POST', { clientId, accountIndex: i });
            if (data.log && Array.isArray(data.log)) {
                data.log.forEach(l => consoleLog('  ' + l, '#a1a1aa'));
            }
            if (data.success) {
                consoleLog('  ✓ ' + data.message, '#22c55e');
                okCount++;
            } else {
                consoleLog('  ✗ ' + (data.message || 'FAIL'), '#ef4444');
                failCount++;
            }
        } catch (e) {
            consoleLog('  ✗ Request error: ' + e.message, '#ef4444');
            failCount++;
        }
    }

    consoleLog('', '');
    consoleLog('Výsledek: ' + okCount + ' OK · ' + failCount + ' FAIL', okCount === accountCount ? '#22c55e' : '#fbbf24');
    btn.disabled = false;
    btn.textContent = original;

    if (failCount === 0 && okCount > 0) {
        btn.style.cssText = 'background:#16a34a;color:white;';
        btn.title = 'Vše OK (' + okCount + '/' + accountCount + ')';
    } else if (failCount > 0 && okCount > 0) {
        btn.style.cssText = 'background:#f97316;color:white;';
        btn.title = 'Částečně: ' + okCount + ' OK · ' + failCount + ' FAIL';
    } else {
        btn.style.cssText = 'background:#dc2626;color:white;';
        btn.title = failCount + ' FAIL';
    }
}

async function testToken(token) {
    const resultEl = document.getElementById('testResult');
    if (!token) {
        resultEl.textContent = 'Zadejte API klic';
        resultEl.className = 'msg msg-err';
        resultEl.classList.remove('hidden');
        return;
    }
    resultEl.textContent = 'Testuji...';
    resultEl.className = 'msg msg-ok';
    resultEl.classList.remove('hidden');

    try {
        const data = await api('test-token', 'POST', { fioToken: token });
        let msg = data.message;
        if (data.account) {
            msg += ' | ' + data.account.accountId + '/' + data.account.bankId + ' (' + data.account.currency + ')';
            if (data.account.iban) msg += ' | ' + data.account.iban;
        }
        resultEl.textContent = msg;
        resultEl.className = 'msg msg-ok';
    } catch (e) {
        resultEl.textContent = e.message;
        resultEl.className = 'msg msg-err';
    }
}

function getAccountsFromForm() {
    const rows = document.querySelectorAll('#accountRows .account-row');
    const accounts = [];
    rows.forEach(row => {
        const inputs = row.querySelectorAll('input');
        const name = inputs[0].value.trim();
        const token = inputs[1].value.trim();
        if (name || token) {
            accounts.push({ name: name || 'Ucet', fioToken: token });
        }
    });
    return accounts;
}

function showAddForm() {
    editingId = null;
    document.getElementById('formTitle').textContent = 'Novy klient';
    document.getElementById('fClientId').value = '';
    document.getElementById('fClientId').disabled = false;
    document.getElementById('fName').value = '';
    document.getElementById('fPassword').value = '';
    document.getElementById('fPassword').placeholder = 'Silne heslo pro klienta';
    document.getElementById('accountRows').innerHTML = '';
    document.getElementById('testResult').classList.add('hidden');
    document.getElementById('fIpAllowlist').value = '*';
    addAccountRow('', '');
    document.getElementById('formCard').classList.remove('hidden');
}

async function editClient(id) {
    try {
        const data = await api('client-detail?id=' + id, 'GET');

        editingId = id;
        document.getElementById('formTitle').textContent = 'Upravit: ' + data.name;
        document.getElementById('fClientId').value = id;
        document.getElementById('fClientId').disabled = true;
        document.getElementById('fName').value = data.name;
        document.getElementById('fPassword').value = '';
        document.getElementById('fPassword').placeholder = '(ponechte prazdne pro zachovani)';
        document.getElementById('accountRows').innerHTML = '';
        document.getElementById('testResult').classList.add('hidden');

        if (data.accounts && data.accounts.length > 0) {
            data.accounts.forEach(a => addAccountRow(a.name, '', a.tokenPreview));
        } else {
            addAccountRow('', '');
        }

        document.getElementById('fIpAllowlist').value = (data.ipAllowlist && data.ipAllowlist.length > 0)
            ? data.ipAllowlist.join('\n')
            : '*';

        document.getElementById('formCard').classList.remove('hidden');
    } catch (e) {
        showMsg(e.message, true);
    }
}

function hideForm() {
    document.getElementById('formCard').classList.add('hidden');
    editingId = null;
}

function parseIpAllowlist(text) {
    return text.split('\n').map(s => s.trim()).filter(s => s.length > 0);
}

async function saveClient() {
    const id = document.getElementById('fClientId').value.trim();
    const name = document.getElementById('fName').value.trim();
    const password = document.getElementById('fPassword').value;
    const accounts = getAccountsFromForm();
    const ipAllowlist = parseIpAllowlist(document.getElementById('fIpAllowlist').value);

    try {
        if (editingId) {
            const body = { id: editingId, ipAllowlist };
            if (name) body.name = name;
            if (password) body.password = password;
            if (accounts.length > 0) body.accounts = accounts;
            await api('clients', 'PUT', body);
            showMsg('Klient aktualizovan');
        } else {
            if (!id || !name || !password) { showMsg('Vyplnte ID, nazev a heslo', true); return; }
            await api('clients', 'POST', { id, name, password, accounts, ipAllowlist });
            showMsg('Klient vytvoren');
        }
        hideForm();
        loadClients();
    } catch (e) {
        showMsg(e.message, true);
    }
}

async function delClient(id) {
    if (!confirm('Opravdu smazat klienta ' + id + '?')) return;
    try {
        await api('clients?id=' + id, 'DELETE');
        showMsg('Klient smazan');
        loadClients();
    } catch (e) {
        showMsg(e.message, true);
    }
}

function showMsg(text, isErr) {
    const el = document.getElementById('dashMsg');
    el.textContent = text;
    el.className = 'msg ' + (isErr ? 'msg-err' : 'msg-ok');
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 4000);
}

document.addEventListener('DOMContentLoaded', () => {
    detectAdminMfa();
    document.getElementById('adminPass').addEventListener('keydown', e => { if (e.key === 'Enter') adminLogin(); });
    document.getElementById('adminTotp').addEventListener('keydown', e => { if (e.key === 'Enter') adminLogin(); });
    document.getElementById('loginBtn').addEventListener('click', adminLogin);
    document.getElementById('addClientBtn').addEventListener('click', showAddForm);
    document.getElementById('changePassBtn').addEventListener('click', showChangePass);
    document.getElementById('savePassBtn').addEventListener('click', savePassword);
    document.getElementById('cancelPassBtn').addEventListener('click', hideChangePass);
    document.getElementById('auditBtn').addEventListener('click', showAudit);
    document.getElementById('closeAuditBtn').addEventListener('click', hideAudit);
    document.getElementById('closeConsoleBtn').addEventListener('click', () => document.getElementById('testConsoleCard').classList.add('hidden'));
    document.getElementById('clearConsoleBtn').addEventListener('click', consoleClear);
    document.getElementById('saveClientBtn').addEventListener('click', saveClient);
    document.getElementById('cancelFormBtn').addEventListener('click', hideForm);
    document.getElementById('addAccountBtn').addEventListener('click', () => addAccountRow('', ''));
});
