# fio-banka

Webová aplikace pro zobrazení a export pohybů z účtů Fio banka. Single-tenant (osobní použití), TOTP login.

## Architektura

```
┌─────────────────────────────────┐         ┌──────────────────────────────────┐
│   Frontend (Cloudflare Pages)   │  fetch  │   Backend (Cloudflare Worker)    │
│   fio-banka.pages.dev           │ ──────► │   fio-api.bass443.workers.dev    │
│   CF account: maxferit          │         │   CF account: bass443            │
│                                 │         │                                  │
│   index.html (single file,      │         │   src/worker.js                  │
│   vanilla JS, no build step)    │         │   - /api/accounts                │
│                                 │         │   - /api/auth (heslo + TOTP)     │
│                                 │         │   - /api/transactions            │
└─────────────────────────────────┘         └────────────────┬─────────────────┘
                                                             │ fetch
                                                             ▼
                                                ┌──────────────────────────┐
                                                │   fioapi.fio.cz/v1/rest  │
                                                │   (Fio API tokeny per    │
                                                │   účet v env vars)       │
                                                └──────────────────────────┘
```

**Dva Cloudflare accounty.** Pages frontend žije na účtu `maxferit`, Worker backend na účtu `bass443`. Není to záměr — historický vznik, jen tak zůstalo.

## Repo layout

```
.
├── index.html          # frontend (Pages Direct Upload)
├── api/                # Cloudflare Worker (backend)
│   ├── src/worker.js
│   ├── wrangler.jsonc
│   └── package.json
└── README.md
```

## Auth flow

1. User zadá heslo + 6-místný TOTP kód z authenticator appky (Google Authenticator / Authy / 1Password / …)
2. Frontend volá `POST /api/auth` na Worker
3. Worker ověří proti env `PASSWORD` a `TOTP_SECRET`
4. Při úspěchu vrátí `sessionToken` (TTL 1h), frontend ho uloží do `sessionStorage`
5. Každý další request na `/api/transactions` posílá `sessionToken`

## Worker env vars (CF dashboard → bass443 → Workers → fio-api → Settings → Variables)

| Var | Popis |
|---|---|
| `PASSWORD` | Master heslo pro login |
| `TOTP_SECRET` | Base32 secret pro TOTP (shared s authenticator appkou) |
| `TOKEN_MAXLA` | Fio API token pro účet Maxla |
| `TOKEN_MAX` | Fio API token pro účet Max |
| `TOKEN_FERDA` | Fio API token pro účet Ferda |
| `TOKEN_SPOLECNY` | Fio API token pro společný účet |

Tokeny se generují ve Fio internetbankingu (Nastavení → API). Token starý víc než 90 dní vyžaduje re-autorizaci v IB.

## Deploy

**Frontend (Pages, Direct Upload — neauto):**
```powershell
# Login na CF jako maxferit
npx wrangler login
# Deploy
npx wrangler pages deploy . --project-name=fio-banka --branch=main
```

**Backend (Worker):**
```powershell
cd api
# Login na CF jako bass443 (!)
npx wrangler login
npx wrangler deploy
```

## Známé problémy

**Backend — auth není skutečně ověřená.** `verifySessionToken` v [api/src/worker.js:507-535](api/src/worker.js#L507-L535) kontroluje jen timestamp tokenu, ne jeho integritu. Kdokoli s URL Workeru může poslat `{sessionToken: "${Date.now()}.cokoliv"}` a projít. Heslo + TOTP brání jen prvnímu loginu, ne dalším requestům.

**Session token používá `Math.random()`** jako security primitiv ([api/src/worker.js:490](api/src/worker.js#L490)). Predikovatelné. Akademické dokud bod 1) není opraven.

**Vlastní implementace SHA1+HMAC** (~250 řádků). Web Crypto API to umí natively přes `crypto.subtle.sign('HMAC', ...)`. Funkční, ale zbytečný attack surface.

**`CORS: *`** ([api/src/worker.js:18](api/src/worker.js#L18)) — Worker přijme volání odkudkoli. Mělo by být omezeno na `fio-banka.pages.dev`.

## Příští kroky

- [ ] Fix session verification (HMAC-podepsaný token s server-side secretem)
- [ ] Restrict CORS na `fio-banka.pages.dev`
- [ ] Konsolidovat CF accounty (přesunout buď Pages na bass443, nebo Worker na maxferit) — odpadne dual-login při deploy
- [ ] Napojit Pages projekt na Git (eliminovat ruční Direct Upload)
