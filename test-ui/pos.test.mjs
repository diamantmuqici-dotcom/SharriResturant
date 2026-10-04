/* Testet e ndërfaqes — ekrani i kamarierit (jsdom + serveri real, opsionale)
   Nisen me: npm run test:ui   (kërkon: npm i -D jsdom) */

import test from "node:test";
import { createDom, skipReason, startServer } from "./helpers.mjs";

test("Ekrani i kamarierit: rrjedha e plotë e porosisë", { skip: skipReason }, async () => {
  const server = await startServer();
  const ui = await createDom({ page: "pos.html", baseUrl: server.baseUrl });
  const { $, $$, text, sheetText, click, clickByText, typeInto, wait, check, done } = ui;

  try {
    await import("../app/pos.js");
    await wait(600);

    /* ---------- 1. Nisja ---------- */
    check("Shiriti i sipërm ka «+ POROSI E RE»", text().includes("+ POROSI E RE"));
    check("Kundërmatësi i tavolinave fillon 0 / 50", $("#counterTables")?.textContent === "0 / 50", $("#counterTables")?.textContent);
    check("Kërko në shiritin e sipërm", Boolean($("#globalSearch")));
    check("Kamarieri në shiritin e sipërm", text().includes("Kamarieri"));
    check("Zgjedhja e kamarierit kërkohet në fillim", sheetText().includes("Kush po punon"), sheetText().slice(0, 80));

    await typeInto("#waiterInput", "Ardit");
    await click("[data-waiter-save]");
    check("Kamarieri u ruajt", text().includes("Ardit"));

    check("Seksioni TAVOLINA TË ZËNA", text().includes("TAVOLINA TË ZËNA"));
    check("Seksioni POROSI ME EMËR", text().includes("POROSI ME EMËR"));
    check("Seksioni POROSI PA TAVOLINË", text().includes("POROSI PA TAVOLINË"));
    check("Gjendja bosh: nuk shfaqen 50 tavolina", !$$(".table-btn").length);

    /* ---------- 2. Rrjedha: Tavolinë → pije → pagesë ---------- */
    await click("[data-new-order]");
    check("Pyetja «KU ËSHTË POROSIA?»", sheetText().includes("KU ËSHTË POROSIA"), sheetText().slice(0, 90));
    check("Katër opsione", ["TAVOLINË", "ME EMËR", "ME VETI", "PËR KËTU"].every((t) => sheetText().includes(t)));

    await clickByText("[data-order-type]", "TAVOLINË");
    check("Hapet zgjedhja e tavolinës", sheetText().includes("Numri i tavolinës"));
    check("Të 50 tavolinat si butona", $$(".table-btn").length === 50, String($$(".table-btn").length));

    await click('.table-btn[data-table="12"]');
    check("Ekrani i porosisë: Tavolina 12", text().includes("Tavolina 12"));
    check("Porosia e re nuk është ruajtur ende", text().includes("Pa ruajtur"));

    await clickByText("[data-add-product]", "Kokakolla");
    await clickByText("[data-add-product]", "Kokakolla");
    check("2× Kokakolla në fletëporosi", text().includes("Kokakolla"));
    check("Totali 2.00€ pas dy pijeve", text().includes("€2.00"), text().slice(0, 400));
    check("Kundërmatësi 1 / 50", $("#counterTables")?.textContent === "1 / 50", $("#counterTables")?.textContent);

    await clickByText("[data-add-product]", "Kafe");
    check("Shtohet kafeja: totali 2.70€", text().includes("€2.70"), text().slice(0, 500));

    await click("[data-pay]");
    check("Ekrani i pagesës", sheetText().includes("PAGESA"));
    check("Mënyrat: Para të gatshme / Kartelë / Tjetër", ["Para të gatshme", "Kartelë", "Tjetër"].every((m) => sheetText().includes(m)));
    await clickByText("[data-method]", "Para të gatshme");
    check("Butonat e shpejtë të shumës", $$(".amount-btn").length > 0);
    await clickByText("[data-amount]", "10");
    check("Rikthimi llogaritet (7.30€)", sheetText().includes("€7.30"), sheetText().slice(0, 300));
    await clickByText("[data-amount]", "E saktë");
    await click("[data-confirm-payment]");
    await wait(300);
    check("«PAGESA U PËRFUNDUA»", sheetText().includes("PAGESA U PËRFUNDUA"), sheetText().slice(0, 120));
    check("Pagesa me para të gatshme regjistrohet", sheetText().includes("Para të gatshme"));
    check("Rikthimi 0.00€", sheetText().includes("€0.00"));
    await clickByText("[data-close-sheet]", "Mbyll");
    await wait(200);
    check("Tavolina 12 u lirua: 0 / 50", $("#counterTables")?.textContent === "0 / 50", $("#counterTables")?.textContent);
    check("Porosia nuk shfaqet më aktive", !text().includes("Tavolina 12"), text().slice(0, 220));

    /* ---------- 3. «Me veti» vetëm me pije → ndalohet ---------- */
    await click("[data-new-order]");
    await clickByText("[data-order-type]", "ME VETI");
    check("Ekrani i porosisë «Me veti»", text().includes("Me veti"));
    check("Paralajmërimi për ushqim", text().includes("duhet të përmbajë të paktën një produkt ushqimor"), text().slice(0, 400));
    await clickByText("[data-add-product]", "Kokakolla");
    check(
      'Gabimi: Porosia "Me veti" duhet të përmbajë të paktën një produkt ushqimor.',
      sheetText().includes('Porosia "Me veti" duhet të përmbajë të paktën një produkt ushqimor'),
      sheetText().slice(0, 160)
    );
    check("Opsioni «Shto ushqim»", sheetText().includes("Shto ushqim"));
    check("Opsioni «Ndrysho llojin e porosisë»", sheetText().includes("Ndrysho llojin e porosisë"));
    await clickByText("[data-close-sheet]", "");
    await wait(120);
    await clickByText('[data-category="ushqim"]', "Ushqim").catch(() => click('[data-category="ushqim"]'));
    check("Filtri «Ushqim» fsheh pijet", !$$(".product-tile.drink").length, String($$(".product-tile.drink").length));

    await clickByText("[data-add-product]", "Hamburger + Pomfrit");
    check("Ushqimi krijon porosinë «Me veti»", text().includes("Porosi aktive"), text().slice(0, 300));
    check("Numri i porosisë shfaqet pasi ruhet", /SH-\d{8}-\d{3}/.test(text()), text().slice(0, 200));
    await click('[data-category="all"]');
    await clickByText("[data-add-product]", "Kokakolla");
    check("Pije + ushqim lejohet në «Me veti»: 3.50€", text().includes("€3.50"), text().slice(0, 500));
    check(
      "Kundërmatësi: 0 tavolina, 1 porosi aktive",
      $("#counterTables")?.textContent === "0 / 50" && $("#counterOrders")?.textContent === "1",
      `${$("#counterTables")?.textContent} / ${$("#counterOrders")?.textContent}`
    );

    await click("[data-pay]");
    await clickByText("[data-method]", "Kartelë");
    await click("[data-confirm-payment]");
    await wait(300);
    check("Pagesa me kartelë u përfundua", sheetText().includes("PAGESA U PËRFUNDUA") && sheetText().includes("Kartelë"));
    await clickByText("[data-close-sheet]", "Mbyll");
    await wait(200);

    /* ---------- 4. «Me emër» ---------- */
    await click("[data-new-order]");
    await clickByText("[data-order-type]", "ME EMËR");
    check("Kërkohet emri", sheetText().includes("Emri / identifikuesi"));
    await click("[data-name-confirm]");
    check("Pa emër nuk vazhdohet", sheetText().includes("Shkruani emrin"), text().slice(-160));
    await typeInto("#nameInput", "Bastria");
    await click("[data-name-confirm]");
    check("Porosia me emër: Bastria", text().includes("Bastria"));
    await clickByText("[data-add-product]", "Kafe");
    check("Pije vetëm me emër lejohet", text().includes("€0.70"), text().slice(0, 400));
    await click("[data-back]");
    await wait(250);
    check("Në panelin «POROSI ME EMËR» shfaqet Bastria", text().includes("Bastria"));
    check("Porosi aktive: 1", $("#counterOrders")?.textContent === "1", $("#counterOrders")?.textContent);
    check("Tavolinat mbeten 0 / 50 (emri nuk është tavolinë)", $("#counterTables")?.textContent === "0 / 50", $("#counterTables")?.textContent);

    /* ---------- 5. Tavolinë e zënë → hap porosinë ekzistuese ---------- */
    await click("[data-new-order]");
    await clickByText("[data-order-type]", "TAVOLINË");
    await click('.table-btn[data-table="7"]');
    await clickByText("[data-add-product]", "Kombinim Skare");
    await click("[data-back]");
    await wait(250);
    check("Tavolina 7 e zënë: 1 / 50", $("#counterTables")?.textContent === "1 / 50", $("#counterTables")?.textContent);
    check("Tavolina 7 nuk shfaqet si e lirë në rrjet", $('.table-btn[data-table="7"]') === null);

    await click("[data-new-order]");
    await clickByText("[data-order-type]", "TAVOLINË");
    check("Tavolina 7 shënohet e zënë në rrjet", Boolean($('.table-btn[data-table="7"].busy')));
    await click('.table-btn[data-table="7"]');
    check("«Tavolina 7 ka një porosi aktive.»", sheetText().includes("Tavolina 7 ka një porosi aktive"), sheetText().slice(0, 140));
    check("Ofrohet «Hap porosinë»", sheetText().includes("Hap porosinë"));
    await clickByText("[data-open-order]", "Hap porosinë");
    await wait(250);
    check("Hapet porosia ekzistuese (pa dublikat)", text().includes("Tavolina 7") && text().includes("Kombinim Skare"));

    /* ---------- 6. Historiku ---------- */
    await click("[data-back]");
    await wait(200);
    await click('[data-view="historiku"]');
    await wait(350);
    check("Historiku shfaq porositë e paguara", text().includes("HISTORIKU") && text().includes("Paguar"), text().slice(0, 200));
    check("Historiku nuk përzihet me porositë aktive", !text().includes("POROSI AKTIVE"));
    check("Tavolina 12 gjendet në historik", text().includes("Tavolina 12"));
    check("«Me veti» gjendet në historik", text().includes("Me veti"));
    await typeInto("#historySearch", "Tavolina 12");
    check("Kërkimi në historik funksionon", text().includes("Tavolina 12"));
    await typeInto("#historySearch", "zzz");
    check("Kërkimi pa rezultat tregon gjendje bosh shqip", text().includes("Nuk ka porosi për këtë ditë ose kërkim"));
    await typeInto("#historySearch", "");

    /* ---------- 7. Kërkimi i porosive aktive ---------- */
    await click("[data-back]");
    await wait(300);
    await typeInto("#globalSearch", "7");
    check("Kërkimi gjen tavolinën 7", text().includes("Tavolina 7"));
    await typeInto("#globalSearch", "xxxyyy");
    check("Gjendja bosh e kërkimit (shqip)", text().includes("Asnjë porosi aktive nuk përputhet"));
    await typeInto("#globalSearch", "");

    /* ---------- 8. Gjuha: asnjë tekst anglisht ---------- */
    await click("[data-menu]");
    const menu = sheetText();
    check("Menuja hapet", menu.includes("Menuja"));
    await clickByText("[data-close-sheet]", "✕").catch(() => click("[data-close-sheet]"));
    const forbidden = [
      "New Order", "Table", "Takeaway", "Takeout", "Dine in", "Search", "Waiter", "Active orders",
      "History", "Total", "Cash", "Card", "Payment", "Cancel", "Save", "Delete", "Settings",
      "Sign in", "Login", "Submit", "Loading", "No orders", "paid", "open"
    ];
    const hits = forbidden.filter((word) => new RegExp(`\\b${word}\\b`).test(text()));
    check("Asnjë tekst anglisht në ndërfaqe", hits.length === 0, hits.join(", "));

    done();
  } finally {
    ui.close();
    await server.stop();
  }
});
