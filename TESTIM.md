# Rei CRM — Udhëzues për testim

Si t'i ngresh aplikacionin nga zero, me çfarë të hyjmë, dhe çfarë ka brenda për të provuar.

Për vendimet arkitekturore dhe pse-të e secilës fazë, shih [README.md](README.md).
Ky dokument është vetëm praktik: ngritje, hyrje, klikim.

---

## 1. Ngritja (një herë)

Duhen **Node 20+**, **npm 11+** dhe **Docker Desktop** të hapur.

```bash
cp .env.example .env
npx auth secret                  # shkruan AUTH_SECRET te .env

docker compose up -d db          # Postgres 16 në localhost:5432
npm install

# npm 11 bllokon skriptet e instalimit. Pa këtë, Prisma dhe esbuild
# mbeten pa binarë dhe `prisma generate` dështon.
npm approve-scripts @prisma/engines prisma esbuild
npm install

npx prisma generate              # klienti gjenerohet te src/generated/prisma
npx prisma migrate deploy        # 4 migrime
npx prisma db seed               # krijon Super Admin-in
npm run dev
```

Aplikacioni hapet te **http://localhost:3000**.

> **Kujdes:** hapi `npm approve-scripts` nuk është opsional në npm 11+.
> Në npm 10 dhe më poshtë skriptet ekzekutohen vetë dhe hapi tepron.

### Rinisja e ditës tjetër

```bash
docker compose up -d db
npm run dev
```

### Nisja nga e para (fshin të dhënat)

```bash
docker compose down -v && docker compose up -d db
npx prisma migrate deploy && npx prisma db seed
```

---

## 2. Me çfarë hyjmë

Super Admin-i krijohet nga seed-i, me vlerat e `.env`:

| | |
|---|---|
| **Email** | `admin@radx.app` |
| **Fjalëkalimi** | `ChangeMe123!` |
| **Roli** | SUPER_ADMIN |

Hyrja bëhet te **http://localhost:3000/login**. Pas hyrjes shkon te `/dashboard`.

Për t'i ndryshuar, redakto `SEED_SUPER_ADMIN_EMAIL` / `SEED_SUPER_ADMIN_PASSWORD`
te `.env` **përpara** `npx prisma db seed`.

### Krijimi i dy roleve të tjera

Nuk ka user-a të tjerë në seed — krijohen me ftesë, dhe kjo është vetë një rrugë
që duhet testuar:

1. Hyr si Super Admin → **http://localhost:3000/users**
2. Te "Fto një përdorues" vendos email, emër dhe rol (`SALES` ose `OUTSIDE_SALES`)
3. Përgjigjja kthen një **`inviteUrl`** — dërgimi me email nuk është konfiguruar në
   zhvillim, ndaj linku duhet kopjuar nga përgjigjja (ose nga logu i serverit)
4. Hap `/invite/<token>`, vendos fjalëkalimin → llogaria kalon `INVITED` → `ACTIVE`

Fjalëkalimi i ftesës duhet **të paktën 10 karaktere**. Për testim:

| Email | Fjalëkalim | Rol |
|---|---|---|
| `sales@radx.app` | `SalesTest123!` | SALES |
| `outside@radx.app` | `OutsideTest123!` | OUTSIDE_SALES |

Ftesa skadon pas `INVITE_TTL_HOURS` (parazgjedhje 72h) dhe është **njëpërdorimshe** —
hapja e dytë e të njëjtit link duhet të refuzohet.

---

## 3. Çfarë shikon secili rol

Kjo tabelë është zemra e testimit: nëse një rol shikon ose bën diçka që rreshti i
vet e mohon, ai është bug.

