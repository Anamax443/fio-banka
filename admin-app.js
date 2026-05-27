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
    try {
        const data = await api('login', 'POST', { password: pass });
        adminToken = data.adminToken;
        document.getElementById('loginView').classList.add('hidden');
        document.getElementById('dashView').classList.remove('hidden');
        loadClients();
    } catch (e) {
        const el = document.getElementById('loginMsg');
        el.textContent = e.message;
        el.classList.remove('hidden');
    }
}

async function loadClients() {
    try {
        const data = await api('clients', 'GET');
        const tbody = document.getElementById('clientsBody');
        if (data.clients.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:32px;">Zadni klienti</td></tr>';
            return;
        }
        tbody.innerHTML = '';
        data.clients.forEach(c => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="font-family:var(--mono);font-size:0.8125rem;">${c.id}</td>
                <td>${c.name}</td>
                <td>${c.accountCount}</td>
                <td>${c.totpEnrolled ? '<span class="badge badge-green">Aktivni</span>' : '<span class="badge badge-yellow">Ceka</span>'}</td>
                <td class="gap"></td>
            `;
            const btnCell = tr.querySelector('.gap');

            const editBtn = document.createElement('button');
            editBtn.className = 'btn btn-sm';
            editBtn.style.cssText = 'background:var(--border);color:var(--text);';
            editBtn.textContent = 'Upravit';
            editBtn.addEventListener('click', () => editClient(c.id));

            const delBtn = document.createElement('button');
            delBtn.className = 'btn btn-danger btn-sm';
            delBtn.textContent = 'Smazat';
            delBtn.addEventListener('click', () => delClient(c.id));

            btnCell.appendChild(editBtn);
            btnCell.appendChild(delBtn);
            tbody.appendChild(tr);
        });
    } catch (e) {
        showMsg(e.message, true);
    }
}

function showAddForm() {
    editingId = null;
    document.getElementById('formTitle').textContent = 'Novy klient';
    document.getElementById('fClientId').value = '';
    document.getElementById('fClientId').disabled = false;
    document.getElementById('fName').value = '';
    document.getElementById('fPassword').value = '';
    document.getElementById('fPassword').placeholder = 'Silne heslo pro klienta';
    document.getElementById('fAccounts').value = '[\n  {"name": "Bezny ucet", "fioToken": ""}\n]';
    document.getElementById('formCard').classList.remove('hidden');
}

async function editClient(id) {
    try {
        const data = await api('clients', 'GET');
        const client = data.clients.find(c => c.id === id);
        if (!client) return;

        editingId = id;
        document.getElementById('formTitle').textContent = 'Upravit: ' + client.name;
        document.getElementById('fClientId').value = id;
        document.getElementById('fClientId').disabled = true;
        document.getElementById('fName').value = client.name;
        document.getElementById('fPassword').value = '';
        document.getElementById('fPassword').placeholder = '(ponechte prazdne pro zachovani)';
        document.getElementById('fAccounts').value = '';
        document.getElementById('formCard').classList.remove('hidden');
    } catch (e) {
        showMsg(e.message, true);
    }
}

function hideForm() {
    document.getElementById('formCard').classList.add('hidden');
    editingId = null;
}

async function saveClient() {
    const id = document.getElementById('fClientId').value.trim();
    const name = document.getElementById('fName').value.trim();
    const password = document.getElementById('fPassword').value;
    const accountsStr = document.getElementById('fAccounts').value.trim();

    let accounts;
    if (accountsStr) {
        try { accounts = JSON.parse(accountsStr); } catch { showMsg('Neplatny JSON v uctech', true); return; }
    }

    try {
        if (editingId) {
            const body = { id: editingId };
            if (name) body.name = name;
            if (password) body.password = password;
            if (accounts) body.accounts = accounts;
            await api('clients', 'PUT', body);
            showMsg('Klient aktualizovan');
        } else {
            if (!id || !name || !password) { showMsg('Vyplnte ID, nazev a heslo', true); return; }
            await api('clients', 'POST', { id, name, password, accounts: accounts || [] });
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
    document.getElementById('adminPass').addEventListener('keydown', e => { if (e.key === 'Enter') adminLogin(); });
    document.getElementById('loginBtn').addEventListener('click', adminLogin);
    document.getElementById('addClientBtn').addEventListener('click', showAddForm);
    document.getElementById('saveClientBtn').addEventListener('click', saveClient);
    document.getElementById('cancelFormBtn').addEventListener('click', hideForm);
});
