/* ============================================================
   SHARRI — Rregullat e porosisë (burimi i vetëm i së vërtetës)

   Këto rregulla zbatohen EDHE në ndërfaqen e kamarierit EDHE
   në server (lib/rules.js importohet nga server/index.js).
   Asnjë rrugë nuk mund t'i anashkalojë.
   ============================================================ */

import { TABLE_COUNT } from "./catalog.js";

/* ---------- Llojet e porosisë ---------- */
export const ORDER_TYPES = ["TAVOLINE", "EMER", "ME_VETI", "PER_KETU"];

export const ORDER_TYPE_LABELS = {
  TAVOLINE: "Tavolinë",
  EMER: "Me emër",
  ME_VETI: "Me veti",
  PER_KETU: "Për këtu"
};

/* Cilët lloje kërkojnë patjetër ushqim */
export const FOOD_ONLY_TYPES = ["ME_VETI", "PER_KETU"];

/* ---------- Statuset ---------- */
export const ORDER_STATUS = { OPEN: "open", PAID: "paid", CANCELLED: "cancelled" };

export const ORDER_STATUS_LABELS = {
  open: "Aktive",
  paid: "Paguar",
  cancelled: "Anuluar"
};

/* ---------- Mënyrat e pagesës ---------- */
export const PAYMENT_METHODS = ["cash", "card", "other"];

export const PAYMENT_METHOD_LABELS = {
  cash: "Para të gatshme",
  card: "Kartelë",
  other: "Tjetër"
};

/* ---------- Lloji i produktit ---------- */
export const PRODUCT_KIND = { FOOD: "ushqim", DRINK: "pije" };

export const PRODUCT_KIND_LABELS = {
  ushqim: "Ushqim",
  pije: "Pije"
};

/* Kategoritë që numërohen si pije (kafe, çaj, birrë, pije freskuese...) */
export const DRINK_CATEGORIES = ["pije", "kafe", "alkool", "birra", "uje"];

/* ---------- Mesazhet e gabimeve (shqip) ---------- */
export const ERRORS = {
  UNKNOWN_ORDER_TYPE: 'Lloji i porosisë nuk njihet. Zgjidhni "Tavolinë", "Me emër", "Me veti" ose "Për këtu".',
  ME_VETI_REQUIRES_FOOD: 'Porosia "Me veti" duhet të përmbajë të paktën një produkt ushqimor.',
  PER_KETU_REQUIRES_FOOD: 'Porosia "Për këtu" duhet të përmbajë të paktën një produkt ushqimor.',
  DRINK_ONLY_NEEDS_LOCATION: "Porosia vetëm me pije duhet të lidhet me një tavolinë ose me një emër.",
  TABLE_REQUIRED: "Zgjidhni numrin e tavolinës.",
  TABLE_INVALID: "Numri i tavolinës duhet të jetë një numër i plotë.",
  TABLE_OUT_OF_RANGE: "Numri i tavolinës duhet të jetë mes 1 dhe {max}.",
  TABLE_BUSY: "Tavolina {table} ka një porosi aktive.",
  NAME_REQUIRED: "Shkruani emrin ose identifikuesin e porosisë.",
  NAME_TOO_LONG: "Emri është shumë i gjatë (më së shumti 60 shkronja).",
  EMPTY_ORDER: "Porosia nuk ka asnjë produkt.",
  PRODUCT_NOT_FOUND: "Produkti nuk u gjet.",
  PRODUCT_UNAVAILABLE: "Produkti nuk është i disponueshëm.",
  QTY_INVALID: "Sasia duhet të jetë një numër i plotë më i madh se zero.",
  ORDER_NOT_FOUND: "Porosia nuk u gjet.",
  ORDER_NOT_OPEN: "Porosia nuk është aktive.",
  ORDER_ALREADY_PAID: "Porosia është paguar tashmë.",
  PAYMENT_METHOD_REQUIRED: "Zgjidhni mënyrën e pagesës.",
  PAYMENT_METHOD_UNKNOWN: "Mënyra e pagesës nuk njihet.",
  PAYMENT_AMOUNT_INVALID: "Shuma e dhënë nuk është e saktë.",
  PAYMENT_AMOUNT_INSUFFICIENT: "Shuma e dhënë nuk mjafton për totalin.",
  CANCEL_REASON_REQUIRED: "Shkruani arsyen e anulimit.",
  ITEM_NOT_FOUND: "Produkti nuk gjendet në këtë porosi.",
  TABLE_NOT_USED: "Kjo tavolinë nuk ka porosi aktive.",
  WAITER_REQUIRED: "Zgjidhni kamarierin.",
  PRODUCT_NAME_REQUIRED: "Shkruani emrin e produktit.",
  PRODUCT_PRICE_INVALID: "Çmimi duhet të jetë një numër i saktë (zero ose më i madh).",
  CASHIER_REQUIRED: "Plotësoni kasierin.",
  CASH_REPORT_NOT_FOUND: "Raporti i arkës nuk u gjet.",
  LOGIN_REQUIRED: "Ju duhet të jeni administrator për këtë veprim.",
  LOGIN_FAILED: "Kredencialet janë të pasakta.",
  LOGIN_LOCKED: "Shumë tentativa. Prisni 5 minuta."
};

