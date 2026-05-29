# Oponentské review – Fio Banka v3.7

**Oponent:** (externí)
**Datum review:** 2026-05-29
**Verze:** 3.7.0
**Výsledek:** 3 kritické, 5 závažných, 7 doporučení

---

## Celkové hodnocení

Aplikace je nadstandardně zabezpečená v porovnání s běžným "dashboardem" – správně používá timing-safe porovnání, CSP, HSTS, audit log, TOTP. Architektura je přiměřeně jednoduchá a účelová. Nicméně identifikoval jsem **tři kritické nedostatky**, které bych před ostrým provozem (pokud se nejedná jen o demo pro 1–2 klienty) doporučoval řešit.

**Shrnutí rizik:**
- 🔴 **Kritické** – chybějící revokace session + chybějící re-authentication pro změny tokenů
- 🟠 **Závažné** – per-IP rate limit, TOTP/Fio tokeny v plaintextu v KV, CSP `unsafe-inline`
- 🟡 **Doporučené** – ID v URL, QR dependency, veřejný status page

---

## Odpovědi na otázky (podle priority)

### Vysoká priorita

#### 1. Plaintext hesla v KV během auto-migrace

**Problém:** Pokud auto-migrace znamená, že na chvíli ukládáte plain heslo do KV (byť na milisekundy), je to **nepřijatelné**. Útočník s read-only přístupem ke KV (CF support, insider, breach) ho získá.

**Doporučení:**
- **Neukládejte plain heslo nikdy.** Migraci udělejte tak, že při přihlášení:
  1. Načtete starý hash (plain heslo v KV? to by tam nemělo být)
  2. Ověříte ho (pokud je to plain – to je samo o sobě problém)
  3. Okamžitě spočítáte nový hash a uložíte ho **místo** plaintextu
  4. Plaintext v paměti funkce vyčistíte (přepíšete)
- Pokud už dnes plain hesla v KV jsou (např. z v2), **force re-login všech klientů** při příštím deployi – pošlete email s upozorněním.

**Verdikt:** Force migrate + odstranit plain ze všech záznamů.

---

#### 2. Session token bez revocation + změna hesla neinvaliduje session

**Reálné riziko:** **Vysoké**, zejména pro banking viewer. Pokud útočník ukradne session token (XSS – byť CSP blokuje, ale chyba v CSP nebo extension), může se dívat na pohyby i poté, co oběť změní heslo.

**Doporučení:**
- Přidejte do KV pro každého klienta `sessionVersion` (integer)
- Session token bude obsahovat i toto číslo: `{ts}.{nonce}.{sessionVersion}.{HMAC}`
- Při změně hesla nebo TOTP → inkrementujte `sessionVersion` → všechny staré session tokeny přestanou platit
- Pokud nechcete měnit token formát, přidejte **KV blocklist** pro explicitní revokaci (např. `revoked:{tokenHash}` s TTL = zbývající čas session). Ale to je složitější.

**Verdikt:** **Implementujte sessionVersion.** Je to cca +30 řádků kódu, stojí za to.

---

#### 3. Fio API token v plain v KV

**Defense in depth:** I když KV je encrypted at-rest, Cloudflare má přístup. Pro bankovní data je šifrování vlastním klíčem vhodné.

**Doporučení:**
- Přidejte `ENCRYPTION_KEY` (32B hex) do env var
- Při zápisu tokenu: `ciphertext = AES-GCM(plaintext, key)`
- Při čtení decrypt
- CPU overhead je zanedbatelný (pár ms)

**Verdikt:** **Implementujte.** Náročnost nízká (Web Crypto API to umí), přidaná hodnota vysoká pro klid duše.

---

#### 4. Rate limit per IP (ne per account)

**Riziko:** Botnet s 1000 IP adresami = 10 000 pokusů za 15 minut (10/IP). To prolomí slabé heslo.

