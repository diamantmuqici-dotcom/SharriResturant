/* Testet e motorit të porosisë — e njëjta logjikë që përdor serveri */
import assert from "node:assert/strict";
import test from "node:test";

import { defaultDB } from "../lib/catalog.js";
import { createEngine } from "../lib/engine.js";
import { RuleError } from "../lib/rules.js";

function makeEngine() {
  const db = defaultDB();
  let saves = 0;
  const engine = createEngine({ db, persist: () => saves++ });
  return { db, engine, saves: () => saves };
}

test("porosia në tavolinë krijohet dhe mbetet aktive", () => {
  const { db, engine, saves } = makeEngine();
  const order = engine.createOrder({
    orderType: "TAVOLINE",
    tableNumber: 12,
    waiter: "Ardit",
    items: [{ productId: "coca-cola", qty: 2 }]
  });

  assert.equal(order.status, "open");
  assert.equal(order.orderType, "TAVOLINE");
  assert.equal(order.tableNumber, 12);
  assert.equal(order.total, 2);
  assert.equal(order.waiter, "Ardit");
  assert.match(order.number, /^SH-\d{8}-\d{3}$/);
  assert.equal(saves() > 0, true);
  assert.equal(engine.getSummary().occupiedTables, 1);
  assert.ok(db.logs[0].action.includes("u krijua"), db.logs[0].action);
});

test("dy porosi aktive në të njëjtën tavolinë nuk lejohen", () => {
  const { engine } = makeEngine();
  engine.createOrder({ orderType: "TAVOLINE", tableNumber: 12, items: [{ productId: "coca-cola", qty: 2 }] });
  assert.throws(
    () => engine.createOrder({ orderType: "TAVOLINE", tableNumber: 12, items: [{ productId: "kafe", qty: 1 }] }),
    (error) => error.code === "TABLE_BUSY" && error.message === "Tavolina 12 ka një porosi aktive."
  );
  /* Tavolina tjetër lejohet */
  engine.createOrder({ orderType: "TAVOLINE", tableNumber: 13, items: [{ productId: "kafe", qty: 1 }] });
});

test("shtimi i produkteve e mban porosinë aktive (2.00€ + 0.70€ = 2.70€)", () => {
  const { engine } = makeEngine();
  const order = engine.createOrder({ orderType: "TAVOLINE", tableNumber: 12, items: [{ productId: "coca-cola", qty: 2 }] });
  const updated = engine.addItems(order.id, [{ productId: "kafe", qty: 1 }], "Ardit");
  assert.equal(updated.total, 2.7);
  assert.equal(updated.status, "open");
  assert.equal(updated.items.length, 2);

  const again = engine.addItems(order.id, [{ productId: "coca-cola", qty: 1 }], "Ardit");
  assert.equal(again.items.find((i) => i.productId === "coca-cola").qty, 3);
  assert.equal(again.total, 3.7);
});

test("çmimet merren nga katalogu, jo nga klienti", () => {
  const { engine } = makeEngine();
  const order = engine.createOrder({
    orderType: "PER_KETU",
    items: [{ productId: "mish-viqi-1kg", qty: 1, price: 0.01, isFood: true }]
  });
  assert.equal(order.items[0].price, 25);
  assert.equal(order.total, 25);
});

test("«Me veti» vetëm me pije refuzohet në çdo hap", () => {
  const { engine } = makeEngine();
  assert.throws(
    () => engine.createOrder({ orderType: "ME_VETI", items: [{ productId: "coca-cola", qty: 1 }] }),
    { code: "ME_VETI_REQUIRES_FOOD" }
  );

  const order = engine.createOrder({
    orderType: "ME_VETI",
    items: [{ productId: "hamburger-pomfrit", qty: 1 }, { productId: "coca-cola", qty: 1 }]
  });
  assert.equal(order.total, 3.5);

  /* Pije shtesë lejohet sepse porosia ka ushqim */
  engine.addItems(order.id, [{ productId: "fanta", qty: 1 }]);

  /* Heqja e të vetmit ushqim ndalohet */
  const foodKey = order.items.find((i) => i.isFood).key;
  assert.throws(() => engine.removeItem(order.id, foodKey), { code: "ME_VETI_REQUIRES_FOOD" });
  assert.throws(() => engine.updateItem(order.id, foodKey, { qty: 0 }), { code: "ME_VETI_REQUIRES_FOOD" });

  /* Porosia mbetet e pandryshuar pas refuzimit */
  assert.equal(order.items.some((i) => i.isFood), true);
  assert.equal(order.total, 4.5);
});