export class RuleError extends Error {
  constructor(code, vars = {}, messageOverride = null) {
    super(messageOverride || formatError(code, vars));
    this.name = "RuleError";
    this.code = code;
    this.vars = vars;
  }
}

export function formatError(code, vars = {}) {
  let message = ERRORS[code] || code;
  for (const [key, value] of Object.entries(vars)) {
    message = message.replaceAll(`{${key}}`, String(value));
  }
  return message;
}

export function fail(code, vars) {
  throw new RuleError(code, vars);
}

/* ---------- Ndihmëse ---------- */
export function cleanText(value, max = 60) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function normalizeOrderType(raw) {
  const value = String(raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!value) return null;

  const direct = {
    tavoline: "TAVOLINE",
    tavolina: "TAVOLINE",
    table: "TAVOLINE",
    emer: "EMER",
    emri: "EMER",
    name: "EMER",
    me_emer: "EMER",
    me_veti: "ME_VETI",
    meveti: "ME_VETI",
    takeout: "ME_VETI",
    takeaway: "ME_VETI",
    per_ketu: "PER_KETU",
    perkettu: "PER_KETU",
    dine_in: "PER_KETU",
    haj_ketu: "PER_KETU",
    ketu: "PER_KETU"
  };

  const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return direct[value] || direct[normalized] || null;
}

export function normalizeTableNumber(raw, tableCount = TABLE_COUNT) {
  if (raw === null || raw === undefined || raw === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) fail("TABLE_INVALID");
  const table = Math.trunc(value);
  if (!Number.isInteger(table) || table < 1 || table > tableCount) {
    fail("TABLE_OUT_OF_RANGE", { max: tableCount });
  }
  return table;
}

/* ---------- Ushqim apo pije? ---------- */
export function categoryOf(product) {
  return String(product?.category ?? "").toLowerCase();
}

export function productKind(product) {
  if (!product) return PRODUCT_KIND.FOOD;
  const kind = String(product.kind ?? "").toLowerCase();
  if (kind === PRODUCT_KIND.DRINK || kind === PRODUCT_KIND.FOOD) return kind;
  /* Nëse produkti nuk e ka shenjën, vendoset nga kategoria */
  return DRINK_CATEGORIES.includes(categoryOf(product)) ? PRODUCT_KIND.DRINK : PRODUCT_KIND.FOOD;
}

export function isFoodProduct(product) {
  return productKind(product) === PRODUCT_KIND.FOOD;
}

export function isDrinkProduct(product) {
  return productKind(product) === PRODUCT_KIND.DRINK;
}

/* Nëse një produkt është ushqim — përdoret për artikujt e porosisë */
export function itemIsFood(item, findProduct = null) {
  if (typeof item?.isFood === "boolean") return item.isFood;
  if (item?.kind) return item.kind === PRODUCT_KIND.FOOD;
  const product = findProduct ? findProduct(item?.productId) : null;
  if (product) return isFoodProduct(product);
  return false;
}

export function hasFood(items = [], findProduct = null) {
  return items.some((item) => Number(item?.qty || 0) > 0 && itemIsFood(item, findProduct));
}

export function hasDrinks(items = [], findProduct = null) {
  return items.some((item) => Number(item?.qty || 0) > 0 && !itemIsFood(item, findProduct));
}

/* ---------- Etiketimi i porosisë ---------- */
export function orderLabel(order) {
  if (!order) return "";
  const type = normalizeOrderType(order.orderType);
  if (type === "TAVOLINE") return `Tavolina ${order.tableNumber ?? ""}`.trim();
  if (type === "EMER") return cleanText(order.customerName, 60) || "Me emër";
  if (type === "ME_VETI") return "Me veti";
  if (type === "PER_KETU") return "Për këtu";
  return "Porosi";
}

export function orderTypeLabel(type) {
  const normalized = normalizeOrderType(type);
  return ORDER_TYPE_LABELS[normalized] || "Porosi";
}

/* ---------- Statuset ---------- */
export function isActive(order) {
  return order && order.status === ORDER_STATUS.OPEN;
}

export function isPaid(order) {
  return order && order.status === ORDER_STATUS.PAID;
}

