/* ============================================================
   SHARRI — Ekrani i kamarierit (POS)

   Rrjedha:  + POROSI E RE → KU ËSHTË POROSIA? → produktet → PAGESA
   Të gjitha rregullat zbatohen edhe në server (lib/rules.js).
   ============================================================ */

import { initApi } from "../lib/api.js";
import { TABLE_COUNT, WAITER_KEY } from "../lib/catalog.js";
import {
  ORDER_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  cleanText,
  computeTotals,
  counters,
  findActiveOrderByTable,
  hasFood,
  isActive,
  isPaid,
  normalizeOrderType,
  orderLabel,
  productKind,
  validateOrderDraft
} from "../lib/rules.js";
import { dayKey, elapsed, formatDate, formatTime } from "../lib/format.js";
import { esc, lineTotal, receiptHtml, receiptQrUrl } from "../lib/receipt.js";
import { QR } from "../lib/qr.js";

/* ============================================================
   Gjendja
   ============================================================ */
const state = {
  api: null,
  ready: false,
  settings: { currency: "€", restaurantName: "SHARRI", waiters: [], tableCount: TABLE_COUNT },
  categories: [],
  products: [],
  tableCount: TABLE_COUNT,
  orders: [],
  summary: null,
  waiter: "",
  view: "aktiv",
  current: null,
  search: "",
  category: "all",
  productQuery: "",
  history: { status: "paid", date: dayKey(new Date()), q: "", orders: [] },
  payment: { method: null, amount: null },
  changeTypeMode: false,
  pendingItems: [],
  refreshing: false
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function money(value) {
  return `${state.settings.currency || "€"}${Number(value || 0).toFixed(2)}`;
}

function findProduct(id) {
  return state.products.find((p) => p.id === id) || null;
}

function isFood(productOrItem) {
  if (!productOrItem) return false;
  if (productOrItem.productId) return productKind(findProduct(productOrItem.productId)) === "ushqim";
  return productKind(productOrItem) === "ushqim";
}

/* ============================================================
   Njoftime dhe fletë
   ============================================================ */
function toast(message, type = "info") {
  const root = $("#toastRoot");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 260);
  }, 3200);
}

let sheetStack = [];

function openSheet(html, { narrow = false, keepOpen = false } = {}) {
  const backdrop = document.createElement("div");
  backdrop.className = "sheet-backdrop";
  const sheet = document.createElement("div");
  sheet.className = `sheet${narrow ? " narrow" : ""}`;
  sheet.innerHTML = html;
  $("#sheetRoot").append(backdrop, sheet);
  document.body.classList.add("no-scroll");

  const entry = { backdrop, sheet, keepOpen };
  sheetStack.push(entry);

  backdrop.addEventListener("click", () => {
    if (entry.keepOpen) return;
    closeSheet(entry);
  });

  return entry;
}

function closeSheet(entry) {
  const target = entry || sheetStack[sheetStack.length - 1];
  if (!target) return;
  sheetStack = sheetStack.filter((item) => item !== target);
  target.backdrop.remove();
  target.sheet.remove();
  if (!sheetStack.length) document.body.classList.remove("no-scroll");
}

function closeAllSheets() {
  [...sheetStack].forEach((entry) => closeSheet(entry));
}

function sheetHead(title, subtitle = "", { close = true } = {}) {
  return `
    <div class="sheet-head">
      <div>
        <h2>${esc(title)}</h2>
        ${subtitle ? `<p>${esc(subtitle)}</p>` : ""}
      </div>
      ${close ? `<button class="icon-btn" data-close-sheet aria-label="Mbyll">✕</button>` : ""}
    </div>`;
}

/* ============================================================
   Ngarkimi i të dhënave
   ============================================================ */
async function loadCatalog() {
  const catalog = await state.api.catalog();
  state.settings = catalog.settings || state.settings;
  state.categories = catalog.categories || [];
  state.products = catalog.products || [];
  state.tableCount = Number(catalog.tableCount || state.settings.tableCount || TABLE_COUNT);
}

async function loadOrders() {
  const [orders, summary] = await Promise.all([
    state.api.orders({ status: "open" }),
    state.api.summary()
  ]);
  state.orders = orders || [];
  state.summary = summary || counters(state.orders, state.tableCount);
}

async function refresh() {
  if (state.refreshing) return;
  state.refreshing = true;
  try {
    await Promise.all([loadCatalog(), loadOrders()]);
  } catch (error) {
    console.error(error);
  } finally {
    state.refreshing = false;
  }
}

/* ============================================================
   Shiriti i sipërm
   ============================================================ */
function renderTopbar() {
  const c = state.summary || counters(state.orders, state.tableCount);
  $("#topbar").innerHTML = `
    <button class="icon-btn" data-menu aria-label="Menuja">☰</button>
    <a class="pos-brand" href="index.html">
      <span class="pos-brand-badge">S</span>
      <span class="name">${esc(state.settings.restaurantName || "SHARRI")}</span>
    </a>

    <button class="btn-new-order" data-new-order>+ POROSI E RE</button>

    <div class="topbar-counter" title="Tavolina të zëna">
      <strong id="counterTables">${c.occupiedTables} / ${c.tableCount}</strong>
      <span>tavolina</span>
    </div>
    <div class="topbar-counter" title="Porosi aktive">
      <strong id="counterOrders">${c.activeOrders}</strong>
      <span>porosi aktive</span>
    </div>

    <div class="topbar-search">
      <input id="globalSearch" class="input" type="search" placeholder="Kërko tavolinë, emër ose porosi..." autocomplete="off" value="${esc(state.search)}" />
    </div>

    <button class="topbar-user" data-waiter>
      <span class="avatar">👤</span>
      <span class="who">
        <small>Kamarieri</small>
        <strong>${esc(state.waiter || "Zgjidhni")}</strong>
      </span>
    </button>`;
}

function updateTopbarCounters() {
  const c = state.summary || counters(state.orders, state.tableCount);
  const tables = $("#counterTables");
  const orders = $("#counterOrders");
  if (tables) tables.textContent = `${c.occupiedTables} / ${c.tableCount}`;
  if (orders) orders.textContent = String(c.activeOrders);
  const who = $(".topbar-user .who strong");
  if (who && who.textContent !== (state.waiter || "Zgjidhni")) who.textContent = state.waiter || "Zgjidhni";
}

/* ============================================================
   Ekrani kryesor — POROSI AKTIVE
   ============================================================ */
