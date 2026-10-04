# SHARRI Restaurant — Sistemi i porosisë për kamarierë, kuzhinë dhe administrator

> Faqja e restorantit, **ekrani i kamarierit (POS)**, paneli i kuzhinës, paneli i
> administratorit, raporti i arkës dhe faturat me QR.
> **Gjithçka në ndërfaqe është shqip.** Rregullat e porosisë zbatohen edhe në server.

---

## 🚀 Nisja

```bash
npm start          # node server/index.js  →  http://localhost:8080
```

| Adresa | Çfarë hapet |
| --- | --- |
| `http://localhost:8080/` | Faqja e restorantit (menyja për klientë) |
| `http://localhost:8080/pos.html` | **Ekrani i kamarierit** (tableti i punës) |
| `http://localhost:8080/index.html#/kitchen` | Paneli i kuzhinës |
| `http://localhost:8080/index.html#/admin` | Paneli i administratorit |

Të dhënat ruhen në `server/data/db.json` (kjo dosje nuk ruhet në Git).
Hyrja e administratorit: `admin` / `admin123` (ndryshojeni menjëherë në prodhim).

### Pa server (faqe statike)

Faqja hapet edhe direkt nga GitHub Pages. Në këtë rast të dhënat ruhen në
`localStorage` të pajisjes, por **e njëjta logjikë rregullash** zbatohet
(`lib/engine.js` + `lib/rules.js`), prandaj as aty nuk mund të krijohet
«Me veti» vetëm me pije. Shkronja e vogël: pa server porositë nuk ndahen
ndërmjet pajisjeve.

Testet:

```bash
npm test           # 47 teste, zero varësi (node --test)
```

Shënim: skedarët nuk hapen me dyklik (`file://`) — modulet e shfletuesit kërkojnë
protokoll HTTP. Përdorni `npm start` ose çdo server statik (`python3 -m http.server`).

---

## 🧾 Rrjedha e kamarierit

```
+ POROSI E RE
      ↓
KU ËSHTË POROSIA?
      ↓
TAVOLINË   |   ME EMËR   |   ME VETI   |   PËR KËTU
      ↓
Prek produktet (1 prekje = 1 produkt)
      ↓
PAGESA → Para të gatshme / Kartelë / Tjetër
      ↓
PAGESA U PËRFUNDUA → porosi largohet nga ekranet aktive, tavolina lirohet
```

Ekrani kryesor **nuk** shfaq 50 tavolina si lista. Shfaq vetëm porositë aktive,
të ndara në tre seksione:

- **TAVOLINA TË ZËNA** — `Tavolina 2 — 10.00€ — 12 min`
- **POROSI ME EMËR** — `Bastria — 6.00€ — 8 min`
- **POROSI PA TAVOLINË** — `Me veti — 8.50€`, `Për këtu — 5.00€`

Kundërmatësi përditësohet vetë:

```
Tavolina të zëna:  7 / 50        (43 tavolina të lira)
Porosi aktive:     10            (3 porosi me emër, 2 pa tavolinë)
```

`7 / 50` do të thotë **7 tavolina fizike të zëna nga 50** — jo «tavolina nr. 7».
Porositë me emër dhe «Me veti» nuk numërohen si tavolina fizike.

### Rregullat që zbatohen

| Porosia | Tavolinë | Me emër | Me veti | Për këtu |
| --- | :-: | :-: | :-: | :-: |
| Ushqim | ✓ | ✓ | ✓ | ✓ |
| Ushqim + pije | ✓ | ✓ | ✓ | ✓ |
| Vetëm pije | ✓ | ✓ | ✗ | ✗ |
| Vetëm kafe | ✓ | ✓ | ✗ | ✗ |
| Vetëm ëmbëlsirë | ✓ | ✓ | ✓ (si ushqim) | ✓ (si ushqim) |

«Me veti» do të thotë **klienti e merr ushqimin me vete** — nuk do të thotë «pa tavolinë».
Prandaj një Kokakolla e vetme nuk mund të jetë «Me veti», ndërsa Hamburger + Kokakolla po.

Kur kamarieri prek një pije në një porosi «Me veti» pa ushqim, sistemi ndalon dhe ofron:

