# Podklad pro oponenturu — Fio Banka v3.7

**Datum:** 2026-05-29
**Verze:** 3.7.0
**Stav:** LIVE na produkci
**Live:** https://fio-banka-3ns.pages.dev
**Repo:** github.com/Anamax443/fio-banka (private)
**Commits:** 43 na main, last `83fef97`
**Vývojový čas:** ~8 dní (2026-05-21 až 2026-05-29)

---

## 1. Co aplikace dělá

**Multi-tenant banking dashboard** pro zobrazení pohybů na účtech Fio banky.

- Jeden GitHub repo = jeden CF Pages projekt = N klientů
- Klient se přihlásí svým ID + heslem (+ TOTP) a vidí pohyby na svých Fio účtech
- Admin spravuje klienty přes web UI (`/admin`)
- Komunikace s Fio: HTTPS GET na `fioapi.fio.cz/v1/rest/periods/{token}/...`

**Read-only — záměrně.** Aplikace nikdy nebude umět platby (rozhodnuto 2026-05-29, viz §7).

**Single-operator scope.** Aplikace má 1 admina, ne admin tým. Žádné role-based access, žádný admin audit oddělený od klientského.

---

## 2. Architektura

```
┌─────────────────────────────────────────────────────────┐
│  Cloudflare Pages: fio-banka-3ns.pages.dev              │
│                                                          │
│  ┌─────────────────┐  ┌──────────────────────────────┐  │
│  │ Statické HTML   │  │ Pages Functions (serverless) │  │
│  │ - index.html    │  │ - /api/auth                  │  │
│  │ - admin.html    │  │ - /api/admin/*  (12 endpts)  │  │
│  │ - docs/*.html   │  │ - /api/client/* (6 endpts)   │  │
│  │ - app.js        │  │ - /api/totp-enroll           │  │
│  │ - admin-app.js  │  │ - /api/transactions          │  │
│  └─────────────────┘  └──────────────────────────────┘  │
│                                  │                       │
│                                  ▼                       │
│                       ┌──────────────────────┐          │
│                       │ Cloudflare KV: FIO_KV│          │
│                       │ - client:{id}         │          │
│                       │ - admin:password      │          │
│                       │ - audit:{ts}-{rand}   │          │
│                       │ - ratelimit:{s}:{ip}  │          │
│                       └──────────────────────┘          │
└─────────────────────────────────────────────────────────┘
                                  │
                                  ▼ HTTPS
                       ┌──────────────────────┐
                       │  fioapi.fio.cz       │
                       │  /v1/rest/periods/   │
                       └──────────────────────┘
```

### Klíčová rozhodnutí

| Rozhodnutí | Důvod | Alternativa byla |
|------------|-------|------------------|
| CF Pages Functions (ne Workers) | Same-origin, bez CORS, jeden deploy | Standalone Worker (původní v1) |
| KV pro klientská data (ne D1/SQL) | Free tier, jednoduchý KV model stačí | D1 (SQL, free tier limit menší) |
| Vanilla JS (ne React/Vue/Svelte) | Zero build step, snadná údržba sólo | Framework s build pipeline |
| 1 repo, N klientů (multi-tenant single-instance) | Žádný per-klient deploy, jeden zdroj pravdy | Per-klient CF Pages projekt |
| Token v KV (ne env vars) | Klient si může spravovat sám | Env vars (původní v2) |

### Tech detail

- **Frontend:** statické HTML + 2 JS soubory (`app.js`, `admin-app.js`). Žádný build, žádné dependencies kromě dev-only wrangler.
- **Backend:** Cloudflare Pages Functions (jeden soubor per endpoint v `functions/api/`)
- **Crypto:** Web Crypto API (`crypto.subtle`) — PBKDF2, HMAC, getRandomValues
- **Stamping:** scripts/stamp-status.js před deployem nahrazuje commit hash + timestamp do status page

---

## 3. Auth flow

### Klient

1. `GET /?c=ID` — ID předvyplněné v URL
2. `POST /api/auth { clientId, password, totpCode? }`
3. Backend ověří:
   - Rate limit (10/15min per IP per scope)
   - Klient existuje
   - IP allowlist (per-klient)
   - Heslo (PBKDF2 hash compare, timing-safe)
   - TOTP (pokud `mfaRequired && totpEnrolled`)
