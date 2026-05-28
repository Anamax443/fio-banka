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

### Správa Fio API tokenů — dvě cesty

| Cesta | Kdo zadá token | Kdo ho zná | Vhodné pro |
|-------|---------------|------------|------------|
| **Admin-managed** | Admin v admin panelu | Admin + server | Klienti, kterým nevadí předat token adminovi |
| **Self-service** | Klient ve svém profilu (`⚙️ Můj profil`) | Pouze server (admin nezná) | Klienti, kteří chtějí maximální soukromí |

Obě cesty jdou kombinovat — admin může nastavit jméno účtu, klient si pak token přidá sám.

Admin v obou případech může kdykoliv ověřit funkčnost přes **Test API** tlačítko v seznamu klientů (server otestuje token bez expozice). Tlačítko mění barvu podle výsledku:

- 🩶 **Šedá** — neotestováno (default, nesignalizuje funkčnost)
- 🟢 **Zelená** — všechny účty OK
- 🟠 **Oranžová** — částečně (některé OK, některé FAIL)
- 🔴 **Červená** — všechny FAIL

Test otevře **černé terminálové okno** se streamem detailů (URL s maskovaným tokenem, HTTP status, čas odezvy, číslo účtu, IBAN, zůstatek). HTTP 409 (rate limit) **není OK** — je to zvláštní stav `rate_limit` (server neumí potvrdit funkčnost).

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
| GET | `/api/client/accounts` | Session (query) | Seznam vlastních účtů + token preview |
| POST | `/api/client/accounts` | Session | Klient přidá nový účet s tokenem |
| PUT | `/api/client/accounts` | Session | Klient upraví účet (jméno / token) |
| DELETE | `/api/client/accounts` | Session | Klient smaže účet |
| POST | `/api/client/change-password` | Session | Klient si změní vlastní heslo |
| GET | `/api/client/profile-info` | Session (query) | Vrací MFA stav (mfaRequired, totpEnrolled, canDisableMfa) |
| POST | `/api/client/mfa-toggle` | Session | Klient zapne/vypne MFA (vypnutí jen když passwordChangedByClient) |

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
| POST | `/api/admin/test-token` | Ověřit Fio API token (admin zná token přímo) |
| POST | `/api/admin/test-account` | Ověřit existující účet klienta by `{clientId, accountIndex}` — bez expozice tokenu |
| GET | `/api/admin/audit?limit=100` | Audit log (login events) |

## KV Data Model

Cloudflare KV namespace `FIO_KV`.

### Klienti — klíč `client:{id}`

```json
{
  "name": "Jan Novák",
  "password": "pbkdf2-sha256-v1$100000$SALT_HEX$HASH_HEX",
  "totpSecret": "BASE32SECRET (nebo null)",
  "totpEnrolled": false,
  "mfaRequired": true,
  "passwordChangedByClient": false,
  "accounts": [
    { "name": "Běžný účet", "fioToken": "fio-api-token-xyz" },
    { "name": "Spořicí", "fioToken": "fio-api-token-abc" }
  ],
  "ipAllowlist": ["*"]
}
```

`ipAllowlist` formát:
- `[]` nebo `["*"]` → bez omezení (default)
- `["1.2.3.4", "5.6.7.0/24"]` → povolené jen tyto IP/CIDR rozsahy
- `["1.2.3.4", "*"]` → `*` má přednost, povoleno vše (= bez omezení)

### Admin — klíč `admin:password`

```
pbkdf2-sha256-v1$100000$SALT_HEX$HASH_HEX
```

Po prvním loginu (nebo změně hesla z UI) je hash. Starý plain `ADMIN_SECRET` env var se auto-migruje při prvním admin loginu.

Když je `admin:password` nastavený v KV, má přednost před env varem `ADMIN_SECRET`. Když ho smažeš, fallback se vrátí k `ADMIN_SECRET`.

### Rate limiting — klíč `ratelimit:{scope}:{ip}`

```json
{
  "timestamps": [1779897600000, 1779897612000, ...]
}
```

Scope: `client_login` nebo `admin_login`. Sliding window 15 min. Po 10 selháních → HTTP 429. TTL = WINDOW + 60s (auto-cleanup).

### Audit log — klíč `audit:{timestamp}-{random}`