- **Shto ushqim** — vazhdon me të njëjtën porosi, ose
- **Ndrysho llojin e porosisë** — kalon te «Tavolinë» ose «Me emër» (produktet e prekura nuk humbin).

### Tavolina e zënë

Nëse tavolina 12 ka tashmë porosi aktive, sistemi nuk krijon porosi të dytë:

```
Tavolina 12 ka një porosi aktive.
   → Hap porosinë        (shtoni produkte te e njëjta porosi)
   → Zgjidh tavolinë tjetër
```

### Pas pagesës

- porosia shënohet `paid` dhe ruhet ora, mënyra e pagesës, rikthimi, kamarieri, artikujt, totali
- regjistrohen ngjarjet e porosisë (audit) dhe regjistri i përgjithshëm
- porosi hiqet nga ekrani aktiv dhe kundërmatësi zbret (`7 / 50` → `6 / 50`)
- tavolina lirohet menjëherë
- porosi gjendet vetëm në **Historiku** (kamarieri dhe administratori)

---

## 🛡️ Validimi në server (i detyrueshëm)

Rregullat nuk janë vetëm në butonat e ndërfaqes. Çdo kërkesë kalon nëpër
`lib/rules.js` → `lib/engine.js`, të cilat i përdor serveri:

```bash
curl -X POST http://localhost:8080/api/orders \
  -H 'Content-Type: application/json' \
  -d '{"orderType":"ME_VETI","items":[{"productId":"coca-cola","qty":1}]}'
```

```json
{
  "ok": false,
  "error": {
    "code": "ME_VETI_REQUIRES_FOOD",
    "message": "Porosia \"Me veti\" duhet të përmbajë të paktën një produkt ushqimor."
  }
}
```

Të njëjtat refuzime vlejnë për:

- dërgimin e `isFood: true` të rremë për një pije (lloji lexohet nga katalogu)
- sajim e çmimit nga klienti (çmimi merret gjithmonë nga katalogu)
- heqjen e të vetmit ushqim nga një porosi «Me veti» / «Për këtu»
- dy porosi aktive në të njëjtën tavolinë
- tavolinë jashtë diapazonit 1–50
- pagesë me shumë të pamjaftueshme, pagesë të dyfishtë, anulim pa arsye
- ndryshime të produktit/cilësimeve pa hyrje administratori

---

## 🔌 API

| Metoda | Rruga | Përshkrimi |
| --- | --- | --- |
| GET | `/api/health` | Gjendja e serverit |
| GET | `/api/catalog` | Cilësimet, kategoritë, produktet, 50 tavolinat |
| GET | `/api/summary` | Kundërmatësit: tavolina të zëna/të lira, porosi aktive, xhirua sot |
| GET | `/api/orders?status=&orderType=&q=&date=&tableNumber=` | Lista e porosive (kërkim dhe filtra) |
| GET | `/api/orders/:id` | Detajet e porosisë |
| POST | `/api/orders` | Krijon porosi (validim i plotë) |
| POST | `/api/orders/:id/items` | Shton produkte |
| PATCH | `/api/orders/:id/items/:key` | Ndryshon sasinë ose shënimin |
| DELETE | `/api/orders/:id/items/:key` | Heq produkt (rivlerëson rregullat) |
| PATCH | `/api/orders/:id/identity` | Ndryshon llojin: Tavolinë ↔ Me emër ↔ Me veti ↔ Për këtu |
| PATCH | `/api/orders/:id/note` | Shënimi për kuzhinën |
| POST | `/api/orders/:id/pay` | Pagesa (`cash` / `card` / `other`) |
| POST | `/api/orders/:id/cancel` | Anulimi me arsye |
| POST | `/api/orders/:id/kitchen` | Kuzhina e shënon «gati» |
| POST | `/api/login`, `/api/logout`, GET `/api/session` | Hyrja e administratorit |
| GET | `/api/logs` | Regjistri (vetëm administratori) |
| POST/DELETE | `/api/products`, `/api/products/:id` | Produktet (vetëm administratori) |
| PATCH | `/api/settings` | Cilësimet, numri i tavolinave, kamarierët (vetëm administratori) |
| GET/POST/DELETE | `/api/cash-reports`, `/api/cash-reports/:id` | Raporti i arkës (vetëm administratori) |

