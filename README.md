# Fio Banka — Multi-tenant Banking Dashboard

Webová aplikace pro zobrazení a export pohybů z účtů Fio banka. Jeden GitHub repozitář slouží jako **motor** pro libovolný počet klientů — každý klient má vlastní Cloudflare Pages deployment s vlastními secrets.

## Architektura

```
GitHub: Anamax443/fio-banka (jeden motor, jeden zdrojový kód)
         │
         ├── CF Pages: klient-a.pages.dev ─── secrets: PASSWORD, TOTP_SECRET, TOKEN_*, ...
         ├── CF Pages: klient-b.pages.dev ─── secrets: PASSWORD, TOKEN_*, MFA_ENABLED=false
         └── CF Pages: klient-c.pages.dev ─── secrets: ...
                  │
                  ▼
         fioapi.fio.cz/v1/rest (Fio API)
```

### Jak to funguje

- **Frontend** (`index.html`) — statická SPA stránka, vanilla JS, žádný build step
- **Backend** (`functions/api/`) — Cloudflare Pages Functions (serverless, běží na stejné doméně)
- **Bez CORS** — frontend i API na stejném originu, žádné cross-origin problémy
- **Bez samostatného Workeru** — vše se deployuje z jednoho místa přes Pages

### Repo layout

```
.
├── index.html                  # Frontend SPA (login + dashboard)
├── package.json                # Dev scripts (wrangler pages dev)
├── functions/                  # Cloudflare Pages Functions
│   ├── api/
│   │   ├── auth.js             # POST /api/auth — login (heslo + volitelné TOTP)
│   │   ├── accounts.js         # GET /api/accounts — seznam účtů
│   │   ├── transactions.js     # POST /api/transactions — pohyby z Fio API
│   │   └── config.js           # GET /api/config — frontend konfigurace (MFA stav)
│   └── _shared/
│       ├── auth.js             # TOTP verifikace, session token (HMAC-SHA256)
│       ├── accounts.js         # Parsování ACCOUNTS_CONFIG z env
│       └── response.js         # JSON response helpers
├── docs/
│   └── project-status.html     # Živý status page projektu
└── api/                        # [LEGACY] Původní standalone Worker (archiv)
    ├── src/worker.js
    └── wrangler.jsonc
```

## Autentifikace

### Režimy

| Režim | Env var `MFA_ENABLED` | Co se děje |
|-------|----------------------|------------|
| **Heslo + TOTP** (default) | `true` nebo nenastaveno | Uživatel zadá heslo + 6-místný kód z Google Authenticator |
| **Jen heslo** | `false` | TOTP pole se skryje, stačí heslo |

### Auth flow

1. Frontend volá `GET /api/config` → zjistí zda je MFA zapnuté
2. Uživatel vyplní login formulář (heslo, případně TOTP kód)
3. `POST /api/auth` → ověření proti env `PASSWORD` (+ `TOTP_SECRET` pokud MFA)
4. Při úspěchu: server vrátí `sessionToken` (HMAC-SHA256, TTL 1 hodina)
5. Frontend uloží token do `sessionStorage`
6. Každý request na `/api/transactions` posílá `sessionToken` v body

### Session token

Formát: `{timestamp}.{nonceHex}.{hmacSig}`
- `timestamp` = Date.now() v ms
- `nonce` = 16 krypto-bezpečných náhodných bajtů (hex)
- `sig` = HMAC-SHA256(`SESSION_SECRET`, `{timestamp}.{nonce}`)
- Verifikace: timing-safe porovnání, odmítnutí expirovaných a future-dated tokenů

## Nasazení nového klienta

### 1. Příprava secrets

Vygenerujte potřebné hodnoty:

```powershell
# SESSION_SECRET — 32 bajtů hex
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# TOTP_SECRET — base32 klíč (pokud MFA)
# Vygenerujte v authenticator appce nebo pomocí:
node -e "const c='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let s='';for(let i=0;i<32;i++)s+=c[Math.floor(Math.random()*32)];console.log(s)"
# Výsledný klíč přidejte do Google Authenticator jako ruční vstup
```

### 2. Vytvoření CF Pages projektu