function filteredActiveOrders() {
  const q = cleanText(state.search, 60).toLowerCase();
  if (!q) return state.orders.filter(isActive);
  return state.orders.filter((order) => {
    if (!isActive(order)) return false;
    const haystack = [
      order.number,
      orderLabel(order),
      order.customerName,
      order.tableNumber ? `tavolina ${order.tableNumber}` : "",
      order.tableNumber ? String(order.tableNumber) : "",
      ORDER_TYPE_LABELS[order.orderType] || "",
      order.waiter || "",
      ...(order.items || []).map((i) => i.name)
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}

function orderTile(order) {
  const minutes = elapsed(order.createdAt);
  const items = order.items || [];
  const preview = items.slice(0, 3).map((i) => `${i.qty}× ${i.name}`).join(", ");
  const more = items.length > 3 ? ` +${items.length - 3}` : "";
  const waited = Date.now() - new Date(order.createdAt).getTime() > 20 * 60 * 1000;

  return `
    <button class="order-tile${order.kitchenReady ? " ready" : ""}${waited && !order.kitchenReady ? " long-wait" : ""}" data-open-order="${esc(order.id)}">
      <span class="kind">${esc(ORDER_TYPE_LABELS[order.orderType] || "Porosi")}</span>
      <span class="title">${esc(orderLabel(order))}</span>
      <span class="total">${money(order.total)}</span>
      <span class="meta">
        <span>⏱ ${esc(minutes)}</span>
        <span>${items.reduce((s, i) => s + i.qty, 0)} artikuj</span>
        ${order.waiter ? `<span>👤 ${esc(order.waiter)}</span>` : ""}
      </span>
      <span class="items-preview">${esc(preview)}${esc(more)}</span>
    </button>`;
}

function sectionBlock(title, orders, emptyText) {
  const body = orders.length
    ? `<div class="order-grid">${orders.map(orderTile).join("")}</div>`
    : `<div class="empty-state"><div class="icon">🍽️</div><p>${esc(emptyText)}</p></div>`;

  return `
    <section class="dash-section">
      <div class="dash-section-head">
        <h2>${esc(title)}</h2>
        <span class="count">${orders.length === 1 ? "1 porosi" : `${orders.length} porosi`}</span>
      </div>
      ${body}
    </section>`;
}

function renderDashboard() {
  const c = state.summary || counters(state.orders, state.tableCount);
  const active = filteredActiveOrders();

  const tableOrders = active
    .filter((o) => o.orderType === "TAVOLINE")
    .sort((a, b) => Number(a.tableNumber) - Number(b.tableNumber));
  const nameOrders = active
    .filter((o) => o.orderType === "EMER")
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const noTableOrders = active
    .filter((o) => ["ME_VETI", "PER_KETU"].includes(o.orderType))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  const searching = Boolean(cleanText(state.search));

  $("#view").innerHTML = `
    <div class="counter-grid">
      <div class="counter-tile gold">
        <span class="label">Tavolina të zëna</span>
        <span class="value">${c.occupiedTables} <small>/ ${c.tableCount}</small></span>
        <span class="hint">${c.freeTables} tavolina të lira</span>
      </div>
      <div class="counter-tile">
        <span class="label">Porosi aktive</span>
        <span class="value">${c.activeOrders}</span>
        <span class="hint">${c.tableOrders} në tavolina</span>
      </div>
      <div class="counter-tile">
        <span class="label">Porosi me emër</span>
        <span class="value">${c.nameOrders}</span>
        <span class="hint">Pa tavolinë fizike</span>
      </div>
      <div class="counter-tile">
        <span class="label">Porosi pa tavolinë</span>
        <span class="value">${c.noTableOrders}</span>
        <span class="hint">Me veti • Për këtu</span>
      </div>
      <div class="counter-tile">
        <span class="label">Xhirua sot</span>
        <span class="value">${money(c.revenueToday || 0)}</span>
        <span class="hint">${c.paidToday || 0} porosi të paguara</span>
      </div>
    </div>

    ${
      searching && !active.length
        ? `<div class="empty-state"><div class="icon">🔍</div><p>Asnjë porosi aktive nuk përputhet me «${esc(state.search)}».</p></div>`
        : `
    <div class="dash-section">
      <div class="dash-section-head">
        <h2>POROSI AKTIVE</h2>
        <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
          <span class="count">Vetëm porositë e hapura — të paguarat shkojnë në Historiku</span>
          <button class="chip" data-view="historiku">🧾 Historiku</button>
        </div>
      </div>
    </div>
    ${sectionBlock("TAVOLINA TË ZËNA", tableOrders, "Asnjë tavolinë e zënë. Shtypni «+ POROSI E RE».")}
    ${sectionBlock("POROSI ME EMËR", nameOrders, "Nuk ka porosi me emër.")}
    ${sectionBlock("POROSI PA TAVOLINË", noTableOrders, "Nuk ka porosi «Me veti» ose «Për këtu».")}
    `}`;
}

function historyRow(order) {
  return `
    <button class="history-row" data-order-detail="${esc(order.id)}">
      <span class="time">${esc(formatTime(order.paidAt || order.createdAt))}</span>
      <span>
        <span class="title">${esc(orderLabel(order))}</span>
        <span class="sub">${esc(ORDER_TYPE_LABELS[order.orderType] || "")}${order.payment ? ` • ${esc(PAYMENT_METHOD_LABELS[order.payment.method] || "")}` : ""}${order.waiter ? ` • ${esc(order.waiter)}` : ""}</span>
      </span>
      <span class="total">${money(order.total)}</span>
      <span class="pill ${isPaid(order) ? "green" : "red"}">${isPaid(order) ? "Paguar" : "Anuluar"}</span>
    </button>`;
}

/* ============================================================
   Ekrani i porosisë (produkte + fletëporosia)
   ============================================================ */
function currentTotals() {
  return computeTotals(state.current?.items || [], state.settings);
}

function currentTitle() {
  const current = state.current;
  if (!current) return "";
  if (current.orderType === "TAVOLINE") return `Tavolina ${current.tableNumber}`;
  if (current.orderType === "EMER") return current.customerName || "Me emër";
  return ORDER_TYPE_LABELS[current.orderType];
}

function visibleProducts() {
  const q = cleanText(state.productQuery, 60).toLowerCase();
  let list = state.products.filter((p) => !p.hidden && p.available !== false);

  if (state.category === "ushqim") list = list.filter((p) => productKind(p) === "ushqim");
  else if (state.category === "pije") list = list.filter((p) => productKind(p) === "pije");
  else if (state.category !== "all") list = list.filter((p) => p.category === state.category);

  if (q) {
    list = list.filter((p) => {
      const category = state.categories.find((c) => c.id === p.category)?.name || "";
      return [p.name, p.desc, p.keywords, category].join(" ").toLowerCase().includes(q);
    });
  }
  return list;
}

function productTile(product) {
  const kind = productKind(product);
  const inOrder = (state.current?.items || []).find((i) => i.productId === product.id);
  const price = product.unit === "piece" ? `${money(product.price)} <small>/ copë</small>` : money(product.price);
  return `
    <button class="product-tile ${kind}${inOrder ? " in-order" : ""}" data-add-product="${esc(product.id)}">
      <span class="emoji">${esc(product.emoji || "🍽️")}</span>
      <span class="name">${esc(product.name)}${inOrder ? ` <span class="pill gold">${inOrder.qty}×</span>` : ""}</span>
      <span class="price">${price}</span>
      <span class="kind">${kind === "ushqim" ? "Ushqim" : "Pije"}</span>
    </button>`;
}

function categoryChips() {
  const chips = [
    { id: "all", name: "Të gjitha" },
    { id: "ushqim", name: "🍽️ Ushqim" },
    { id: "pije", name: "🥤 Pije" },
    ...state.categories
  ];
  return chips
    .map(
      (chip) =>
        `<button class="chip${state.category === chip.id ? " active" : ""}" data-category="${esc(chip.id)}">${esc(chip.name)}</button>`
    )
    .join("");
}

function draftNotice() {
  const current = state.current;
  if (!current) return "";
  const needsFood = ["ME_VETI", "PER_KETU"].includes(current.orderType);
  if (!needsFood) return "";
  const items = current.items || [];
  if (hasFood(items, findProduct)) {
    return `<div class="notice ok">Porosia «${esc(ORDER_TYPE_LABELS[current.orderType])}» përmban ushqim — mund të vazhdohet.</div>`;
  }
  const label = ORDER_TYPE_LABELS[current.orderType];
  return `
    <div class="notice">
      Porosia «${esc(label)}» duhet të përmbajë të paktën një produkt ushqimor.
      ${items.length ? "Pijet vetëm lejohen në «Tavolinë» ose «Me emër»." : "Filloni me një ushqim."}
      <div class="chip-row" style="margin-top:10px;">
        <button class="chip" data-category="ushqim">Shiko ushqimet</button>
        <button class="chip" data-change-type>Ndrysho llojin e porosisë</button>
      </div>
    </div>`;
}

function orderHeadHtml() {
  const current = state.current;
  const saved = Boolean(current.orderId);
  const title = currentTitle();
  const typeLabel = ORDER_TYPE_LABELS[current.orderType] || "";
  const who = current.waiter || state.waiter;

  return `
      <div class="who">
        <h1>${esc(title)}</h1>
        <p>
          ${title === typeLabel ? "" : `${esc(typeLabel)} • `}
          ${current.number ? `${esc(current.number)} • ` : "porosi e re • "}
          ${current.createdAt ? `⏱ ${esc(elapsed(current.createdAt))} • ` : ""}
          ${who ? `👤 ${esc(who)}` : ""}
        </p>
      </div>
      <div style="display:flex; gap:10px; flex-wrap:wrap;">
        ${saved ? `<span class="pill green">Porosi aktive</span>` : `<span class="pill warn">Pa ruajtur</span>`}
        ${current.kitchenReady ? `<span class="pill green">Gati në kuzhinë</span>` : ""}
        <button class="btn ghost" data-back>← Kthehu te porositë</button>
      </div>`;
}

function renderOrderView() {
  const current = state.current;
  if (!current) return renderDashboard();

  const totals = currentTotals();

  $("#view").innerHTML = `
    <div class="order-head" id="orderHead">${orderHeadHtml()}</div>

    <div id="orderNotice">${draftNotice()}</div>

    <div class="order-layout">
      <section class="product-panel">
        <div class="product-toolbar">
          <input id="productSearch" class="input" type="search" placeholder="Kërko produkt..." autocomplete="off" value="${esc(state.productQuery)}" />
          <button class="btn ghost" data-quick-drinks>🥤 Pije</button>
        </div>
        <div class="chip-row" id="categoryChips">${categoryChips()}</div>
        <div class="product-grid" id="productGrid">${visibleProducts().map(productTile).join("")}</div>
      </section>

      <aside class="ticket" id="ticket">${ticketHtml(totals)}</aside>
    </div>`;
}

function ticketHtml(totals = currentTotals()) {
  const current = state.current;
  const items = current?.items || [];

  const rows = items.length
    ? items
        .map(
          (item) => `
        <div class="ticket-item">
          <div class="row">
            <span>
              <span class="name">${esc(item.name)}</span>
              <span class="unit-price"> • ${money(item.price)} ${item.isFood || isFood(item) ? "" : "• pije"}</span>
            </span>
            <span class="line-total">${money(lineTotal(item))}</span>
          </div>
          <div class="row">
            <span class="qty-controls">
              <button class="minus" data-qty="-1" data-key="${esc(item.key)}" aria-label="Pakëso">−</button>
              <span>${item.qty}</span>
              <button data-qty="1" data-key="${esc(item.key)}" aria-label="Shto">+</button>
            </span>
            <button class="chip" data-remove-item="${esc(item.key)}">Fshi</button>
          </div>
        </div>`
        )
        .join("")
    : `<div class="empty-state"><div class="icon">🧾</div><p>Prekni produktet për t'i shtuar në porosi.</p></div>`;

  return `
    <div class="ticket-head">
      <h2>Porosia</h2>
      <span class="pill dark">${totals.count} artikuj</span>
    </div>
    <div class="ticket-items" id="ticketItems">${rows}</div>
    <div class="field">
      <label for="orderNote">Shënim për kuzhinën</label>
      <textarea id="orderNote" class="ticket-note" placeholder="p.sh. pa qepë, më shumë patate...">${esc(current?.note || "")}</textarea>
    </div>
    <div class="ticket-totals">
      <div class="ticket-row"><span>Nëntotali</span><strong>${money(totals.subtotal)}</strong></div>
      <div class="ticket-row"><span>TVSH</span><strong>${money(totals.vat)}</strong></div>
      <div class="ticket-row grand"><span>Totali</span><strong>${money(totals.total)}</strong></div>
    </div>
    <div class="ticket-actions">
      <button class="btn gold big block" data-pay ${items.length ? "" : "disabled"}>PAGESA</button>
      <button class="btn ghost block" data-save-order ${items.length ? "" : "disabled"}>Ruaj porosinë</button>
      ${current?.orderId ? `<button class="btn danger block" data-cancel-order>Anulo porosinë</button>` : ""}
    </div>`;
}

function updateTicket() {
  const ticket = $("#ticket");
  if (ticket) ticket.innerHTML = ticketHtml();
  const grid = $("#productGrid");
  if (grid) grid.innerHTML = visibleProducts().map(productTile).join("");
  const notice = $("#orderNotice");
  if (notice) notice.innerHTML = draftNotice();
  const head = $("#orderHead");
  if (head) head.innerHTML = orderHeadHtml();
  updateTopbarCounters();
}

/* ============================================================
   Historiku
   ============================================================ */
async function loadHistory() {
  const filters = { status: state.history.status === "all" ? "all" : state.history.status };
  if (state.history.date) filters.date = state.history.date;
  state.history.orders = (await state.api.orders(filters)) || [];
}

function filteredHistory() {
  const q = cleanText(state.history.q, 60).toLowerCase();
  const list = state.history.orders.slice().sort(
    (a, b) => new Date(b.paidAt || b.createdAt) - new Date(a.paidAt || a.createdAt)
  );
  if (!q) return list;
  return list.filter((order) =>
    [order.number, orderLabel(order), order.customerName, order.waiter, order.tableNumber || "", ...(order.items || []).map((i) => i.name)]
      .join(" ")
      .toLowerCase()
      .includes(q)
  );
}

function renderHistory() {
  const today = dayKey(new Date());
  const chips = [
    { id: "paid", label: "Të paguara" },
    { id: "cancelled", label: "Të anuluara" },
    { id: "all", label: "Të gjitha" }
  ];

  $("#view").innerHTML = `
    <div class="order-head">
      <div class="who">
        <h1>HISTORIKU</h1>
        <p>Porositë e përfunduara — nuk përzihen me porositë aktive.</p>
      </div>
      <div style="display:flex; gap:10px; flex-wrap:wrap;">
        <button class="btn ghost" data-back>← Kthehu te porositë aktive</button>
      </div>
    </div>

    <div class="product-toolbar">
      <input id="historySearch" class="input" type="search" placeholder="Kërko: Tavolina 50, Bastria, Me veti, Enver..." autocomplete="off" value="${esc(state.history.q)}" />
      <input id="historyDate" class="input" type="date" value="${esc(state.history.date)}" style="max-width:220px;" />
    </div>
    <div class="chip-row">
      ${chips
        .map(
          (chip) =>
            `<button class="chip${state.history.status === chip.id ? " active" : ""}" data-history-status="${chip.id}">${chip.label}</button>`
        )
        .join("")}
      <button class="chip${state.history.date === today ? " active" : ""}" data-history-today>Sot</button>
    </div>

    <div id="historyList">${historyListHtml()}</div>`;
}

function historyListHtml() {
  const list = filteredHistory();
  if (!list.length) {
    return `<div class="empty-state"><div class="icon">🧾</div><p>Nuk ka porosi për këtë ditë ose kërkim.</p></div>`;
  }
  const total = list.reduce((sum, order) => sum + (isPaid(order) ? Number(order.total || 0) : 0), 0);
  return `
    <div class="dash-section-head" style="margin-bottom:6px;">
      <span class="count">${list.length} porosi • gjithsej ${money(total)}</span>
    </div>
    <div class="history-list">${list.map(historyRow).join("")}</div>`;
}

/* ============================================================
   Krijimi i porosisë — KU ËSHTË POROSIA?
   ============================================================ */
function openNewOrderSheet(title = "KU ËSHTË POROSIA?") {
  const types = [
    {
      id: "TAVOLINE",
      emoji: "🍽️",
      title: "TAVOLINË",
      desc: "Klienti është ulur në një nga 50 tavolinat.",
      tag: "Çdo porosi",
      tagClass: "any"
    },
    {
      id: "EMER",
      emoji: "🧑",
      title: "ME EMËR",
      desc: "Shkruani emrin ose identifikuesin: Bastria, Enver, Te Stubi, Nfund te Ora.",
      tag: "Çdo porosi",
      tagClass: "any"
    },
    {
      id: "ME_VETI",
      emoji: "🥡",
      title: "ME VETI",
      desc: "Klienti e merr ushqimin me vete. Pijet mund të shoqërojnë ushqimin.",
      tag: "Vetëm me ushqim",
      tagClass: "food"
    },
    {
      id: "PER_KETU",
      emoji: "⏳",
      title: "PËR KËTU",
      desc: "Klienti po pret këtu, pa tavolinë të numëruar.",
      tag: "Vetëm me ushqim",
      tagClass: "food"
    }
  ];

  openSheet(
    `${sheetHead(title, "Zgjidhni mënyrën si do të identifikohet porosia.")}
    <div class="type-grid">
      ${types
        .map(
          (type) => `
        <button class="type-card" data-order-type="${type.id}">
          <span class="emoji">${type.emoji}</span>
          <span class="title">${type.title}</span>
          <span class="desc">${type.desc}</span>
          <span class="tag ${type.tagClass}">${type.tag}</span>
        </button>`
        )
        .join("")}
    </div>
    <div class="notice">Pijet vetëm (pa ushqim) lejohen në «Tavolinë» ose «Me emër».</div>`,
    { narrow: false }
  );
}

function openTableSheet() {
  const busy = new Map(
    state.orders
      .filter((o) => isActive(o) && o.orderType === "TAVOLINE")
      .map((o) => [Number(o.tableNumber), o])
  );

  const buttons = [];
  for (let n = 1; n <= state.tableCount; n++) {
    const order = busy.get(n);
    buttons.push(`
      <button class="table-btn${order ? " busy" : ""}" data-table="${n}">
        ${n}
        <small>${order ? money(order.total) : "e lirë"}</small>
      </button>`);
  }

  openSheet(
    `${sheetHead("Numri i tavolinës", `Tavolina të lira: ${state.tableCount - busy.size} / ${state.tableCount}`)}
    <div class="field">
      <label for="tableInput">Shkruani numrin</label>
      <input id="tableInput" class="input" type="number" min="1" max="${state.tableCount}" inputmode="numeric" placeholder="p.sh. 12" />
    </div>
    <div class="sheet-actions">
      <button class="btn ghost" data-close-sheet>Anulo</button>
      <button class="btn gold" data-table-confirm>Vazhdo</button>
    </div>
    <div class="table-grid">${buttons.join("")}</div>`,
    { narrow: false }
  );

  setTimeout(() => $("#tableInput")?.focus(), 60);
}

async function openNameSheet() {
  let names = [];
  try {
    const named = (await state.api.orders({ orderType: "EMER" })) || [];
    names = [...new Set(named.map((o) => o.customerName).filter(Boolean))].slice(0, 12);
  } catch {
    names = [];
  }

  openSheet(
    `${sheetHead("ME EMËR", "Shkruani emrin ose identifikuesin e porosisë.")}
    <div class="field">
      <label for="nameInput">Emri / identifikuesi</label>
      <input id="nameInput" class="input" type="text" autocomplete="off" placeholder="p.sh. Bastria, Enver, Te Stubi, Nfund te Ora" />
    </div>
    ${names.length ? `<div class="chip-row">${names.map((n) => `<button class="chip" data-name="${esc(n)}">${esc(n)}</button>`).join("")}</div>` : ""}
    <div class="sheet-actions">
      <button class="btn ghost" data-close-sheet>Anulo</button>
      <button class="btn gold" data-name-confirm>Vazhdo</button>
    </div>`,
    { narrow: true }
  );

  setTimeout(() => $("#nameInput")?.focus(), 60);
}

function startDraft({ orderType, tableNumber = null, customerName = "" }) {
  closeAllSheets();
  const pending = state.pendingItems;
  state.pendingItems = [];
  state.changeTypeMode = false;
  state.current = {
    orderId: null,
    number: "",
    orderType,
    tableNumber,
    customerName,
    items: [],
    note: "",
    createdAt: null,
    kitchenReady: false,
    status: "open"
  };
  state.category = "all";
  state.productQuery = "";
  state.view = "porosi";
  render();
  if (pending.length) reapplyPendingItems(pending);
}

/* Ndryshon identitetin e një porosie të ruajtur (p.sh. "Me veti" → "Tavolinë") */
async function applyIdentity({ orderType, tableNumber = null, customerName = "" }) {
  const current = state.current;
  if (!current?.orderId) return startDraft({ orderType, tableNumber, customerName });

  closeAllSheets();
  try {
    const order = await state.api.changeIdentity(
      current.orderId,
      { orderType, tableNumber, customerName },
      state.waiter
    );
    syncFromOrder(order);
    state.changeTypeMode = false;
    state.pendingItems = [];
    state.view = "porosi";
    await refresh();
    render();
    toast(`Porosia tani është: ${orderLabel(order)}`, "ok");
  } catch (error) {
    handleRuleError(error);
  }
}

function syncFromOrder(order) {
  state.current = {
    orderId: order.id,
    number: order.number,
    orderType: order.orderType,
    tableNumber: order.tableNumber,
    customerName: order.customerName,
    items: order.items || [],
    note: order.note || "",
    createdAt: order.createdAt,
    kitchenReady: Boolean(order.kitchenReady),
    status: order.status,
    payment: order.payment || null,
    paidAt: order.paidAt || null,
    waiter: order.waiter || "",
    subtotal: order.subtotal,
    vat: order.vat,
    total: order.total,
    events: order.events || []
  };
}

async function openOrder(id) {
  try {
    const order = await state.api.order(id);
    syncFromOrder(order);
    state.category = "all";
    state.productQuery = "";
    state.view = "porosi";
    closeAllSheets();
    render();
  } catch (error) {
    handleRuleError(error);
  }
}

/* ============================================================
   Shtimi / ndryshimi i produkteve
   ============================================================ */
function validationContext() {
  return {
    tableCount: state.tableCount,
    orders: state.orders,
    findProduct,
    orderId: state.current?.orderId || null
  };
}

function mergeTrial(items, incoming) {
  const trial = items.map((i) => ({ ...i }));
  for (const item of incoming) {
    const existing = trial.find((i) => i.productId === item.productId);
    if (existing) existing.qty += Number(item.qty || 1);
    else trial.push({ ...item, qty: Number(item.qty || 1) });
  }
  return trial;
}

async function addProduct(productId) {
  const product = findProduct(productId);
  const current = state.current;
  if (!product || !current) return;

  /* 1) Kontrolli i menjëhershëm në ndërfaqe (e njëjta rregull si në server) */
  if (!current.orderId) {
    const trial = mergeTrial(current.items, [{ productId, qty: 1 }]);
    try {
      validateOrderDraft(
        {
          orderType: current.orderType,
          tableNumber: current.tableNumber,
          customerName: current.customerName,
          items: trial
        },
        validationContext()
      );
    } catch (error) {
      handleRuleError(error, { product });
      return;
    }
  }

  /* 2) Validimi përfundimtar bëhet në server / në ruajtjen lokale */
  try {
    if (!current.orderId) {
      const order = await state.api.createOrder({
        orderType: current.orderType,
        tableNumber: current.tableNumber,
        customerName: current.customerName,
        note: current.note,
        waiter: state.waiter,
        channel: "kamarier",
        items: [{ productId, qty: 1 }]
      });
      syncFromOrder(order);
    } else {
      const order = await state.api.addItems(current.orderId, [{ productId, qty: 1 }], state.waiter);
      syncFromOrder(order);
    }
    await refresh();
    updateTicket();
    toast(`U shtua: ${product.name}`, "ok");
  } catch (error) {
    handleRuleError(error, { product });
  }
}

async function changeQty(key, delta) {
  const current = state.current;
  if (!current?.orderId) return;
  const item = current.items.find((i) => i.key === key);
  if (!item) return;

  const nextQty = item.qty + delta;
  if (nextQty < 0) return;

  try {
    const order =
      nextQty === 0
        ? await state.api.removeItem(current.orderId, key, state.waiter)
        : await state.api.updateItem(current.orderId, key, { qty: nextQty }, state.waiter);
    syncFromOrder(order);
    await refresh();
    updateTicket();
  } catch (error) {
    handleRuleError(error, { item });
  }
}

async function removeItemLine(key) {
  const current = state.current;
  if (!current?.orderId) return;
  try {
    const order = await state.api.removeItem(current.orderId, key, state.waiter);
    syncFromOrder(order);
    await refresh();
    updateTicket();
    toast("Produkti u hoq.", "info");
  } catch (error) {
    handleRuleError(error);
  }
}

async function saveNote() {
  const current = state.current;
  const value = $("#orderNote")?.value || "";
  if (!current) return;
  current.note = value;
  if (!current.orderId) return;
  try {
    const order = await state.api.setNote(current.orderId, value, state.waiter);
    syncFromOrder(order);
  } catch (error) {
    handleRuleError(error);
  }
}

/* ============================================================
   Trajtimi i gabimeve (mesazhe shqip + veprime të shpejta)
   ============================================================ */
function handleRuleError(error, context = {}) {
  const code = error?.code;
  const message = error?.message || "Veprimi nuk u krye.";

  if (code === "ME_VETI_REQUIRES_FOOD" || code === "PER_KETU_REQUIRES_FOOD" || code === "DRINK_ONLY_NEEDS_LOCATION") {
    const label = ORDER_TYPE_LABELS[state.current?.orderType] || "";
    const product = context.product;
    openSheet(
      `${sheetHead(message, `Porosia «${label}» lejohet vetëm me ushqim.`)}
      <div class="notice error">
        ${product ? `Produkti «${esc(product.name)}» është pije.` : "Nuk ka produkt ushqimor në porosi."}
        Zgjidhni një nga opsionet:
      </div>
      <div class="menu-list">
        <button class="menu-item" data-category="ushqim" data-close-sheet>
          <span class="emoji">🍽️</span>
          <span>Shto ushqim<small>Vazhdoni me të njëjtën porosi</small></span>
        </button>
        <button class="menu-item" data-change-type>
          <span class="emoji">🔁</span>
          <span>Ndrysho llojin e porosisë<small>Tavolinë ose Me emër — aty lejohen edhe pijet vetëm</small></span>
        </button>
      </div>`,
      { narrow: true }
    );
    return;
  }

  if (code === "TABLE_BUSY") {
    const table = error?.vars?.table || state.current?.tableNumber;
    const existing = findActiveOrderByTable(state.orders, table);
    openSheet(
      `${sheetHead(`Tavolina ${table} ka një porosi aktive.`, existing ? `${money(existing.total)} • ${elapsed(existing.createdAt)} • ${existing.items.length} produkte` : "")}
      <div class="menu-list">
        ${
          existing
            ? `<button class="menu-item" data-open-order="${esc(existing.id)}">
                <span class="emoji">📂</span><span>Hap porosinë<small>Shtoni produkte te porosia ekzistuese</small></span>
              </button>`
            : ""
        }
        <button class="menu-item" data-new-order>
          <span class="emoji">➕</span><span>Zgjidh tavolinë tjetër<small>Kthehu te «POROSI E RE»</small></span>
        </button>
      </div>`,
      { narrow: true }
    );
    return;
  }

  toast(message, "error");
}

/* ============================================================
   Pagesa
   ============================================================ */
function paymentSheetHtml() {
  const current = state.current;
  const totals = currentTotals();
  const total = Number(current.orderId ? current.total ?? totals.total : totals.total);
  const method = state.payment.method;
  const amount = state.payment.amount;
  const change = amount === null || amount === undefined ? 0 : Math.round((Number(amount) - total) * 100) / 100;
  const insufficient = method === "cash" && Number(amount || 0) + 0.0001 < total;

  const quickAmounts = [total, 5, 10, 20, 50, 100]
    .map((value) => Math.round(value * 100) / 100)
    .filter((value, index, list) => list.indexOf(value) === index);

  return `
    ${sheetHead("PAGESA", `${currentTitle()} • ${esc(current.number || "")}`)}
    <div class="pay-total">
      <span class="label">Totali për pagesë</span>
      <span class="amount">${money(total)}</span>
    </div>

    <div class="method-grid">
      <button class="method-btn${method === "cash" ? " active" : ""}" data-method="cash">
        <span class="emoji">💵</span><span>Para të gatshme</span>
      </button>
      <button class="method-btn${method === "card" ? " active" : ""}" data-method="card">
        <span class="emoji">💳</span><span>Kartelë</span>
      </button>
      <button class="method-btn${method === "other" ? " active" : ""}" data-method="other">
        <span class="emoji">🧾</span><span>Tjetër</span>
      </button>
    </div>

    ${
      method === "cash"
        ? `<div class="field">
            <label>Shuma e marrë</label>
            <div class="amount-grid">
              ${quickAmounts
                .map(
                  (value) =>
                    `<button class="amount-btn${Number(amount) === value ? " active" : ""}" data-amount="${value}">${
                      value === total ? "E saktë" : money(value)
                    }</button>`
                )
                .join("")}
            </div>
            <input id="cashAmount" class="input" type="number" step="0.01" min="0" inputmode="decimal" placeholder="Shuma tjetër" value="${amount ?? ""}" />
            <div class="change-line${insufficient ? " negative" : ""}">
              <span>${insufficient ? "Mungon" : "Rikthimi"}</span>
              <strong>${money(Math.abs(change))}</strong>
            </div>
          </div>`
        : ""
    }

    <div class="sheet-actions">
      <button class="btn ghost" data-close-sheet>Anulo</button>
      <button class="btn success big" data-confirm-payment ${!method || insufficient ? "disabled" : ""}>
        ${method ? `Përfundo pagesën • ${money(total)}` : "Zgjidhni mënyrën e pagesës"}
      </button>
    </div>`;
}

function openPaymentSheet() {
  const current = state.current;
  if (!current) return;
  if (!current.items?.length) {
    toast("Porosia nuk ka asnjë produkt.", "error");
    return;
  }
  state.payment = { method: null, amount: null };
  openSheet(paymentSheetHtml(), { narrow: true });
}

function updatePaymentSheet() {
  const sheet = sheetStack[sheetStack.length - 1]?.sheet;
  if (!sheet || !$("[data-confirm-payment]", sheet)) return;
  sheet.innerHTML = paymentSheetHtml();
  if (state.payment.method === "cash") setTimeout(() => $("#cashAmount")?.focus(), 40);
}

async function confirmPayment() {
  const current = state.current;
  if (!current?.orderId || !state.payment.method) return;

  try {
    const order = await state.api.pay(
      current.orderId,
      { method: state.payment.method, amount: state.payment.amount ?? undefined },
      state.waiter
    );
    closeAllSheets();
    await refresh();
    state.current = null;
    state.view = "aktiv";
    render();
    openSuccessSheet(order);
  } catch (error) {
    handleRuleError(error);
  }
}

function openSuccessSheet(order) {
  const method = PAYMENT_METHOD_LABELS[order.payment?.method] || "";
  openSheet(
    `<div class="success-card">
      <div class="check">✓</div>
      <h2>PAGESA U PËRFUNDUA</h2>
      <p>Porosia u largua nga porositë aktive dhe tani gjendet në Historiku.</p>
      <div class="success-meta">
        <div class="row"><span>Porosia</span><strong>${esc(orderLabel(order))}</strong></div>
        <div class="row"><span>Numri</span><strong>${esc(order.number)}</strong></div>
        <div class="row"><span>Totali</span><strong>${money(order.total)}</strong></div>
        <div class="row"><span>Mënyra e pagesës</span><strong>${esc(method)}</strong></div>
        ${order.payment?.method === "cash" ? `<div class="row"><span>Rikthimi</span><strong>${money(order.payment.change)}</strong></div>` : ""}
        <div class="row"><span>Ora</span><strong>${esc(formatTime(order.paidAt))}</strong></div>
        <div class="row"><span>Kamarieri</span><strong>${esc(order.waiter || state.waiter || "—")}</strong></div>
        ${order.orderType === "TAVOLINE" ? `<div class="row"><span>Tavolina</span><strong>U lirua</strong></div>` : ""}
      </div>
      <div class="sheet-actions" style="width:100%;">
        <button class="btn ghost" data-close-sheet>Mbyll</button>
        <button class="btn gold" data-print-receipt="${esc(order.id)}">Printo faturën</button>
      </div>
    </div>`,
    { narrow: true }
  );

  lastPaidOrder = order;
}

let lastPaidOrder = null;

/* ============================================================
   Anulimi
   ============================================================ */
function openCancelSheet() {
  const reasons = ["Klienti nuk erdhi", "Gabim në porosi", "Kërkesë e klientit", "Produkt i mbaruar"];
  openSheet(
    `${sheetHead("Anulo porosinë", `${currentTitle()} • ${money(currentTotals().total)}`)}
    <div class="chip-row">
      ${reasons.map((r) => `<button class="chip" data-reason="${esc(r)}">${esc(r)}</button>`).join("")}
    </div>
    <div class="field">
      <label for="cancelReason">Arsyeja</label>
      <input id="cancelReason" class="input" type="text" placeholder="Shkruani arsyen..." />
    </div>
    <div class="sheet-actions">
      <button class="btn ghost" data-close-sheet>Kthehu</button>
      <button class="btn danger" data-confirm-cancel>Konfirmo anulimin</button>
    </div>`,
    { narrow: true }
  );
  setTimeout(() => $("#cancelReason")?.focus(), 60);
}

async function confirmCancel() {
  const reason = cleanText($("#cancelReason")?.value || "", 200);
  if (!reason) {
    toast("Shkruani arsyen e anulimit.", "error");
    return;
  }
  try {
    await state.api.cancel(state.current.orderId, reason, state.waiter);
    closeAllSheets();
    state.current = null;
    state.view = "aktiv";
    await refresh();
    render();
    toast("Porosia u anulua.", "info");
  } catch (error) {
    handleRuleError(error);
  }
}

/* ============================================================
   Fatura dhe detajet
   ============================================================ */
function printReceipt(order) {
  if (!order) return;
  const qrUrl = receiptQrUrl(order, state.settings, location.href);
  let qr = "";
  try {
    qr = QR.dataUrl(qrUrl);
  } catch {
    qr = "";
  }
  $("#printRoot").innerHTML = `<div class="receipt">${receiptHtml(order, { qr, settings: state.settings })}</div>`;
  setTimeout(() => window.print(), 120);
}

async function openOrderDetail(id) {
  try {
    const order = await state.api.order(id);
    const qrUrl = receiptQrUrl(order, state.settings, location.href);
    let qr = "";
    try {
      qr = QR.dataUrl(qrUrl);
    } catch {
      qr = "";
    }

    const events = (order.events || [])
      .slice()
      .reverse()
      .map(
        (event) => `
        <div class="event">
          <span class="what">${esc(event.message || event.type)}</span>
          <span class="when">${esc(formatDate(event.at))} • ${esc(event.by || "")}</span>
        </div>`
      )
      .join("");

    openSheet(
      `${sheetHead(orderLabel(order), `${esc(order.number)} • ${esc(formatDate(order.createdAt))}`)}
      <div class="receipt">${receiptHtml(order, { qr, settings: state.settings })}</div>
      <div class="detail-list">
        <div class="detail-row"><span>Lloji i porosisë</span><strong>${esc(ORDER_TYPE_LABELS[order.orderType] || "")}</strong></div>
        <div class="detail-row"><span>Statusi</span><strong>${isPaid(order) ? "Paguar" : order.status === "cancelled" ? "Anuluar" : "Aktive"}</strong></div>
        ${order.payment ? `<div class="detail-row"><span>Mënyra e pagesës</span><strong>${esc(PAYMENT_METHOD_LABELS[order.payment.method] || "")}</strong></div>` : ""}
        ${order.paidAt ? `<div class="detail-row"><span>Ora e pagesës</span><strong>${esc(formatTime(order.paidAt))}</strong></div>` : ""}
        ${order.waiter ? `<div class="detail-row"><span>Kamarieri</span><strong>${esc(order.waiter)}</strong></div>` : ""}
        ${order.cancelReason ? `<div class="detail-row"><span>Arsyeja e anulimit</span><strong>${esc(order.cancelReason)}</strong></div>` : ""}
      </div>
      ${events ? `<div class="field"><label>Ngjarjet e porosisë</label><div class="event-list">${events}</div></div>` : ""}
      <div class="sheet-actions">
        <button class="btn ghost" data-close-sheet>Mbyll</button>
        <button class="btn gold" data-print-receipt="${esc(order.id)}">Printo faturën</button>
      </div>`,
      { narrow: false }
    );

    detailCache = order;
  } catch (error) {
    handleRuleError(error);
  }
}

let detailCache = null;

/* ============================================================
   Kamarieri dhe menuja
   ============================================================ */
function openWaiterSheet({ required = false } = {}) {
  const waiters = state.settings.waiters || [];
  openSheet(
    `${sheetHead("Kush po punon?", "Zgjidhni ose shkruani emrin e kamarierit.", { close: !required })}
    ${waiters.length ? `<div class="chip-row">${waiters.map((w) => `<button class="chip" data-waiter-pick="${esc(w)}">${esc(w)}</button>`).join("")}</div>` : ""}
    <div class="field">
      <label for="waiterInput">Emri i kamarierit</label>
      <input id="waiterInput" class="input" type="text" autocomplete="off" placeholder="p.sh. Ardit" value="${esc(state.waiter)}" />
    </div>
    <div class="sheet-actions">
      ${required ? "" : `<button class="btn ghost" data-close-sheet>Anulo</button>`}
      <button class="btn gold" data-waiter-save>Vazhdo</button>
    </div>`,
    { narrow: true, keepOpen: required }
  );
  setTimeout(() => $("#waiterInput")?.focus(), 60);
}

function saveWaiter(value) {
  const name = cleanText(value, 40);
  if (!name) {
    toast("Shkruani emrin e kamarierit.", "error");
    return false;
  }
  state.waiter = name;
  localStorage.setItem(WAITER_KEY, name);
  closeAllSheets();
  renderTopbar();
  toast(`Kamarieri: ${name}`, "ok");
  return true;
}

function openMenuSheet() {
  const c = state.summary || counters(state.orders, state.tableCount);
  openSheet(
    `${sheetHead("Menuja", state.settings.restaurantName || "SHARRI")}
    <div class="menu-list">
      <button class="menu-item" data-view="aktiv" data-close-sheet><span class="emoji">🟢</span><span>Porosi aktive<small>${c.activeOrders} aktive • ${c.occupiedTables} / ${c.tableCount} tavolina</small></span></button>
      <button class="menu-item" data-view="historiku"><span class="emoji">🧾</span><span>Historiku<small>Porositë e paguara dhe të anuluara</small></span></button>
      <button class="menu-item" data-new-order data-close-sheet><span class="emoji">➕</span><span>Porosi e re<small>Filloni një porosi të re</small></span></button>
      <a class="menu-item" href="index.html#/kitchen"><span class="emoji">👨‍🍳</span><span>Paneli i kuzhinës<small>Porositë duke u përgatitur</small></span></a>
      <a class="menu-item" href="index.html#/admin"><span class="emoji">🛡️</span><span>Administratori<small>Historiku i plotë, produktet, arka</small></span></a>
      <a class="menu-item" href="index.html"><span class="emoji">🌐</span><span>Faqja e restorantit<small>Menyja për klientët</small></span></a>
      <button class="menu-item" data-waiter><span class="emoji">👤</span><span>Ndrysho kamarierin<small>${esc(state.waiter || "i pazgjedhur")}</small></span></button>
      <button class="menu-item" data-refresh><span class="emoji">🔄</span><span>Rifresko<small>Përditëso porositë dhe tavolinat</small></span></button>
    </div>
    <p class="mode-line">
      Lidhja: ${esc(state.api?.modeLabel || "")}<br />
      Tavolina fizike: ${state.tableCount} • Rregulli: «Me veti» dhe «Për këtu» vetëm me ushqim.
    </p>`,
    { narrow: true }
  );
}

/* ============================================================
   Pasqyrimi
   ============================================================ */
function renderView() {
  if (state.view === "porosi") return renderOrderView();
  if (state.view === "historiku") return renderHistory();
  return renderDashboard();
}

function render() {
  renderTopbar();
  renderView();
}

async function setView(view) {
  closeAllSheets();
  state.view = view;
  if (view === "historiku") {
    await loadHistory();
  }
  renderView();
}

async function backToActive() {
  state.current = null;
  state.view = "aktiv";
  await refresh();
  render();
}

/* ============================================================
   Ngjarjet
   ============================================================ */
function bindEvents() {
  document.addEventListener("click", async (event) => {
    const target = event.target;
    const hit = (selector) => target.closest(selector);

    if (hit("[data-close-sheet]")) {
      const picker = hit("[data-category]");
      closeSheet();
      if (picker) {
        state.category = picker.dataset.category;
        if (state.view === "porosi") updateTicket();
      }
      return;
    }

    if (hit("[data-menu]")) return openMenuSheet();
    if (hit("[data-new-order]")) return openNewOrderSheet();
    if (hit("[data-waiter]") && !hit("[data-waiter-pick]") && !hit("[data-waiter-save]")) return openWaiterSheet();
    if (hit("[data-refresh]")) {
      await refresh();
      render();
      closeAllSheets();
      return toast("Të dhënat u përditësuan.", "ok");
    }

    const viewBtn = hit("[data-view]");
    if (viewBtn) return setView(viewBtn.dataset.view);

    const typeBtn = hit("[data-order-type]");
    if (typeBtn) {
      const type = normalizeOrderType(typeBtn.dataset.orderType);
      closeSheet();
      if (type === "TAVOLINE") return openTableSheet();
      if (type === "EMER") return openNameSheet();
      if (state.changeTypeMode && state.current?.orderId) return applyIdentity({ orderType: type });
      return startDraft({ orderType: type });
    }

    const tableBtn = hit("[data-table]");
    if (tableBtn) return chooseTable(Number(tableBtn.dataset.table));

    if (hit("[data-table-confirm]")) {
      const value = Number($("#tableInput")?.value);
      if (!value) return toast("Shkruani numrin e tavolinës.", "error");
      return chooseTable(value);
    }

    const nameChip = hit("[data-name]");
    if (nameChip) {
      const input = $("#nameInput");
      if (input) input.value = nameChip.dataset.name;
      return;
    }

    if (hit("[data-name-confirm]")) {
      const name = cleanText($("#nameInput")?.value || "", 60);
      if (!name) return toast("Shkruani emrin ose identifikuesin.", "error");
      if (state.changeTypeMode && state.current?.orderId) {
        return applyIdentity({ orderType: "EMER", customerName: name });
      }
      closeAllSheets();
      return startDraft({ orderType: "EMER", customerName: name });
    }

    if (hit("[data-change-type]")) {
      state.pendingItems = (state.current?.items || []).map((i) => ({
        productId: i.productId,
        qty: i.qty,
        note: i.note
      }));
      state.changeTypeMode = !state.current?.orderId ? false : true;
      closeAllSheets();
      openNewOrderSheet("Zgjidhni llojin e ri të porosisë");
      return;
    }

    const openBtn = hit("[data-open-order]");
    if (openBtn) return openOrder(openBtn.dataset.openOrder);

    const detailBtn = hit("[data-order-detail]");
    if (detailBtn) return openOrderDetail(detailBtn.dataset.orderDetail);

    const printBtn = hit("[data-print-receipt]");
    if (printBtn) {
      const order =
        lastPaidOrder?.id === printBtn.dataset.printReceipt
          ? lastPaidOrder
          : detailCache?.id === printBtn.dataset.printReceipt
            ? detailCache
            : await state.api.order(printBtn.dataset.printReceipt).catch(() => null);
      return printReceipt(order);
    }

    const productBtn = hit("[data-add-product]");
    if (productBtn) return addProduct(productBtn.dataset.addProduct);

    const qtyBtn = hit("[data-qty]");
    if (qtyBtn) return changeQty(qtyBtn.dataset.key, Number(qtyBtn.dataset.qty));

    const removeBtn = hit("[data-remove-item]");
    if (removeBtn) return removeItemLine(removeBtn.dataset.removeItem);

    const chip = hit("[data-category]");
    if (chip) {
      state.category = chip.dataset.category;
      const chips = $("#categoryChips");
      if (chips) chips.innerHTML = categoryChips();
      const grid = $("#productGrid");
      if (grid) grid.innerHTML = visibleProducts().map(productTile).join("");
      const notice = $("#orderNotice");
      if (notice) notice.innerHTML = draftNotice();
      return;
    }

    if (hit("[data-quick-drinks]")) {
      state.category = state.category === "pije" ? "all" : "pije";
      const chips = $("#categoryChips");
      if (chips) chips.innerHTML = categoryChips();
      const grid = $("#productGrid");
      if (grid) grid.innerHTML = visibleProducts().map(productTile).join("");
      return;
    }

    if (hit("[data-back]")) return backToActive();
    if (hit("[data-save-order]")) return saveOrder();
    if (hit("[data-pay]")) return openPaymentSheet();
    if (hit("[data-cancel-order]")) return openCancelSheet();

    const methodBtn = hit("[data-method]");
    if (methodBtn) {
      state.payment.method = methodBtn.dataset.method;
      if (state.payment.method !== "cash") state.payment.amount = null;
      else if (state.payment.amount === null) state.payment.amount = Number(currentTotals().total);
      return updatePaymentSheet();
    }

    const amountBtn = hit("[data-amount]");
    if (amountBtn) {
      state.payment.amount = Number(amountBtn.dataset.amount);
      return updatePaymentSheet();
    }

    if (hit("[data-confirm-payment]")) return confirmPayment();

    const reasonChip = hit("[data-reason]");
    if (reasonChip) {
      const input = $("#cancelReason");
      if (input) input.value = reasonChip.dataset.reason;
      return;
    }

    if (hit("[data-confirm-cancel]")) return confirmCancel();

    const waiterPick = hit("[data-waiter-pick]");
    if (waiterPick) return saveWaiter(waiterPick.dataset.waiterPick);

    if (hit("[data-waiter-save]")) return saveWaiter($("#waiterInput")?.value || "");
  });

  document.addEventListener("input", (event) => {
    const target = event.target;

    if (target.id === "globalSearch") {
      state.search = target.value;
      if (state.view !== "aktiv") {
        state.view = "aktiv";
        state.current = null;
      }
      renderDashboard();
      return;
    }

    if (target.id === "productSearch") {
      state.productQuery = target.value;
      const grid = $("#productGrid");
      if (grid) grid.innerHTML = visibleProducts().map(productTile).join("");
      return;
    }

    if (target.id === "orderNote") {
      if (state.current) state.current.note = target.value;
      clearTimeout(noteTimer);
      noteTimer = setTimeout(saveNote, 600);
      return;
    }

    if (target.id === "historySearch") {
      state.history.q = target.value;
      const list = $("#historyList");
      if (list) list.innerHTML = historyListHtml();
      return;
    }

    if (target.id === "cashAmount") {
      state.payment.amount = target.value === "" ? null : Number(target.value);
      const sheet = sheetStack[sheetStack.length - 1]?.sheet;
      if (!sheet) return;
      const total = Number(state.current?.total ?? currentTotals().total);
      const change = Number(state.payment.amount || 0) - total;
      const line = $(".change-line", sheet);
      if (line) {
        line.classList.toggle("negative", change < 0);
        line.querySelector("span").textContent = change < 0 ? "Mungon" : "Rikthimi";
        line.querySelector("strong").textContent = money(Math.abs(change));
      }
      const confirm = $("[data-confirm-payment]", sheet);
      if (confirm) {
        confirm.disabled = change < -0.0001;
        confirm.textContent = `Përfundo pagesën • ${money(total)}`;
      }
      $$(".amount-btn", sheet).forEach((btn) =>
        btn.classList.toggle("active", Number(btn.dataset.amount) === Number(state.payment.amount))
      );
    }
  });

  document.addEventListener("change", async (event) => {
    const target = event.target;
    if (target.id === "historyDate") {
      state.history.date = target.value;
      await loadHistory();
      const list = $("#historyList");
      if (list) list.innerHTML = historyListHtml();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (sheetStack.length) {
      const top = sheetStack[sheetStack.length - 1];
      if (!top.keepOpen) closeSheet(top);
    }
  });

  const historyStatus = (event) => {
    const button = event.target.closest("[data-history-status]");
    if (!button) return;
    state.history.status = button.dataset.historyStatus;
    loadHistory().then(() => {
      renderHistory();
    });
  };
  document.addEventListener("click", historyStatus);

  document.addEventListener("click", async (event) => {
    if (!event.target.closest("[data-history-today]")) return;
    state.history.date = dayKey(new Date());
    await loadHistory();
    renderHistory();
  });
}

let noteTimer = null;

async function saveOrder() {
  const current = state.current;
  if (!current?.items?.length) {
    toast("Porosia nuk ka asnjë produkt.", "error");
    return;
  }
  if (current.orderId) {
    await saveNote();
    toast("Porosia është e ruajtur dhe aktive.", "ok");
    return backToActive();
  }
  try {
    const order = await state.api.createOrder({
      orderType: current.orderType,
      tableNumber: current.tableNumber,
      customerName: current.customerName,
      note: current.note,
      waiter: state.waiter,
      channel: "kamarier",
      items: current.items.map((i) => ({ productId: i.productId, qty: i.qty, note: i.note }))
    });
    syncFromOrder(order);
    toast("Porosia u ruajt.", "ok");
    await backToActive();
  } catch (error) {
    handleRuleError(error);
  }
}

function chooseTable(number) {
  if (!Number.isInteger(number) || number < 1 || number > state.tableCount) {
    toast(`Numri i tavolinës duhet të jetë mes 1 dhe ${state.tableCount}.`, "error");
    return;
  }

  const existing = findActiveOrderByTable(state.orders, number);
  if (existing) {
    closeAllSheets();
    openSheet(
      `${sheetHead(`Tavolina ${number} ka një porosi aktive.`, `${money(existing.total)} • ${elapsed(existing.createdAt)} • ${existing.items.reduce((s, i) => s + i.qty, 0)} artikuj`)}
      <div class="menu-list">
        <button class="menu-item" data-open-order="${esc(existing.id)}">
          <span class="emoji">📂</span><span>Hap porosinë<small>Vazhdoni te e njëjta tavolinë</small></span>
        </button>
        <button class="menu-item" data-new-order>
          <span class="emoji">🔁</span><span>Zgjidh tavolinë tjetër<small>Kthehu te «POROSI E RE»</small></span>
        </button>
      </div>`,
      { narrow: true }
    );
    return;
  }

  if (state.changeTypeMode && state.current?.orderId) {
    return applyIdentity({ orderType: "TAVOLINE", tableNumber: number });
  }
  startDraft({ orderType: "TAVOLINE", tableNumber: number });
}

/* Kur kamarieri ndryshon llojin e porosisë, produktet e prekura nuk humbin */
async function reapplyPendingItems(items) {
  for (const item of items) {
    for (let i = 0; i < item.qty; i++) {
      await addProduct(item.productId);
    }
  }
}

/* ============================================================
   Nisja
   ============================================================ */
async function boot() {
  state.api = await initApi();
  state.waiter = localStorage.getItem(WAITER_KEY) || "";

  await refresh();
  state.ready = true;
  bindEvents();
  render();

  if (!state.waiter) openWaiterSheet({ required: true });

  state.api.subscribe(async () => {
    await refresh();
    updateTopbarCounters();

    /* Nëse porosia që është e hapur u pagua ose u anulua diku tjetër, kthehemi te lista */
    const current = state.current;
    if (current?.orderId && state.view === "porosi") {
      const fresh = state.orders.find((order) => order.id === current.orderId);
      if (!fresh) {
        state.current = null;
        state.view = "aktiv";
        render();
        toast("Porosia nuk është më aktive — kaloi në Historiku.", "info");
        return;
      }
      syncFromOrder(fresh);
    }

    if (state.view === "aktiv") renderDashboard();
    else if (state.view === "porosi") updateTicket();
  });

  setInterval(() => {
    if (state.view === "aktiv") renderDashboard();
    else if (state.view === "porosi") updateTicket();
  }, 30000);
}

boot().catch((error) => {
  console.error(error);
  document.getElementById("view").innerHTML = `
    <div class="empty-state">
      <div class="icon">⚠️</div>
      <p>${esc(error?.message || "Sistemi nuk u nis.")}</p>
      <button class="btn gold" onclick="location.reload()">Rifresko faqen</button>
    </div>`;
});
