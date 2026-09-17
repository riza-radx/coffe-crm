# Rei CRM — Faza 1 (Foundation)

> **Do ta ngresh dhe ta provosh?** Shko te **[TESTIM.md](TESTIM.md)** — ngritja hap pas hapi,
> kredencialet e hyrjes, çfarë shikon secili rol, dhe scenarët për t'i klikuar.
> Ky dokument shpjegon **pse** është ndërtuar kështu, jo si nis.

Menaxhim shitjesh dhe kontratash për Rei (kafe → bare, restorante, hotele, zyra, shtëpi).
Ky repo mbulon **Fazat 1–3** të planit teknik: bazën e të dhënave, hyrjen me ftesë,
RBAC-un, modulet e klientëve, kontratave e faturave, dhe logjikën e parave
(verifikim fature → komision i ngrirë → aprovim → pagesë). Dashboard-et e analitika
(Faza 4) dhe njoftimet (Faza 5) vijnë më pas.

## Stack

Next.js 16 (App Router, React 19, TypeScript) · PostgreSQL 16 · Prisma 7 ·
Auth.js (next-auth v5) · Tailwind v4 · Zod 4 · react-hook-form · Vitest · Docker

## Ngritja lokale

```bash
cp .env.example .env
npx auth secret                 # shkruan AUTH_SECRET te .env

docker compose up -d db         # Postgres 16 në localhost:5432
npm install
npx prisma generate             # detyrim: klienti nuk është në repo
npx prisma migrate deploy       # aplikon prisma/migrations
npx prisma db seed              # krijon Super Admin-in nga .env
npm run dev                     # http://localhost:3000
```

Hyr me `SEED_SUPER_ADMIN_EMAIL` / `SEED_SUPER_ADMIN_PASSWORD`, shko te `/users`,
krijo një ftesë, hap linkun `/invite/<token>` dhe vendos fjalëkalimin.

## Komandat

| Komanda | Çfarë bën |
|---|---|
| `npm run dev` | Serveri i zhvillimit |
| `npm run build` / `npm start` | Build prodhimi (standalone) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Testet Vitest (292 teste) |
| `npm run db:migrate` | Migrim i ri gjatë zhvillimit |
| `npm run db:deploy` | Aplikon migrimet (prodhim) |
| `npm run db:seed` | Seed-i i Super Admin-it |
| `npm run db:verify` | Kontroll i skemës kundrejt Postgres-it, pa Prisma (shih më poshtë) |

`db:verify` e bën TRUNCATE tabelave, ndaj refuzon të ekzekutohet veç nëse emri i
bazës mbaron me `_test` ose `_dev`:

```bash
DATABASE_URL="postgresql://rei:rei_dev_password@localhost:5432/rei_crm_test" npm run db:verify
```

## Struktura

```
prisma/
  schema.prisma                 6 modele: User, Client, Contract, Bill, Commission, Invite
  migrations/                   migrimi fillestar (SQL)
  seed.ts                       një Super Admin
scripts/verify-schema.mjs       kontrolle skemë-nivel me `pg` (pa klient Prisma)
src/
  auth.config.ts                gjysma pa-Prisma e Auth.js (gating i faqeve)
  auth.ts                       Credentials provider + callback-et jwt/session
  proxy.ts                      Next 16: zëvendëson middleware.ts
  lib/rbac/                     matrica e seksionit 7, can(), ownerFilter(), canAccessPath()
  lib/auth/dal.ts               requireUser() — e vetmja rrugë për të mësuar kush është thirrësi
  lib/auth/guards.ts            withAuth() → 401/403 për route handler-at
  lib/{db,password,invites,env}.ts
  lib/validation/auth.ts        skemat Zod, të njëjtat në klient dhe server
  app/api/auth/{[...nextauth],invite,accept-invite}/
  app/api/users/
  app/{login,invite/[token],dashboard,users}/
tests/                          rbac, routes, invites, password, api-rbac
```

## Vendimet e Fazës 1 (dhe pse)

**Vetëm 6 tabela.** `business_profile`, `audit_logs`, `notifications` dhe
`revenue_summaries` nuk hyjnë në këtë fazë. Mutacionet e Fazës 1 (krijim/pranim
ftese) kalojnë në `prisma.$transaction`, kështu që lidhja e auditit në Fazën 4
është shtesë, jo rishkrim.

**Emrat fizikë në snake_case.** Modelet Prisma mbajnë emrat camelCase të planit;
tabelat dhe kolonat mapohen te emrat snake_case të seksionit 2 (`users`,
`password_hash`, `sales_owner_id`, …) me `@@map` / `@map`.

**`password_hash` është nullable.** Një përdorues i ftuar ekziston me status
`INVITED` pa fjalëkalim derisa të hapë linkun e ftesës.

**Sesione JWT, jo sesione në bazë.** Plani kërkon "database sessions for easy
revocation", por Credentials provider-i i Auth.js punon vetëm me JWT dhe një
tabelë sesionesh nuk hyn në këtë fazë. Zëvendësimi është dy-nivelor:

- `callbacks.jwt` rilexon `users.status`/`role` nga baza çdo `SESSION_REVALIDATE_SECONDS`
  (parazgjedhje 30) dhe kthen `null` — pra heq token-in — nëse llogaria nuk është `ACTIVE`.
  Është i ngadalësuar me qëllim, sepse ky callback ekzekutohet edhe për prefetch-e.
