/* Testet e rregullave të porosisë (zero varësi: node --test) */
import assert from "node:assert/strict";
import test from "node:test";

import { defaultDB, defaultProducts } from "../lib/catalog.js";
import {
  ERRORS,
  RuleError,
  counters,
  hasFood,
  migrateOrder,
  normalizeOrderType,
  normalizeTableNumber,
  orderLabel,
  productKind,
  validateOrderDraft,
  validatePayment
} from "../lib/rules.js";

const db = defaultDB();
const findProduct = (id) => db.products.find((p) => p.id === id) || null;
const context = (extra = {}) => ({ tableCount: 50, orders: [], findProduct, ...extra });

const item = (productId, qty = 1) => ({ productId, qty });

test("llojet e porosisë njihen edhe me shkrime të ndryshme", () => {
  assert.equal(normalizeOrderType("TAVOLINE"), "TAVOLINE");
  assert.equal(normalizeOrderType("tavolinë"), "TAVOLINE");
  assert.equal(normalizeOrderType("me veti"), "ME_VETI");
  assert.equal(normalizeOrderType("ME_VETI"), "ME_VETI");
  assert.equal(normalizeOrderType("takeout"), "ME_VETI");
  assert.equal(normalizeOrderType("për këtu"), "PER_KETU");
  assert.equal(normalizeOrderType("dine_in"), "PER_KETU");
  assert.equal(normalizeOrderType("me emër"), "EMER");
  assert.equal(normalizeOrderType("gabim"), null);
});

test("numri i tavolinës është mes 1 dhe 50", () => {
  assert.equal(normalizeTableNumber(12), 12);
  assert.equal(normalizeTableNumber("7"), 7);
  assert.equal(normalizeTableNumber(""), null);
  assert.throws(() => normalizeTableNumber(0), RuleError);
  assert.throws(() => normalizeTableNumber(51), RuleError);
  assert.throws(() => normalizeTableNumber("abc"), RuleError);
});

test("produktet ndahen në ushqim dhe pije", () => {
  assert.equal(productKind(findProduct("hamburger-pomfrit")), "ushqim");
  assert.equal(productKind(findProduct("trileqe")), "ushqim");
  assert.equal(productKind(findProduct("coca-cola")), "pije");
  assert.equal(productKind(findProduct("kafe")), "pije");
  assert.equal(productKind(findProduct("caj")), "pije");
  assert.equal(productKind(findProduct("birra")), "pije");
  assert.equal(productKind({ ...findProduct("coca-cola"), kind: "ushqim" }), "ushqim");
});

/* -------- Matrica e validimit (rregulli 23) -------- */
test("ushqim lejohet në të katër llojet", () => {
  for (const orderType of ["TAVOLINE", "EMER", "ME_VETI", "PER_KETU"]) {
    const draft = {
      orderType,
      tableNumber: orderType === "TAVOLINE" ? 10 : null,
      customerName: orderType === "EMER" ? "Bastria" : "",
      items: [item("hamburger-pomfrit")]
    };
    const result = validateOrderDraft(draft, context());
    assert.equal(result.orderType, orderType);
  }
});

test("ushqim + pije lejohet në të katër llojet", () => {
  for (const orderType of ["TAVOLINE", "EMER", "ME_VETI", "PER_KETU"]) {
    validateOrderDraft(
      {
        orderType,
        tableNumber: orderType === "TAVOLINE" ? 11 : null,
        customerName: orderType === "EMER" ? "Enver" : "",
        items: [item("hamburger-pomfrit"), item("coca-cola")]
      },
      context()
    );
  }
});

test("vetëm pije → «Me veti» ndalohet", () => {
  assert.throws(
    () => validateOrderDraft({ orderType: "ME_VETI", items: [item("coca-cola", 2)] }, context()),
    (error) => {
      assert.equal(error.code, "ME_VETI_REQUIRES_FOOD");
      assert.equal(error.message, ERRORS.ME_VETI_REQUIRES_FOOD);
      assert.equal(error.message, 'Porosia "Me veti" duhet të përmbajë të paktën një produkt ushqimor.');
      return true;
    }
  );
});