Përgjigjet: `{ "ok": true, "data": ... }` ose `{ "ok": false, "error": { "code", "message" } }` — mesazhet shqip.

---

## 🗂️ Modeli i porosisë

```js
{
  id, number,                    // "SH-20261004-012"
  createdAt, updatedAt,
  orderType,                     // TAVOLINE | EMER | ME_VETI | PER_KETU  (ruhet, nuk hamendësohet)
  tableNumber,                   // 12 ose null
  customerName,                  // "Bastria" ose ""
  status,                        // open | paid | cancelled
  kitchenReady,                  // kuzhina e ka gati
  items: [{ key, productId, name, price, qty, kind, isFood, note }],
  subtotal, vat, total,
  waiter,                        // kush e hapi / kush e pagu
  payment: { method, amount, change, at, by },
  paidAt, cancelReason, channel, // "kamarier" ose "internet"
  events: [{ at, by, type, message }]   // gjurmë e plotë
}
```

Lloji i produktit (`ushqim` ose `pije`) vendoset nga administratori te
**Produktet → Lloji**; nëse nuk zgjidhet, merret nga kategoria
(`Pije`, `Kafe & Çaj` = pije, të tjerat = ushqim).

---

## 🖥️ Panelet e tjera

**Kuzhina** (`#/kitchen`) — porositë aktive me identifikues të qartë
(`Tavolina 12`, `Bastria`, `Me veti`), koha e pritjes, «Gati», anulim me arsye, zë për porosi të reja.

**Administratori** (`#/admin`) — paneli (xhirua sot, tavolina të zëna `7 / 50`, produktet më të shitura),
historiku i plotë i porosisë me kërkim (`Tavolina 50`, `Bastria`, `Me veti`, `Për këtu`, `Enver`),
filtra sipas statusit/llojit/datës, detaje të plota me ngjarjet e porosisë, eksport CSV (kokat shqip),
menaxhimi i produkteve, **Raporti i arkës** (hekurat, letërnjoftimet, tërheqjet, diferenca, historiku, printim),
cilësimet (numri i tavolinave, lista e kamarierëve, TVSH) dhe regjistri i ngjarjeve.

**Fatura me QR** — çdo faturë printon një kod QR; skanimi hap `recepit.html`
dhe tregon vetëm atë porosi (artikujt, TVSH-në, totalin, llojin, tavolinën/emrin, mënyrën e pagesës).

---

## 📁 Struktura

```
index.html        faqja + kuzhina + administratori (ngarkon app/main.js)
pos.html          ekrani i kamarierit (ngarkon app/pos.js)
pos.css           stili i ekranit të kamarierit
recepit.html      fatura që hapet nga kodi QR
Resturant.html    faqe e pavarur e raportit të arkës (printim)

app/main.js       logjika e faqes, kuzhinës dhe administratorit
app/pos.js        logjika e ekranit të kamarierit

lib/rules.js      RREGULLAT: llojet, matrica e validimit, mesazhet shqip
lib/engine.js     motori i porosisë (krijim, shtim, pagesë, anulim, audit)
lib/store.js      ruajtja lokale (kur nuk ka server) + hyrja
lib/api.js        klienti i API-së: server ose ruajtje lokale, e njëjta ndërfaqe
lib/catalog.js    produktet, kategoritë, cilësimet, 50 tavolinat
lib/normalize.js  bashkimi i të dhënave të ruajtura me katalogun + migrimi
lib/format.js     para, data, ora, kohëzgjatja (sq-AL)
lib/receipt.js    përmbajtja e faturës + ngarkesa e QR-së
lib/qr.js         gjeneruesi i kodit QR (pa varësi)

server/index.js   serveri HTTP (statik + API, zero varësi)
server/db.js      ruajtja në server/data/db.json
server/data/      të dhënat (nuk ruhet në Git)

test/             47 teste (rregullat, motori, API lokale, serveri)
```

Pa varësi, pa ndërtim, pa framework — vetëm Node ≥ 20 për serverin dhe testet.