- `requireUser()` në DAL rilexon `status`/`role` në **çdo** kërkesë reale, pa kufizim.
  Pra pezullimi i një llogarie ndalon menjëherë çdo gjë që lexon ose shkruan të dhëna,
  dhe një ndryshim roli zë vend pa rihyrje.

Nëse duhet revokim i menjëhershëm edhe në navigim, vendos `SESSION_REVALIDATE_SECONDS=0`.

**RBAC në dy shtresa.** `proxy.ts` bën vetëm gating të përafërt të faqeve nga cookie-ja
(pa bazë të dhënash, sepse ekzekutohet në çdo navigim). Vendimet reale janë në
route handler-at dhe server action-et me `can(user, action, resource)`; lista e
"vetëm të mijat" injektohet me `ownerFilter()` në nivel query-je.

**Qelizat e konfigurueshme.** `OUTSIDE_SALES_CAN_CREATE_CONTRACT` (parazgjedhje
`false`) dhe `OUTSIDE_SALES_CLIENT_REQUIRES_APPROVAL` (parazgjedhje `false`)
mbulojnë dy qelizat që plani i shënon "configurable" / "may require approval".

**Dërgimi i ftesave me email** është Faza 5. Tani `POST /api/auth/invite` kthen
`inviteUrl` në përgjigje.

## Endpoint-et e Fazës 1

```
POST /api/auth/invite          Super Admin → krijon user INVITED + token
POST /api/auth/accept-invite   publik, i mbrojtur me token njëpërdorimsh
GET  /api/users                Super Admin, gjithmonë me faqosje
     /api/auth/[...nextauth]   login/logout/session (Auth.js)
```

Auth.js i trajton login-in dhe logout-in te `/api/auth/callback/credentials` dhe
`/api/auth/signout`, jo te `POST /api/auth/login` / `/logout` si i emërton plani —
ky është i njëjti kontratë, me rrugët standarde të bibliotekës.

---

# Faza 2 — Core CRUD

## Endpoint-et e shtuara

```
GET    /api/clients            ?search=&type=&city=&salesOwner=&status=&sort=&page=&pageSize=
POST   /api/clients
GET    /api/clients/:id        klient + kontratat + faturat + totalet
PATCH  /api/clients/:id

GET    /api/contracts          ?clientId=&status=&salesOwner=&sort=&page=&pageSize=
POST   /api/contracts
GET    /api/contracts/:id
PATCH  /api/contracts/:id      edit + kalimi DRAFT→ACTIVE

GET    /api/bills              ?contractId=&clientId=&status=&dateFrom=&dateTo=&sort=&page=
POST   /api/bills
GET    /api/bills/:id
```

`sort` është `<fushë>:asc|desc` me **allowlist** për fushë — nuk shkon kurrë string i
lirë te `orderBy` i Prisma-s. `pageSize` kufizohet në 100; asnjë listë nuk kthehet e pakufizuar.

## Faqet

`/clients` (listë + formular shtimi) · `/clients/[id]` · `/contracts` · `/contracts/new` ·
`/contracts/[id]` (me butonin DRAFT→ACTIVE) · `/bills` · `/bills/new`

## Tabela server-driven

TanStack Table **v9** (`useTable`, `tableFeatures`, `table.FlexRender`) me
`manualPagination` + `manualSorting` dhe **pa** row-model-e klienti: Postgres bën
renditjen dhe ndarjen në faqe, `data` është saktësisht faqja.

Gjendja e tabelës **rrjedh nga URL-ja**, nuk pasqyrohet në `useState` dhe nuk shkruhet
kurrë nga një `useEffect` — `src/lib/table/table-url-state.ts` është bërthama e pastër
(e testuar) dhe `use-table-url-state.ts` vetëm e lidh me `useSearchParams` dhe
`history.pushState`. Kjo është arsyeja pse filtrat janë të ndashëm si link dhe pse
tabela nuk bie në cikël render-i.

TanStack Query (v5) mban cache-in dhe e pavalidon pas mutacioneve. Klienti i query-ve
është singleton në browser dhe i freskët për kërkesë në server, dhe `clearQueryCache()`
thirret në daljen nga llogaria sepse përgjigjet e listave janë të skopuara sipas rolit.

## Rregullat e biznesit të zbatuara

- Kontrata krijohet **gjithmonë** si `DRAFT`; komisioni % ngrihet në krijim.
- `PATCH` e statusit kalon nga makina e gjendjeve të seksionit 6. Faza 2 ekspozon vetëm
  `DRAFT→ACTIVE`; kalimet e tjera legale kthejnë `TRANSITION_NOT_AVAILABLE_YET`, ato
  ilegale `TRANSITION_INVALID_TRANSITION` (409).
- Komisioni % mund të ndryshohet vetëm nga Super Admin (`403` për të tjerët).
- Faturë vetëm mbi kontratë **ACTIVE** (`409 CONTRACT_NOT_ACTIVE`).
- Sales / Outside Sales faturojnë vetëm kontratat ku janë `salesOwnerId`; kontrata e
  një tjetri raportohet si `404`, jo `403`, që të mos zbulohen ID-të e të tjerëve.
- `clientId` dhe `enteredById` e faturës merren nga kontrata dhe nga sesioni, nuk merren kurrë nga kërkesa.

## Vendime dhe supozime të Fazës 2