test("vetëm kafe → «Për këtu» ndalohet", () => {
  assert.throws(
    () => validateOrderDraft({ orderType: "PER_KETU", items: [item("kafe")] }, context()),
    { code: "PER_KETU_REQUIRES_FOOD" }
  );
});

test("vetëm pije lejohet në tavolinë ose me emër", () => {
  validateOrderDraft({ orderType: "TAVOLINE", tableNumber: 4, items: [item("coca-cola", 2)] }, context());
  validateOrderDraft({ orderType: "EMER", customerName: "Bastria", items: [item("kafe")] }, context());
});

test("ëmbëlsira vetëm ndjek rregullin e ushqimit", () => {
  validateOrderDraft({ orderType: "ME_VETI", items: [item("trileqe")] }, context());
  validateOrderDraft({ orderType: "PER_KETU", items: [item("torte-snikers")] }, context());
});

test("pijet e shumta nuk e bëjnë porosinë «ushqim»", () => {
  assert.equal(hasFood([item("coca-cola"), item("kafe"), item("birra")], findProduct), false);
  assert.equal(hasFood([item("coca-cola"), item("file-pule")], findProduct), true);
});

test("tavolina kërkon numër dhe nuk lejohet e zënë", () => {
  assert.throws(() => validateOrderDraft({ orderType: "TAVOLINE", items: [item("kafe")] }, context()), {
    code: "TABLE_REQUIRED"
  });

  const busy = {
    id: "p1",
    orderType: "TAVOLINE",
    tableNumber: 12,
    status: "open",
    items: [item("coca-cola", 2)]
  };
  assert.throws(
    () => validateOrderDraft({ orderType: "TAVOLINE", tableNumber: 12, items: [item("kafe")] }, context({ orders: [busy] })),
    (error) => {
      assert.equal(error.code, "TABLE_BUSY");
      assert.equal(error.message, "Tavolina 12 ka një porosi aktive.");
      return true;
    }
  );

  /* E njëjta porosi mund të ndryshohet pa u konsideruar dublikat */
  validateOrderDraft(
    { orderType: "TAVOLINE", tableNumber: 12, items: [item("kafe")] },
    context({ orders: [busy], orderId: "p1" })
  );

  /* Porosia e paguar nuk e mban tavolinën të zënë */
  validateOrderDraft(
    { orderType: "TAVOLINE", tableNumber: 12, items: [item("kafe")] },
    context({ orders: [{ ...busy, status: "paid" }] })
  );
});

test("«Me emër» kërkon identifikues", () => {
  assert.throws(() => validateOrderDraft({ orderType: "EMER", items: [item("kafe")] }, context()), {
    code: "NAME_REQUIRED"
  });
  assert.throws(() => validateOrderDraft({ orderType: "EMER", customerName: "   ", items: [item("kafe")] }, context()), {
    code: "NAME_REQUIRED"
  });
  const result = validateOrderDraft({ orderType: "EMER", customerName: "  Nfund te Ora  ", items: [item("kafe")] }, context());
  assert.equal(result.customerName, "Nfund te Ora");
});

test("lloj i panjohur porosie refuzohet", () => {
  assert.throws(() => validateOrderDraft({ orderType: "PIJE", items: [item("kafe")] }, context()), {
    code: "UNKNOWN_ORDER_TYPE"
  });
});

/* -------- Kundërmatësi i tavolinave (rregulli 3 dhe 26) -------- */
test("kundërmatësi numëron vetëm tavolinat fizike", () => {
  const orders = [
    { id: "1", orderType: "TAVOLINE", tableNumber: 2, status: "open" },
    { id: "2", orderType: "TAVOLINE", tableNumber: 7, status: "open" },
    { id: "3", orderType: "EMER", customerName: "Bastria", status: "open" },
    { id: "4", orderType: "ME_VETI", status: "open" },
    { id: "5", orderType: "PER_KETU", status: "open" },
    { id: "6", orderType: "TAVOLINE", tableNumber: 9, status: "paid" }
  ];
  const c = counters(orders, 50);
  assert.equal(c.tableCount, 50);
  assert.equal(c.occupiedTables, 2);
  assert.equal(c.freeTables, 48);
  assert.equal(c.activeOrders, 5);
  assert.equal(c.tableOrders, 2);
  assert.equal(c.nameOrders, 1);
  assert.equal(c.noTableOrders, 2);
  assert.deepEqual(c.occupiedTableNumbers, [2, 7]);
});

