/* Testet e ndërfaqes — mënyra statike (pa server, si në GitHub Pages)
   Nisen me: npm run test:ui   (kërkon: npm i -D jsdom) */

import test from "node:test";
import { createDom, skipReason } from "./helpers.mjs";

test("Mënyra lokale: rregullat zbatohen edhe pa server", { skip: skipReason }, async () => {
  const ui = await createDom({
    page: "pos.html",
    pageUrl: "https://diamantmuqici-dotcom.github.io/SharriResturant/pos.html",
    localOnly: true
  });
  const { $, text, sheetText, click, clickByText, typeInto, wait, check, done, networkCalls } = ui;

  try {
    await import("../app/pos.js");
    await wait(500);

    check("Nuk bëhet asnjë thirrje rrjeti", networkCalls() === 0, String(networkCalls()));
    check("Nisja në mënyrën lokale", text().includes("+ POROSI E RE"));
    check("Kundërmatësi fillestar 0 / 50", $("#counterTables")?.textContent === "0 / 50", $("#counterTables")?.textContent);

    await typeInto("#waiterInput", "Blerta");
    await click("[data-waiter-save]");

    /* «Me veti» me vetëm pije → ndalohet edhe pa server */
    await click("[data-new-order]");
    await clickByText("[data-order-type]", "ME VETI");
    await clickByText("[data-add-product]", "Kokakolla");
    check(
      "Edhe pa server: «Me veti» kërkon ushqim",
      sheetText().includes('Porosia "Me veti" duhet të përmbajë të paktën një produkt ushqimor'),
      sheetText().slice(0, 140)
    );
    await click("[data-close-sheet]");
    await wait(120);

    /* Tavolinë → pije → pagesë */
    await click("[data-change-type]");
    await wait(150);
    await clickByText("[data-order-type]", "TAVOLINË");
    await click('.table-btn[data-table="4"]');
    check("Kalimi te tavolina mban produktin e prekur", text().includes("Tavolina 4"));
    await clickByText("[data-add-product]", "Kokakolla");
    await wait(200);
    check("Porosia u krijua lokalisht", text().includes("Porosi aktive"), text().slice(0, 200));
    check("Kundërmatësi 1 / 50", $("#counterTables")?.textContent === "1 / 50", $("#counterTables")?.textContent);

    await click("[data-pay]");
    await clickByText("[data-method]", "Kartelë");
    await click("[data-confirm-payment]");
    await wait(300);
    check("Pagesa u përfundua (lokalisht)", sheetText().includes("PAGESA U PËRFUNDUA"), sheetText().slice(0, 120));
    await clickByText("[data-close-sheet]", "Mbyll");
    await wait(250);
    check("Tavolina 4 u lirua: 0 / 50", $("#counterTables")?.textContent === "0 / 50", $("#counterTables")?.textContent);

    /* Të dhënat mbeten në localStorage */
    const saved = JSON.parse(ui.localStorage.getItem("sharri_pos_v1") || "{}");
    check("Porosia u ruajt në localStorage", (saved.orders || []).length === 1 && saved.orders[0].status === "paid", String(saved.orders?.[0]?.status));
    check("orderType ruhet në bazë", saved.orders?.[0]?.orderType === "TAVOLINE", saved.orders?.[0]?.orderType);
    check("Pagesa ruhet me mënyrë dhe orë", saved.orders?.[0]?.payment?.method === "card" && Boolean(saved.orders?.[0]?.paidAt));
    check("Ngjarjet (audit) ruhen", (saved.orders?.[0]?.events || []).length >= 2, String(saved.orders?.[0]?.events?.length));
    check("Regjistri i përgjithshëm është shqip", (saved.logs || []).some((l) => l.action.includes("u pagua")), JSON.stringify(saved.logs?.[0]));

    done();
  } finally {
    ui.close();
  }
});