- **`audit_logs` mbetet për Fazën 4** (zgjedhja jote). Mutacionet e kësaj faze nuk
  shkruajnë gjurmë; veprimi "amend" i komisionit % zbatohet dhe kufizohet, por pa log.
- **Pronësia e klientit është `acquired_by`** (zgjedhja jote): Outside Sales sheh
  klientët që ka sjellë ai.
- **Faturat trashëgojnë dukshmërinë e kontratës** — tabela RBAC nuk ka rresht për
  faturat, dhe çdo faturë varet nga saktësisht një kontratë. Prandaj Sales (që sheh
  të gjitha kontratat) sheh të gjitha faturat.
- **Scoping-u bashkohet me `AND`**, jo me spread: kështu një `?salesOwner=` në URL nuk
  mund të mbishkruajë filtrin e pronësisë. Ka test për këtë.
- **Editimi i klientit** kalon në të njëjtën leje si shikimi, sepse tabela RBAC nuk ka
  rresht "edit client"; scope-i vendos. Rikalimi i një klienti te një përfaqësues tjetër
  (`acquiredById`) lejohet vetëm për Super Admin — plani nuk e trajton këtë rast.
- **Numri i faturës nuk është unik** në skemë, ndaj nuk zbatohet unicitet në kod.
- `/users` e Fazës 1 mbetet me tabelën e vjetër të thjeshtë; wrapper-i i ri përdoret nga
  klientët, kontratat dhe faturat, siç i përmend plani.

---

# Faza 3 — Logjika e parave

## Endpoint-et e shtuara

```
PATCH  /api/bills/:id              korrigjim vetëm sa është PENDING
POST   /api/bills/:id/verify       ngrin komisionin
POST   /api/bills/:id/dispute      { reason? } — kthen komisionin PENDING
POST   /api/bills/:id/void         { reason? }

GET    /api/commissions            ?salesUserId=&status=&period=YYYY-MM&sort=&page=
POST   /api/commissions/:id/approve
POST   /api/commissions/:id/pay
POST   /api/commissions/batch-approve   { ids[] } ose { salesUserId?, period? }
```

## Formula dhe ngrirja

```
commission_amount = bill.amount × contract.commission_percentage
```

Llogaritet **një herë**, në momentin që fatura kalon në `VERIFIED`, dhe përqindja
kopjohet në `commission_percentage_snapshot`. Asgjë më vonë nuk e rillogarit: aprovimi
dhe pagesa prekin vetëm statusin. Nëse kontrata ndryshon përqindje pas ngrirjes,
komisionet ekzistuese mbeten të pacenuara — ka test për këtë.

Aritmetika bëhet me `BigInt` mbi njësi minore (`src/lib/money/fixed-point.ts`); asnjë
shumë nuk kalon kurrë nëpër `Number`. Rrumbullakimi është **half-up** në 2 dhjetore,
i aplikuar një herë, mbi prodhimin final — njësoj si `numeric` i Postgres-it, e
verifikuar kundrejt tij.

## Makinat e gjendjeve

```
Fatura:    PENDING → VERIFIED | DISPUTED | VOID
           VERIFIED → DISPUTED | VOID          (komisioni kthehet prapa)
           DISPUTED → VERIFIED | VOID          (kontestim i zgjidhur; snapshot i ri)
           VOID → —

Komisioni: PENDING → APPROVED → PAID
```

## Rregullat e biznesit të zbatuara

- Verifikimi krijon komisionin brenda të njëjtit transaksion me kalimin e faturës.
- `sales_user_id` merret nga `contract.sales_owner_id`, kurrë nga kërkesa.
- Kontestimi ose anulimi i një fature të verifikuar **fshin** komisionin — por vetëm
  nëse ai është ende `PENDING`. Nëse është `APPROVED` ose `PAID`, i gjithë kalimi
  refuzohet me `409 COMMISSION_LOCKED`.
- Pagesa kërkon aprovim paraprak (`PENDING → PAID` është `409`).
- Aprovimi/pagesa refuzohen nëse fatura nuk është më `VERIFIED` (`409 BILL_NOT_VERIFIED`).
- Konkurrenca zgjidhet me `updateMany` të kushtëzuar nga statusi i lexuar (`409
  BILL_CONCURRENT_MODIFICATION` / `COMMISSION_CONCURRENT_MODIFICATION`), pa lock-e.
- Aprovimi në grup është një transaksion i vetëm; ID-të e papranueshme kthehen te
  `skipped` në vend që të rrëzojnë grupin, dhe një filtër që kap mbi 500 rreshta
  refuzohet me `409 BATCH_TOO_LARGE`.

## Audit

`audit_logs` erdhi në këtë fazë (zgjedhja jote). `writeAudit(tx, …)` merr klientin e
transaksionit dhe **nuk** importon `prisma` — kështu një gjurmë nuk shkruhet dot jashtë
transaksionit që përshkruan, dhe një mutacion i refuzuar nuk lë gjurmë fare. Testet e
verifikojnë këtë mekanikisht, jo me lexim kodi.

Një komision i fshirë mbijeton te gjurma: `entity_id` nuk ka çelës të huaj, dhe `diff.before`
mban vlerat e fshira. `approved_at`/`approved_by` nuk ekzistojnë si kolona në plan —
kush aprovoi dhe kur lexohet nga `audit_logs`.

## Faqet

`/commissions` (totale për status, filtra, aprovim/pagesë, aprovim në grup) ·
`/bills/[id]` (veprimet verify/dispute/void + karta e komisionit) · kolona e komisionit
te `/bills`.