| | Super Admin | Sales | Outside Sales |
|---|---|---|---|
| Përdoruesit e ftesat (`/users`) | ✅ | ❌ | ❌ |
| Gjurmët e auditit (`/audit-logs`) | ✅ | ❌ | ❌ |
| Klientët | të gjithë | të gjithë | vetëm të vetët |
| Kontratat | të gjitha | të gjitha | vetëm të vetat |
| Krijim klienti | ✅ | ✅ | ✅ (i veti) |
| Krijim kontrate | ✅ | ✅ | ❌ *(e konfigurueshme)* |
| Ndryshim i komisionit % | ✅ | ❌ | ❌ |
| Shtim fature | ✅ | vetëm kontratat e vet | vetëm kontratat e vet |
| Verifikim / kontestim fature | ✅ | vetëm të vetat | ❌ |
| Aprovim / pagesë komisioni | ✅ | ❌ | ❌ |
| Rinovim / ndërprerje kontrate | ✅ | vetëm të vetat | ❌ |
| Lista e komisioneve | të gjitha | vetëm të vetat | vetëm të vetat |
| Renditja (`/leaderboard`) | e plotë | e plotë | vetëm rreshti i vet + vendi |
| Njoftimet | vetëm të vetat | vetëm të vetat | vetëm të vetat |

Dy qeliza kontrollohen nga `.env` dhe janë `false` si parazgjedhje:
`OUTSIDE_SALES_CAN_CREATE_CONTRACT` dhe `OUTSIDE_SALES_CLIENT_REQUIRES_APPROVAL`.

**Si duket një refuzim:** një faqe e ndaluar bën **redirect** (307), një endpoint API
kthen **403**. Kontrata e një përfaqësuesi tjetër kthen **404**, jo 403 — me qëllim,
që të mos zbulohen ID-të e të tjerëve. Pa hyrje fare: **401**.

---

## 4. Ku klikohet — `/dashboard` është qendra

Nuk ka menu anësore globale. Lidhjet e moduleve janë te `/dashboard`, dhe
**filtrohen sipas rolit** — një Sales nuk e shikon fare lidhjen "Përdoruesit".

| Faqja | Çfarë ka |
|---|---|
| `/login` | Hyrja |
| `/dashboard` | Totalet, trendi 12-mujor, klientët kryesorë, vendi yt, zilja e njoftimeve, navigimi |
| `/clients` | Lista me kërkim + filtra (tip, qytet, status, përfaqësues) + formulari i shtimit |
| `/clients/[id]` | Klienti me kontratat, faturat dhe totalet |
| `/contracts` | Lista me filtra |
| `/contracts/new` | Kontratë e re |
| `/contracts/[id]` | Detajet + `DRAFT→ACTIVE` + Rinovo / Ndërpre + lidhja te kontrata e mëparshme |
| `/bills` | Lista me filtra datë/status + kolona e komisionit |
| `/bills/new` | Faturë e re |
| `/bills/[id]` | Verifiko / Kontesto / Anulo + karta e komisionit |
| `/commissions` | Totale për status, filtra, aprovim, pagesë, aprovim në grup, eksport CSV |
| `/leaderboard` | Renditja, me filtër periudhe në URL |
| `/reports` | Tri raporte, secili CSV + PDF |
| `/users` | *Vetëm Super Admin* — lista + ftesa |
| `/audit-logs` | *Vetëm Super Admin* — vetëm lexim |
| `/invite/[token]` | Publik — vendosja e fjalëkalimit |

Filtrat dhe renditja rrjedhin nga **URL-ja**, ndaj çdo pamje e filtruar është e
ndashme si link — dhe kjo vlen edhe si test: kopjo URL-në, hape në një skedë të re,
duhet të japë të njëjtën pamje.

---

## 5. Scenari kryesor: nga klienti te pagesa

Kjo është rruga e parave, nga fillimi në fund. Numrat janë zgjedhur që rezultati
të jetë i lehtë për ta kontrolluar me mend.

1. **Klient** — `/clients` → shto "Bar Aroma", tip `BAR`, qytet Tiranë
2. **Kontratë** — `/contracts/new` → klienti i mësipërm, komision **5%**,
   fillim `2026-09-01`. Krijohet **gjithmonë** `DRAFT`.
3. **Aktivizo** — `/contracts/[id]` → `DRAFT → ACTIVE`
   *(faturë mbi kontratë DRAFT duhet të refuzohet me 409)*
4. **Faturë** — `/bills/new` → kontrata e mësipërme, nr. `F-001`,
   shuma **120000**, datë `2026-09-10`. Krijohet `PENDING`.
5. **Verifiko** — `/bills/[id]` → Verifiko.
   Komisioni **ngrihet** tani: `120000 × 5% =` **`6000.00`**
