# Fio Banka — Multi-tenant Banking Dashboard

Webová aplikace pro zobrazení a export pohybů z účtů Fio banka. Admin spravuje klienty přes webový panel, každý klient se přihlašuje heslem + TOTP (Google Authenticator).

**Live:** [fio-banka-3ns.pages.dev](https://fio-banka-3ns.pages.dev)

## Architektura

```
GitHub: Anamax443/fio-banka
    │
    │  wrangler pages deploy .
    ▼
CF Pages: fio-banka-3ns.pages.dev
    │
    ├── index.html + app.js         (klientský frontend — login, pohyby, export)
    ├── admin.html + admin-app.js   (admin panel — správa klientů)
    ├── functions/api/              (Pages Functions — serverless backend)
    │       ├── auth.js             POST /api/auth (login)
    │       ├── accounts.js         POST /api/accounts (seznam účtů klienta)
    │       ├── transactions.js     POST /api/transactions (pohyby z Fio API)
    │       ├── totp-enroll.js      POST /api/totp-enroll (TOTP setup)
    │       └── admin/
    │           ├── _middleware.js   Auth guard (Bearer token)
    │           ├── login.js        POST /api/admin/login
    │           ├── clients.js      GET/POST/PUT/DELETE /api/admin/clients
    │           ├── client-detail.js GET /api/admin/client-detail?id=...
    │           └── test-token.js   POST /api/admin/test-token
    │
    ├── Cloudflare KV: FIO_KV       (klientská data — hesla, TOTP, Fio tokeny)
    └── CF Secrets                   (ADMIN_SECRET, SESSION_SECRET)
              │
              ▼
         fioapi.fio.cz/v1/rest      (Fio Banking API)
```

## Jak to funguje

### Dva typy uživatelů

| Role | Přístup | Správa |
|------|---------|--------|
| **Admin** | `/admin` | Vytváří klienty, nastavuje hesla, zadává Fio API klíče, testuje tokeny |
| **Klient** | `/` | Přihlásí se ID + heslo + TOTP, prohlíží pohyby, exportuje CSV |

### Admin flow

1. Admin se přihlásí na `/admin` master heslem + TOTP kódem (Google Authenticator)
2. Vytvoří klienta: zadá ID, jméno, heslo, účty s Fio API klíči
3. U každého účtu může kliknout **Test** — ověří platnost tokenu proti Fio API
4. Admin zkopíruje **direct link** (např. `/?c=maxla`) a pošle ho klientovi
5. **Změna admin hesla:** tlačítko "Změnit heslo" v admin panelu — heslo se uloží do KV

### Admin auth model

| Zdroj | Když | Priorita |
|-------|------|----------|
| KV `admin:password` | Po prvním změně hesla z UI | Vyšší |
| Env var `ADMIN_SECRET` | Initial setup / fallback recovery | Nižší |
| Env var `ADMIN_TOTP_SECRET` | Pokud nastavený, TOTP povinné | — |

Admin password lze měnit za běhu přes UI. Po změně se zapíše do KV a env var slouží jako recovery (pokud zapomeneš nové, smaž KV záznam a fallback se aktivuje).

### Klientský flow

1. Klient otevře svůj **direct link** `/?c=maxla` → ID je předvyplněné a zamčené
2. Zadá heslo (TOTP nech prázdné poprvé) → **Přihlásit se**
3. **První přihlášení:** systém ho pošle na TOTP enrollment — QR kód pro Google Authenticator
4. Klient naskenuje QR, zadá 6-místný kód → **Aktivovat TOTP**
5. **Další přihlášení:** ID (z URL) + heslo + TOTP kód
6. Po přihlášení: výběr účtu, období, zobrazení pohybů, export CSV
7. Funguje na desktopu i mobilu/tabletu (responsive design)

### Security model — MFA

| Kdo nastavil heslo | MFA | Důvod |
|---|---|---|
| **Admin** | Povinné | Admin zná heslo → klient potřebuje druhý faktor |
| *Klient sám (budoucí verze)* | *Volitelné* | *Klient je jediný kdo zná heslo* |

TOTP secret se generuje na serveru, admin k němu nemá přístup. Admin vidí jen `tokenPreview` (prvních 8 znaků).

## Repo layout

```
.
├── index.html              # Klientský frontend (login + dashboard)
├── app.js                  # Klientský JS (auth, transactions, CSV export)
├── admin.html              # Admin panel HTML
├── admin-app.js            # Admin panel JS (CRUD klientů, test tokenů)
├── _headers                # Security headers (CSP, HSTS, X-Frame-Options)
├── package.json            # Scripts: dev, deploy, stamp
├── wrangler.toml           # CF Pages config + KV binding
├── functions/              # Cloudflare Pages Functions
│   ├── api/
│   │   ├── auth.js         # Login — čte z KV, vrací needsTotpEnrollment
│   │   ├── accounts.js     # Seznam účtů klienta z KV
│   │   ├── transactions.js # Proxy k Fio API s Fio tokenem z KV
│   │   ├── totp-enroll.js  # Generování TOTP secret + QR, verifikace
│   │   └── admin/
│   │       ├── _middleware.js    # Bearer token auth guard
│   │       ├── login.js         # Admin login (ADMIN_SECRET)
│   │       ├── clients.js       # CRUD klientů v KV
│   │       ├── client-detail.js # Detail klienta (safe — bez plných tokenů)
│   │       └── test-token.js    # Ověření Fio API tokenu
│   └── _shared/
│       ├── auth.js         # TOTP (RFC 6238), HMAC-SHA256 sessions
│       ├── kv.js           # KV helpers (get/put/delete/list clients)
│       └── response.js     # JSON response helpers
├── scripts/
│   └── stamp-status.js     # Vloží commit hash + čas do status page
├── docs/
│   └── project-status.html # Živý status page s progress tracking
└── api/                    # [LEGACY] Původní standalone Worker v1
    ├── src/worker.js
    └── wrangler.jsonc
```

## API Endpointy

### Klientské (veřejné / session auth)

| Metoda | Endpoint | Auth | Popis |
|--------|----------|------|-------|
| POST | `/api/auth` | - | Login (clientId + heslo + volitelné TOTP) |
| POST | `/api/accounts` | Session | Seznam účtů klienta |
| POST | `/api/transactions` | Session | Pohyby z Fio API za období |
| POST | `/api/totp-enroll` | Session | Generování/verifikace TOTP |

### Admin (Bearer token auth)

| Metoda | Endpoint | Popis |
|--------|----------|-------|
| GET | `/api/admin/login` | Vrací `{mfaRequired}` pro frontend |
| POST | `/api/admin/login` | Admin přihlášení (heslo + volitelný TOTP) |
| POST | `/api/admin/change-password` | Změna admin hesla (zapíše do KV) |
| GET | `/api/admin/clients` | Seznam všech klientů |
| POST | `/api/admin/clients` | Vytvořit klienta |
| PUT | `/api/admin/clients` | Upravit klienta (prázdné heslo = zachovat, prázdný token = zachovat) |
| DELETE | `/api/admin/clients?id=...` | Smazat klienta |
| GET | `/api/admin/client-detail?id=...` | Detail klienta (safe preview tokenů) |
| POST | `/api/admin/test-token` | Ověřit Fio API token proti fioapi.fio.cz |
| GET | `/api/admin/audit?limit=100` | Audit log (login events) |

## KV Data Model

Cloudflare KV namespace `FIO_KV`.

### Klienti — klíč `client:{id}`

```json
{
  "name": "Jan Novák",
  "password": "klientské heslo",
  "totpSecret": "BASE32SECRET (nebo null)",
  "totpEnrolled": false,
  "mfaRequired": true,
  "accounts": [
    { "name": "Běžný účet", "fioToken": "fio-api-token-xyz" },
    { "name": "Spořicí", "fioToken": "fio-api-token-abc" }
  ]
}
```

### Admin — klíč `admin:password`

```
[plain string — aktuální admin heslo, pokud bylo změněno přes UI]
```

Když je `admin:password` nastavený v KV, má přednost před env varem `ADMIN_SECRET`. Když ho smažeš, fallback se vrátí k `ADMIN_SECRET`.

### Audit log — klíč `audit:{timestamp}-{random}`

```json
{
  "ts": 1779897600000,
  "type": "client_login_ok|client_login_fail|admin_login_ok|admin_login_fail|client_login_needs_enrollment",
  "clientId": "maxla",
  "reason": "bad_password|bad_totp|no_client",
  "ip": "1.2.3.4",
  "country": "CZ",
  "ua": "Mozilla/..."
}
```

TTL 90 dnů (`expirationTtl` v `kv.put`). Číst přes admin panel → 📜 Audit log.

## CF Secrets (Environment Variables)

| Proměnná | Typ | Popis |
|----------|-----|-------|
| `ADMIN_SECRET` | Secret | Initial admin heslo (fallback po smazání KV `admin:password`) |
| `ADMIN_TOTP_SECRET` | Secret | Base32 TOTP klíč pro admin MFA (volitelné, doporučeno) |
| `SESSION_SECRET` | Secret | HMAC-SHA256 klíč pro session tokeny |

Všechna klientská data (hesla, Fio tokeny, TOTP) jsou v KV, ne v env vars. Admin heslo migruje do KV po první změně z UI.

## Nasazení

### Existující instance

```powershell
cd fio-banka
npm run deploy    # stamp status page + wrangler pages deploy + git checkout
```

### Nová instance (nový CF Pages projekt)

```powershell
# 1. Vytvořit Pages projekt
npx wrangler pages project create muj-fio --production-branch main

# 2. Vytvořit KV namespace
npx wrangler kv namespace create FIO_KV
# → zapiš ID do wrangler.toml

# 3. Nastavit secrets
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
echo "VYGENEROVANY_HEX" | npx wrangler pages secret put SESSION_SECRET --project-name muj-fio
echo "ADMIN_HESLO" | npx wrangler pages secret put ADMIN_SECRET --project-name muj-fio

# 4. Deploy
npx wrangler pages deploy . --project-name muj-fio

# 5. Otevřít /admin, vytvořit klienta, zadat Fio API klíč, otestovat
```

## Lokální vývoj

```powershell
cd fio-banka
npm install

# .dev.vars (v .gitignore)
@"
SESSION_SECRET=dev-secret-32-bytes-hex-value-here
ADMIN_SECRET=admin123
"@ | Set-Content .dev.vars

npm run dev
# → http://localhost:8080       (klientský login)
# → http://localhost:8080/admin (admin panel)
```

## Bezpečnost

### Implementováno

- **HMAC-SHA256 session tokeny** s timing-safe porovnáním, TTL 1h
- **TOTP RFC 6238** (SHA-1, 30s okno, ±1 step tolerance) přes Web Crypto API
- **Kryptograficky bezpečný nonce** (`crypto.getRandomValues`)
- **CSP headers** — `script-src 'self'`, `frame-ancestors 'none'`
- **HSTS** — `max-age=31536000; includeSubDomains; preload`
- **X-Frame-Options DENY**, Permissions-Policy, Referrer-Policy
- **Same-origin** — frontend a API na stejné doméně, bez CORS
- **Admin auth middleware** — Bearer token na všech `/api/admin/*` kromě login
- **Admin MFA** — TOTP přes Google Authenticator (povinné když `ADMIN_TOTP_SECRET` nastavený)
- **Admin password change** — z UI, heslo se migruje do KV (env var jako recovery fallback)
- **Token preview** — admin vidí jen prvních 8 znaků Fio tokenu při editaci
- **Audit log** — login události (success/fail) v KV s 90-day TTL, viewer v admin panelu (IP, country, user-agent, reason)
- **Security audit: 89%** (25 PASS, 3 WARN, 0 FAIL)

### Plánováno

- Rate limiting na `/api/auth` a `/api/admin/login` (brute-force ochrana)
- Hashed hesla (bcrypt/scrypt místo plaintext)
- Klient si může změnit heslo → MFA se stane volitelné

## Fio API

Tokeny se generují v Fio internetovém bankovnictví:
1. [ib.fio.cz](https://ib.fio.cz) → Nastavení → API → Nový token
2. Token je platný do odvolání
3. **Data starší 90 dnů** vyžadují re-autorizaci v IB
4. **Rate limit:** max 1 request za 30 sekund na token (HTTP 409 při překročení)

## Historie verzí

| Verze | Datum | Commit | Změny |
|-------|-------|--------|-------|
| v3.3 | 2026-05-28 | (HEAD) | Audit log přihlášení (KV, 90 dní TTL, viewer v admin panelu), admin-help.html, klient-help.html, nav links v admin + klient UI, deploy s commit+time stampem |
| v3.2 | 2026-05-28 | `f30db0e` | Admin MFA (TOTP), admin změna hesla přes UI, heslo migruje do KV s env var fallback |
| v3.1 | 2026-05-28 | `79b66da` | Per-client direct link (`/?c=ID`), QR kód funkční (CSP fix), E2E test úspěšný (desktop + mobil) |
| v3.0 | 2026-05-27 | `a6d2264` | Admin panel, KV storage, TOTP enrollment, per-token test, security headers (89%) |
| v2.0 | 2026-05-27 | `2e101a0` | Pages Functions, multi-tenant, konfigurovatelné MFA |
| v1.1 | 2026-05-21 | `53d3245` | Security hardening: HMAC sessions, crypto.subtle, scoped CORS |
| v1.0 | 2026-05-21 | `b547f96` | Initial: static page + standalone Worker |

## Stav projektu (k 2026-05-28)

**E2E test úspěšný:**
- Admin vytvořil klienta `maxla` přes `/admin` s Fio API tokenem ✓
- Test tokenu vrátil platné údaje o účtu ✓
- Klient otevřel direct link `/?c=maxla` ✓
- Přihlásil se heslem → TOTP enrollment ✓
- Naskenoval QR kód v Google Authenticator ✓
- Aktivoval TOTP a zobrazil pohyby na účtu ✓
- Funguje na **desktopu i mobilu** ✓

**Aplikace je v produkci** na `https://fio-banka-3ns.pages.dev`.