## Vendime dhe supozime të Fazës 3

- **Kush e sheh listën e komisioneve**: tabela e seksionit 7 nuk ka rresht për këtë.
  `viewAll:commission` u shtua si Super Admin = të gjitha, Sales dhe Outside Sales =
  vetëm të vetat, sepse një rresht komisioni është pagesë personale. Renditja
  (leaderboard) mbetet siç është.
- **Verifikimi nuk rikontrollon statusin e kontratës.** Fatura u krijua mbi një kontratë
  `ACTIVE`; nëse kontrata skadon para verifikimit, paraja është prapë e fituar.
- **`DISPUTED → VERIFIED` lejohet.** Ri-verifikimi merr snapshot **të ri** të përqindjes
  aktuale — i vetmi vend ku një amendim i përqindjes ndryshon një pagesë. Prandaj të dy
  hapat logohen me vlerat paraardhëse.
- **"Muaji i mbyllur"** nuk ka tabelë periudhash në këtë fazë; përkthehet si "tashmë i
  aprovuar/paguar" — një komision i tillë nuk kthehet më prapa.
- **Periudha llogaritet mbi `bills.bill_date`** (UTC), jo mbi `commissions.created_at`:
  një faturë e verifikuar me vonesë nuk duhet të rrëshqasë në pagesën e muajit tjetër.
  Lista dhe aprovimi në grup përdorin të njëjtin resolver.
- **Arsyeja e kontestimit/anulimit** nuk ka kolonë; ruhet brenda `diff` të auditit.
- **Editimi i faturës** përdor lejen "Add bill" (own për të dy rolet e shitjes), ndaj
  Outside Sales korrigjon faturën e vet pa pasur të drejtë ta verifikojë.

---

# Faza 4 — Dukshmëria

## Endpoint-et e shtuara

```
GET /api/analytics/leaderboard          ?period=YYYY | YYYY-MM | YYYY-Qn
GET /api/analytics/revenue              ?groupBy=client|salesRep|month&from=&to=&limit=
GET /api/analytics/commissions/summary
GET /api/audit-logs                     ?entityType=&entityId=&actorId=&action=&dateFrom=&dateTo=&page=
```

## Kush sheh çfarë te renditja

Portieri i rrugës është `viewAll:commission` — i lejuar për të tre rolet — sepse
`viewFull:leaderboard` do ta kthente Outside Sales-in me 403 edhe nga shifrat e veta.
Forma e përgjigjes vendoset brenda `getLeaderboard`, nga `viewFull:leaderboard`:

- **Super Admin / Sales** marrin tabelën e plotë me emra.
- **Outside Sales** merr saktësisht një rresht — të vetin — plus `self: { rank, of }`.
  Rreshti ndërtohet nga e para, nuk është lista e plotë me fusha të hequra, dhe testi
  e verifikon duke kërkuar emrat e të tjerëve në të gjithë `JSON.stringify(body)`.

Renditja llogaritet mbi **të gjithë** përfaqësuesit dhe pastaj redaktohet. Alternativa
— të pyesësh vetëm shifrat e thirrësit dhe ta nxjerrësh vendin me një `COUNT` — do ta
shkruante rregullin e renditjes në dy vende, dhe ditën që ato nuk pajtohen, një Outside
Sales lexon "#3 nga 8" ndërsa ekrani i admin-it e ka të katërtin.

## SQL-ja e vetme e shkruar me dorë