**Řešení – kombinované limity:**
- Per IP: 10/15min (současný)
- Per account: 30/15min (KV `ratelimit:client:{id}` s TTL)
- Po per-account limitu → zpoždění + audit + dočasný lock (např. 5 min)

**Proti CPU budgetu:** K loginu dochází řádově jednotky za sekundu, zápis do KV per request je v pořádku.

**Verdikt:** **Implementujte per-account limit.** Je to standard v bankovnictví.

---

#### 5. Klient spravuje Fio tokeny bez TOTP re-auth

**Riziko:** Po krádeži session tokenu (např. z historie browseru, shared PC) může útočník vyměnit Fio token za svůj a stáhnout transakce. Nebo token smazat – DoS.

**Doporučení:**
- Pro **změnu/mazání Fio tokenu** vyžadovat re-authentication (heslo nebo TOTP)
- Pro **přidání nového tokenu** také re-auth (nebo alespoň TOTP, pokud je MFA enabled)
- Session token by měl mít flag `lastReauthAt`, který se ověří před citlivou akcí (max 5 minut starý)

**Verdikt:** **Kritické – řešit před launch.** Bez toho je session token příliš mocný.

---

### Střední priorita

#### 6. TOTP secret v plain v KV

Analogické k bodu 3 – šifrujte stejným `ENCRYPTION_KEY`. TOTP secret musí být dostupný ve funkci, ale at-rest encryption stačí.

**Verdikt:** **Šifrujte spolu s Fio tokeny.**

---

#### 7. Žádný brute-force lockout per účet

**Důsledek:** Útočník s rotujícími IP (VPN, botnet) může zkoušet hesla donekonečna. Per-account rate limit (bod 4) by měl stačit, ale lockout po N failed je standard.

**Doporučení:** Po 30 failed pokusech za 15 minut → zablokovat účet na 1 hodinu (admin může odblokovat). KV `lockout:{clientId}`.

**Verdikt:** **Doporučuji implementovat** – malá námaha, velký efekt.

---

#### 8. Admin audit neukazuje zadávaná hesla (správně), ale chybí detekce anomálií

Není to chyba, ale námět: přidejte do admin panelu sekci "Podezřelé pokusy" – např. stejné heslo zkoušené na více účtech, loginy z neobvyklých zemí.

**Verdikt:** Nice-to-have pro v3.8.

---

#### 9. CSP `unsafe-inline` pro style-src

**Lze odstranit:** Ano, přesuňte všechny `<style>` bloky do externího CSS souboru. Žádný JavaScript nepotřebuje inline styly.

**Postup:**
1. Vytvořte `styles.css` (hlavní) a `admin-styles.css`
2. Odstraňte `<style>` z HTML
3. Nastavte `style-src 'self'`

**Verdikt:** **Odstraňte unsafe-inline** – je to čistá bezpečnostní výhra.

---

#### 10. Fallback na `ADMIN_SECRET` env var

**Riziko:** Útočník s přístupem k wrangler/CF dashboard smaže `admin:password` z KV a pak použije známý `ADMIN_SECRET` z environment variables (které jsou stejně vidět v CF dashboard).

**Jde o recovery vs security trade-off.** Pokud je `ADMIN_SECRET` silný (random 256b), tak je to OK. Ale přidejte audit: každý login přes fallback zalogujte jako `WARNING` a pošlete alert adminovi (email/webhook).

**Verdikt:** **Akceptovat**, ale přidat alerting.

---

### Nízká priorita

#### 11. Audit log retence 90 dní

**Pro osobní banking?** Stačí. **Pro firemní?** Bývá 1 rok+ (GDPR nemá konkrétní lhůtu, ale "přiměřenou").

**Doporučení:** Udělejte export auditu do CSV (admin tlačítko) a/nebo prodlužte na 180 dní (KV TTL lze, ale kvóta?).

**Verdikt:** Závisí na klientech – dle smlouvy.

---

#### 12. `/api/admin/login` GET vrací MFA stav

