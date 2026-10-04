/* ============================================================
   SHARRI — Motori i porosisë (logjika e biznesit)

   Ky motor përdoret nga:
     • server/index.js  → validim i detyrueshëm në server
     • lib/store.js     → e njëjta logjikë kur faqja hapet pa server

   Pra rregullat janë të njëjta kudo dhe nuk mund të anashkalohen.
   ============================================================ */

import { TABLE_COUNT } from "./catalog.js";
import {
  ORDER_STATUS,
  PAYMENT_METHODS,
  RuleError,
  cleanText,
  computeTotals,
  counters,
  fail,
  findActiveOrderByTable,
  isActive,
  isPaid,
  newItemKey,
  normalizeItems,
  normalizeOrderType,
  orderLabel,
  productKind,
  validateOrderDraft,
  validatePayment
} from "./rules.js";

export function createEngine({ db, persist = () => {}, now = () => new Date() }) {
  const findProduct = (id) => db.products.find((p) => p.id === id) || null;
  const tableCount = () => Number(db.settings?.tableCount || TABLE_COUNT);

  function stamp() {
    return now().toISOString();
  }

  function log(action, actor) {
    db.logs = db.logs || [];
    db.logs.unshift({
      id: uid(),
      at: stamp(),
      user: actor || "sistemi",
      action
    });
    if (db.logs.length > 500) db.logs.length = 500;
  }

  function addEvent(order, type, message, actor) {
    order.events = order.events || [];
    order.events.push({ at: stamp(), by: actor || order.waiter || "sistemi", type, message });
  }

  function totalsFor(order) {
    const totals = computeTotals(order.items, db.settings);
    order.subtotal = totals.subtotal;
    order.vat = totals.vat;
    order.total = totals.total;
    order.itemCount = totals.count;
    return totals;
  }

  /* Rivalidimi i plotë i porosisë (përdoret në çdo ndryshim) */
  function revalidate(order) {
    validateOrderDraft(
      {
        orderType: order.orderType,
        tableNumber: order.tableNumber,
        customerName: order.customerName,
        items: order.items
      },
      { tableCount: tableCount(), orders: db.orders, findProduct, orderId: order.id }
    );
  }

  function orderNumber() {
    db.counters = db.counters || { orders: 0, cashReports: 0 };
    db.counters.orders = Number(db.counters.orders || 0) + 1;
    const date = now();
    const datePart = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
    return `SH-${datePart}-${String(db.counters.orders).padStart(3, "0")}`;
  }

  function getOrderOrThrow(id) {
    const order = db.orders.find((o) => o.id === id);
    if (!order) fail("ORDER_NOT_FOUND");
    return order;
  }

  /* ---------- Krijimi i porosisë ---------- */
  function createOrder(payload = {}) {
    const items = normalizeItems(payload.items || [], { findProduct });
    if (!items.length) fail("EMPTY_ORDER");

    const draft = validateOrderDraft(
      {
        orderType: payload.orderType,
        tableNumber: payload.tableNumber,
        customerName: payload.customerName,
        items
      },
      { tableCount: tableCount(), orders: db.orders, findProduct }
    );

    const waiter = cleanText(payload.waiter, 40);
    const order = {
      id: uid(),
      number: orderNumber(),
      createdAt: stamp(),
      updatedAt: stamp(),
      orderType: draft.orderType,
      tableNumber: draft.tableNumber,
      customerName: draft.customerName || "",
      customer: payload.customer ? cleanText(payload.customer, 60) : draft.customerName || "",
      phone: cleanText(payload.phone || "", 30),
      note: cleanText(payload.note || "", 240),
      channel: payload.channel === "internet" ? "internet" : "kamarier",
      status: ORDER_STATUS.OPEN,
      kitchenReady: false,
      items,
      subtotal: 0,
      vat: 0,
      total: 0,
      itemCount: 0,
      waiter,
      payment: null,
      paidAt: null,
      events: []
    };

    totalsFor(order);
    addEvent(order, "krijuar", `Porosia u krijua (${orderLabel(order)})`, waiter);

    db.orders.unshift(order);
    log(`Porosia ${order.number} u krijua — ${orderLabel(order)}${waiter ? ` — kamarieri: ${waiter}` : ""}`, waiter);
    persist();
    return order;
  }

  /* ---------- Shtimi i produkteve në porosi ekzistuese ---------- */
  function addItems(orderId, rawItems = [], actor = "") {
    const order = getOrderOrThrow(orderId);
    if (!isActive(order)) fail("ORDER_NOT_OPEN");

    const incoming = normalizeItems(rawItems, { findProduct });
    if (!incoming.length) fail("EMPTY_ORDER");

    /* Provë para se të preket porosia — nëse bie ndesh me rregullat, nuk ndryshohet asgjë */
    const trial = order.items.map((item) => ({ ...item }));
    for (const item of incoming) {
      const existing = trial.find((i) => i.productId === item.productId && !i.note && !item.note);
      if (existing) existing.qty += item.qty;
      else trial.push({ ...item, key: item.key || newItemKey() });
    }
    validateTrial(order, trial);

    order.items = trial;
    totalsFor(order);
    order.updatedAt = stamp();
    addEvent(
      order,
      "produkt_shtuar",
      incoming.map((i) => `${i.qty}× ${i.name}`).join(", "),
      actor
    );
    log(`Porosia ${order.number} — u shtuan: ${incoming.map((i) => `${i.qty}× ${i.name}`).join(", ")}`, actor || order.waiter);
    persist();
    return order;
  }

  /* Validimi i një versioni provë të porosisë (pa e ruajtur) */
  function validateTrial(order, trialItems) {
    const totals = computeTotals(trialItems, db.settings);
    validateOrderDraft(
      {
        orderType: order.orderType,
        tableNumber: order.tableNumber,
        customerName: order.customerName,
        items: trialItems
      },
      { tableCount: tableCount(), orders: db.orders, findProduct, orderId: order.id }
    );
    return totals;
  }

  function updateItem(orderId, key, patch = {}, actor = "") {
    const order = getOrderOrThrow(orderId);
    if (!isActive(order)) fail("ORDER_NOT_OPEN");

    const item = order.items.find((i) => i.key === key);
    if (!item) fail("ITEM_NOT_FOUND");

    if (patch.qty !== undefined && Number(patch.qty) === 0) return removeItem(orderId, key, actor);

    const trial = order.items.map((i) => ({ ...i }));
    const trialItem = trial.find((i) => i.key === key);

    if (patch.qty !== undefined) {
      const qty = Number(patch.qty);
      if (!Number.isInteger(qty) || qty < 1 || qty > 999) fail("QTY_INVALID");
      trialItem.qty = qty;
    }
    if (patch.note !== undefined) trialItem.note = cleanText(patch.note, 140);
    validateTrial(order, trial);

    order.items = trial;
    totalsFor(order);
    order.updatedAt = stamp();
    addEvent(order, "produkt_ndryshuar", `${trialItem.qty}× ${trialItem.name}`, actor);
    log(`Porosia ${order.number} — u ndryshua: ${trialItem.qty}× ${trialItem.name}`, actor || order.waiter);
    persist();
    return order;
  }

  function removeItem(orderId, key, actor = "") {
    const order = getOrderOrThrow(orderId);
    if (!isActive(order)) fail("ORDER_NOT_OPEN");

    const item = order.items.find((i) => i.key === key);
    if (!item) fail("ITEM_NOT_FOUND");

    const trial = order.items.filter((i) => i.key !== key).map((i) => ({ ...i }));
    if (!trial.length) fail("EMPTY_ORDER");
    validateTrial(order, trial);

    order.items = trial;
    totalsFor(order);
    order.updatedAt = stamp();
    addEvent(order, "produkt_hiur", `${item.name}`, actor);
    log(`Porosia ${order.number} — u hoq: ${item.name}`, actor || order.waiter);
    persist();
    return order;
  }

  /* Ndryshimi i identitetit të porosisë (Tavolinë ↔ Me emër ↔ Me veti ↔ Për këtu)
     Rregullat rivlerësohen plotësisht: "Me veti"/"Për këtu" kërkojnë ushqim. */
  function changeIdentity(orderId, payload = {}, actor = "") {
    const order = getOrderOrThrow(orderId);
    if (!isActive(order)) fail("ORDER_NOT_OPEN");

    const draft = validateOrderDraft(
      {
        orderType: payload.orderType ?? order.orderType,
        tableNumber: payload.tableNumber !== undefined ? payload.tableNumber : order.tableNumber,
        customerName: payload.customerName !== undefined ? payload.customerName : order.customerName,
        items: order.items
      },
      { tableCount: tableCount(), orders: db.orders, findProduct, orderId: order.id }
    );

    order.orderType = draft.orderType;
    order.tableNumber = draft.tableNumber;
    order.customerName = draft.customerName || "";
    if (draft.orderType === "EMER" && !order.customer) order.customer = draft.customerName;
    order.updatedAt = stamp();
    addEvent(order, "identiteti", `Porosia u lidh me: ${orderLabel(order)}`, actor);
    log(`Porosia ${order.number} — u ndryshua identifikuesi: ${orderLabel(order)}`, actor || order.waiter);
    persist();
    return order;
  }

  function setNote(orderId, note, actor = "") {
    const order = getOrderOrThrow(orderId);
    if (!isActive(order)) fail("ORDER_NOT_OPEN");
    order.note = cleanText(note, 240);
    order.updatedAt = stamp();
    addEvent(order, "shenim", order.note || "Shënimi u fshi", actor);
    persist();
    return order;
  }

  /* ---------- Pagesa ---------- */
  function payOrder(orderId, payload = {}, actor = "") {
    const order = getOrderOrThrow(orderId);
    /* Rivalidim i plotë para pagesës — nuk lejohet "Me veti" vetëm me pije */
    revalidate(order);

    const payment = validatePayment(order, payload);
    const who = cleanText(actor || payload.waiter || order.waiter, 40);

    order.status = ORDER_STATUS.PAID;
    order.paidAt = stamp();
    order.updatedAt = order.paidAt;
    order.waiter = who || order.waiter;
    order.payment = {
      method: payment.method,
      amount: payment.amount,
      change: payment.change,
      at: order.paidAt,
      by: who || "kamarieri"
    };
    if (!order.payment.method || !PAYMENT_METHODS.includes(order.payment.method)) fail("PAYMENT_METHOD_UNKNOWN");

    addEvent(
      order,
      "paguar",
      `Pagesa u përfundua — ${payment.method === "cash" ? "Para të gatshme" : payment.method === "card" ? "Kartelë" : "Tjetër"} (${payment.amount.toFixed(2)}€)`,
      who
    );
    log(`Porosia ${order.number} u pagua — ${orderLabel(order)} — totali ${order.total.toFixed(2)}€`, who || order.waiter);
    persist();
    return order;
  }

  function cancelOrder(orderId, reason = "", actor = "") {
    const order = getOrderOrThrow(orderId);
    if (isPaid(order)) fail("ORDER_ALREADY_PAID");
    if (!isActive(order)) fail("ORDER_NOT_OPEN");
    const why = cleanText(reason, 200);
    if (!why) fail("CANCEL_REASON_REQUIRED");

    order.status = ORDER_STATUS.CANCELLED;
    order.updatedAt = stamp();
    order.cancelReason = why;
    addEvent(order, "anuluar", `U anulua: ${why}`, actor);
    log(`Porosia ${order.number} u anulua — ${orderLabel(order)} — arsyeja: ${why}`, actor || order.waiter);
    persist();
    return order;
  }

  function setKitchenReady(orderId, ready, actor = "") {
    const order = getOrderOrThrow(orderId);
    if (!isActive(order)) fail("ORDER_NOT_OPEN");
    order.kitchenReady = Boolean(ready);
    order.updatedAt = stamp();
    addEvent(order, "kuzhina", order.kitchenReady ? "Porosia është gati" : "Porosia është në përgatitje", actor);
    log(`Porosia ${order.number} — kuzhina: ${order.kitchenReady ? "gati" : "në përgatitje"}`, actor);
    persist();
    return order;
  }

  /* ---------- Leximi ---------- */
  function listOrders(filters = {}) {
    let list = db.orders.slice();
    const status = String(filters.status || "all");
    if (status !== "all") list = list.filter((o) => o.status === status);
    if (filters.activeOnly) list = list.filter(isActive);

    const type = normalizeOrderType(filters.orderType);
    if (type) list = list.filter((o) => o.orderType === type);

    if (filters.tableNumber) {
      const table = Number(filters.tableNumber);
      list = list.filter((o) => Number(o.tableNumber) === table);
    }

    if (filters.date) {
      list = list.filter((o) => String(o.createdAt || "").slice(0, 10) === String(filters.date));
    }

    const q = cleanText(filters.q || "", 60).toLowerCase();
    if (q) {
      list = list.filter((o) => {
        const haystack = [
          o.number,
          o.customerName,
          o.customer,
          o.phone,
          o.waiter,
          o.note,
          o.tableNumber ? `Tavolina ${o.tableNumber}` : "",
          o.tableNumber ? String(o.tableNumber) : "",
          orderLabel(o),
          ...(o.items || []).map((i) => i.name)
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      });
    }

    return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  function getSummary() {
    const c = counters(db.orders, tableCount());
    const today = now();
    today.setHours(0, 0, 0, 0);
    const paidToday = db.orders.filter((o) => isPaid(o) && new Date(o.paidAt || o.createdAt) >= today);
    const revenueToday = paidToday.reduce((sum, o) => sum + Number(o.total || 0), 0);
    const openOrders = db.orders.filter(isActive);

    return {
      ...c,
      revenueToday: Math.round(revenueToday * 100) / 100,
      paidToday: paidToday.length,
      openTotal: Math.round(openOrders.reduce((sum, o) => sum + Number(o.total || 0), 0) * 100) / 100,
      ordersTotal: db.orders.length
    };
  }

  function getCatalog() {
    return {
      settings: db.settings,
      categories: db.categories,
      products: db.products,
      tableCount: tableCount(),
      tables: occupiedTableList()
    };
  }

  function occupiedTableList() {
    const busy = new Set(
      db.orders
        .filter((o) => isActive(o) && o.orderType === "TAVOLINE")
        .map((o) => Number(o.tableNumber))
    );
    const tables = [];
    for (let i = 1; i <= tableCount(); i++) {
      const order = busy.has(i) ? findActiveOrderByTable(db.orders, i) : null;
      tables.push({ number: i, busy: busy.has(i), orderId: order?.id || null, total: order?.total || 0 });
    }
    return tables;
  }

  /* ---------- Produktet / cilësimet (administratori) ---------- */
  function saveProduct(payload = {}, actor = "") {
    const name = cleanText(payload.name, 80);
    const price = Number(payload.price);
    if (!name) throw new RuleError("PRODUCT_NAME_REQUIRED");
    if (!Number.isFinite(price) || price < 0) throw new RuleError("PRODUCT_PRICE_INVALID");

    const kind = payload.kind === "pije" ? "pije" : payload.kind === "ushqim" ? "ushqim" : null;
    const data = {
      name,
      category: cleanText(payload.category, 40) || "torte",
      price: Math.round(price * 100) / 100,
      unit: payload.unit === "piece" ? "piece" : null,
      emoji: cleanText(payload.emoji || "🍽️", 8),
      image: String(payload.image || ""),
      desc: cleanText(payload.desc || "", 240),
      kind,
      keywords: cleanText(payload.keywords || "", 120),
      popular: Boolean(payload.popular),
      daily: Boolean(payload.daily),
      family: Boolean(payload.family),
      special: Boolean(payload.special),
      available: payload.available === undefined ? true : Boolean(payload.available),
      hidden: Boolean(payload.hidden)
    };

    let product;
    if (payload.id) {
      product = findProduct(payload.id);
      if (!product) throw new RuleError("PRODUCT_NOT_FOUND");
      Object.assign(product, data);
      log(`Produkti u ndryshua: ${name}`, actor);
    } else {
      product = { id: uid(), created: Date.now(), ...data };
      db.products.push(product);
      log(`Produkti u krijua: ${name}`, actor);
    }
    persist();
    return product;
  }

  function deleteProduct(id, actor = "") {
    const product = findProduct(id);
    if (!product) throw new RuleError("PRODUCT_NOT_FOUND");
    db.products = db.products.filter((p) => p.id !== id);
    log(`Produkti u fshi: ${product.name}`, actor);
    persist();
    return { id };
  }

  function saveSettings(payload = {}, actor = "") {
    const tableCountValue = Number(payload.tableCount ?? db.settings.tableCount ?? TABLE_COUNT);
    db.settings = {
      ...db.settings,
      ...payload,
      taxRate: Number(payload.taxRate ?? db.settings.taxRate ?? 0),
      taxIncluded: Boolean(payload.taxIncluded ?? db.settings.taxIncluded),
      tableCount: Number.isInteger(tableCountValue) && tableCountValue > 0 && tableCountValue <= 200 ? tableCountValue : TABLE_COUNT,
      waiters: Array.isArray(payload.waiters)
        ? payload.waiters.map((w) => cleanText(w, 40)).filter(Boolean)
        : db.settings.waiters || []
    };
    log("Cilësimet u përditësuan", actor);
    persist();
    return db.settings;
  }

  /* ---------- Raportet e arkës ---------- */
  function saveCashReport(report = {}, actor = "") {
    db.cashReports = db.cashReports || [];
    db.counters = db.counters || { orders: 0, cashReports: 0 };
    const cashier = cleanText(report.cashier, 60);
    if (!cashier) throw new RuleError("CASHIER_REQUIRED");

    const record = { ...report, cashier, updatedAt: stamp(), updatedBy: actor };
    if (report.id) {
      const index = db.cashReports.findIndex((r) => r.id === report.id);
      if (index >= 0) db.cashReports[index] = record;
      else db.cashReports.unshift(record);
    } else {
      db.counters.cashReports = Number(db.counters.cashReports || 0) + 1;
      const date = now();
      record.id = uid();
      record.createdAt = stamp();
      record.createdBy = actor;
      record.number = `ARK-${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}-${String(db.counters.cashReports).padStart(3, "0")}`;
      db.cashReports.unshift(record);
    }
    log(`Raporti i arkës ${record.number} u ruajt`, actor);
    persist();
    return record;
  }

  function deleteCashReport(id, actor = "") {
    db.cashReports = db.cashReports || [];
    const report = db.cashReports.find((r) => r.id === id);
    if (!report) throw new RuleError("CASH_REPORT_NOT_FOUND");
    db.cashReports = db.cashReports.filter((r) => r.id !== id);
    log(`Raporti i arkës ${report.number || id} u fshi`, actor);
    persist();
    return { id };
  }

  return {
    db,
    findProduct,
    tableCount,
    listOrders,
    getOrder: getOrderOrThrow,
    createOrder,
    addItems,
    updateItem,
    removeItem,
    changeIdentity,
    setNote,
    payOrder,
    cancelOrder,
    setKitchenReady,
    getSummary,
    getCatalog,
    occupiedTableList,
    saveProduct,
    deleteProduct,
    saveSettings,
    saveCashReport,
    deleteCashReport,
    log: (action, actor) => {
      log(action, actor);
      persist();
    },
    productKind
  };
}

export function uid() {
  const cryptoRef = globalThis.crypto;
  if (cryptoRef?.randomUUID) return cryptoRef.randomUUID();
  return `id-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}
