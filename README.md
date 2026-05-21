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

## Pokračování na druhém PC

> Posledně rozpracováno **2026-05-21**. Předchozí session: stáhnut Worker zdroják, sloučen do monorepa, opraveny security díry. **Worker ještě nebyl deploynut s novými fixy** — dokud neuděláš krok 3, produkce běží stará (rozbitá) verze.

### Bootstrap

```powershell
# Pokud repo na PC ještě není
cd D:\git
git clone https://github.com/Anamax443/fio-banka.git
cd fio-banka\api
npm install
```

### Pending checklist

- [ ] **Vygenerovat `SESSION_SECRET`** — 32 bajtů hex:
  ```powershell
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
  (Pokud máš secret z předchozí session uložený v 1Password/poznámkách, použij ho — jinak nový vygeneruj. Secret se nikdy nesdílí ani necommituje.)

- [ ] **Přidat do CF dashboardu** — bass443 → Workers & Pages → `fio-api` → Settings → Variables and Secrets → **Add → Type: Secret** → `SESSION_SECRET` = hex string. ⚠️ **Musí být Secret, ne plain Variable** (secret zmizí z UI po uložení, plain ne).

- [ ] **Deploy Workeru:**
  ```powershell
  npx wrangler login          # přihlas se jako bass443@gmail.com
  npx wrangler whoami         # ověř: "Bass443@gmail.com's Account"
  cd D:\git\fio-banka\api
  npx wrangler deploy
  ```

- [ ] **Test:** otevři [fio-banka.pages.dev](https://fio-banka.pages.dev) → heslo + TOTP → načti pohyby. Pokud projde, nové signed sessions fungují.

- [ ] **Cleanup:** smaž lokální orphan `D:\git\fio-api\` (zdroják je teď v `fio-banka/api/`):
  ```powershell
  Remove-Item -Recurse -Force D:\git\fio-api
  ```
  (Existuje jen na původním PC, na novém ho nemáš.)

### Pokud se něco rozbije po deployi

- **401 "Neplatná session"** — frontend posílá starou session z `sessionStorage`. Odhlas se a přihlas znovu, nebo otevři incognito.
- **500 "Server není správně nakonfigurován"** — chybí `SESSION_SECRET` v env. Zkontroluj v CF dashboardu že je tam **a že je typu Secret** (ne plain var).
- **CORS error v browseru** — frontend volá z jiného origin než `fio-banka.pages.dev`. Pokud testuješ z localhost, port musí být 3000/8080 (whitelist v `api/src/worker.js`).
- **Rollback:** v CF dashboardu → fio-api → Deployments → klikni na předchozí deployment → Rollback. Stará rozbitá auth se vrátí, ale aspoň poběží.

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
| `SESSION_SECRET` | Náhodný řetězec (32+ znaků) pro HMAC podpis session tokenů. Generuj např. `node -e "console.log(crypto.randomBytes(32).toString('hex'))"`. **Nikdy nesdílet, při kompromitaci rotovat (invaliduje všechny sessions).** |
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

## Bezpečnostní fixy (2026-05-21)

Po stažení původního zdrojáku z CF dashboardu byl Worker přepsán s těmito opravami:

- **Session verification opravena** — token je teď `${timestamp}.${nonceHex}.${hmacSig}` kde `hmacSig = HMAC-SHA256(SESSION_SECRET, "${timestamp}.${nonceHex}")`. Bez znalosti `SESSION_SECRET` nelze token vyrobit. Verifikace porovnává timing-safe.
- **`Math.random()` nahrazen `crypto.getRandomValues`** pro nonce v session tokenu.
- **CORS omezen** na `fio-banka.pages.dev` (+ localhost pro dev) s `Vary: Origin` headerem. Žádné `*`.
- **Vlastní SHA1/HMAC nahrazeno `crypto.subtle`** — Worker je o ~250 řádků kratší, používá nativní Web Crypto API.
- **Token nesmí být future-dated** — drobnost, ale ucpává divné edge case.

**⚠️ Před prvním deployem této verze:** Viz [Pending checklist](#pending-checklist) výše. Bez `SESSION_SECRET` Worker vrátí 500.

## Příští kroky

- [ ] Konsolidovat CF accounty (přesunout buď Pages na bass443, nebo Worker na maxferit) — odpadne dual-login při deploy
- [ ] Napojit Pages projekt na Git (eliminovat ruční Direct Upload)
- [ ] Doplnit rate limiting na `/api/auth` (brute-force ochrana hesla — TOTP je 6 cifer, prolomení 1M pokusů)