4. Vrací HMAC-SHA256 session token, TTL 1h
5. Plain passwords se auto-rehashují při loginu

### Admin

Same flow, ale:
- `ADMIN_SECRET` env var → migruje do `admin:password` KV po prvním loginu (hashed)
- `ADMIN_TOTP_SECRET` env var (pokud nastavený, MFA povinné)
- Bearer token v `Authorization` header pro všechny `/api/admin/*` calls

### Session token

Formát: `{timestamp_ms}.{nonceHex}.{HMAC-SHA256(SESSION_SECRET, ${ts}.${nonce})}`

- `timestamp` rejektován pokud `now - ts > 1h` (expirace) nebo `now < ts` (future-dated)
- Verifikace timing-safe
- Stateless (server nemá session store)

### TOTP

- RFC 6238, SHA-1, 30s window, ±1 step tolerance
- Secret base32, 20 random bytes
- Enrollment via QR (`api.qrserver.com` — CSP allowlisted, secret v URL je v request, ne v image)

---

## 4. KV data model

### `client:{id}`

```json
{
  "name": "Jan Novák",
  "password": "pbkdf2-sha256-v1$100000$SALT_HEX$HASH_HEX",
  "totpSecret": "BASE32SECRET",
  "totpEnrolled": true,
  "mfaRequired": true,
  "passwordChangedByClient": false,
  "accounts": [
    { "name": "Běžný", "fioToken": "fio-token-xyz" }
  ],
  "ipAllowlist": ["*"]
}
```

### `admin:password`

Plain string s formátem `pbkdf2-sha256-v1$...`. Po prvním loginu/změně.

### `audit:{timestamp}-{random}`

TTL 90 dní (Cloudflare auto-expire). Záznam loginů (success+fail), reason, IP, country, UA.

### `ratelimit:{scope}:{ip}`

```json
{ "timestamps": [1779897600000, ...] }
```

Sliding window 15min, TTL 16min. Scopes: `client_login`, `admin_login`.

---

## 5. Security model — co je implementováno

| Vrstva | Implementace |
|--------|--------------|
| **Hashed hesla** | PBKDF2-SHA256, 100k iter, 16B salt, timing-safe verify, auto-migrace |
| **Session tokens** | HMAC-SHA256, TTL 1h, stateless, timing-safe |
| **TOTP** | RFC 6238, povinné pro klienty (toggleable po vlastní změně hesla) |
| **Rate limit** | 10 fail / 15 min per IP per scope, HTTP 429, audit log |
| **IP allowlist** | Per-klient (CIDR + wildcard), HTTP 403 + audit log před heslo check |
| **CSP** | `script-src 'self'`, `frame-ancestors 'none'`, no inline JS |
| **HSTS** | max-age 31536000, includeSubDomains, preload |
| **X-Frame-Options** | DENY |
| **Same-origin** | Bez CORS, frontend + API stejná doména |
| **Admin auth** | Master password + povinné TOTP (env `ADMIN_TOTP_SECRET`) |
| **Token isolation** | Admin nemusí znát Fio API tokeny (klient self-service), preview jen prvních 8 znaků |
| **Audit log** | KV, 90 dní TTL, IP/country/UA/reason, viewer v admin panelu |

**Externí security audit:** 89% (25 PASS / 3 WARN / 0 FAIL).
WARNs: DNSSEC (CF úroveň), CSP reporting (vyžaduje report-uri endpoint), 1 inline event handler v archived stránce.

---

## 6. Otázky pro oponenturu

### Vysoká priorita

1. **Plaintext hesla v KV během auto-migrace** — útočník s read-only KV přístupem (CF support, vendor breach) může mezi loginy klienta vidět plain heslo. Backward-compat za cenu temporární expozice. Mám to defaultně přepsat na hash při příštím deployi a vyžadovat force re-login?

2. **Session token bez revocation** — stateless HMAC = nelze invalidovat konkrétní session bez rotace `SESSION_SECRET` (která invaliduje **všechny**). Po změně hesla session zůstává platná do TTL. Reálné riziko nebo academic?

3. **Fio API token v plain v KV** — token sám o sobě nelze "hashnout" (server ho musí poslat Fio). Šifrování at-rest by vyžadovalo master key, který by stejně musel být dostupný funkci. Stojí to za to (defense in depth)?