export function isCancelled(order) {
  return order && order.status === ORDER_STATUS.CANCELLED;
}

export function activeOrders(orders = []) {
  return orders.filter(isActive);
}

export function activeTableOrders(orders = []) {
  return activeOrders(orders).filter((order) => normalizeOrderType(order.orderType) === "TAVOLINE");
}

export function occupiedTables(orders = []) {
  const tables = new Set();
  for (const order of activeTableOrders(orders)) {
    const table = Number(order.tableNumber);
    if (Number.isInteger(table) && table > 0) tables.add(table);
  }
  return [...tables].sort((a, b) => a - b);
}

export function findActiveOrderByTable(orders = [], tableNumber) {
  const table = Number(tableNumber);
  return activeTableOrders(orders).find((order) => Number(order.tableNumber) === table) || null;
}

/* Numërimet e ekranit kryesor: tavolina të zëna / të lira / porosi aktive */
export function counters(orders = [], tableCount = TABLE_COUNT) {
  const active = activeOrders(orders);
  const tables = occupiedTables(active);
  const tableOrders = active.filter((o) => normalizeOrderType(o.orderType) === "TAVOLINE");
  const nameOrders = active.filter((o) => normalizeOrderType(o.orderType) === "EMER");
  const noTableOrders = active.filter((o) =>
    ["ME_VETI", "PER_KETU"].includes(normalizeOrderType(o.orderType))
  );

  return {
    tableCount,
    occupiedTables: tables.length,
    freeTables: Math.max(0, tableCount - tables.length),
    activeOrders: active.length,
    tableOrders: tableOrders.length,
    nameOrders: nameOrders.length,
    noTableOrders: noTableOrders.length,
    occupiedTableNumbers: tables
  };
}

/* ---------- Totale ---------- */
export function computeTotals(items = [], settings = {}) {
  const rate = Number(settings.taxRate || 0) / 100;
  const subtotal = items.reduce(
    (sum, item) => sum + Number(item.price || 0) * Number(item.qty || 0),
    0
  );
  let vat = 0;
  let total = subtotal;
  if (settings.taxIncluded) {
    vat = subtotal - subtotal / (1 + rate);
  } else {
    vat = subtotal * rate;
    total = subtotal + vat;
  }
  const round = (n) => Math.round(n * 100) / 100;
  return {
    subtotal: round(subtotal),
    vat: round(vat),
    total: round(total),
    count: items.reduce((sum, item) => sum + Number(item.qty || 0), 0)
  };
}

/* ============================================================
   VALIDIMI QENDROR — përdoret nga serveri dhe nga ruajtja lokale
   draft: { orderType, tableNumber, customerName, items }
   ctx:   { tableCount, orders, findProduct, orderId }
   ============================================================ */
export function validateOrderDraft(draft = {}, ctx = {}) {
  const tableCount = Number(ctx.tableCount || TABLE_COUNT);
  const orders = Array.isArray(ctx.orders) ? ctx.orders : [];
  const findProduct = ctx.findProduct || (() => null);

  const orderType = normalizeOrderType(draft.orderType);
  if (!orderType) fail("UNKNOWN_ORDER_TYPE");

  const items = (draft.items || []).filter((item) => Number(item?.qty || 0) > 0);

  /* 1) Tavolina */
  let tableNumber = null;
  if (orderType === "TAVOLINE") {
    tableNumber = normalizeTableNumber(draft.tableNumber, tableCount);
    if (tableNumber === null) fail("TABLE_REQUIRED");

    const busy = orders.find(
      (order) =>
        isActive(order) &&
        normalizeOrderType(order.orderType) === "TAVOLINE" &&
        Number(order.tableNumber) === tableNumber &&
        order.id !== ctx.orderId
    );
    if (busy) fail("TABLE_BUSY", { table: tableNumber });
  }

  /* 2) Emri / identifikuesi */
  let customerName = "";
  if (orderType === "EMER") {
    customerName = cleanText(draft.customerName, 60);
    if (customerName.length < 1) fail("NAME_REQUIRED");
  }

  /* 3) Ushqimi për "Me veti" dhe "Për këtu" */
  if (FOOD_ONLY_TYPES.includes(orderType) && !hasFood(items, findProduct)) {
    fail(orderType === "ME_VETI" ? "ME_VETI_REQUIRES_FOOD" : "PER_KETU_REQUIRES_FOOD");
  }

  /* 4) Porosia vetëm me pije duhet të ketë tavolinë ose emër */
  if (items.length > 0 && !hasFood(items, findProduct) && !["TAVOLINE", "EMER"].includes(orderType)) {
    fail("DRINK_ONLY_NEEDS_LOCATION");
  }

  return {
    orderType,
    tableNumber,
    customerName: orderType === "EMER" ? customerName : cleanText(draft.customerName, 60),
    items
  };
}

