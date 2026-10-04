/* Testet e mënyrës lokale (faqja statike, pa server) — të njëjtat rregulla */
import assert from "node:assert/strict";
import test from "node:test";

import { DB_KEY } from "../lib/catalog.js";
import { createLocalApi } from "../lib/store.js";

function installStorage() {
  const make = () => {
    const map = new Map();
    return {
      getItem: (key) => (map.has(key) ? map.get(key) : null),
      setItem: (key, value) => map.set(key, String(value)),
      removeItem: (key) => map.delete(key),
      clear: () => map.clear(),
      _map: map
    };
  };
  globalThis.localStorage = make();
  globalThis.sessionStorage = make();
  return globalThis.localStorage;
}

test("mënyra lokale krijon administratorin dhe katalogun", async () => {
  installStorage();
  const api = createLocalApi();
  await api.init();

  assert.equal(api.mode, "lokal");
  const catalog = await api.catalog();
  assert.equal(catalog.tableCount, 50);
  assert.ok(catalog.products.find((p) => p.id === "kafe"));

  const session = await api.login("admin", "admin123");
  assert.equal(session.role, "admin");
  await assert.rejects(() => api.login("admin", "gabim"), /Kredencialet janë të pasakta/);
});

test("mënyra lokale zbaton të njëjtat rregulla për «Me veti»", async () => {
  installStorage();
  const api = createLocalApi();
  await api.init();

  await assert.rejects(
    () => api.createOrder({ orderType: "ME_VETI", items: [{ productId: "coca-cola", qty: 2 }] }),
    (error) => {
      assert.equal(error.code, "ME_VETI_REQUIRES_FOOD");
      assert.equal(error.message, 'Porosia "Me veti" duhet të përmbajë të paktën një produkt ushqimor.');
      return true;
    }
  );

  await assert.rejects(
    () => api.createOrder({ orderType: "PER_KETU", items: [{ productId: "kafe", qty: 1 }] }),
    { code: "PER_KETU_REQUIRES_FOOD" }
  );

  const order = await api.createOrder({
    orderType: "ME_VETI",
    items: [{ productId: "hamburger-pomfrit", qty: 1 }, { productId: "coca-cola", qty: 1 }]
  });
  assert.equal(order.total, 3.5);

  const foodKey = order.items.find((i) => i.isFood).key;
  await assert.rejects(() => api.removeItem(order.id, foodKey), { code: "ME_VETI_REQUIRES_FOOD" });
});

test("kundërmatësi i tavolinave përditësohet pas pagesës", async () => {
  installStorage();
  const api = createLocalApi();
  await api.init();

  assert.equal((await api.summary()).occupiedTables, 0);

  const first = await api.createOrder({ orderType: "TAVOLINE", tableNumber: 2, items: [{ productId: "kafe", qty: 1 }] });
  await api.createOrder({ orderType: "EMER", customerName: "Bastria", items: [{ productId: "trileqe", qty: 1 }] });
  await api.createOrder({ orderType: "ME_VETI", items: [{ productId: "file-pule", qty: 1 }] });

  let summary = await api.summary();
  assert.equal(summary.occupiedTables, 1);
  assert.equal(summary.activeOrders, 3);
  assert.equal(summary.nameOrders, 1);
  assert.equal(summary.noTableOrders, 1);

  await assert.rejects(
    () => api.createOrder({ orderType: "TAVOLINE", tableNumber: 2, items: [{ productId: "kafe", qty: 1 }] }),
    { code: "TABLE_BUSY" }
  );

  await api.pay(first.id, { method: "card" }, "Ardit");
  summary = await api.summary();
  assert.equal(summary.occupiedTables, 0);
  assert.equal(summary.activeOrders, 2);
  assert.equal(summary.paidToday, 1);

  const active = await api.orders({ status: "open" });
  assert.equal(active.some((o) => o.id === first.id), false);

  const paid = await api.orders({ status: "paid" });
  assert.equal(paid.length, 1);
  assert.equal(paid[0].payment.method, "card");

  const search = await api.orders({ q: "Bastria" });
  assert.equal(search.length, 1);
});

test("të dhënat mbeten pas rifreskimit të faqes", async () => {
  const storage = installStorage();
  const api = createLocalApi();
  await api.init();
  await api.createOrder({ orderType: "TAVOLINE", tableNumber: 9, items: [{ productId: "kafe", qty: 2 }] });

  assert.ok(storage.getItem(DB_KEY));

  /* Simulon hapjen e faqes përsëri me të njëjtën ruajtje */
  const reopened = createLocalApi();
  await reopened.init();
  const summary = await reopened.summary();
  assert.equal(summary.occupiedTables, 1);
  assert.equal(summary.activeOrders, 1);
});

test("dëgjuesi njoftohet kur ndryshojnë porositë", async () => {
  installStorage();
  const api = createLocalApi();
  await api.init();

  let notifications = 0;
  api.subscribe(() => notifications++);
  await api.createOrder({ orderType: "PER_KETU", items: [{ productId: "gullash", qty: 1 }] });
  assert.ok(notifications > 0);
});

test("porositë e vjetra (dine_in/takeout) migrohen automatikisht", async () => {
  const storage = installStorage();
  storage.setItem(
    DB_KEY,
    JSON.stringify({
      settings: { currency: "€", taxRate: 18, taxIncluded: true },
      categories: [],
      products: [],
      orders: [
        {
          id: "e-vjeter-1",
          number: "SH-20250101-001",
          createdAt: new Date().toISOString(),
          type: "dine_in",
          table: "14",
          customer: "Klienti",
          status: "preparing",
          items: [{ productId: "kafe", name: "Kafe", qty: 1, price: 0.7 }],
          subtotal: 0.7,
          vat: 0.11,
          total: 0.7
        },
        {
          id: "e-vjeter-2",
          number: "SH-20250101-002",
          createdAt: new Date().toISOString(),
          type: "takeout",
          status: "completed",
          items: [{ productId: "hamburger-pomfrit", name: "Hamburger + Pomfrit", qty: 1, price: 2.5 }],
          subtotal: 2.5,
          vat: 0.39,
          total: 2.5
        }
      ],
      cashReports: [],
      users: [],
      logs: [],
      counters: { orders: 2, cashReports: 0 }
    })
  );

  const api = createLocalApi();
  await api.init();
  const orders = await api.orders();
  const legacyTable = orders.find((o) => o.id === "e-vjeter-1");
  const legacyTakeout = orders.find((o) => o.id === "e-vjeter-2");

  assert.equal(legacyTable.orderType, "TAVOLINE");
  assert.equal(legacyTable.tableNumber, 14);
  assert.equal(legacyTable.status, "open");
  assert.equal(legacyTakeout.orderType, "ME_VETI");
  assert.equal(legacyTakeout.status, "paid");

  const summary = await api.summary();
  assert.equal(summary.occupiedTables, 1);
});