test("«Për këtu» kërkon ushqim", () => {
  const { engine } = makeEngine();
  assert.throws(() => engine.createOrder({ orderType: "PER_KETU", items: [{ productId: "kafe", qty: 1 }] }), {
    code: "PER_KETU_REQUIRES_FOOD"
  });
  engine.createOrder({ orderType: "PER_KETU", items: [{ productId: "kombinim-skare", qty: 1 }] });
});

test("pagesa e përfundon porosinë dhe e liron tavolinën", () => {
  const { db, engine } = makeEngine();
  const order = engine.createOrder({ orderType: "TAVOLINE", tableNumber: 7, waiter: "Blerta", items: [{ productId: "kafe", qty: 1 }] });

  assert.throws(() => engine.payOrder(order.id, { method: "cash", amount: 0.5 }), { code: "PAYMENT_AMOUNT_INSUFFICIENT" });

  const paid = engine.payOrder(order.id, { method: "cash", amount: 5 }, "Blerta");
  assert.equal(paid.status, "paid");
  assert.equal(paid.payment.method, "cash");
  assert.equal(paid.payment.change, 4.3);
  assert.equal(paid.payment.by, "Blerta");
  assert.ok(paid.paidAt);
  assert.ok(paid.events.some((e) => e.type === "paguar"));

  assert.throws(() => engine.payOrder(order.id, { method: "cash" }), { code: "ORDER_ALREADY_PAID" });
  assert.throws(() => engine.addItems(order.id, [{ productId: "kafe", qty: 1 }]), { code: "ORDER_NOT_OPEN" });

  /* Tavolina 7 është e lirë përsëri */
  engine.createOrder({ orderType: "TAVOLINE", tableNumber: 7, items: [{ productId: "kafe", qty: 1 }] });
  assert.equal(engine.getSummary().occupiedTables, 1);
  assert.ok(db.logs.some((entry) => entry.action.includes("u pagua")), db.logs[0].action);
});

test("anulimi kërkon arsye dhe e heq porosinë nga aktivet", () => {
  const { engine } = makeEngine();
  const order = engine.createOrder({ orderType: "EMER", customerName: "Bastria", items: [{ productId: "kafe", qty: 1 }] });
  assert.throws(() => engine.cancelOrder(order.id, ""), { code: "CANCEL_REASON_REQUIRED" });
  const cancelled = engine.cancelOrder(order.id, "Klienti nuk erdhi", "Ardit");
  assert.equal(cancelled.status, "cancelled");
  assert.equal(engine.listOrders({ status: "open" }).length, 0);
  assert.equal(engine.listOrders({ status: "cancelled" }).length, 1);
});