test("pas pagesës tavolina lirohet", () => {
  const orders = [{ id: "1", orderType: "TAVOLINE", tableNumber: 7, status: "open" }];
  assert.equal(counters(orders, 50).occupiedTables, 1);
  orders[0].status = "paid";
  assert.equal(counters(orders, 50).occupiedTables, 0);
});

/* -------- Etiketimi -------- */
test("etiketimi i porosisë", () => {
  assert.equal(orderLabel({ orderType: "TAVOLINE", tableNumber: 10 }), "Tavolina 10");
  assert.equal(orderLabel({ orderType: "EMER", customerName: "Bastria" }), "Bastria");
  assert.equal(orderLabel({ orderType: "ME_VETI" }), "Me veti");
  assert.equal(orderLabel({ orderType: "PER_KETU" }), "Për këtu");
});

/* -------- Pagesa -------- */
test("pagesa kërkon mënyrë të vlefshme dhe shumë të mjaftueshme", () => {
  const order = { id: "1", status: "open", total: 3.5 };
  assert.deepEqual(validatePayment(order, { method: "card" }), { method: "card", amount: 3.5, change: 0 });
  assert.deepEqual(validatePayment(order, { method: "cash", amount: 5 }), { method: "cash", amount: 5, change: 1.5 });
  assert.throws(() => validatePayment(order, {}), { code: "PAYMENT_METHOD_REQUIRED" });
  assert.throws(() => validatePayment(order, { method: "bitcoin" }), { code: "PAYMENT_METHOD_UNKNOWN" });
  assert.throws(() => validatePayment(order, { method: "cash", amount: 3 }), { code: "PAYMENT_AMOUNT_INSUFFICIENT" });
  assert.throws(() => validatePayment({ ...order, status: "paid" }, { method: "cash" }), { code: "ORDER_ALREADY_PAID" });
});

/* -------- Migrimi i të dhënave të vjetra -------- */
test("porositë e vjetra migrohen në llojet e reja", () => {
  const legacy = migrateOrder({
    id: "x",
    number: "SH-1",
    type: "dine_in",
    table: "14",
    customer: "Klienti",
    status: "preparing",
    items: [{ productId: "kafe", name: "Kafe", qty: 1, price: 0.7 }],
    createdAt: new Date().toISOString()
  });
  assert.equal(legacy.orderType, "TAVOLINE");
  assert.equal(legacy.tableNumber, 14);
  assert.equal(legacy.status, "open");

  const takeout = migrateOrder({ id: "y", type: "takeout", status: "completed", items: [] });
  assert.equal(takeout.orderType, "ME_VETI");
  assert.equal(takeout.status, "paid");

  const named = migrateOrder({ id: "z", type: "dine_in", customer: "Bastria", status: "cancelled", items: [] });
  assert.equal(named.orderType, "EMER");
  assert.equal(named.customerName, "Bastria");
  assert.equal(named.status, "cancelled");
});

test("katalogu përmban produktet e përmendura në rregulla", () => {
  const names = defaultProducts().map((p) => p.name.toLowerCase());
  for (const expected of ["kokakolla", "fanta", "birrë", "schweppes", "red bull", "golden eagle", "kafe", "çaj", "laqin", "file pule", "gjysmë pule", "kombinim skare", "mish viqi natyral", "pleskavicë sharri", "hamburger + pomfrit", "sandwich tuna", "torte trileqe", "torte snikers"]) {
    assert.ok(names.includes(expected), `mungon: ${expected}`);
  }
});