`bills` s'ka kolonë përfaqësuesi — atribuimi kalon nga `bills.contract_id →
contracts.sales_owner_id` — ndaj `groupBy` i Prisma-s nuk e shpreh dot "të ardhurat
sipas përfaqësuesit". `src/lib/queries/analytics-sql.ts` është i vetmi vend me SQL të
shkruar, dhe është **funksion i pastër**: pa import baze të dhënash, ndaj testi që
pohon se `sales_owner_id` është në `WHERE` e pohon mbi vetë tekstin e query-t, jo mbi
një mock që mund të gabojë në të njëjtin drejtim si kodi.

Asgjë nga thirrësi nuk hyn në tekst: tri shprehjet e grupimit janë konstante moduli të
zgjedhura nga një enum Zod, çdo vlerë është parametër `$n`. `SUM(...)::text` dhe
`COUNT(*)::int` janë të detyrueshme — pa to `numeric` vjen si float dhe `count` si
`BigInt`, që e rrëzon `JSON.stringify`.

## Periudhat

`src/lib/validation/period.ts` mban një resolver për muaj, tremujor dhe vit; `Date.UTC`
e kalon vetë muajin 12 në janarin pasardhës, ndaj dhjetori dhe Q4 s'kanë rast të veçantë.
`PeriodSchema` i Fazës 3 **nuk** u zgjerua: e ndan me `BatchApproveSchema`, ku një
periudhë është rrezja e shpërthimit të një kliku.

## Auditi në të gjitha mutacionet

Faza 3 solli `audit_logs`; Faza 4 lidh edhe mutacionet e Fazave 1–2. Krijimi dhe
përditësimi i klientit dhe i kontratës kaluan në transaksion, sepse një gjurmë nuk
shkruhet dot jashtë transaksionit që përshkruan.

- Një `PATCH` kontrate jep **deri në tre** gjurmë të veçanta: `STATUS_CHANGE`, amendimi
  i përqindjes (`diff.amend = "commissionPercentage"`) dhe redaktimet e zakonshme.
  Kështu "kush e ndryshoi përqindjen" është një query mbi `action`, jo skanim diff-esh.
- Një `PATCH` që nuk ndryshon asgjë nuk shkruan gjurmë.
- Ftesa logon përdoruesin e krijuar, **jo** token-in; pranimi i ftesës logon aktivizimin
  me `actor_id` = vetë i ftuari (s'ka sesion ende), pa fjalëkalimin.

## Faqet

`/dashboard` (i skopuar sipas rolit: totale, trend 12-mujor, klientët kryesorë, vendi yt) ·
`/leaderboard` (filtër periudhe në URL) · `/audit-logs` (vetëm Super Admin, vetëm lexim)

## Grafikët

SVG i gjeneruar në server, pa bibliotekë grafikësh dhe pa JavaScript klienti — plani
përmend recharts, kjo është shmangia e vetme prej tij dhe u zgjodh që faqet të mbeten
Server Components. Paleta është një grup i vetëm token-esh te `globals.css`, e
validuar në të dyja modet: ΔE ngjyrash ngjitur 24.7 (dritë) / 26.8 (errët) për
daltonizëm, ≥3:1 kontrast, rampa ordinale monotone në ndriçim. Shtresa e hover-it
janë `<title>` mbi çdo shenjë, dhe çdo grafik ka pamjen e tij në tabelë.

## Vendime dhe supozime të Fazës 4

- **`/reports` mbetet jashtë kësaj faze** (zgjedhja jote): analitika e Fazës 4 rri te
  dashboard-i dhe te renditja.
- **`revenue_summaries` nuk u ndërtua.** Plani e vendos punën e natës te Faza 5, ndaj
  agregimet janë të drejtpërdrejta, të kufizuara nga dritarja (maks. 731 ditë) dhe nga
  `limit` (maks. 100).
- **Të ardhurat = fatura jo-VOID**, e njëjta paravendje si totalet te kartat e klientit
  dhe të kontratës — që shifra e analitikës të mos bjerë ndesh me asnjë ekran tjetër.
- **Skopimi i `groupBy=client` bëhet sipas `sales_owner_id`, jo `acquired_by`.** Një
  faturë trashëgon dukshmërinë e kontratës së vet; sipas `acquired_by` një përfaqësues
  do të shihte të ardhura nga kontrata që s'i zotëron.
- **Nuk u shtua indeks.** Çdo query e analitikës filtron `bill_date` dhe bashkon
  `contracts`; `bills(bill_date, status)` do ta ndihmonte, por një indeks i ri është
  migrim — matje mbi të dhëna reale dhe pastaj Faza 5.
- **`GET /api/audit-logs` s'ka shkrues.** Moduli eksporton vetëm `GET`.

# Faza 5 — Polish për nisje

## Endpoint-et e shtuara

```
POST  /api/contracts/:id/renew          { startDate, endDate?, commissionPercentage?, ... }
POST  /api/contracts/:id/terminate      { reason }            (arsyeja është e detyrueshme)
GET   /api/notifications                ?unread=true|false&type=&page=&pageSize=
PATCH /api/notifications/:id/read
GET   /api/commissions?format=csv       (të njëjtat filtra si lista — pasqyra e komisioneve)
```

## Cikli i kontratës: kush e hap cilën derë

Diagrami i seksionit 6 nuk ndryshoi; ajo që u shtua është **kanali**. Një kalim i
ligjshëm nuk është i ligjshëm nga çdo derë:

| Kalimi | Kanali | Pse |
| --- | --- | --- |
| `DRAFT → ACTIVE` | `PATCH /api/contracts/:id` | s'ka të dhëna shtesë për të bartur |
| `ACTIVE → RENEWED` | `POST .../renew` | duhet kontrata pasardhëse |
| `ACTIVE → TERMINATED` | `POST .../terminate` | duhet arsyeja |
| `ACTIVE → EXPIRED` | vetëm puna e natës | seksioni 6: kalim automatik, jo veprim njeriu |

`checkTransition(from, to, channel)` i përgjigjet të dyjave, dhe `channel` ka si
parazgjedhje `"patch"` — një thirrës që e harron merr derën më të ngushtë, jo më të
gjerën. Një kalim përmes derës së gabuar kthen `TRANSITION_WRONG_CHANNEL` (409), i
ndarë nga `TRANSITION_INVALID_TRANSITION`, që do të thotë "jo në diagram".

**Rinovimi** bën të dyja lëvizjet në një transaksion, ndaj një klient nuk mbetet as me
dy kontrata ACTIVE as pa asnjë. Pasardhësja krijohet `DRAFT` dhe aktivizohet po aty
përmes së njëjtës makinë gjendjesh — rruga e vetme për në ACTIVE mbetet `DRAFT→ACTIVE`,
dhe auditi i tregon të dy hapat. `previous_contract_id` është unik, ndaj rinovimi i
dytë i së njëjtës kontratë kthen `ALREADY_RENEWED` në vend të një gabimi 500.
Përqindja trashëgohet; ta ndryshosh është amendim, pra vetëm Super Admin.

**Ndërprerja** kërkon një arsye ≥5 karaktere. Arsyeja **nuk** u bë kolonë e re: seksioni
2 i rendit kolonat e `contracts` dhe asnjëra s'është arsye ndërprerjeje, ndërsa
`audit_logs` ekziston pikërisht për "kush, kur, me çfarë" — pra shkon te `diff.reason`.

## Njoftimet

`notifications` shkruhet **brenda** transaksionit që e shkaktoi, njësoj si `audit_logs`:
një aprovim i rrëzuar nuk lë "komisioni u aprovua" në asnjë zile. Email-i është e
kundërta — nuk duhet të jetë brenda transaksionit, sepse një timeout SMTP do të
rrëzonte një aprovim krejt në rregull. Ndaj `writeNotifications` kthen id-të që duan
email dhe thirrësi i vendos në radhë **pasi** transaksioni ka bërë commit.

| Ngjarja | Kush njoftohet |
| --- | --- |
| Komisioni APPROVED / PAID | përfaqësuesi i komisionit |
| Fatura DISPUTED | pronari i kontratës |
| Kontrata skadon për ≤30 ditë / skadoi | pronari i kontratës |
| Ftesa u pranua | admin-i që e dërgoi |

Aprovimi në grup shkruan një njoftim për çdo komision, jo një përmbledhje: zilja është
personale dhe "12 komisione u aprovuan" fsheh se cilat.

Akses: `view:notification` është rresht i **prejardhur**, jo i tabelës së seksionit 7 —
skopi është `own` për të tre rolet, Super Admin përfshirë. Askush nuk lexon zilen e
tjetrit, dhe kjo zbatohet nga `WHERE user_id = ...`, jo nga një kontroll roli.

## Email-i

`src/lib/email/mailer.ts` është një transport i vetëm për procesin. Pa `SMTP_HOST`,
mesazhi ndërtohet ashtu si do të dërgohej dhe shkruhet në log (`streamTransport` i
nodemailer): makina e zhvillimit dhe testet s'kanë nevojë për server, dhe një
konfigurim që mungon në prodhim është i zhurmshëm, jo i heshtur. `sendMail` kthen
`{ delivered }` dhe nuk gënjen kurrë se dërgoi.

Ftesa tashmë dërgohet me email (Faza 1 e la si TODO). Lidhja mbetet edhe në përgjigjen e
API-t, me `emailDelivered`, që admin-i ta përcjellë vetë kur dërgimi dështon.

## Worker-i (pg-boss)

Proces i dytë nga **i njëjti image** (`target: worker` në Dockerfile, `npm run worker`
lokalisht), jo një fije brenda Next-it: instancat web shtohen e rifillohen me trafikun,
dhe një punë e planifikuar që bëhet një herë për instancë është punë që bëhet tri herë.

| Radha | Kur | Çfarë bën |
| --- | --- | --- |
| `contracts.daily-sweep` | `NIGHTLY_CRON` (UTC) | ACTIVE me `end_date` të kaluar → EXPIRED; paralajmërim për ato brenda `CONTRACT_EXPIRY_WARNING_DAYS` |
| `summaries.nightly-rollup` | 15 min më vonë | rimbush `revenue_summaries` për muajin e kaluar dhe këtë |
| `notifications.email` | sipas ngjarjes | dërgon një njoftim me email, i ngarkuar nga id-ja |

Gjithçka është idempotente, sepse ajo që premton një radhë është *at-least-once*:
fshirja rilexon statusin para se ta lëvizë kontratën (`updateMany ... WHERE status =
'ACTIVE'`, dhe `count !== 1` do të thotë "dikush e lëvizi i pari — fiton ai"), rollup-i
bën upsert, dhe puna e email-it mban një id njoftimi, jo një mesazh të gatshëm.
Paralajmërimi dërgohet **një herë për dritare**: pyetja "a e kam njoftuar tashmë" i
përgjigjet vetë të dhënave (a ka njoftim `CONTRACT_EXPIRING` për atë kontratë që nga
`end_date - N`), jo një kursori që mund të humbasë.

Aktori i skadimit është `null`. Një kontratë që skadon nuk u skadua *nga* askush, dhe
`audit_logs.actor_id` u bë i anulueshëm pikërisht për këtë.

## `revenue_summaries`

Agregati i natës i seksionit 9, një rresht për `(grain, subject, month)` — të ardhurat
për klient dhe totalet e komisionit për përfaqësues. Llogaritet nga **i njëjti**
`buildRevenueGroupSql` që përdor analitika e drejtpërdrejtë: një query e dytë këtu do të
ishte një përkufizim i dytë i "të ardhurave", i lirë të largohej nga i pari nga një
faturë VOID ose një join, ndërsa ndarja e builder-it i bën të dyja të njëjtën shprehje
mbi të njëjtin muaj, të ndryshme vetëm nga koha kur u ekzekutuan.

Muaji i kaluar rrotullohet sërish bashkë me këtë: një faturë e futur me vonesë, ose një
kontestim i zgjidhur më 2-shin, ndryshon një muaj që tashmë quhej "i mbyllur".

## Eksporti CSV

`format=csv` është një **paraqitje e listës**, jo endpoint i dytë: i njëjti handler, i
njëjti scope, i njëjti resolver periudhe — ndaj eksporti s'mund të nxjerrë kurrë një
rresht që lista do ta fshihte. Dritarja e faqeve hiqet (një pasqyrë pa faqen 2 nuk është
pasqyrë) dhe në vend të saj vjen `CSV_EXPORT_LIMIT = 5000`; një skedar i prerë e thotë
me `x-export-truncated: true`, nuk kalon për të plotë.

Shkrimi është RFC 4180 me CRLF dhe BOM (pa BOM, Excel-i lexon "Përfaqësuesi" si
mojibake), dhe një fushë që nis me `= + - @` merr një apostrof përpara: një klient i
quajtur `=cmd|...` është shfrytëzim i spreadsheet-it, jo emër klienti.

## Faqet

`/contracts/[id]` fiton veprimet Rinovo / Ndërpre (vetëm kur kontrata është ACTIVE dhe
roli i lejon — serveri rikontrollon gjithsesi) dhe lidhjen te kontrata e mëparshme ·
`/dashboard` fiton zilen me numëruesin dhe listën · `/commissions` fiton lidhjen e
pasqyrës CSV.

## Vendime dhe supozime të Fazës 5

- **Arsyeja e ndërprerjes shkon te auditi, jo te një kolonë e re** (shih më lart).
- **`notifications.entity_type` ripërdor `AuditEntityType`** në vend të një kopjeje të
  dytë të po atyre pesë vlerave; të dyja kolonat i përgjigjen "për cilin rekord bëhet
  fjalë".
- **`revenue_summaries` nuk ka çelës të huaj** te `clients`/`users`: një përmbledhje
  historike duhet t'i mbijetojë rreshtit që përshkruan. `commission_*` ka kuptim vetëm
  në grain-in `SALES_REP` dhe rri 0 për rreshtat `CLIENT`.
- **Dashboard-i ende lexon drejtpërdrejt.** Tabela dhe puna e natës u ndërtuan; kalimi i
  leximeve mbi to është optimizim që duhet matur mbi të dhëna reale, jo i detyruar tani.
- **Shënimi si i lexuar nuk shkruan audit.** Nuk ndryshon para, status, as pamjen e
  askujt tjetër — dhe është idempotent: klikimi i dytë s'është 409.
- **Ende pa `/settings` dhe `business_profile`** (jashtë shtrirjes së kësaj faze), dhe
  pa `/reports`.
- **Worker-i duhet të ketë një replikë të vetme.** Dy replika i bëjnë të gjitha punët e
  planifikuara dy herë; `docker-compose.yml` e thotë këtë te shërbimi `worker`.
- **Prisma duhet të rigjenerohet** pas migrimit të kësaj faze: `npm run db:generate`,
  pastaj `npm run db:deploy`.

# Faza 6 — Post-MVP

## Endpoint-et e shtuara

```
GET /api/notifications/preferences
PUT /api/notifications/preferences     { preferences: [{ type, inApp, email }] }