```json
{
  "ts": 1779897600000,
  "type": "client_login_ok|client_login_fail|admin_login_ok|admin_login_fail|client_login_needs_enrollment|client_password_change_ok|client_password_change_fail",
  "clientId": "maxla",
  "reason": "bad_password|bad_totp|no_client|ip_blocked|rate_limited|bad_current",
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
- **Audit log** — login události (success/fail) v KV s 90-day TTL, viewer v admin panelu (IP, country, user-agent, reason). TTL retence: záznamy se po 90 dnech automaticky mažou (CF KV `expirationTtl`)
- **IP allowlist per klient** — admin nastaví seznam povolených IP / CIDR pro klienta. **Každá IP/CIDR na vlastní řádek** (Enter mezi nimi, NE čárkou). `*` nebo prázdné = bez omezení. Blocked pokusy se logují jako `ip_blocked` v audit logu, vrací HTTP 403
- **Hashed hesla** — PBKDF2-SHA256, 100 000 iterations, 16B salt (`crypto.getRandomValues`), 32B hash. Formát: `pbkdf2-sha256-v1$iter$salt$hash`. Backward-compat: stará plain hesla se auto-migrují na hash při prvním úspěšném loginu. Verifikace timing-safe.
- **Rate limiting** — 10 failed login pokusů za 15 minut z jedné IP zablokuje další pokusy (HTTP 429). Sliding window v KV (`ratelimit:{scope}:{ip}`). Scopes: `client_login`, `admin_login`. Úspěšný login counter vynuluje.
- **Klient si může změnit heslo** — z profile screen (`⚙️ Můj profil`). Min 4 znaky (PIN-style, kompenzuje povinné TOTP). Endpoint `POST /api/client/change-password`.
- **MFA toggle klientem** — po vlastní změně hesla (`passwordChangedByClient=true`) může klient vypnout MFA z profilu. Endpoint `POST /api/client/mfa-toggle`. Re-enable forces nový TOTP enrollment.
- **Admin force MFA** — tlačítko v admin seznamu (žluté "MFA on" když off, šedé "Reset" když on). Resetuje `passwordChangedByClient` na false — klient nemůže vypnout dokud znovu nezmění heslo. Resetuje TOTP secret pro fresh enrollment (užitečné při ztrátě telefonu).
- **Security audit: 89%** (25 PASS, 3 WARN, 0 FAIL)

### Plánováno

- **CF Logpush** — export audit logu mimo KV (do R2 / externí SIEM) — vyžaduje paid CF plan, defer to launch day

## Fio API

Tokeny se generují v Fio internetovém bankovnictví:
1. [ib.fio.cz](https://ib.fio.cz) → Nastavení → API → Nový token
2. Token je platný do odvolání
3. **Data starší 90 dnů** vyžadují re-autorizaci v IB
4. **Rate limit:** max 1 request za 30 sekund na token (HTTP 409 při překročení)

## Historie verzí

| Verze | Datum | Commit | Změny |
|-------|-------|--------|-------|
| v3.7 | 2026-05-28 | (HEAD) | **MFA self-service + admin force:** Klient si může vypnout MFA z profilu (vyžaduje `passwordChangedByClient=true`). Admin má v seznamu klientů tlačítko **MFA on** (vynutit) nebo **Reset** (re-enrollment). Force MFA resetuje i `passwordChangedByClient` — klient nemůže vypnout dokud znovu nezmění heslo. + favicon (F gradient), kompaktní admin tabulka (ikony pro Edit/Smazat, fits desktop bez scrollu) |
| v3.6 | 2026-05-28 | `31510c3` | **Bezpečnostní balík:** (1) Klient si může změnit heslo z profilu (min 4 znaky pro klienta, 6 pro admina). (2) Rate limiting: 10 failů / 15 min per IP per scope (HTTP 429 + auto-clear po úspěchu). (3) Hashed hesla (PBKDF2-SHA256, 100k iterations, 16B salt) s auto-migrací z plain při loginu. |
| v3.5.1 | 2026-05-28 | `9114e42` | Test API tlačítko: neutrální default + barevné stavy (zelená/oranžová/červená dle výsledku), černé terminálové okno se streamem testů, oprava HTTP 409 false-positive (nově samostatný stav `rate_limit`) |
| v3.5 | 2026-05-28 | `47233ef` | Klient si může zadávat/spravovat Fio API tokeny ve svém profilu (admin je nemusí znát). Admin má "Test API" tlačítko v seznamu klientů — server-side ověří všechny účty bez expozice tokenu. Admin token input zůstává jako volitelná cesta. |
| v3.4 | 2026-05-28 | `98f7564` | IP allowlist per klient (jedna IP / CIDR na řádek, `*` = vše), badge "Omezeno/Neomezeno" v seznamu, audit log eviduje `ip_blocked` |
| v3.3 | 2026-05-28 | `c7f30b9` | Audit log přihlášení (KV, 90 dní TTL, viewer v admin panelu), admin-help.html, klient-help.html, nav links v admin + klient UI, deploy s commit+time stampem |
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