/* Validimi i artikujve (çmimet merren gjithmonë nga katalogu) */
export function normalizeItems(rawItems = [], ctx = {}) {
  const findProduct = ctx.findProduct || (() => null);
  const items = [];

  for (const raw of rawItems) {
    const product = findProduct(raw?.productId || raw?.id);
    if (!product) fail("PRODUCT_NOT_FOUND");
    if (product.hidden || product.available === false) fail("PRODUCT_UNAVAILABLE");

    const qty = Number(raw?.qty ?? 1);
    if (!Number.isInteger(qty) || qty < 1 || qty > 999) fail("QTY_INVALID");

    const existingKey = raw?.key && items.find((i) => i.key === raw.key);
    if (existingKey) {
      existingKey.qty += qty;
      continue;
    }

    items.push({
      key: raw?.key || newItemKey(),
      productId: product.id,
      name: product.name,
      price: Number(product.price || 0),
      emoji: product.emoji || "🍽️",
      image: product.image || "",
      kind: productKind(product),
      isFood: isFoodProduct(product),
      unit: product.unit || null,
      qty,
      note: cleanText(raw?.note, 140)
    });
  }

  return items;
}

export function newItemKey() {
  return `art-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/* Validimi i pagesës */
export function validatePayment(order, payload = {}) {
  if (!order) fail("ORDER_NOT_FOUND");
  if (isPaid(order)) fail("ORDER_ALREADY_PAID");
  if (!isActive(order)) fail("ORDER_NOT_OPEN");

  const method = String(payload.method ?? "").trim().toLowerCase();
  if (!method) fail("PAYMENT_METHOD_REQUIRED");
  if (!PAYMENT_METHODS.includes(method)) fail("PAYMENT_METHOD_UNKNOWN");

  const total = Number(order.total || 0);
  let amount = total;
  let change = 0;

  if (payload.amount !== undefined && payload.amount !== null && payload.amount !== "") {
    amount = Number(payload.amount);
    if (!Number.isFinite(amount) || amount < 0) fail("PAYMENT_AMOUNT_INVALID");
    amount = Math.round(amount * 100) / 100;
    if (amount + 0.0001 < total) fail("PAYMENT_AMOUNT_INSUFFICIENT");
    change = Math.round((amount - total) * 100) / 100;
  }

  return { method, amount, change };
}

/* Migrimi i porosive të vjetra në modelin e ri */
export function migrateOrder(order = {}) {
  if (order && order.orderType && order.status && ["open", "paid", "cancelled"].includes(order.status)) {
    return { ...order, orderType: normalizeOrderType(order.orderType) || "PER_KETU" };
  }

  const legacyType = String(order.type ?? "").toLowerCase();
  const legacyTable = Number(order.table);
  let orderType = "PER_KETU";
  let tableNumber = null;

  if (legacyType === "takeout" || legacyType === "takeaway") {
    orderType = "ME_VETI";
  } else if (Number.isInteger(legacyTable) && legacyTable > 0) {
    orderType = "TAVOLINE";
    tableNumber = legacyTable;
  } else if (cleanText(order.customer)) {
    orderType = "EMER";
  }

  const statusMap = {
    preparing: ORDER_STATUS.OPEN,
    ready: ORDER_STATUS.OPEN,
    open: ORDER_STATUS.OPEN,
    completed: ORDER_STATUS.PAID,
    paid: ORDER_STATUS.PAID,
    cancelled: ORDER_STATUS.CANCELLED
  };

  const items = (order.items || []).map((item) => ({
    ...item,
    kind: item.kind || (item.isFood === false ? PRODUCT_KIND.DRINK : null),
    isFood: typeof item.isFood === "boolean" ? item.isFood : undefined
  }));

  return {
    ...order,
    orderType,
    tableNumber,
    customerName: orderType === "EMER" ? cleanText(order.customer, 60) : cleanText(order.customerName || "", 60),
    customer: order.customer || "",
    phone: order.phone || "",
    status: statusMap[order.status] || ORDER_STATUS.OPEN,
    kitchenReady: order.status === "ready" || Boolean(order.kitchenReady),
    items,
    payment: order.payment || null,
    paidAt: order.paidAt || (statusMap[order.status] === ORDER_STATUS.PAID ? order.updatedAt || order.createdAt : null),
    waiter: order.waiter || "",
    events: order.events || []
  };
}

/* Kthimi i porosive të trashëguara (dine_in/takeout) në llojet e reja */
export function legacyTypeToOrderType(legacyType, table, customerName) {
  return normalizeOrderType(legacyType) || (Number(table) > 0 ? "TAVOLINE" : customerName ? "EMER" : "PER_KETU");
}