1. Otevřete [Cloudflare Dashboard](https://dash.cloudflare.com) → Workers & Pages → Create
2. **Connect to Git** → vyberte repozitář `Anamax443/fio-banka`
3. **Project name**: zvolte unikátní jméno (např. `klient-fio`) → bude `klient-fio.pages.dev`
4. **Build settings**: Framework preset = None, Build command = (prázdné), Build output = `/`
5. **Deploy**

### 3. Nastavení environment variables

V CF Dashboard → projekt → Settings → Environment variables:

| Proměnná | Typ | Popis | Povinná |
|----------|-----|-------|---------|
| `PASSWORD` | Secret | Heslo pro přihlášení | Ano |
| `SESSION_SECRET` | Secret | HMAC klíč pro session tokeny (32+ hex znaků) | Ano |
| `TOTP_SECRET` | Secret | Base32 secret pro TOTP (sdílený s authenticator appkou) | Jen s MFA |
| `MFA_ENABLED` | Plain | `true` (default) nebo `false` pro vypnutí MFA | Ne |
| `ACCOUNTS_CONFIG` | Secret | JSON konfigurace účtů (viz níže) | Ne (default: 1 účet) |
| `TOKEN_*` | Secret | Fio API tokeny dle ACCOUNTS_CONFIG | Ano |

### 4. ACCOUNTS_CONFIG formát

JSON objekt s mapou účtů. Klíč = ID účtu, `tokenVar` odkazuje na název env proměnné s Fio API tokenem:

```json
{
  "bezny": { "name": "Běžný účet", "tokenVar": "TOKEN_BEZNY" },
  "sporici": { "name": "Spořicí účet", "tokenVar": "TOKEN_SPORICI" }
}
```

Pokud `ACCOUNTS_CONFIG` není nastaveno, použije se default s jedním účtem (`TOKEN_UCET1`).

### 5. Test

Otevřete `https://klient-fio.pages.dev` → přihlaste se → načtěte pohyby.

## Lokální vývoj

```powershell
cd fio-banka
npm install

# Vytvořte .dev.vars s testovacími secrets
# (soubor je v .gitignore, nikdy se necommituje)
@"
PASSWORD=test123
SESSION_SECRET=abc123def456...
TOTP_SECRET=JBSWY3DPEHPK3PXP
MFA_ENABLED=true
ACCOUNTS_CONFIG={"test":{"name":"Test","tokenVar":"TOKEN_TEST"}}
TOKEN_TEST=vaš-fio-api-token
"@ | Set-Content .dev.vars

npm run dev
# → http://localhost:8080
```

## Fio API tokeny

Tokeny se generují ve Fio internetovém bankovnictví:
1. Přihlaste se na [ib.fio.cz](https://ib.fio.cz)
2. Nastavení → API → Přidat nový token
3. Token je platný do odvolání, ale **data starší 90 dnů vyžadují re-autorizaci v IB**
4. Fio API má rate limit: **max 1 request za 30 sekund** na token

## Bezpečnost

- Session tokeny: HMAC-SHA256 s timing-safe porovnáním
- Nonce: `crypto.getRandomValues` (kryptograficky bezpečný)
- TOTP: RFC 6238 (SHA-1, 30s okno, ±1 step tolerance)
- Fio API tokeny: uložené v CF Secrets (nikdy v kódu)
- Heslo: porovnání v plaintextu proti env var (single-user, ne databáze)
- Bez CORS: frontend a API na stejném originu

### Doporučení pro produkci

- Nastavte `PASSWORD` na silné heslo (20+ znaků)
- Zapněte MFA pro finanční data
- Rotujte `SESSION_SECRET` periodicky (invaliduje všechny sessions)
- Monitorujte CF Analytics pro podezřelou aktivitu na `/api/auth`

## Migrace z v1 (standalone Worker)

Původní architektura používala dva CF accounty (frontend na maxferit, Worker na bass443). Nová v2 architektura:
- Vše z jednoho CF Pages projektu
- Bez CORS (same-origin)
- Bez dual-account deploye
- Git-connected (auto-deploy při push)

Starý kód zůstává v `api/` jako archiv pro referenci.

## Historie verzí

| Verze | Datum | Změny |
|-------|-------|-------|
| v2.0 | 2026-05-27 | Pages Functions, multi-tenant, konfigurovatelné MFA, ACCOUNTS_CONFIG |
| v1.1 | 2026-05-21 | Security hardening: HMAC sessions, crypto.subtle, scoped CORS |
| v1.0 | 2026-05-21 | Initial: static page + standalone Worker |