6. **Provo pagesën para aprovimit** — duhet **409**. Pagesa kërkon aprovim.
7. **Aprovo** → **Paguaj** — `/commissions`. Statusi `PENDING → APPROVED → PAID`.
8. **Kontrollo zilen** — `/dashboard`. Duhen dy njoftime:
   "Komisioni u aprovua" dhe "Komisioni u pagua".
9. **Renditja** — `/leaderboard?period=2026-09` → rank 1, të ardhura `120000.00`,
   komision `6000.00`
10. **Gjurma** — `/audit-logs`. Çdo hap i mësipërm duhet të ketë një rresht.

### Ngrirja — testi që kap gabimin më të shtrenjtë

Pas hapit 5, kthehu te kontrata dhe ndrysho komisionin në 10%. Komisioni i ngrirë
**duhet të mbetet 6000.00**. Përqindja e re vlen vetëm për faturat e verifikuara më pas.

### Kthimi prapa

- **Kontesto** ose **anulo** një faturë të verifikuar → komisioni `PENDING` **fshihet**
- Po nëse komisioni është `APPROVED` ose `PAID` → i gjithë kalimi refuzohet me
  **409 `COMMISSION_LOCKED`**. Paraja e paguar nuk kthehet prapa me një klik.
- `DISPUTED → VERIFIED` lejohet, dhe merr snapshot **të ri** të përqindjes aktuale

### Cikli i kontratës

| Kalimi | Nga ku bëhet |
|---|---|
| `DRAFT → ACTIVE` | `/contracts/[id]` |
| `ACTIVE → RENEWED` | butoni **Rinovo** — krijon pasardhësen në një transaksion |
| `ACTIVE → TERMINATED` | butoni **Ndërpre** — **kërkon arsye ≥5 karaktere** |
| `ACTIVE → EXPIRED` | vetëm puna e natës, kurrë me dorë |

Rinovimi i dytë i së njëjtës kontratë duhet të kthejë **`ALREADY_RENEWED`**.

---

## 6. Gjëra të tjera për të provuar

**Faturimi dhe komisionet**

- Aprovim në grup te `/commissions` — një transaksion; ID-të e papranueshme kthehen
  te `skipped`, nuk rrëzojnë grupin. Mbi 500 rreshta → `409 BATCH_TOO_LARGE`.
- Korrigjim fature lejohet **vetëm** sa është `PENDING`
- Periudha llogaritet mbi **datën e faturës**, jo mbi datën e krijimit të komisionit:
  një faturë e verifikuar me vonesë nuk duhet të rrëshqasë në muajin tjetër

**Raportet dhe eksportet** — `/reports`, secili CSV dhe PDF:
të ardhurat sipas klientit · kontratat që skadojnë · pasqyra e komisioneve.
CSV-ja ka BOM (që Excel-i të lexojë shkronjat shqipe) dhe kufi 5000 rreshta —
një skedar i prerë e deklaron me header-in `x-export-truncated: true`.
Eksporti përdor **të njëjtin scope** si lista, ndaj një rol nuk mund të nxjerrë
me eksport atë që lista do t'i fshihte. Ia vlen provuar si Sales.

**Njoftimet** — zilja te `/dashboard`:

| Ngjarja | Kush njoftohet |
|---|---|
| Komision APPROVED / PAID | përfaqësuesi i komisionit |
| Faturë DISPUTED | pronari i kontratës |
| Kontratë skadon ≤30 ditë / skadoi | pronari i kontratës |
| Ftesa u pranua | admin-i që e dërgoi |

Aprovimi në grup shkruan **një njoftim për çdo komision**, jo një përmbledhje.
Askush nuk lexon zilen e tjetrit — Super Admin-i përfshirë.

**Siguria / RBAC** — vlen provuar me dorë:

- Hap `/users` si Sales → redirect
- Kërko `/api/users` si Sales → 403
- Provo të shohësh kontratën e një përfaqësuesi tjetër → 404
- Pezullo një llogari ndërsa është e hapur në një skedë tjetër → çdo lexim ose
  shkrim ndalon menjëherë, pa pritur skadimin e token-it