GET /api/commissions?format=pdf                          (pasqyra e komisioneve)
GET /api/analytics/revenue?...&format=csv|pdf            (të ardhurat sipas klientit)
GET /api/contracts?expiringBefore=YYYY-MM-DD&format=csv|pdf   (kontratat që skadojnë)
```

Asnjë endpoint i ri për raportet: `format` është një **paraqitje** e listës që
ekziston, dhe `expiringBefore` është një predikat më shumë. Kështu një eksport nuk
mund të nxjerrë kurrë një rresht që ekrani do ta fshihte — është i njëjti handler,
i njëjti scope, i njëjti resolver periudhe.

## Preferencat e njoftimeve

Një rresht për çift `(përdorues, tip)`. **Rreshti që mungon nuk është "pa
preferencë" — është parazgjedhja** që çdo përdorues kishte para se tabela të
ekzistonte (në-app po, email menjëherë). Prandaj tabela nis bosh dhe asgjë nuk
ndryshon për dikë që s'i hap kurrë cilësimet; dhe një rresht që kthehet te
parazgjedhja fshihet, që "pa rresht" dhe "parazgjedhje" të mos ndahen kurrë në
kuptim.

| Çelësi | Çfarë bën |
| --- | --- |
| `in_app` | fsheh tipin nga zilja — **nuk** e ndalon shkrimin e rreshtit |
| `email: INSTANT` | email në momentin e ngjarjes (sjellja e Fazës 5) |
| `email: DIGEST` | asnjë email atëherë; hyn te përmbledhja e nesërme |
| `email: OFF` | asnjë email, kurrë |

`in_app` është filtër në lexim, jo në shkrim, sepse njoftimi është *dëshmia* se
ngjarja ndodhi dhe një email duhet të mund t'i drejtohet. Numëruesi i palexuarave
përdor të njëjtin filtër si lista — përndryshe distinktivi mbijeton rreshtat e vet.

Aksesi: `view:notification` mbetet `own` për të tre rolet, dhe të dy veprimet e
preferencave punojnë mbi rreshtat e vetë thirrësit — s'ka parametër që të tregojë
nga cilësimet e dikujt tjetër. Ruajtja është zëvendësim i plotë në një transaksion:
një formular gjysmë i ruajtur është pikërisht mënyra si dikush mbetet pa shpjegim
pse një email ende vjen.

Përmbledhja ditore mbulon një **ditë të tërë UTC**, jo "që nga hera e fundit": një
datë është e riprodhueshme, ndaj një natë e humbur rihapet për atë datë dhe jep
saktësisht të njëjtin email. Çmimi është se një rilëshim e dërgon dy herë — e cila
është ana e duhur e gabimit, sepse një dublikatë duket, një boshllëk i heshtur jo.

## PDF-të

`pdfkit`, me Helvetica-n e vet: kodimi WinAnsi mbulon ë dhe ç, ndaj nuk futet
asnjë font në image. Një renderues i vetëm për të tri raportet — titull, periudhë,
tabelë, total — sepse tri renderues do të thoshin tri tipografi që largohen nga
njëra-tjetra. Koka e tabelës përsëritet në çdo faqe, numri i faqes shkruhet duke
ulur përkohësisht margjinën (ndryshe pdfkit hap faqe të re për vetë numrin e
faqes, e cila kërkon numrin e vet, e kështu me radhë).

Raporti mujor është i njëjti renderues me dy seksione, i gjeneruar nga job-i i
pg-boss më 1 të muajit dhe i dërguar si bashkëngjitje te çdo Super Admin aktiv.
Ai lexon `revenue_summaries`, jo faturat: rrotullimi i natës tashmë i përgjigjet
së njëjtës pyetje, dhe ta bësh dy herë është mënyra si dy dokumente për të njëjtin
muaj nuk pajtohen. Muaji rrotullohet edhe një herë para leximit — një faturë e
futur më 31 duhet të jetë brenda.

## Akordimi i performancës — dhe indeksi që nuk u shtua

`scripts/benchmark.mjs` mbjell të dhëna volum-realiste dhe mat me `EXPLAIN
(ANALYZE, BUFFERS)` query-t që aplikacioni vërtet lëshon, para dhe pas çdo
kandidati, veç e veç (`--candidates=...`). Qëllimi nuk është të shtosh indekse; është
të mundesh t'i refuzosh. Seksioni 9 e thotë: "don't over-index upfront".

Me 120k fatura / 60k komisione:

| Kandidati | Analitika 12-mujore | Lista e komisioneve (muaj) | Kandidatët e aprovimit në grup |
| --- | --- | --- | --- |
| `bills(bill_date, status)` | **+45% / +52%** | −70% | −45% |
| `bills(bill_date)` | +11% / +35% | −66% | −43% |
| `bills(bill_date) WHERE status <> 'VOID'` | +21% / +32% | −2% | −0% |
| `commissions(status)` | ±7% | +1% | −9% |

Me 600k fatura / 300k komisione, i njëjti kandidat i parë: analitika ±3%, lista e
komisioneve **+7%**, aprovimi në grup −18%. Pra fitimi nuk qëndron kur ndryshon
volumi — dhe një indeks që ndihmon në një volum e dëmton në tjetrin nuk është
akordim, është fat. **Asnjë indeks i ri nuk u shtua.**

Ajo që matja gjeti në vend të tij:

| Query | Live | Nga `revenue_summaries` |
| --- | --- | --- |
| Trendi 12-mujor i dashboard-it (600k fatura) | **127 ms** | **0.8 ms** |

Asnjë indeks nuk e prek atë numër, sepse query-ja prek me qëllim pjesën më të madhe
të tabelës. Zgjidhja nuk është ta lexosh tabelën. Ndaj dashboard-i tani lexon muajt
e mbyllur nga `revenue_summaries` (tabela dhe puna e natës u ndërtuan në Fazën 5)
dhe mban muajin e tanishëm live, me dy rregulla që e mbajnë të ndershme:

- **Muaji i tanishëm është gjithmonë live** — ende po ndryshon, dhe rrotullimi bëhet natën.
- **Nëse rrotullimi s'ka prodhuar asgjë, e gjithë dritarja bie te query-ja live.**
  Zerot do të ishin gënjeshtër, dhe një seri gjysmë-përmbledhje gjysmë-live është e
  pamundur të arsyetohet.

Skopimi mbetet i saktë sepse grain-i ndryshon me rolin: Super Admin lexon grain-in
`CLIENT` (gjithë biznesi), një përfaqësues lexon `SALES_REP` me `subject_id` të vetin.

## Faqja /reports

Filtrat (muaji, horizonti i skadimit) rrinë në URL si kudo tjetër. Çdo raport ka
një pamje të shkurtër dhe dy lidhje — CSV dhe PDF. Preferencat e njoftimeve rrinë
pas ziles, jo te `/settings`: janë personale, ndërsa `/settings` është profili i
biznesit dhe e hap vetëm Super Admin.

## Vendime dhe supozime të Fazës 6

- **Asnjë indeks i ri** (shih më lart) — vendim i matur, jo i shmangur.
- **Preferencat janë tabelë e re**, jo kolonë JSON te `users`: worker-i i pyet me
  `WHERE email = 'DIGEST'`, dhe kufizimi unik `(user_id, type)` e mban të pastër.
- **`in_app` fsheh, nuk ndalon.** Rreshti shkruhet gjithsesi.
- **Përmbledhja mbulon një datë, jo një kursor** — e riprodhueshme, me çmimin e një
  dublikate në rast rilëshimi.
- **`expiringBefore` është parametër i ri i listës së kontratave**, jo endpoint i ri;
  raporti i skadimeve është ajo listë me një predikat më shumë.
- **Totali i pasqyrës është totali i skedarit**, jo i filtrit: një fundfaqe që nuk
  pajtohet me rreshtat mbi të është më keq se asnjë fundfaqe.
- **Ende pa `/settings` dhe `business_profile`** — jashtë fazave të planit.
- **Migrimet u verifikuan kundër një Postgres 16 të vërtetë**: `npm run db:verify`
  jep 32/32, përfshirë tabelat e Fazave 5 dhe 6.