test("identiteti i porosisë mund të ndryshohet sipas rregullave", () => {
  const { engine } = makeEngine();
  const order = engine.createOrder({
    orderType: "ME_VETI",
    items: [{ productId: "hamburger-pomfrit", qty: 1 }, { productId: "coca-cola", qty: 1 }]
  });

  const changed = engine.changeIdentity(order.id, { orderType: "TAVOLINE", tableNumber: 20 }, "Ardit");
  assert.equal(changed.orderType, "TAVOLINE");
  assert.equal(changed.tableNumber, 20);

  /* Tani pijet vetëm lejohen, prandaj ushqimi mund të hiqet */
  const foodKey = changed.items.find((i) => i.isFood).key;
  engine.removeItem(changed.id, foodKey, "Ardit");
  assert.equal(changed.items.length, 1);

  /* Kthimi në «Me veti» pa ushqim ndalohet */
  assert.throws(() => engine.changeIdentity(changed.id, { orderType: "ME_VETI" }), { code: "ME_VETI_REQUIRES_FOOD" });

  /* Nuk mund të kalojë në një tavolinë të zënë */
  engine.createOrder({ orderType: "TAVOLINE", tableNumber: 33, items: [{ productId: "kafe", qty: 1 }] });
  assert.throws(() => engine.changeIdentity(changed.id, { orderType: "TAVOLINE", tableNumber: 33 }), { code: "TABLE_BUSY" });
});

test("kërkesa e dërguar drejtpërdrejt me «Me veti» + Kokakolla refuzohet", () => {
  const { engine } = makeEngine();
  assert.throws(
    () =>
      engine.createOrder({
        orderType: "ME_VETI",
        tableNumber: null,
        customerName: "",
        items: [{ productId: "coca-cola", qty: 1, price: 1, isFood: true, kind: "ushqim" }]
      }),
    (error) => {
      assert.ok(error instanceof RuleError);
      assert.equal(error.message, 'Porosia "Me veti" duhet të përmbajë të paktën një produkt ushqimor.');
      return true;
    }
  );
});

test("porosia bosh nuk krijohet", () => {
  const { engine } = makeEngine();
  assert.throws(() => engine.createOrder({ orderType: "TAVOLINE", tableNumber: 5, items: [] }), { code: "EMPTY_ORDER" });
  assert.throws(
    () => engine.createOrder({ orderType: "TAVOLINE", tableNumber: 5, items: [{ productId: "nuk-ekziston", qty: 1 }] }),
    { code: "PRODUCT_NOT_FOUND" }
  );
});

test("kërkimi dhe filtrat e historikut", () => {
  const { engine } = makeEngine();
  const table = engine.createOrder({ orderType: "TAVOLINE", tableNumber: 50, items: [{ productId: "kafe", qty: 1 }] });
  engine.createOrder({ orderType: "EMER", customerName: "Bastria", items: [{ productId: "trileqe", qty: 1 }] });
  engine.createOrder({ orderType: "ME_VETI", items: [{ productId: "hamburger-pomfrit", qty: 1 }] });
  engine.createOrder({ orderType: "PER_KETU", items: [{ productId: "kombinim-skare", qty: 1 }] });
  engine.payOrder(table.id, { method: "card" }, "Ardit");

  assert.equal(engine.listOrders({ q: "Tavolina 50" }).length, 1);
  assert.equal(engine.listOrders({ q: "Bastria" }).length, 1);
  assert.equal(engine.listOrders({ orderType: "ME_VETI" }).length, 1);
  assert.equal(engine.listOrders({ orderType: "PER_KETU" }).length, 1);
  assert.equal(engine.listOrders({ status: "paid" }).length, 1);
  assert.equal(engine.listOrders({ status: "open" }).length, 3);
  assert.equal(engine.listOrders({ tableNumber: 50 }).length, 1);

  const summary = engine.getSummary();
  assert.equal(summary.tableCount, 50);
  assert.equal(summary.occupiedTables, 0);
  assert.equal(summary.activeOrders, 3);
  assert.equal(summary.paidToday, 1);
  assert.equal(summary.revenueToday, 0.7);
});

test("kuzhina shënon porosinë si gati", () => {
  const { engine } = makeEngine();
  const order = engine.createOrder({ orderType: "TAVOLINE", tableNumber: 3, items: [{ productId: "qebapa", qty: 4 }] });
  assert.equal(engine.setKitchenReady(order.id, true).kitchenReady, true);
  assert.equal(engine.setKitchenReady(order.id, false).kitchenReady, false);
});
