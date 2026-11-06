# Fakturace

Soukromá webová aplikace pro fakturaci a roční daňové podklady fyzické osoby
(OSVČ podle § 7 ZDP a/nebo nájem podle § 9 ZDP), neplátce DPH.

- Next.js 16 (App Router) + TypeScript, SQLite přes Prisma 7
- PDF faktury s QR Platbou (SPAYD), neměnné po vystavení
- přihlášení heslem + povinné dvoufázové ověření (TOTP), jediný účet
- data (databáze, PDF, účtenky) v jednom adresáři `DATA_DIR` → snadná záloha i export

> Daňové výstupy aplikace jsou **podklad**. Před podáním zkontrolujte aktuální sazby a limity.

## Stav

| Krok | Obsah | Stav |
|---|---|---|
| 0 | kostra, CI, Docker image pro Railway | hotovo |
| 1 | instalace účtu, přihlášení, 2FA, auditní log | hotovo |
| 2 | dodavatel, činnosti (§ 7 / § 9), odběratelé + ARES | hotovo |
| 3 | faktury: koncept → vystavení, číselná řada bez mezer, PDF + QR | hotovo |
| 4 | odesílání e-mailem, šablony, log odeslání | další |
| 5 | úhrady, stavy po splatnosti, upomínky | |
| 6 | dobropisy a storno | |
| 7 | opakované faktury | |
| 8 | výdaje a účtenky, archiv | |
| 9 | import výpisu (CSV) a párování podle VS | |
| 10 | roční daňové podklady (§ 7 / § 9, paušál vs. skutečné výdaje) | čeká na ověření sazeb |
| 11 | šifrované zálohy, export, archivní balík | |

## Nasazení na Railway

Railway najde `Dockerfile` v kořeni repozitáře a postaví z něj image. Konfigurace
se nastavuje v administraci Railway (soubor `railway.json` Railway už pro nové
služby nepodporuje).

1. **New Project → Deploy from GitHub repo** → vyberte tento repozitář.
2. **Volume:** ke službě připojte svazek s cestou **`/data`**. Bez něj by se data
   při každém nasazení ztratila.
3. **Networking → Generate Domain** – vznikne adresa typu `https://…up.railway.app`.
4. **Variables:**

   | Proměnná | Hodnota |
   |---|---|
   | `APP_URL` | adresa z bodu 3, bez lomítka na konci |
   | `BETTER_AUTH_SECRET` | výstup `openssl rand -base64 32` |
   | `SETUP_TOKEN` | výstup `openssl rand -hex 16` |

   `DATA_DIR=/data` je nastavené v image. `APP_URL` musí přesně odpovídat adrese
   v prohlížeči, jinak přihlášení odmítne požadavek.
5. **Settings → Deploy → Healthcheck Path:** `/api/zdravi`.
6. Otevřete adresu aplikace → průvodce **Instalace** → zadejte `SETUP_TOKEN`,
   založte účet → přihlaste se → nastavte dvoufázové ověření a uložte si záložní kódy.

Poznámky:

- Kontejner při startu aplikuje migrace (`scripts/migrate.mjs`) a pak spustí server
  pod neprivilegovaným uživatelem `node`; svazek si sám nastaví práva.
- Při novém nasazení je aplikace několik sekund nedostupná (svazek může mít
  připojený vždy jen jeden běžící kontejner).
- Druhý účet založit nejde (hlídá to aplikace i databáze). `SETUP_TOKEN` můžete
  po instalaci změnit na jinou náhodnou hodnotu.

## Lokální vývoj

Potřebujete Node.js 22.

```bash
npm ci
cp .env.example .env        # doplňte BETTER_AUTH_SECRET a SETUP_TOKEN
npm run db:generate         # Prisma Client do src/generated/prisma
npm run dev                 # aplikuje migrace a spustí http://localhost:3000
```

| Příkaz | Co dělá |
|---|---|
| `npm run check` | lint, typová kontrola, testy a kontrola migrací |
| `npm test` | unit a integrační testy (Vitest, každý soubor s čistou databází) |
| `npm run build && npm run e2e` | end-to-end test v prohlížeči proti produkčnímu buildu |
| `npm run db:migrate` | aplikuje migrace na databázi v `DATA_DIR` |
| `npm run db:check` | ověří, že migrace přesně odpovídají `prisma/schema.prisma` |
| `npm run db:new-migration -- <nazev>` | po změně schématu vygeneruje novou migraci |

### Databáze a migrace

- Schéma je v `prisma/schema.prisma`, migrace v `prisma/migrations/*/migration.sql`.
- Migrace se generují `npm run db:new-migration -- <nazev>` (oficiální schema-engine
  Prismy ve WASM verzi, bez stahování binárek) a aplikují `scripts/migrate.mjs`
  (zapisuje do `_prisma_migrations`, kompatibilní s Prisma CLI).
- Aplikovanou migraci nikdy neupravujte – runner to odmítne (kontrolní součet).
- Integritu účetních dokladů hlídá i sama databáze (triggery v migraci
  `…_integrity_triggers`): vystavenou fakturu nelze smazat ani změnit, číselná řada
  jde jen o +1, auditní log je jen pro zápis. Při přestavbě tabulky generátor
  migrací triggery automaticky obnoví a test ověří, že žádný nechybí.

### Struktura

```
src/app/(public)     instalace, přihlášení, nastavení 2FA
src/app/(app)        aplikace za přihlášením (faktury, odběratelé, nastavení)
src/app/api          Better Auth, stahování souborů (jen po 2FA), healthcheck
src/lib              doménová logika: peníze v haléřích, data v Europe/Prague,
                     IČO/účty/IBAN, SPAYD, ARES, číslování, PDF, audit, soubory
prisma/              schéma a SQL migrace
scripts/             migrace, generování klienta, kontrola driftu
tests/               unit, integrační (vč. integrity DB) a E2E testy
```

## Bezpečnost

- Tajné klíče jen v proměnných prostředí (`.env` se necommituje), nic citlivého v URL.
- Jediný účet, povinné 2FA (TOTP + 10 záložních kódů), omezení počtu pokusů.
- Změna bankovního účtu dodavatele vyžaduje kód z ověřovací aplikace.
- Soubory se vydávají jen přihlášenému uživateli s 2FA a s kontrolou otisku SHA-256.
- Produkční hlavičky: CSP, HSTS, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`;
  aplikace je vyřazená z indexace vyhledávači.