- Vendos `SESSION_REVALIDATE_SECONDS=0` te `.env` për revokim të menjëhershëm
  edhe në navigim

---

## 7. Worker-i (opsional)

Punët e natës rrinë në një **proces të dytë**, që nuk nis me `npm run dev`:

```bash
npm run worker
```

| Radha | Çfarë bën |
|---|---|
| `contracts.daily-sweep` | ACTIVE me datë mbarimi të kaluar → EXPIRED, + paralajmërime |
| `summaries.nightly-rollup` | rimbush `revenue_summaries` |
| `notifications.email` | dërgon një njoftim me email |
| `notifications.daily-digest` | përmbledhja ditore |
| `reports.monthly` | raporti mujor |

Për ta testuar pa pritur orën e cron-it, vendos `NIGHTLY_CRON` te një minutë
afër (UTC). Të gjitha punët janë idempotente — ekzekutimi i dytë nuk dyfishon asgjë.

**Worker-i duhet të ketë vetëm një replikë.** Dy replika i bëjnë të gjitha punët
e planifikuara dy herë.

---

## 8. Komandat

| Komanda | Çfarë bën |
|---|---|
| `npm run dev` | Serveri i zhvillimit |
| `npm test` | Testet Vitest — **479 teste** |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run worker` | Worker-i i punëve të natës |
| `npm run db:deploy` | Aplikon migrimet |
| `npm run db:seed` | Seed-i i Super Admin-it |
| `npm run db:generate` | Rigjeneron klientin e Prisma-s |
| `npm run build` / `npm start` | Build prodhimi |

---

## 9. Kur diçka nuk punon

**`prisma generate` dështon, ose esbuild ankohet për binar që mungon**
Skriptet e instalimit janë të bllokuara. `npm approve-scripts @prisma/engines prisma esbuild`
dhe pastaj `npm install` përsëri.

**`Can't reach database server at localhost:5432`**
`docker compose ps db` — duhet `healthy`. Nëse jo: `docker compose up -d db`.

**Faqja jep 500 pas ndryshimit të skemës**
`npm run db:generate`, pastaj `npm run db:deploy`. Klienti i Prisma-s nuk është në repo
dhe nuk rigjenerohet vetë.

**`emailDelivered: false` në përgjigjen e ftesës**
E pritshme. Pa `SMTP_HOST`, mesazhi ndërtohet dhe shkruhet në log në vend që të dërgohet —
linku i ftesës merret nga `inviteUrl` e përgjigjes. `sendMail` nuk gënjen kurrë se dërgoi.

**`npm run build` dështon me gabime tipi**
Ka **32 gabime `tsc`** të parandodhura, kryesisht tipi `Tx` i transaksionit kundrejt
Prisma 7 (`$on` që mungon) dhe dy `groupBy` që duan `orderBy` në tip. `npm run dev`
punon pa u ndikuar (Turbopack nuk bllokon te tipat), por `next.config.ts` **nuk** ka
`ignoreBuildErrors`, ndaj build-i i prodhimit ndalon. Duhet rregulluar përpara nisjes.

---

## 10. Çfarë nuk ekziston ende

Që të mos raportohen si bug:

- **`/settings`** — rruga është e rezervuar për Super Admin, por faqja nuk është ndërtuar.
  Po ashtu pa `business_profile`.
- **Preferencat e njoftimeve** kanë API (`/api/notifications/preferences`) por **pa UI**.
  Parazgjedhja për të gjithë: në aplikacion `on`, email `INSTANT`.
- **Dërgimi i email-eve** duhet `SMTP_*` te `.env`; pa të shkon në log.
- **Dashboard-i lexon drejtpërdrejt** nga tabelat, jo nga `revenue_summaries`.
  Agregati ndërtohet nga worker-i, por leximet nuk kaluan mbi të.
- **Numri i faturës nuk është unik** — dy fatura me `F-001` pranohen me qëllim.
- **`DIGEST_CRON` dhe `MONTHLY_REPORT_CRON`** nuk janë te `.env.example`;
  kanë parazgjedhje (`0 6 * * *`, `30 6 1 * *`), ndaj punojnë pa u shkruar.