4. **Rate limit per IP, ne per account** — útočník s rotující IP (botnet) projde. KV write per request je drahý (může dojít CPU budget). Vyšší limit per account by chránil i proti distribuovanému útoku, ale složitější.

5. **Klient může spravovat tokeny bez TOTP re-auth** — po loginu má klient session token a může přidávat/měnit/mazat Fio tokeny bez dalšího TOTP. Lateral movement risk po krádeži session.

### Střední priorita

6. **TOTP secret v plain v KV** — kdyby útočník přečetl KV, může TOTP klonovat. Zaměnit za bcrypt? Ne, TOTP server musí umět regenerovat HOTP každých 30s.

7. **Žádný brute-force lockout per účet** — jen per IP. Pomalý útok z mnoha IP (rotující VPN) projde rate limitem.

8. **Admin nevidí konkrétní failed pokus v audit** — vidí `reason: bad_password` ale nevidí jaké heslo bylo zadáno (správně, ale chybí možnost "tento pokus se nezdá legit").

9. **CSP `'unsafe-inline'` pro style-src** — nutné protože `<style>` bloky v HTML. Riziko (style-based exfil) nízké ale existuje.

10. **Fallback na `ADMIN_SECRET` env var** — pokud někdo smaže `admin:password` z KV, fallback se aktivuje. Útočník s wrangler přístupem to může udělat. Recovery vs. security trade-off.

### Nízká priorita

11. **Audit log retence 90 dní** — pro forenziku nedostatečné? Compliance requirements?

12. **`/api/admin/login` GET endpoint vrací MFA stav** — neauthenticated info disclosure ("MFA je povinné"). Trivial, ale leak.

13. **`/?c=ID` ID v URL** — bookmarkable, leaks v Referer header při kliknutí na externí odkaz z dashboardu. Ne secret, ale ID = identifikátor.

14. **`api.qrserver.com` external dependency** — QR generování přes 3rd party. Pokud spadne, klient nemůže projít enrollmentem. Lokální QR knihovna (~2KB) by to odstranila.

15. **`docs/project-status.html` je veřejně přístupný** — info disclosure o stacku, KV namespace ID, audit log retenci. Záměr? Nebo schovat pod auth?

---

## 7. Explicit out-of-scope decisions

| Co | Důvod | Datum rozhodnutí |
|----|-------|------------------|
| **Platby (write Fio API)** | Read-only viewer = data exposure max risk, ne finanční ztráta. Komplexní limity, schvalování, audit. | 2026-05-29 |
| **CF Logpush** | Vyžaduje paid CF plan. Defer to launch day. | 2026-05-27 (memory note) |
| **Multi-admin / role-based access** | Single-operator. Pro multi-admin by bylo potřeba per-user audit, granular permissions. | Initial design |
| **Bcrypt místo PBKDF2** | PBKDF2 dostupný ve Web Crypto API; bcrypt by vyžadoval polyfill / WASM. | Initial design |
| **Per-account write token** | Aplikace nikdy nebude umět platby — bezpředmětné. | 2026-05-29 |

---

## 8. Co bych chtěl od oponentury

1. **Threat model review** — pokrývám realistická rizika? Co chybí?
2. **Auto-migrace plain → hash** — accept risk nebo force migrate?
3. **Session revocation** — je stateless HMAC vhodné pro banking viewer? Stojí za to přidat KV blocklist?
4. **Fio token at-rest encryption** — má smysl pro single-operator setup?
5. **Per-account rate limit** — kompenzace nebo overkill?
6. **CSP polish** — dá se odstranit `'unsafe-inline'` pro style?
7. **Cokoliv další** co jsem přehlédl.

---

## 9. Užitečné odkazy

- **Live aplikace:** https://fio-banka-3ns.pages.dev
- **Status page:** https://fio-banka-3ns.pages.dev/docs/project-status
- **Admin docs:** https://fio-banka-3ns.pages.dev/docs/admin-help
- **Klient docs:** https://fio-banka-3ns.pages.dev/docs/help
- **Repo:** github.com/Anamax443/fio-banka (private)
- **Tato dokumentace:** `docs/oponentury/2026-05-29-podklad-fio-banka-v3.7.md`

---

*Vygenerováno pro vstup do oponentního review. Reakce na review prosím uložit do nového souboru `docs/oponentury/2026-05-29-reakce-*.md`.*
