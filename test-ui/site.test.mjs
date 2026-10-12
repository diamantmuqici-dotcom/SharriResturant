/* Testet e ndërfaqes — menuja publike, kuzhina, admini (jsdom + serveri real, opsionale)
   Nisen me: npm run test:ui   (kërkon: npm i -D jsdom) */

import test from "node:test";
import { createDom, skipReason, startServer } from "./helpers.mjs";

test("Menuja publike, kuzhina dhe paneli i administratorit", { skip: skipReason }, async () => {
  const server = await startServer();
  const ui = await createDom({ page: "index.html", baseUrl: server.baseUrl, cookieJar: true });
  const { window, $, $$, text, click, typeInto, goHash, wait, check, done } = ui;

  const submit = async (selector, extra = 500) => {
    $(selector).dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    await wait(extra);
  };

  try {
    await import("../app/main.js");
    await wait(900);

    /* ---------- Faqja publike ---------- */
    check("Menyja shfaq produktet", $$("#menuGrid .card").length > 20, String($$("#menuGrid .card").length));
    check("Navigimi shqip (MENYJA, Kamarieri, Administratori)", ["MENYJA", "Kamarieri", "Kuzhina", "Administratori"].every((t) => text().includes(t)));
    check("Kategoria «Kafe & Çaj» ekziston", text().includes("Kafe & Çaj"));
    check("Produkti «Kokakolla» ekziston", text().includes("Kokakolla"));

    /* ---------- Shporta: vetëm pije → «Me veti» ndalohet ---------- */
    await click('[data-add="coca-cola"]');
    check("Shporta numëron 1", $("#cartCount").textContent === "1", $("#cartCount").textContent);
    await click("#checkoutBtn");
    await wait(200);
    check("Hapet dritarja e porosisë", text().includes("Lloji i porosisë"));
    check("Paralajmërimi: shporta ka vetëm pije", text().includes("Shporta ka vetëm pije"), text().slice(0, 200));
    await typeInto("#orderTypeSelect", "ME_VETI", "change");
    check('Butoni bllokohet: "Kërkohet ushqim për këtë lloj"', $("#checkoutForm button[type=submit]").textContent.includes("Kërkohet ushqim"), $("#checkoutForm button[type=submit]").textContent);

    /* ---------- Shtohet ushqimi → lejohet «Me veti» ---------- */
    await click("[data-close]");
    await wait(200);
    await click('[data-add="hamburger-pomfrit"]');
    await click("#checkoutBtn");
    await wait(200);
    await typeInto("#orderTypeSelect", "ME_VETI", "change");
    check("Me ushqim, «Me veti» lejohet", !$("#checkoutForm button[type=submit]").disabled);
    await submit("#checkoutForm");
    check("Porosia u krijua", text().includes("Porosia u pranua"), text().slice(0, 200));
    check("Shfaqet «Me veti»", text().includes("Me veti"));
    await click("[data-close]");
    await wait(200);

    /* ---------- Porosi në tavolinë nga faqja ---------- */
    await click('[data-add="kafe"]');
    await click("#checkoutBtn");
    await wait(200);
    await typeInto("#orderTypeSelect", "TAVOLINE", "change");
    check("Fusha e tavolinës shfaqet", !$("#tableField").classList.contains("hidden"));
    await typeInto('input[name="table"]', "21");
    await submit("#checkoutForm");
    check("Porosia në Tavolinën 21 u krijua", text().includes("Tavolina 21"), text().slice(0, 220));
    await click("[data-close]");
    await wait(200);

    /* ---------- Kuzhina ---------- */
    await goHash("#/kitchen");
    check("Paneli i kuzhinës hapet", text().includes("Paneli i kuzhinës"));
    check("Kuzhina sheh Tavolinën 21", text().includes("Tavolina 21"));
    check("Kuzhina sheh porosinë «Me veti»", text().includes("Me veti"));
    check("Kuzhina tregon kundërmatësin e tavolinave", /tavolina \d+ \/ 50/.test(text()), text().slice(0, 200));
    await click("[data-kitchen-ready]");
    await wait(400);
    check("Statusi «Gati» vendoset", text().includes("Gati"));

    /* ---------- Administratori ---------- */
    await goHash("#/admin");
    check("Kërkohet hyrja", text().includes("Hyrja e administratorit"));
    await typeInto('input[name="username"]', "admin");
    await typeInto('input[name="password"]', "admin123");
    await submit("#loginForm", 700);
    check("Hyrja u kry → Paneli", text().includes("Paneli") && text().includes("Xhirua sot"), text().slice(0, 200));
    check("Paneli tregon tavolinat e zëna", text().includes("Tavolina të zëna"));

    await click('[data-admin-nav="orders"]');
    await wait(500);
    check("Historiku i porosisë hapet", text().includes("Historiku i porosisë"));
    check("Kolona shqip (Identifikuesi, Pagesa, Statusi)", ["Identifikuesi", "Kamarieri", "Pagesa", "Statusi", "Veprime"].every((t) => text().includes(t)));
    check("Filtri i llojit të porosisë", text().includes("Lloji i porosisë"));

    await typeInto("#adminOrderSearch", "Tavolina 21");
    await wait(250);
    check("Kërkimi gjen tavolinën 21", text().includes("Tavolina 21"));
    await typeInto("#adminOrderSearch", "Me veti");
    await wait(250);
    check("Kërkimi gjen «Me veti»", text().includes("Me veti"));
    await typeInto("#adminOrderSearch", "");
    await typeInto("#adminOrderTypeFilter", "ME_VETI", "change");
    await wait(250);
    check("Filtri sipas llojit funksionon", text().includes("Me veti") && !text().includes("Tavolina 21"), text().slice(0, 200));
    await typeInto("#adminOrderTypeFilter", "all", "change");

    await click('[data-order-action="view"]');
    await wait(300);
    check("Detajet e porosisë hapen", text().includes("Lloji i porosisë") && text().includes("Ngjarjet e porosisë"), text().slice(0, 200));
    await click("[data-close]");
    await wait(200);

    await click('[data-admin-nav="products"]');
    await wait(400);
    check("Produktet: kolona «Lloji»", text().includes("Lloji") && text().includes("Ushqim") && text().includes("Pije"));
    check("Shpjegimi i rregullit", text().includes("lejohet «Me veti»"));

    await click('[data-admin-nav="settings"]');
    await wait(400);
    check("Cilësimet: numri i tavolinave", text().includes("Numri i tavolinave"));
    check("Cilësimet: kamarierët", text().includes("Kamarierët"));
    await typeInto('input[name="tableCount"]', "50");
    await typeInto('input[name="waiters"]', "Ardit, Blerta, Liridon");
    await submit("#settingsForm");
    check("Cilësimet u ruajtën", text().includes("Cilësimet u ruajtën"), text().slice(-200));

    await click('[data-admin-nav="cash"]');
    await wait(400);
    check("Raporti i arkës hapet", text().includes("Raporti i arkës") && text().includes("Letërnjoftimet"));
    await click("[data-cash-history]");
    await wait(400);
    check("Historiku i arkës: kokat shqip", ["Pritshëm", "Raportuar", "Diferenca", "Veprime"].every((t) => text().includes(t)), text().slice(0, 240));
    await click("[data-close]");
    await wait(200);

    await click('[data-admin-nav="logs"]');
    await wait(400);
    check("Regjistri hapet", text().includes("Regjistri"));
    check("Regjistri është shqip", text().includes("u krijua") || text().includes("u pagua") || text().includes("u kyç"), text().slice(0, 240));

    /* ---------- Gjuha ---------- */
    await goHash("#/");
    await wait(300);
    const forbidden = ["Add to Cart", "Checkout", "Total", "Cancel", "Delete", "Save", "Search", "Order", "Paid", "Settings", "History", "Table", "Waiter", "Cash", "Card", "Submit", "Loading", "No orders", "Dashboard"];
    const hits = forbidden.filter((word) => new RegExp(`\\b${word}\\b`).test(text()));
    check("Asnjë tekst anglisht në faqe", hits.length === 0, hits.join(", "));

    done();
  } finally {
    ui.close();
    await server.stop();
  }
});