**Info disclosure:** Triviální, ale snadno opravitelné – vraťte pouze `{ mfaRequired: true/false }` a žádné detaily (např. "je enrollnuto?").

**Verdikt:** **Opravte** – 5 minut práce.

---

#### 13. `/?c=ID` – ID v URL

**Referer leak:** Pokud klient klikne z dashboardu na externí odkaz, ID se pošle v `Referer`.

**Řešení:**
- Nepoužívat ID v URL – uložit do `sessionStorage` po prvním načtení a pak přesměrovat na `/`
- Nebo použít POST pro přihlášení, ID poslat v těle

**Verdikt:** Nízké riziko (ID není tajné), ale pro klienty kteří chtějí bookmark – opravte.

---

#### 14. Závislost na `api.qrserver.com`

**Riziko outage:** Klient nemůže enrollnout TOTP.

**Řešení:** Lokální QR generování – např. `qrcode` (2KB) nebo `QRCode.js` (vanilla). CSP pak nepotřebuje external.

**Verdikt:** **Nahraďte** – jednoduché, žádná external dependency.

---

#### 15. `docs/project-status.html` je veřejný

**Info disclosure:** KV namespace ID, audit retence, commit hash.

**Pokud je to záměr pro open-core/transparentnost**, tak OK. Ale namespace ID je citlivé (pomáhá při útoku na KV).

**Doporučení:**
- Schovat pod HTTP Basic auth (CF Pages Access) nebo
- Odstranit citlivé údaje (namespace, commit hashe nahradit "83fef97" bez kontextu)

**Verdikt:** **Upravte nebo schovejte.**

---

## Další postřehy (mimo vaše otázky)

### Chybějící logout endpoint
- Session token nelze invalidovat → logout jen maže token na straně klienta (nedostatečné)
- Přidejte endpoint `/api/logout`, který přidá token do **krátkodobého blocklistu** (např. `blacklist:{tokenHash}` s TTL = zbývající čas session)
- Nebo použijte sessionVersion z bodu 2

### Absence notifikací
- Při změně Fio tokenu nebo hesla – pošlete email klientovi ("Byl změněn přístupový token, pokud jste to nebyli vy, kontaktujte admina")
- Při login z nové IP/země – varování emailem

### Chybí CSRF ochrana?
- Ne, protože session token je v `Authorization` header (ne cookie) → CSRF není možné. OK.

### Rate limiting na API endpointy kromě login
- `/api/transactions` může být DoSed útočníkem s platným tokenem. Přidejte per-user rate limit (např. 1000 requestů / hodinu).

### Admin změna hesla klienta
- Pokud admin změní klientovi heslo, měl by resetovat TOTP (nebo vyžadovat re-enroll). V dokumentaci to nevidím.

### Verze API v URL
- `/api/client/*` – žádná version prefix. Pro budoucí změny zaveďte `/api/v1/...`

---

## Závěr a doporučená roadmapa

### Před launch (blokující)
1. ✅ **Session version** (revokace po změně hesla) – kritické
2. ✅ **Re-authentication pro změny Fio tokenů** – kritické
3. ✅ **Per-account rate limit + lockout** – závažné
4. ✅ **Odstranit unsafe-inline CSP** – závažné

### Do 1 týdne po launch
5. Šifrování Fio tokenů a TOTP secretů v KV
6. Lokální QR generátor
7. Notifikace emailem (změna tokenu/hesla, nový login)
8. Per-user rate limit na `/api/transactions`

### Do 1 měsíce
9. Export auditu pro admina
10. Skrýt/upravit veřejný status page
11. Logout endpoint s blocklistem

**Celkové bezpečnostní skóre po opravě kritických bodů:** odhaduji 94 % (dnes 89 %). Po implementaci všech doporučení 97 %.

---

*Oponenturu zpracoval: (AI jako externí konzultant)*
*Souhlasím s uveřejněním v docs/oponentury/2026-05-29-reakce-oponent.md*
