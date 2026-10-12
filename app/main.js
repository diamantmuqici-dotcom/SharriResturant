/* ============================================================
   SHARRI — Faqja, paneli i kuzhinës dhe paneli i administratorit

   Të gjitha të dhënat merren nga lib/api.js:
     • me server  → validimi bëhet në server
     • pa server  → e njëjta logjikë (lib/engine.js + lib/rules.js)
   Gjithçka në ndërfaqe është shqip.
   ============================================================ */

import { initApi } from "../lib/api.js";
import { CART_KEY, TABLE_COUNT } from "../lib/catalog.js";
import {
  ORDER_STATUS,
  ORDER_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  PRODUCT_KIND_LABELS,
  cleanText,
  computeTotals,
  counters,
  isActive,
  isPaid,
  normalizeOrderType,
  orderLabel,
  productKind
} from "../lib/rules.js";
import { dayKey, elapsed, formatDate, formatDay, formatTime } from "../lib/format.js";
import { esc, linePrice, lineTotal, receiptHtml, receiptQrUrl } from "../lib/receipt.js";
import { QR } from "../lib/qr.js";

/* ============================================================
   Gjendja
   ============================================================ */
const state = {
  api: null,
  settings: { currency: "€", restaurantName: "SHARRI", tableCount: TABLE_COUNT, waiters: [] },
  categories: [],
  products: [],
  orders: [],
  logs: [],
  cashReports: [],
  summary: null,
  user: null,
  cart: [],
  filters: { q: "", cat: "all", sort: "featured" },
  adminSection: "dashboard",
  adminOrders: { q: "", status: "all", type: "all", date: "" },
  cash: null,
  kdsSound: true,
  knownOrders: new Set()
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function money(value) {
  return `${state.settings.currency || "€"}${Number(value || 0).toFixed(2)}`;
}

function txt(value) {
  if (value == null) return "";
  if (typeof value === "object") return value.sq || value.en || Object.values(value)[0] || "";
  return String(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function categoryName(id) {
  const category = state.categories.find((c) => c.id === id);
  return category ? txt(category.name) : id;
}

function getProduct(id) {
  return state.products.find((p) => p.id === id);
}

function kindOf(product) {
  return productKind(product);
}

/* ============================================================
   Njoftime, dritare dhe printim
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
    setTimeout(() => el.remove(), 300);
  }, 3600);
}

function openModal(html) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  $("#modalRoot").appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("open"));
  document.body.classList.add("modal-open");
  return overlay;
}

function closeModal(overlay) {
  if (!overlay) return;
  overlay.classList.remove("open");
  setTimeout(() => overlay.remove(), 230);
  if (!$$(".modal-overlay").length) document.body.classList.remove("modal-open");
}

function closeTopModal() {
  const all = $$(".modal-overlay");
  if (all.length) closeModal(all[all.length - 1]);
}

function printElement(selector) {
  const el = $(selector);
  if (!el) return;
  el.classList.add("print-target");
  document.body.classList.add("printing");
  window.print();
  setTimeout(() => {
    el.classList.remove("print-target");
    document.body.classList.remove("printing");
  }, 1000);
}

/* Dritare për arsyejen e anulimit (shqip, pa fjalë angleze) */
function openReasonModal({ title, subtitle = "", label = "Arsyeja", confirmText = "Konfirmo", onConfirm }) {
  const overlay = openModal(`
    <div class="modal-head">
      <div><h3>${esc(title)}</h3>${subtitle ? `<div class="modal-sub">${esc(subtitle)}</div>` : ""}</div>
      <button class="icon-btn" data-close aria-label="Mbyll">✕</button>
    </div>
    <div class="field">
      <label>${esc(label)}</label>
      <input id="reasonInput" class="input" type="text" autocomplete="off" placeholder="Shkruani arsyen..." />
    </div>
    <div style="display:flex; justify-content:flex-end; gap:12px; flex-wrap:wrap; margin-top:18px;">
      <button class="btn ghost" data-close>Kthehu</button>
      <button class="btn danger" id="reasonConfirm">${esc(confirmText)}</button>
    </div>`);

  setTimeout(() => $("#reasonInput", overlay)?.focus(), 60);
  $("#reasonConfirm", overlay).addEventListener("click", async () => {
    const reason = cleanText($("#reasonInput", overlay)?.value || "", 200);
    if (!reason) {
      toast("Shkruani arsyen.", "error");
      return;
    }
    closeModal(overlay);
    await onConfirm(reason);
  });
}

/* ============================================================
   Ngarkimi i të dhënave
   ============================================================ */
async function loadAll() {
  const [catalog, orders, summary] = await Promise.all([
    state.api.catalog(),
    state.api.orders(),
    state.api.summary()
  ]);
  state.settings = catalog.settings || state.settings;
  state.categories = catalog.categories || [];
  state.products = catalog.products || [];
  state.orders = orders || [];
  state.summary = summary || counters(state.orders, Number(state.settings.tableCount || TABLE_COUNT));
}

async function loadAdminData() {
  try {
    const [logs, cashReports] = await Promise.all([state.api.logs(), state.api.cashReports()]);
    state.logs = logs || [];
    state.cashReports = cashReports || [];
  } catch (error) {
    /* vetëm administratori i sheh këto të dhëna */
    console.warn(error?.message || error);
  }
}

/* ============================================================
   Faqja publike
   ============================================================ */
function renderPublicContent() {
  $("#brandName").textContent = txt(state.settings.restaurantName);
  $("#heroTitle").textContent = txt(state.settings.restaurantName);
  $("#heroTagline").textContent = txt(state.settings.tagline);
  $("#contactAddress").textContent = txt(state.settings.address);
  $("#contactPhone").textContent = txt(state.settings.phone);
  $("#contactHours").textContent = txt(state.settings.hours);
  renderChips();
  renderMenu();
  renderCart();
}

function renderChips() {
  const chips = [{ id: "all", name: "Të gjitha" }, ...state.categories];
  $("#chips").innerHTML = chips
    .map(
      (c) =>
        `<button class="chip ${state.filters.cat === c.id ? "active" : ""}" data-chip="${esc(c.id)}">${esc(txt(c.name))}</button>`
    )
    .join("");
}

function getFilteredProducts() {
  let list = state.products.filter((p) => !p.hidden);
  const q = state.filters.q.trim().toLowerCase();
  if (q) {
    list = list.filter((p) => {
      const haystack = [txt(p.name), txt(p.desc), categoryName(p.category), p.keywords || ""].join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }
  if (state.filters.cat !== "all") list = list.filter((p) => p.category === state.filters.cat);
  switch (state.filters.sort) {
    case "newest":
      list.sort((a, b) => b.created - a.created);
      break;
    case "price_asc":
      list.sort((a, b) => a.price - b.price);
      break;
    case "price_desc":
      list.sort((a, b) => b.price - a.price);
      break;
    default:
      list.sort((a, b) => Number(b.popular || b.special) - Number(a.popular || a.special) || b.created - a.created);
  }
  return list;
}

function productCard(product) {
  const name = txt(product.name);
  const desc = txt(product.desc);
  const badges = [
    product.special ? `<span class="badge gold">Specialitet</span>` : "",
    product.popular ? `<span class="badge gold">Popullore</span>` : "",
    product.daily ? `<span class="badge dark">Ditor</span>` : "",
    product.family ? `<span class="badge dark">Për Familje</span>` : ""
  ].join("");
  const media = product.image
    ? `<img src="${esc(product.image)}" alt="${esc(name)}" loading="lazy" />`
    : `<div class="emoji">${esc(product.emoji || "🍽️")}</div>`;
  const price = product.unit === "piece" ? `${money(product.price)} <small>/ copë</small>` : money(product.price);
  const kind = kindOf(product) === "pije" ? `<span class="badge dark">Pije</span>` : "";
  const button = product.available
    ? `<button class="btn gold small" data-add="${esc(product.id)}">Shto në shportë</button>`
    : `<button class="btn ghost small" disabled>Pa disponim</button>`;

  return `
    <article class="card"><div class="media">${media}<div class="badges">${badges}</div></div>
    <div class="card-body"><div class="card-top"><h3>${esc(name)}</h3><div class="price">${price}</div></div>
    <p>${esc(desc)}</p><div class="card-actions"><span class="cat">${esc(categoryName(product.category))} ${kind}</span>${button}</div></div></article>`;
}

function renderMenu() {
  const list = getFilteredProducts();
  $("#menuGrid").innerHTML = list.map(productCard).join("");
  $("#menuEmpty").classList.toggle("hidden", list.length > 0);
}

/* ============================================================
   Shporta
   ============================================================ */
function computeCartTotals() {
  const items = state.cart.map((item) => ({ ...item, price: linePrice(item) }));
  return computeTotals(items, state.settings);
}

function addCart(productId) {
  const product = getProduct(productId);
  if (!product || product.hidden || !product.available) return;
  const existing = state.cart.find((item) => item.productId === productId);
  if (existing) existing.qty += 1;
  else {
    state.cart.push({
      key: `sh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      productId: product.id,
      name: txt(product.name),
      price: product.price,
      image: product.image || "",
      emoji: product.emoji || "🍽️",
      isFood: kindOf(product) === "ushqim",
      qty: 1,
      note: ""
    });
  }
  saveCart();
  renderCart();
  toast("U shtua në shportë.", "ok");
}

function saveCart() {
  localStorage.setItem(CART_KEY, JSON.stringify(state.cart));
}

function changeCartQty(key, delta) {
  const item = state.cart.find((i) => i.key === key);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) state.cart = state.cart.filter((i) => i.key !== key);
  saveCart();
  renderCart();
}

function removeCartLine(key) {
  state.cart = state.cart.filter((i) => i.key !== key);
  saveCart();
  renderCart();
  toast("U hoq nga shporta.", "info");
}

function renderCart() {
  const totals = computeCartTotals();
  const badge = $("#cartCount");
  badge.textContent = String(totals.count);
  badge.classList.toggle("hidden", totals.count === 0);
  $("#checkoutBtn").disabled = state.cart.length === 0;

  $("#cartItems").innerHTML = state.cart.length
    ? state.cart
        .map(
          (item) => `
    <article class="cart-item">
      <div class="cart-thumb">${item.image ? `<img src="${esc(item.image)}" alt="${esc(txt(item.name))}" />` : esc(item.emoji || "🍽️")}</div>
      <div class="cart-info">
        <h4>${esc(txt(item.name))}</h4>
        <textarea class="cart-note" data-note-key="${esc(item.key)}" placeholder="Shënim...">${esc(item.note || "")}</textarea>
        <div class="cart-controls">
          <div class="qty">
            <button data-cart-action="dec" data-key="${esc(item.key)}" aria-label="Pakëso">−</button>
            <span>${item.qty}</span>
            <button data-cart-action="inc" data-key="${esc(item.key)}" aria-label="Shto">+</button>
          </div>
          <div class="line-price">${money(linePrice(item) * item.qty)}</div>
          <button class="icon-btn" data-cart-action="remove" data-key="${esc(item.key)}" aria-label="Fshi">✕</button>
        </div>
      </div>
    </article>`
        )
        .join("")
    : `<div class="empty"><div class="empty-icon">🛒</div><p>Shporta juaj është bosh.</p></div>`;

  $("#cartTotals").innerHTML = `
    <div class="totals-row"><span>Nëntotali</span><strong>${money(totals.subtotal)}</strong></div>
    <div class="totals-row"><span>TVSH</span><strong>${money(totals.vat)}</strong></div>
    <div class="totals-row grand"><span>Totali</span><strong>${money(totals.total)}</strong></div>`;
}

function openCart() {
  $("#cartDrawer").classList.add("open");
  $("#cartDrawer").setAttribute("aria-hidden", "false");
  $("#backdrop").classList.remove("hidden");
  document.body.classList.add("no-scroll");
}

function closeCart() {
  $("#cartDrawer").classList.remove("open");
  $("#cartDrawer").setAttribute("aria-hidden", "true");
  $("#backdrop").classList.add("hidden");
  document.body.classList.remove("no-scroll");
}

/* ============================================================
   Porosia nga faqja (klienti)
   ============================================================ */
function cartHasFood() {
  return state.cart.some((item) => {
    const product = getProduct(item.productId);
    return product ? kindOf(product) === "ushqim" : item.isFood !== false;
  });
}

function openCheckout() {
  if (!state.cart.length) return;
  closeCart();
  const totals = computeCartTotals();
  const hasFood = cartHasFood();
  const summary = state.cart
    .map(
      (item) => `
    <div class="summary-row">
      <span>${item.qty}× ${esc(txt(item.name))}</span>
      <strong>${money(linePrice(item) * item.qty)}</strong>
    </div>`
    )
    .join("");

  const tableCount = Number(state.settings.tableCount || TABLE_COUNT);

  openModal(`
    <div class="modal-head">
      <div><h3>Porosia</h3><div class="modal-sub">Zgjidhni ku do ta merrni porosinë.</div></div>
      <button class="icon-btn" data-close aria-label="Mbyll">✕</button>
    </div>
    <form id="checkoutForm" class="form two-col">
      <div class="field"><label>Lloji i porosisë</label>
        <select name="type" id="orderTypeSelect" class="select">
          <option value="TAVOLINE">Tavolinë</option>
          <option value="PER_KETU">Për këtu</option>
          <option value="ME_VETI">Me veti</option>
        </select>
      </div>
      <div class="field" id="tableField"><label>Numri i tavolinës</label>
        <input name="table" class="input" type="number" min="1" max="${tableCount}" inputmode="numeric" placeholder="1 - ${tableCount}" />
      </div>
      <div class="field"><label>Emri (opsional)</label><input name="customer" class="input" autocomplete="off" /></div>
      <div class="field"><label>Telefoni (opsional)</label><input name="phone" class="input" inputmode="tel" autocomplete="off" /></div>
      <div class="field span-2"><label>Shënime për kuzhinën</label><textarea name="notes" class="textarea"></textarea></div>
      ${
        hasFood
          ? ""
          : `<div class="panel span-2" style="border-color:rgba(255,209,102,.4);">
              <p style="color:var(--warning); font-weight:800;">Shporta ka vetëm pije.</p>
              <p>Porosia «Me veti» dhe «Për këtu» lejohet vetëm me ushqim. Zgjidhni «Tavolinë» ose shtoni një ushqim.</p>
            </div>`
      }
      <div class="panel span-2"><div class="summary-list">${summary}
        <div class="summary-row"><span>Nëntotali</span><strong>${money(totals.subtotal)}</strong></div>
        <div class="summary-row"><span>TVSH</span><strong>${money(totals.vat)}</strong></div>
        <div class="summary-row"><strong>Totali</strong><strong>${money(totals.total)}</strong></div>
      </div></div>
      <div class="span-2" style="display:flex; justify-content:flex-end; gap:12px; flex-wrap:wrap;">
        <button type="button" class="btn ghost" data-close>Anulo</button>
        <button type="submit" class="btn gold">Ruaj porosinë</button>
      </div>
    </form>`);

  syncCheckoutType();
}

function syncCheckoutType() {
  const select = $("#orderTypeSelect");
  if (!select) return;
  const type = normalizeOrderType(select.value);
  $("#tableField")?.classList.toggle("hidden", type !== "TAVOLINE");

  const hasFood = cartHasFood();
  const submit = $('#checkoutForm button[type="submit"]');
  if (submit) {
    const blocked = !hasFood && ["ME_VETI", "PER_KETU"].includes(type);
    submit.disabled = blocked;
    submit.textContent = blocked ? "Kërkohet ushqim për këtë lloj" : "Ruaj porosinë";
  }
}

async function handleCheckoutForm(form) {
  const data = new FormData(form);
  const type = normalizeOrderType(data.get("type")) || "PER_KETU";
  const table = type === "TAVOLINE" ? Number(data.get("table")) : null;
  const customer = cleanText(data.get("customer") || "", 60);
  const phone = cleanText(data.get("phone") || "", 30);
  const notes = cleanText(data.get("notes") || "", 240);

  if (type === "TAVOLINE" && (!Number.isInteger(table) || table < 1)) {
    toast("Shënoni numrin e tavolinës.", "error");
    return;
  }

  try {
    const order = await state.api.createOrder({
      orderType: type,
      tableNumber: table,
      customerName: type === "TAVOLINE" ? "" : customer,
      customer,
      phone,
      note: notes,
      channel: "internet",
      waiter: customer || "Klienti",
      items: state.cart.map((item) => ({ productId: item.productId, qty: item.qty, note: item.note }))
    });

    state.cart = [];
    saveCart();
    renderCart();
    await loadAll();
    closeModal(form.closest(".modal-overlay"));
    openSuccessModal(order);
    toast("Porosia u krijua me sukses.", "ok");
  } catch (error) {
    toast(error?.message || "Porosia nuk u krijua.", "error");
  }
}

function openSuccessModal(order) {
  openModal(`
    <div class="modal-head"><div><h3>Porosia u pranua</h3><div class="modal-sub">Porosia juaj u dërgua në kuzhinë.</div></div><button class="icon-btn" data-close aria-label="Mbyll">✕</button></div>
    <div class="panel">
      <div class="summary-row"><span>Numri i porosisë</span><strong>${esc(order.number)}</strong></div>
      <div class="summary-row"><span>${order.orderType === "TAVOLINE" ? "Tavolina" : "Porosia"}</span><strong>${esc(orderLabel(order))}</strong></div>
      <div class="summary-row"><span>Totali</span><strong>${money(order.total)}</strong></div>
    </div>
    <div style="display:flex; justify-content:flex-end; gap:12px; flex-wrap:wrap; margin-top:18px;">
      <button class="btn ghost" data-close>Mbyll</button>
      <button class="btn gold" data-receipt="${esc(order.id)}">Shiko faturën</button>
    </div>`);
}

/* ============================================================
   Fatura
   ============================================================ */
function openReceipt(orderId) {
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) {
    toast("Porosia nuk u gjet.", "error");
    return;
  }
  let qr = "";
  try {
    qr = QR.dataUrl(receiptQrUrl(order, state.settings, location.href));
  } catch {
    qr = "";
  }

  openModal(`
    <div class="modal-head"><h3>Fatura</h3><button class="icon-btn" data-close aria-label="Mbyll">✕</button></div>
    <div class="receipt" id="receiptPrint">${receiptHtml(order, { qr, settings: state.settings })}</div>
    <div style="display:flex; justify-content:flex-end; gap:12px; flex-wrap:wrap; margin-top:18px;">
      <button class="btn ghost" data-close>Mbyll</button>
      <button class="btn gold" data-print="#receiptPrint">Printo faturën</button>
    </div>`);
}

/* ============================================================
   Paneli i kuzhinës
   ============================================================ */
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.075, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.42);
    osc.start();
    osc.stop(ctx.currentTime + 0.45);
  } catch {
    /* zëri nuk është i domosdoshëm */
  }
}

function syncKnownOrders() {
  let hasNew = false;
  state.orders.forEach((order) => {
    if (!state.knownOrders.has(order.id)) {
      state.knownOrders.add(order.id);
      hasNew = true;
    }
  });
  if (hasNew && state.kdsSound) beep();
}

function kitchenCard(order) {
  const items = order.items
    .map(
      (item) => `
    <div class="order-item">
      <div class="order-item-head"><strong>${item.qty}× ${esc(txt(item.name))}</strong><strong>${money(lineTotal(item))}</strong></div>
      ${item.note ? `<div class="order-item-details">${esc(item.note)}</div>` : ""}
    </div>`
    )
    .join("");

  const statusClass = order.kitchenReady ? "ready" : "preparing";

  return `
    <article class="order-card status-${statusClass}">
      <div class="order-card-top">
        <div>
          <div class="order-number">${esc(orderLabel(order))}</div>
          <div class="order-time">${esc(order.number)} • ${esc(formatTime(order.createdAt))} • ⏱ ${esc(elapsed(order.createdAt))}</div>
        </div>
        <span class="status-pill ${statusClass}">${order.kitchenReady ? "Gati" : "Duke u përgatitur"}</span>
      </div>
      <div class="order-card-body">
        <div class="order-meta">
          <div><strong>Lloji:</strong> ${esc(ORDER_TYPE_LABELS[order.orderType] || "")}</div>
          ${order.waiter ? `<div><strong>Kamarieri:</strong> ${esc(order.waiter)}</div>` : ""}
          ${order.channel === "internet" ? `<div><strong>Porosia:</strong> nga faqja</div>` : ""}
          ${order.phone ? `<div><strong>Telefoni:</strong> ${esc(order.phone)}</div>` : ""}
        </div>
        <div class="order-items">${items}</div>
        ${order.note ? `<div class="order-note">${esc(order.note)}</div>` : ""}
      </div>
      <div class="order-card-actions">
        ${
          order.kitchenReady
            ? `<button class="btn ghost small" data-kitchen-ready="${esc(order.id)}" data-ready="0">Kthe në përgatitje</button>`
            : `<button class="btn gold small" data-kitchen-ready="${esc(order.id)}" data-ready="1">Gati</button>`
        }
        <button class="btn danger small" data-kitchen-cancel="${esc(order.id)}">Anulo</button>
        <button class="btn ghost small" data-receipt="${esc(order.id)}">Fatura</button>
      </div>
    </article>`;
}

function renderKitchen(checkNew = false) {
  if (checkNew) syncKnownOrders();
  const active = state.orders
    .filter(isActive)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  const cards = active.length
    ? active.map(kitchenCard).join("")
    : `<div class="empty"><div class="empty-icon">👨‍🍳</div><p>Nuk ka porosi aktive.</p></div>`;

  const c = state.summary || counters(state.orders, Number(state.settings.tableCount || TABLE_COUNT));

  $("#routeView").innerHTML = `
    <div class="kds">
      <div class="kds-topbar">
        <div>
          <div class="kds-title">Paneli i kuzhinës</div>
          <div class="text-muted">${esc(formatDate(new Date()))} • ${c.activeOrders} porosi aktive • tavolina ${c.occupiedTables} / ${c.tableCount}</div>
        </div>
        <div style="display:flex; gap:12px; flex-wrap:wrap; align-items:center;">
          <label class="checkline"><input type="checkbox" id="kdsSoundToggle" ${state.kdsSound ? "checked" : ""} /><span>Zëri</span></label>
          <a class="btn ghost" href="pos.html">Kamarieri</a>
          <a class="btn ghost" href="#/">Kthehu te faqja</a>
        </div>
      </div>
      <div class="kds-grid">${cards}</div>
    </div>`;
}

async function setKitchenReady(orderId, ready) {
  try {
    await state.api.kitchenReady(orderId, ready, state.user?.username || "kuzhina");
    await loadAll();
    renderKitchen(false);
    toast(ready ? "Porosia është gati." : "Porosia është në përgatitje.", "ok");
  } catch (error) {
    toast(error?.message || "Veprimi nuk u krye.", "error");
  }
}

async function cancelFromKitchen(orderId) {
  const order = state.orders.find((o) => o.id === orderId);
  openReasonModal({
    title: "Anulo porosinë",
    subtitle: order ? `${orderLabel(order)} • ${money(order.total)}` : "",
    confirmText: "Konfirmo anulimin",
    onConfirm: async (reason) => {
      try {
        await state.api.cancel(orderId, reason, state.user?.username || "kuzhina");
        await loadAll();
        renderKitchen(false);
        toast("Porosia u anulua.", "info");
      } catch (error) {
        toast(error?.message || "Porosia nuk u anulua.", "error");
      }
    }
  });
}

/* ============================================================
   Administratori — hyrja
   ============================================================ */
function renderAdmin() {
  if (!state.user) return renderAdminLogin();
  renderAdminShell();
}

function renderAdminLogin() {
  $("#routeView").innerHTML = `
    <div class="login-shell">
      <form id="loginForm" class="login-card">
        <div style="display:grid; justify-items:center; gap:14px;">
          <div class="brand-badge" style="width:72px;height:72px;font-size:2.1rem;border-radius:24px;">S</div>
          <h2 style="font-family:var(--display);font-size:2.3rem;">Hyrja e administratorit</h2>
        </div>
        <div class="field"><label>Përdoruesi</label><input name="username" class="input" required autocomplete="username" /></div>
        <div class="field"><label>Fjalëkalimi</label><input name="password" type="password" class="input" required autocomplete="current-password" /></div>
        <button class="btn gold block" type="submit">Hyr</button>
        <a class="btn ghost block" href="pos.html">Ekrani i kamarierit</a>
        <a class="btn ghost block" href="#/">Kthehu</a>
      </form>
    </div>`;
}

async function handleLoginForm(form) {
  const data = new FormData(form);
  try {
    state.user = await state.api.login(String(data.get("username") || ""), String(data.get("password") || ""));
    await loadAdminData();
    renderAdmin();
    toast(`Mirë se erdhët, ${state.user.username}.`, "ok");
  } catch (error) {
    toast(error?.message || "Kredencialet janë të pasakta.", "error");
  }
}

async function logout() {
  try {
    await state.api.logout();
  } catch {
    /* dalja bëhet edhe lokalisht */
  }
  state.user = null;
  renderAdmin();
}

/* ============================================================
   Administratori — seksionet
   ============================================================ */
function renderAdminShell() {
  const sections = [
    ["dashboard", "Paneli"],
    ["orders", "Historiku i porosisë"],
    ["products", "Produktet"],
    ["cash", "Raporti i arkës"],
    ["settings", "Cilësimet"],
    ["logs", "Regjistri"]
  ];

  $("#routeView").innerHTML = `
    <div class="admin">
      <aside class="admin-sidebar">
        <div class="admin-brand">${esc(txt(state.settings.restaurantName))}</div>
        <nav class="admin-nav">
          ${sections
            .map(
              ([id, label]) =>
                `<button data-admin-nav="${id}" class="${state.adminSection === id ? "active" : ""}">${esc(label)}</button>`
            )
            .join("")}
        </nav>
        <a class="btn gold" href="pos.html">Ekrani i kamarierit</a>
        <button class="btn ghost" data-admin-logout>Dalje</button>
        <a class="btn ghost" href="#/">Kthehu te faqja</a>
      </aside>
      <section class="admin-main" id="adminContent"></section>
    </div>`;

  renderAdminSection();
}

function renderAdminSection() {
  const content = $("#adminContent");
  if (!content) return;
  $$(".admin-nav button").forEach((btn) => btn.classList.toggle("active", btn.dataset.adminNav === state.adminSection));
  switch (state.adminSection) {
    case "orders":
      return renderAdminOrders();
    case "products":
      return renderAdminProducts();
    case "cash":
      return renderAdminCash();
    case "settings":
      return renderAdminSettings();
    case "logs":
      return renderAdminLogs();
    default:
      return renderAdminDashboard();
  }
}

function renderAdminDashboard() {
  const tableCount = Number(state.settings.tableCount || TABLE_COUNT);
  const c = state.summary || counters(state.orders, tableCount);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const validOrders = state.orders.filter((o) => o.status !== ORDER_STATUS.CANCELLED);
  const ordersToday = validOrders.filter((o) => new Date(o.createdAt) >= todayStart);
  const paidToday = state.orders.filter((o) => isPaid(o) && new Date(o.paidAt || o.createdAt) >= todayStart);
  const revenueToday = paidToday.reduce((sum, o) => sum + Number(o.total || 0), 0);
  const averageOrder = paidToday.length ? revenueToday / paidToday.length : 0;

  const productMap = new Map();
  paidToday.forEach((order) =>
    order.items.forEach((item) => {
      const entry = productMap.get(item.productId) || { name: txt(item.name), qty: 0, revenue: 0 };
      entry.qty += item.qty;
      entry.revenue += lineTotal(item);
      productMap.set(item.productId, entry);
    })
  );
  const topProducts = [...productMap.values()].sort((a, b) => b.qty - a.qty).slice(0, 5);

  const recent = state.orders.slice(0, 6);
  const recentRows = recent.length
    ? recent
        .map(
          (order) => `
    <tr>
      <td><strong>${esc(order.number)}</strong></td>
      <td>${esc(formatDate(order.createdAt))}</td>
      <td>${esc(orderLabel(order))}</td>
      <td>${esc(ORDER_TYPE_LABELS[order.orderType] || "")}</td>
      <td>${money(order.total)}</td>
      <td>${statusPill(order)}</td>
    </tr>`
        )
        .join("")
    : `<tr><td colspan="6">Nuk ka porosi.</td></tr>`;

  const topRows = topProducts.length
    ? topProducts
        .map(
          (item, index) => `
    <tr><td>${index + 1}</td><td>${esc(item.name)}</td><td>${item.qty}</td><td>${money(item.revenue)}</td></tr>`
        )
        .join("")
    : `<tr><td colspan="4">Nuk ka të dhëna.</td></tr>`;

  $("#adminContent").innerHTML = `
    <div class="admin-topbar"><h2>Paneli</h2><div class="text-muted">${esc(state.user?.username || "")} • ${esc(formatDate(new Date()))}</div></div>
    <div class="stats">
      <div class="stat"><div class="stat-label">Porosi aktive</div><div class="stat-value">${c.activeOrders}</div></div>
      <div class="stat"><div class="stat-label">Tavolina të zëna</div><div class="stat-value">${c.occupiedTables} <span style="font-size:1.1rem;color:var(--muted);">/ ${c.tableCount}</span></div></div>
      <div class="stat"><div class="stat-label">Xhirua sot</div><div class="stat-value">${money(revenueToday)}</div></div>
      <div class="stat"><div class="stat-label">Porosi të paguara sot</div><div class="stat-value">${paidToday.length}</div></div>
      <div class="stat"><div class="stat-label">Porosia mesatare</div><div class="stat-value">${money(averageOrder)}</div></div>
      <div class="stat"><div class="stat-label">Porosi sot (gjithsej)</div><div class="stat-value">${ordersToday.length}</div></div>
    </div>
    <div class="panel"><h3>Porositë e fundit</h3><div class="table-wrap"><table>
      <thead><tr><th>Porosia</th><th>Data</th><th>Identifikuesi</th><th>Lloji</th><th>Totali</th><th>Statusi</th></tr></thead>
      <tbody>${recentRows}</tbody></table></div></div>
    <div class="panel"><h3>Produktet më të shitura sot</h3><div class="table-wrap"><table>
      <thead><tr><th>#</th><th>Produkti</th><th>Sasia</th><th>Të ardhurat</th></tr></thead>
      <tbody>${topRows}</tbody></table></div></div>`;
}

function statusPill(order) {
  if (isPaid(order)) return `<span class="status-pill ready">Paguar</span>`;
  if (order.status === ORDER_STATUS.CANCELLED) return `<span class="status-pill cancelled">Anuluar</span>`;
  return `<span class="status-pill preparing">Aktive</span>`;
}

function filteredAdminOrders() {
  const { q, status, type, date } = state.adminOrders;
  let list = state.orders.slice();

  if (status !== "all") list = list.filter((o) => o.status === status);
  const normalizedType = normalizeOrderType(type === "all" ? "" : type);
  if (normalizedType) list = list.filter((o) => o.orderType === normalizedType);
  if (date) list = list.filter((o) => String(o.createdAt || "").slice(0, 10) === date);

  const query = cleanText(q, 60).toLowerCase();
  if (query) {
    list = list.filter((order) =>
      [
        order.number,
        order.customerName,
        order.customer,
        order.phone,
        order.waiter,
        orderLabel(order),
        ORDER_TYPE_LABELS[order.orderType] || "",
        order.tableNumber ? `tavolina ${order.tableNumber}` : "",
        order.tableNumber ? String(order.tableNumber) : "",
        ...(order.items || []).map((i) => txt(i.name))
      ]
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }

  return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function renderAdminOrders() {
  const list = filteredAdminOrders();
  const revenue = list.filter(isPaid).reduce((sum, o) => sum + Number(o.total || 0), 0);

  const rows = list.length
    ? list
        .map(
          (order) => `
    <tr>
      <td><strong>${esc(order.number)}</strong><br><span class="text-muted">${esc(formatDate(order.createdAt))}</span></td>
      <td><strong>${esc(orderLabel(order))}</strong><br><span class="text-muted">${esc(ORDER_TYPE_LABELS[order.orderType] || "")}</span></td>
      <td>${esc(order.waiter || "—")}${order.channel === "internet" ? `<br><span class="text-muted">nga faqja</span>` : ""}</td>
      <td>${money(order.total)}<br><span class="text-muted">${order.items.reduce((s, i) => s + i.qty, 0)} artikuj</span></td>
      <td>${
        order.payment
          ? `${esc(PAYMENT_METHOD_LABELS[order.payment.method] || "")}<br><span class="text-muted">${esc(formatTime(order.paidAt))}</span>`
          : "—"
      }</td>
      <td>${statusPill(order)}</td>
      <td><div class="row-actions">
        <button class="btn ghost small" data-order-action="view" data-id="${esc(order.id)}">Shiko</button>
        <button class="btn ghost small" data-order-action="print" data-id="${esc(order.id)}">Printo</button>
        ${
          isActive(order)
            ? `<button class="btn gold small" data-order-action="pay" data-id="${esc(order.id)}">Shëno të paguar</button>
               <button class="btn danger small" data-order-action="cancel" data-id="${esc(order.id)}">Anulo</button>`
            : ""
        }
      </div></td>
    </tr>`
        )
        .join("")
    : `<tr><td colspan="7">Nuk ka porosi për këto kritere.</td></tr>`;

  const typeOptions = [
    ["all", "Të gjitha llojet"],
    ["TAVOLINE", "Tavolinë"],
    ["EMER", "Me emër"],
    ["ME_VETI", "Me veti"],
    ["PER_KETU", "Për këtu"]
  ];

  $("#adminContent").innerHTML = `
    <div class="admin-topbar"><h2>Historiku i porosisë</h2>
      <div style="display:flex; gap:12px; flex-wrap:wrap;">
        <button class="btn gold" data-admin-export>Eksporto (CSV)</button>
      </div>
    </div>
    <div class="panel">
      <div class="form two-col">
        <div class="field"><label>Kërko</label>
          <input id="adminOrderSearch" class="input" placeholder="Tavolina 50, Bastria, Me veti, Enver, numri i porosisë..." value="${esc(state.adminOrders.q)}" autocomplete="off" />
        </div>
        <div class="field"><label>Data</label>
          <input id="adminOrderDate" class="input" type="date" value="${esc(state.adminOrders.date)}" />
        </div>
        <div class="field"><label>Statusi</label>
          <select id="adminOrderStatusFilter" class="select">
            <option value="all">Të gjitha statuset</option>
            <option value="open" ${state.adminOrders.status === "open" ? "selected" : ""}>Aktive</option>
            <option value="paid" ${state.adminOrders.status === "paid" ? "selected" : ""}>Paguar</option>
            <option value="cancelled" ${state.adminOrders.status === "cancelled" ? "selected" : ""}>Anuluar</option>
          </select>
        </div>
        <div class="field"><label>Lloji i porosisë</label>
          <select id="adminOrderTypeFilter" class="select">
            ${typeOptions
              .map(([value, label]) => `<option value="${value}" ${state.adminOrders.type === value ? "selected" : ""}>${label}</option>`)
              .join("")}
          </select>
        </div>
      </div>
      <div class="summary-row"><span>Gjithsej në listë: ${list.length} porosi • të paguara: ${money(revenue)}</span></div>
    </div>
    <div class="panel"><div class="table-wrap"><table>
      <thead><tr><th>Porosia</th><th>Identifikuesi</th><th>Kamarieri</th><th>Totali</th><th>Pagesa</th><th>Statusi</th><th>Veprime</th></tr></thead>
      <tbody>${rows}</tbody></table></div></div>`;
}

function openAdminOrderDetail(orderId) {
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) return;

  let qr = "";
  try {
    qr = QR.dataUrl(receiptQrUrl(order, state.settings, location.href));
  } catch {
    qr = "";
  }

  const items = order.items
    .map(
      (item) => `
      <div class="summary-row">
        <span>${item.qty}× ${esc(txt(item.name))}${item.note ? ` — ${esc(item.note)}` : ""}</span>
        <strong>${money(lineTotal(item))}</strong>
      </div>`
    )
    .join("");

  const events = (order.events || [])
    .slice()
    .reverse()
    .map(
      (event) => `
      <tr><td>${esc(formatDate(event.at))}</td><td>${esc(event.by || "")}</td><td>${esc(event.message || event.type)}</td></tr>`
    )
    .join("");

  openModal(`
    <div class="modal-head">
      <div><h3>${esc(orderLabel(order))}</h3><div class="modal-sub">${esc(order.number)} • ${esc(formatDate(order.createdAt))}</div></div>
      <button class="icon-btn" data-close aria-label="Mbyll">✕</button>
    </div>
    <div class="panel">
      <div class="summary-row"><span>Lloji i porosisë</span><strong>${esc(ORDER_TYPE_LABELS[order.orderType] || "")}</strong></div>
      <div class="summary-row"><span>Statusi</span><strong>${isPaid(order) ? "Paguar" : order.status === ORDER_STATUS.CANCELLED ? "Anuluar" : "Aktive"}</strong></div>
      ${order.tableNumber ? `<div class="summary-row"><span>Numri i tavolinës</span><strong>${esc(order.tableNumber)}</strong></div>` : ""}
      ${order.customerName ? `<div class="summary-row"><span>Emri / identifikuesi</span><strong>${esc(order.customerName)}</strong></div>` : ""}
      ${order.customer ? `<div class="summary-row"><span>Klienti</span><strong>${esc(order.customer)}</strong></div>` : ""}
      ${order.phone ? `<div class="summary-row"><span>Telefoni</span><strong>${esc(order.phone)}</strong></div>` : ""}
      ${order.waiter ? `<div class="summary-row"><span>Kamarieri</span><strong>${esc(order.waiter)}</strong></div>` : ""}
      ${order.payment ? `<div class="summary-row"><span>Mënyra e pagesës</span><strong>${esc(PAYMENT_METHOD_LABELS[order.payment.method] || "")}</strong></div>` : ""}
      ${order.paidAt ? `<div class="summary-row"><span>Ora e pagesës</span><strong>${esc(formatTime(order.paidAt))}</strong></div>` : ""}
      ${order.payment?.by ? `<div class="summary-row"><span>Pagesën e mori</span><strong>${esc(order.payment.by)}</strong></div>` : ""}
      ${order.payment?.change ? `<div class="summary-row"><span>Rikthimi</span><strong>${money(order.payment.change)}</strong></div>` : ""}
      ${order.note ? `<div class="summary-row"><span>Shënimi</span><strong>${esc(order.note)}</strong></div>` : ""}
      ${order.cancelReason ? `<div class="summary-row"><span>Arsyeja e anulimit</span><strong>${esc(order.cancelReason)}</strong></div>` : ""}
    </div>
    <div class="panel"><h3>Produktet</h3><div class="summary-list">${items}
      <div class="summary-row"><span>Nëntotali</span><strong>${money(order.subtotal)}</strong></div>
      <div class="summary-row"><span>TVSH</span><strong>${money(order.vat)}</strong></div>
      <div class="summary-row"><strong>Totali</strong><strong>${money(order.total)}</strong></div>
    </div></div>
    ${qr ? `<div class="panel" style="justify-items:center;"><img src="${qr}" alt="Kodi QR i porosisë" style="width:150px;height:150px;" /><small class="text-muted">Skanojeni për ta hapur në telefon</small></div>` : ""}
    ${
      events
        ? `<div class="panel"><h3>Ngjarjet e porosisë</h3><div class="table-wrap"><table>
            <thead><tr><th>Data</th><th>Përdoruesi</th><th>Veprimi</th></tr></thead>
            <tbody>${events}</tbody></table></div></div>`
        : ""
    }
    <div style="display:flex; justify-content:flex-end; gap:12px; flex-wrap:wrap;">
      <button class="btn ghost" data-close>Mbyll</button>
      ${isActive(order) ? `<button class="btn gold" data-order-action="pay" data-id="${esc(order.id)}">Shëno të paguar</button>` : ""}
      <button class="btn ghost" data-order-action="print" data-id="${esc(order.id)}">Printo faturën</button>
    </div>`);
}

async function markOrderPaid(orderId) {
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) return;
  try {
    await state.api.pay(orderId, { method: "other" }, state.user?.username || "administratori");
    closeTopModal();
    await loadAll();
    renderAdminSection();
    toast("Porosia u shënua si e paguar.", "ok");
  } catch (error) {
    toast(error?.message || "Veprimi nuk u krye.", "error");
  }
}

async function cancelOrderFromAdmin(orderId) {
  const order = state.orders.find((o) => o.id === orderId);
  openReasonModal({
    title: "Anulo porosinë",
    subtitle: order ? `${orderLabel(order)} • ${money(order.total)}` : "",
    confirmText: "Konfirmo anulimin",
    onConfirm: async (reason) => {
      try {
        await state.api.cancel(orderId, reason, state.user?.username || "administratori");
        closeTopModal();
        await loadAll();
        renderAdminSection();
        toast("Porosia u anulua.", "info");
      } catch (error) {
        toast(error?.message || "Porosia nuk u anulua.", "error");
      }
    }
  });
}

function exportOrdersCSV() {
  const list = filteredAdminOrders();
  const rows = [
    ["Numri", "Data", "Ora", "Lloji", "Identifikuesi", "Tavolina", "Emri", "Kamarieri", "Pagesa", "Ora e pagesës", "Totali", "Statusi", "Produktet"]
  ];
  list.forEach((order) =>
    rows.push([
      order.number,
      formatDay(order.createdAt),
      formatTime(order.createdAt),
      ORDER_TYPE_LABELS[order.orderType] || "",
      orderLabel(order),
      order.tableNumber || "",
      order.customerName || "",
      order.waiter || "",
      order.payment ? PAYMENT_METHOD_LABELS[order.payment.method] || "" : "",
      order.paidAt ? formatTime(order.paidAt) : "",
      Number(order.total || 0).toFixed(2),
      isPaid(order) ? "Paguar" : order.status === ORDER_STATUS.CANCELLED ? "Anuluar" : "Aktive",
      order.items.map((i) => `${i.qty}× ${txt(i.name)}`).join("; ")
    ])
  );

  const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `sharri-porositë-${dayKey(new Date())}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  toast("Eksportimi u krye.", "ok");
}

/* ---------- Produktet ---------- */
function renderAdminProducts() {
  const rows = state.products
    .slice()
    .sort(
      (a, b) =>
        categoryName(a.category).localeCompare(categoryName(b.category)) || txt(a.name).localeCompare(txt(b.name))
    )
    .map(
      (product) => `
    <tr>
      <td>${product.image ? `<img class="thumb" src="${esc(product.image)}" alt="${esc(txt(product.name))}" />` : `<div class="thumb-fallback">${esc(product.emoji || "🍽️")}</div>`}</td>
      <td><strong>${esc(txt(product.name))}</strong></td>
      <td>${esc(categoryName(product.category))}</td>
      <td><span class="badge ${kindOf(product) === "ushqim" ? "gold" : "dark"}">${PRODUCT_KIND_LABELS[kindOf(product)]}</span></td>
      <td>${product.unit === "piece" ? `${money(product.price)} / copë` : money(product.price)}</td>
      <td>
        ${product.hidden ? `<span class="badge dark">Fshehur</span>` : ""}
        ${!product.available ? `<span class="badge dark">Pa disponim</span>` : ""}
        ${product.popular ? `<span class="badge gold">Popullore</span>` : ""}
        ${product.daily ? `<span class="badge dark">Ditor</span>` : ""}
      </td>
      <td><div class="row-actions">
        <button class="btn ghost small" data-product-action="edit" data-id="${esc(product.id)}">Ndrysho</button>
        <button class="btn ghost small" data-product-action="toggle-hidden" data-id="${esc(product.id)}">${product.hidden ? "Shfaq" : "Fsheh"}</button>
        <button class="btn danger small" data-product-action="delete" data-id="${esc(product.id)}">Fshi</button>
      </div></td>
    </tr>`
    )
    .join("");

  $("#adminContent").innerHTML = `
    <div class="admin-topbar"><h2>Produktet</h2><button class="btn gold" data-admin-add-product>Shto produkt</button></div>
    <div class="panel">
      <p class="text-muted">Lloji i produktit (ushqim ose pije) vendos nëse porosia lejohet «Me veti» ose «Për këtu».</p>
      <div class="table-wrap"><table>
      <thead><tr><th>Imazhi</th><th>Produkti</th><th>Kategoria</th><th>Lloji</th><th>Çmimi</th><th>Statusi</th><th>Veprime</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    </div>`;
}

function openProductForm(productId = null) {
  const product = productId ? getProduct(productId) : null;
  const catOpts = state.categories
    .map((c) => `<option value="${esc(c.id)}" ${product?.category === c.id ? "selected" : ""}>${esc(txt(c.name))}</option>`)
    .join("");
  const kind = product ? product.kind || "" : "";

  openModal(`
    <div class="modal-head"><h3>${product ? "Ndrysho produktin" : "Shto produkt"}</h3><button class="icon-btn" data-close aria-label="Mbyll">✕</button></div>
    <form id="productForm" class="form two-col">
      <input type="hidden" name="id" value="${esc(product?.id || "")}" />
      <div class="field"><label>Emri</label><input name="name" class="input" required value="${esc(txt(product?.name || ""))}" /></div>
      <div class="field"><label>Kategoria</label><select name="category" class="select" required>${catOpts}</select></div>
      <div class="field"><label>Çmimi</label><input name="price" type="number" step="0.01" min="0" class="input" required value="${product?.price ?? ""}" /></div>
      <div class="field"><label>Lloji</label>
        <select name="kind" class="select">
          <option value="">Sipas kategorisë</option>
          <option value="ushqim" ${kind === "ushqim" ? "selected" : ""}>Ushqim</option>
          <option value="pije" ${kind === "pije" ? "selected" : ""}>Pije</option>
        </select>
      </div>
      <div class="field"><label>Njësia</label><select name="unit" class="select"><option value="">Normale</option><option value="piece" ${product?.unit === "piece" ? "selected" : ""}>Për copë</option></select></div>
      <div class="field"><label>Emoji</label><input name="emoji" class="input" value="${esc(product?.emoji || "🍽️")}" /></div>
      <div class="field"><label>Fjalë kyçe për kërkim</label><input name="keywords" class="input" value="${esc(product?.keywords || "")}" placeholder="p.sh. kokakolla, kafe" /></div>
      <div class="field"><label>URL e imazhit</label><input id="productImage" name="image" class="input" value="${esc(product?.image || "")}" /></div>
      <div class="field span-2"><label>Ngarko imazh</label><input id="productImageFile" type="file" accept="image/*" class="input" /></div>
      <div class="field span-2"><label>Përshkrimi</label><textarea name="desc" class="textarea" required>${esc(txt(product?.desc || ""))}</textarea></div>
      <div class="field span-2">
        <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:10px;">
          <label class="checkline"><input type="checkbox" name="popular" ${product?.popular ? "checked" : ""} /><span>Popullore</span></label>
          <label class="checkline"><input type="checkbox" name="daily" ${product?.daily ? "checked" : ""} /><span>Ditor</span></label>
          <label class="checkline"><input type="checkbox" name="family" ${product?.family ? "checked" : ""} /><span>Familje</span></label>
          <label class="checkline"><input type="checkbox" name="special" ${product?.special ? "checked" : ""} /><span>Specialitet</span></label>
          <label class="checkline"><input type="checkbox" name="available" ${product ? (product.available ? "checked" : "") : "checked"} /><span>Disponueshëm</span></label>
          <label class="checkline"><input type="checkbox" name="hidden" ${product?.hidden ? "checked" : ""} /><span>Fshehur</span></label>
        </div>
      </div>
      <div class="span-2" style="display:flex; justify-content:flex-end; gap:12px; flex-wrap:wrap;">
        <button type="button" class="btn ghost" data-close>Anulo</button>
        <button type="submit" class="btn gold">Ruaj</button>
      </div>
    </form>`);
}

async function processImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          const scale = Math.min(1, 700 / img.width);
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", 0.72));
        } catch (error) {
          reject(error);
        }
      };
      img.onerror = () => reject(new Error("Imazhi nuk u ngarkua."));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error("Skedari nuk u lexua."));
    reader.readAsDataURL(file);
  });
}

async function handleProductForm(form) {
  const data = new FormData(form);
  const payload = {
    id: String(data.get("id") || "") || undefined,
    name: String(data.get("name") || "").trim(),
    category: String(data.get("category") || ""),
    price: Number(data.get("price")),
    kind: String(data.get("kind") || "") || null,
    unit: String(data.get("unit") || "") || null,
    emoji: String(data.get("emoji") || "🍽️").trim(),
    keywords: String(data.get("keywords") || "").trim(),
    image: String(data.get("image") || "").trim(),
    desc: String(data.get("desc") || "").trim(),
    popular: Boolean(data.get("popular")),
    daily: Boolean(data.get("daily")),
    family: Boolean(data.get("family")),
    special: Boolean(data.get("special")),
    available: Boolean(data.get("available")),
    hidden: Boolean(data.get("hidden"))
  };

  try {
    await state.api.saveProduct(payload, state.user?.username || "administratori");
    closeTopModal();
    await loadAll();
    renderAdminProducts();
    renderPublicContent();
    toast("Produkti u ruajt.", "ok");
  } catch (error) {
    toast(error?.message || "Produkti nuk u ruajt.", "error");
  }
}

async function deleteProduct(id) {
  const product = getProduct(id);
  if (!confirm("Jeni të sigurt që doni ta fshini këtë produkt?")) return;
  try {
    await state.api.deleteProduct(id, state.user?.username || "administratori");
    await loadAll();
    renderAdminProducts();
    renderPublicContent();
    toast(`Produkti u fshi: ${txt(product?.name) || id}`, "info");
  } catch (error) {
    toast(error?.message || "Produkti nuk u fshi.", "error");
  }
}

async function toggleProductHidden(id) {
  const product = getProduct(id);
  if (!product) return;
  try {
    await state.api.saveProduct({ ...clone(product), hidden: !product.hidden }, state.user?.username || "administratori");
    await loadAll();
    renderAdminProducts();
    renderPublicContent();
    toast(product.hidden ? "Produkti u shfaq." : "Produkti u fsheh.", "info");
  } catch (error) {
    toast(error?.message || "Veprimi nuk u krye.", "error");
  }
}

/* ---------- Raporti i arkës ---------- */
function defaultCashReport() {
  return {
    id: null,
    number: null,
    createdAt: null,
    updatedAt: null,
    createdBy: null,
    updatedBy: null,
    cashier: state.user?.username || "",
    expected: 0,
    notes: "",
    coins: [
      { value: 1, qty: 0 },
      { value: 2, qty: 0 }
    ],
    bills: [
      { value: 5, qty: 0 },
      { value: 10, qty: 0 },
      { value: 20, qty: 0 },
      { value: 50, qty: 0 },
      { value: 100, qty: 0 },
      { value: 200, qty: 0 }
    ],
    withdrawals: []
  };
}

function ensureCashDraft() {
  if (!state.cash) state.cash = defaultCashReport();
}

function cashReportCalc(report) {
  const coinsTotal = report.coins.reduce((sum, row) => sum + row.value * (Number(row.qty) || 0), 0);
  const billsTotal = report.bills.reduce((sum, row) => sum + row.value * (Number(row.qty) || 0), 0);
  const drawerTotal = coinsTotal + billsTotal;
  const withdrawalsTotal = report.withdrawals.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  const reportedTotal = drawerTotal - withdrawalsTotal;
  const difference = reportedTotal - (Number(report.expected) || 0);
  return { coinsTotal, billsTotal, drawerTotal, withdrawalsTotal, reportedTotal, difference };
}

function updateCashSummary() {
  const calc = cashReportCalc(state.cash);
  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = money(value);
  };
  set("cashCoinsTotal", calc.coinsTotal);
  set("cashBillsTotal", calc.billsTotal);
  set("cashDrawerTotal", calc.drawerTotal);
  set("cashWithdrawalsTotal", calc.withdrawalsTotal);
  set("cashReportedTotal", calc.reportedTotal);
  set("cashDifference", calc.difference);

  const row = $("#cashDifferenceRow");
  if (row) {
    row.classList.toggle("positive", calc.difference >= 0);
    row.classList.toggle("negative", calc.difference < 0);
  }
}

function renderAdminCash() {
  ensureCashDraft();
  const report = state.cash;
  const calc = cashReportCalc(report);
  const when = new Date(report.updatedAt || report.createdAt || Date.now());

  const coinRows = report.coins
    .map(
      (row, index) =>
        `<tr><td>${money(row.value)}</td><td><input class="input" type="number" min="0" step="1" value="${esc(row.qty)}" data-cash-qty="coins" data-index="${index}" /></td><td data-cash-row-total="coins-${index}">${money(row.value * row.qty)}</td></tr>`
    )
    .join("");
  const billRows = report.bills
    .map(
      (row, index) =>
        `<tr><td>${money(row.value)}</td><td><input class="input" type="number" min="0" step="1" value="${esc(row.qty)}" data-cash-qty="bills" data-index="${index}" /></td><td data-cash-row-total="bills-${index}">${money(row.value * row.qty)}</td></tr>`
    )
    .join("");
  const withdrawalRows = report.withdrawals.length
    ? report.withdrawals
        .map(
          (row, index) =>
            `<div class="cash-withdrawal"><input class="input" value="${esc(row.person)}" placeholder="Personi" data-cash-wfield="person" data-index="${index}" /><input class="input" type="number" step="0.01" min="0" value="${esc(row.amount)}" placeholder="Shuma" data-cash-wfield="amount" data-index="${index}" /><input class="input" value="${esc(row.note)}" placeholder="Shënim" data-cash-wfield="note" data-index="${index}" /><button class="icon-btn" data-cash-remove-withdrawal="${index}" aria-label="Hiq">✕</button></div>`
        )
        .join("")
    : `<p class="text-muted">Nuk ka tërheqje.</p>`;

  $("#adminContent").innerHTML = `
    <div class="admin-topbar"><h2>Raporti i arkës</h2>
      <div style="display:flex; gap:12px; flex-wrap:wrap;">
        <button class="btn gold" data-cash-save>Ruaj raportin</button>
        <button class="btn ghost" data-cash-new>Raport i ri</button>
        <button class="btn ghost" data-cash-history>Historiku</button>
        <button class="btn ghost" data-print="#cashPrint">Printo</button>
        <button class="btn ghost" data-cash-sample>Ngarko shembull</button>
      </div>
    </div>
    <div id="cashPrint" class="print-area">
      <div class="panel">
        <div class="cash-meta">
          <div><strong>${esc(txt(state.settings.restaurantName))}</strong></div>
          ${report.number ? `<div><span class="cash-badge">Numri i raportit:</span> <strong>${esc(report.number)}</strong></div>` : ""}
          <div><span class="cash-badge">Llogaritur nga:</span> <strong>${esc(report.createdBy || state.user?.username || "")}</strong></div>
          <div><span class="cash-badge">Përditësuar nga:</span> <strong>${esc(report.updatedBy || state.user?.username || "")}</strong></div>
        </div>
        <div class="form two-col">
          <div class="field"><label>Data</label><input class="input" readonly value="${esc(formatDay(when.toISOString()))}" /></div>
          <div class="field"><label>Ora</label><input class="input" readonly value="${esc(formatTime(when.toISOString()))}" /></div>
          <div class="field"><label>Kasieri</label><input id="cashCashier" class="input" value="${esc(report.cashier)}" /></div>
          <div class="field"><label>Totali i pritshëm</label><input id="cashExpected" class="input" type="number" step="0.01" min="0" value="${esc(report.expected)}" /></div>
          <div class="field span-2"><label>Shënime</label><textarea id="cashNotes" class="textarea">${esc(report.notes)}</textarea></div>
        </div>
      </div>
      <div class="cash-grid">
        <div class="panel"><h3>Hekurat / Monedhat</h3><div class="table-wrap"><table class="cash-table"><thead><tr><th>Vlera</th><th>Sasia</th><th>Totali</th></tr></thead><tbody>${coinRows}</tbody></table></div></div>
        <div class="panel"><h3>Letërnjoftimet</h3><div class="table-wrap"><table class="cash-table"><thead><tr><th>Vlera</th><th>Sasia</th><th>Totali</th></tr></thead><tbody>${billRows}</tbody></table></div></div>
      </div>
      <div class="panel">
        <div style="display:flex; justify-content:space-between; gap:16px; align-items:center; flex-wrap:wrap;">
          <h3>Tërheqjet / Kush ka marrë para</h3>
          <button class="btn ghost" data-cash-add-withdrawal>Shto tërheqje</button>
        </div>
        <div class="cash-withdrawals">${withdrawalRows}</div>
      </div>
      <div class="panel"><h3>Përmbledhja</h3>
        <div class="cash-summary">
          <div class="cash-summary-row"><span>Hekurat (1 € + 2 €)</span><strong id="cashCoinsTotal">${money(calc.coinsTotal)}</strong></div>
          <div class="cash-summary-row"><span>Letra (5 € - 200 €)</span><strong id="cashBillsTotal">${money(calc.billsTotal)}</strong></div>
          <div class="cash-summary-row"><span>Totali në arkë</span><strong id="cashDrawerTotal">${money(calc.drawerTotal)}</strong></div>
          <div class="cash-summary-row"><span>Tërheqjet gjithsej</span><strong id="cashWithdrawalsTotal">${money(calc.withdrawalsTotal)}</strong></div>
          <div class="cash-summary-row final"><span>Totali i raportuar</span><strong id="cashReportedTotal">${money(calc.reportedTotal)}</strong></div>
          <div id="cashDifferenceRow" class="cash-summary-row final ${calc.difference >= 0 ? "positive" : "negative"}"><span>Diferenca nga totali i pritshëm</span><strong id="cashDifference">${money(calc.difference)}</strong></div>
        </div>
      </div>
    </div>`;
}

async function saveCashReport() {
  ensureCashDraft();
  const report = state.cash;
  if (!cleanText(report.cashier)) {
    toast("Plotësoni kasierin.", "error");
    return;
  }
  try {
    const saved = await state.api.saveCashReport(clone(report), state.user?.username || "administratori");
    state.cash = clone(saved);
    await loadAdminData();
    renderAdminCash();
    toast("Raporti u ruajt.", "ok");
  } catch (error) {
    toast(error?.message || "Raporti nuk u ruajt.", "error");
  }
}

function loadCashSample() {
  const report = defaultCashReport();
  report.cashier = state.user?.username || "Kasieri";
  report.expected = 320.5;
  report.notes = "Shembull demonstrimi.";
  report.coins[0].qty = 25;
  report.coins[1].qty = 12;
  report.bills[0].qty = 10;
  report.bills[1].qty = 8;
  report.bills[2].qty = 5;
  report.bills[3].qty = 2;
  report.bills[4].qty = 1;
  report.withdrawals = [
    { person: "Menaxheri", amount: 50, note: "Blerje operative" },
    { person: "Furnizuesi", amount: 80, note: "Pagesë furnizimi" }
  ];
  state.cash = report;
  renderAdminCash();
  toast("Shembulli u ngarkua.", "info");
}

function openCashHistoryModal() {
  const reports = state.cashReports.slice().sort(
    (a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0)
  );
  const rows = reports.length
    ? reports
        .map((report) => {
          const calc = cashReportCalc(report);
          return `<tr>
      <td><strong>${esc(report.number || "")}</strong></td>
      <td>${esc(formatDate(report.updatedAt || report.createdAt))}</td>
      <td>${esc(report.cashier)}</td>
      <td>${esc(report.createdBy || "")}${report.updatedBy && report.updatedBy !== report.createdBy ? `<br><span class="text-muted">${esc(report.updatedBy)}</span>` : ""}</td>
      <td>${money(report.expected)}</td>
      <td>${money(calc.reportedTotal)}</td>
      <td>${money(calc.difference)}</td>
      <td><div class="row-actions">
        <button class="btn ghost small" data-cash-load="${esc(report.id)}">Ngarko</button>
        <button class="btn danger small" data-cash-delete="${esc(report.id)}">Fshi</button>
      </div></td></tr>`;
        })
        .join("")
    : `<tr><td colspan="8">Nuk ka raporte të ruajtura.</td></tr>`;

  openModal(`
    <div class="modal-head"><h3>Historiku i raporteve</h3><button class="icon-btn" data-close aria-label="Mbyll">✕</button></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Raporti</th><th>Data</th><th>Kasieri</th><th>Llogaritur nga</th><th>Pritshëm</th><th>Raportuar</th><th>Diferenca</th><th>Veprime</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`);
}

async function deleteCashReport(id) {
  if (!confirm("Jeni të sigurt që doni ta fshini këtë raport?")) return;
  try {
    await state.api.deleteCashReport(id, state.user?.username || "administratori");
    if (state.cash?.id === id) state.cash = defaultCashReport();
    await loadAdminData();
    closeTopModal();
    openCashHistoryModal();
    toast("Raporti u fshi.", "info");
  } catch (error) {
    toast(error?.message || "Raporti nuk u fshi.", "error");
  }
}

/* ---------- Cilësimet dhe regjistri ---------- */
function renderAdminSettings() {
  const settings = state.settings;
  $("#adminContent").innerHTML = `
    <div class="admin-topbar"><h2>Cilësimet</h2></div>
    <form id="settingsForm" class="panel form two-col">
      <div class="field"><label>Emri i restorantit</label><input name="restaurantName" class="input" required value="${esc(txt(settings.restaurantName))}" /></div>
      <div class="field"><label>Telefoni</label><input name="phone" class="input" required value="${esc(txt(settings.phone))}" /></div>
      <div class="field"><label>Adresa</label><input name="address" class="input" required value="${esc(txt(settings.address))}" /></div>
      <div class="field"><label>Orari</label><input name="hours" class="input" required value="${esc(txt(settings.hours))}" /></div>
      <div class="field"><label>Monedha</label><input name="currency" class="input" required value="${esc(settings.currency)}" /></div>
      <div class="field"><label>TVSH %</label><input name="taxRate" type="number" min="0" max="100" step="0.1" class="input" required value="${esc(settings.taxRate)}" /></div>
      <div class="field"><label>Numri i tavolinave</label><input name="tableCount" type="number" min="1" max="200" step="1" class="input" required value="${esc(settings.tableCount || TABLE_COUNT)}" /></div>
      <div class="field"><label>Kamarierët (të ndarë me presje)</label><input name="waiters" class="input" value="${esc((settings.waiters || []).join(", "))}" placeholder="Ardit, Blerta, Liridon" /></div>
      <label class="checkline span-2"><input type="checkbox" name="taxIncluded" ${settings.taxIncluded ? "checked" : ""} /><span>TVSH e përfshirë në çmime</span></label>
      <div class="span-2">
        <p class="text-muted">Rregulli i porosisë: «Me veti» dhe «Për këtu» lejohen vetëm kur porosia përmban ushqim. Pijet vetëm lidhen me tavolinë ose me emër.</p>
      </div>
      <div class="span-2" style="display:flex; justify-content:flex-end;"><button type="submit" class="btn gold">Ruaj cilësimet</button></div>
    </form>`;
}

async function handleSettingsForm(form) {
  const data = new FormData(form);
  try {
    await state.api.saveSettings(
      {
        restaurantName: String(data.get("restaurantName") || "").trim(),
        phone: String(data.get("phone") || "").trim(),
        address: String(data.get("address") || "").trim(),
        hours: String(data.get("hours") || "").trim(),
        currency: String(data.get("currency") || "€").trim(),
        taxRate: Number(data.get("taxRate")) || 0,
        taxIncluded: Boolean(data.get("taxIncluded")),
        tableCount: Number(data.get("tableCount")) || TABLE_COUNT,
        waiters: String(data.get("waiters") || "")
          .split(",")
          .map((name) => name.trim())
          .filter(Boolean)
      },
      state.user?.username || "administratori"
    );
    await loadAll();
    renderAdminSettings();
    renderPublicContent();
    toast("Cilësimet u ruajtën.", "ok");
  } catch (error) {
    toast(error?.message || "Cilësimet nuk u ruajtën.", "error");
  }
}

function renderAdminLogs() {
  const rows = state.logs.length
    ? state.logs
        .map((entry) => `<tr><td>${esc(formatDate(entry.at))}</td><td>${esc(entry.user)}</td><td>${esc(entry.action)}</td></tr>`)
        .join("")
    : `<tr><td colspan="3">Nuk ka regjistrime.</td></tr>`;

  $("#adminContent").innerHTML = `
    <div class="admin-topbar"><h2>Regjistri</h2><div class="text-muted">${state.logs.length} ngjarje</div></div>
    <div class="panel"><div class="table-wrap"><table>
      <thead><tr><th>Data</th><th>Përdoruesi</th><th>Veprimi</th></tr></thead>
      <tbody>${rows}</tbody></table></div></div>`;
}

/* ============================================================
   Routeri
   ============================================================ */
function route() {
  const hash = location.hash || "#/";
  const publicView = $("#publicView");
  const routeView = $("#routeView");

  if (hash.startsWith("#/kitchen")) {
    publicView.classList.add("hidden");
    routeView.classList.remove("hidden");
    state.knownOrders = new Set(state.orders.map((o) => o.id));
    renderKitchen(false);
  } else if (hash.startsWith("#/admin")) {
    publicView.classList.add("hidden");
    routeView.classList.remove("hidden");
    renderAdmin();
  } else {
    publicView.classList.remove("hidden");
    routeView.classList.add("hidden");
    renderPublicContent();
  }
}

function renderCurrentRoute() {
  const hash = location.hash || "#/";
  if (hash.startsWith("#/kitchen")) return renderKitchen(false);
  if (hash.startsWith("#/admin")) {
    loadAdminData().then(() => renderAdminSection());
    return;
  }
  return renderPublicContent();
}

/* ============================================================
   Ngjarjet
   ============================================================ */
function bindEvents() {
  window.addEventListener("hashchange", route);

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const overlay = $$(".modal-overlay");
    if (overlay.length) closeModal(overlay[overlay.length - 1]);
    else closeCart();
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (target.classList.contains("modal-overlay")) return closeModal(target);

    const closeButton = target.closest("[data-close]");
    if (closeButton) return closeModal(closeButton.closest(".modal-overlay"));

    if (target.closest("[data-open-cart]")) openCart();
    if (target.closest("[data-close-cart]")) closeCart();

    const addBtn = target.closest("[data-add]");
    if (addBtn) addCart(addBtn.dataset.add);

    const chip = target.closest("[data-chip]");
    if (chip) {
      state.filters.cat = chip.dataset.chip;
      renderChips();
      renderMenu();
    }

    const cartAction = target.closest("[data-cart-action]");
    if (cartAction) {
      const key = cartAction.dataset.key;
      if (cartAction.dataset.cartAction === "inc") changeCartQty(key, 1);
      if (cartAction.dataset.cartAction === "dec") changeCartQty(key, -1);
      if (cartAction.dataset.cartAction === "remove") removeCartLine(key);
    }

    if (target.closest("[data-open-checkout]")) openCheckout();

    const receiptBtn = target.closest("[data-receipt]");
    if (receiptBtn) {
      closeModal(receiptBtn.closest(".modal-overlay"));
      openReceipt(receiptBtn.dataset.receipt);
    }

    const printBtn = target.closest("[data-print]");
    if (printBtn) printElement(printBtn.dataset.print);

    const readyBtn = target.closest("[data-kitchen-ready]");
    if (readyBtn) setKitchenReady(readyBtn.dataset.kitchenReady, readyBtn.dataset.ready === "1");

    const cancelBtn = target.closest("[data-kitchen-cancel]");
    if (cancelBtn) cancelFromKitchen(cancelBtn.dataset.kitchenCancel);

    const adminNav = target.closest("[data-admin-nav]");
    if (adminNav) {
      state.adminSection = adminNav.dataset.adminNav;
      if (["logs", "cash", "orders"].includes(state.adminSection)) loadAdminData();
      renderAdminShell();
    }

    if (target.closest("[data-admin-logout]")) logout();
    if (target.closest("[data-admin-add-product]")) openProductForm();
    if (target.closest("[data-admin-export]")) exportOrdersCSV();

    const productAction = target.closest("[data-product-action]");
    if (productAction) {
      const id = productAction.dataset.id;
      const action = productAction.dataset.productAction;
      if (action === "edit") openProductForm(id);
      if (action === "toggle-hidden") toggleProductHidden(id);
      if (action === "delete") deleteProduct(id);
    }

    const orderAction = target.closest("[data-order-action]");
    if (orderAction) {
      const id = orderAction.dataset.id;
      const action = orderAction.dataset.orderAction;
      if (action === "view") openAdminOrderDetail(id);
      if (action === "print") openReceipt(id);
      if (action === "pay") markOrderPaid(id);
      if (action === "cancel") cancelOrderFromAdmin(id);
    }

    if (target.closest("[data-cash-save]")) saveCashReport();
    if (target.closest("[data-cash-new]")) {
      state.cash = defaultCashReport();
      renderAdminCash();
    }
    if (target.closest("[data-cash-history]")) openCashHistoryModal();
    if (target.closest("[data-cash-sample]")) loadCashSample();
    if (target.closest("[data-cash-add-withdrawal]")) {
      ensureCashDraft();
      state.cash.withdrawals.push({ person: "", amount: 0, note: "" });
      renderAdminCash();
    }

    const removeWithdrawal = target.closest("[data-cash-remove-withdrawal]");
    if (removeWithdrawal) {
      state.cash.withdrawals.splice(Number(removeWithdrawal.dataset.cashRemoveWithdrawal), 1);
      renderAdminCash();
    }

    const loadReport = target.closest("[data-cash-load]");
    if (loadReport) {
      const report = state.cashReports.find((r) => r.id === loadReport.dataset.cashLoad);
      if (report) {
        state.cash = clone(report);
        closeTopModal();
        renderAdminCash();
        toast("Raporti u ngarkua.", "info");
      }
    }

    const deleteReport = target.closest("[data-cash-delete]");
    if (deleteReport) deleteCashReport(deleteReport.dataset.cashDelete);
  });

  document.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.target;
    if (form.id === "checkoutForm") handleCheckoutForm(form);
    if (form.id === "loginForm") handleLoginForm(form);
    if (form.id === "productForm") handleProductForm(form);
    if (form.id === "settingsForm") handleSettingsForm(form);
  });

  document.addEventListener("input", (event) => {
    const target = event.target;

    if (target.id === "searchInput") {
      state.filters.q = target.value;
      renderMenu();
    }
    if (target.dataset.noteKey) {
      const item = state.cart.find((i) => i.key === target.dataset.noteKey);
      if (item) {
        item.note = target.value;
        saveCart();
      }
    }
    if (target.id === "cashCashier") {
      ensureCashDraft();
      state.cash.cashier = target.value;
    }
    if (target.id === "cashExpected") {
      ensureCashDraft();
      state.cash.expected = parseFloat(target.value) || 0;
      updateCashSummary();
    }
    if (target.id === "cashNotes") {
      ensureCashDraft();
      state.cash.notes = target.value;
    }
    if (target.dataset.cashQty) {
      ensureCashDraft();
      const kind = target.dataset.cashQty;
      const index = Number(target.dataset.index);
      const qty = Math.max(0, parseInt(target.value, 10) || 0);
      state.cash[kind][index].qty = qty;
      const cell = document.querySelector(`[data-cash-row-total="${kind}-${index}"]`);
      if (cell) cell.textContent = money(state.cash[kind][index].value * qty);
      updateCashSummary();
    }
    if (target.dataset.cashWfield) {
      ensureCashDraft();
      const index = Number(target.dataset.index);
      const field = target.dataset.cashWfield;
      state.cash.withdrawals[index][field] = field === "amount" ? parseFloat(target.value) || 0 : target.value;
      updateCashSummary();
    }
    if (target.id === "adminOrderSearch") {
      state.adminOrders.q = target.value;
      renderAdminOrders();
      const input = $("#adminOrderSearch");
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
    }
  });

  document.addEventListener("change", (event) => {
    const target = event.target;
    if (target.id === "sortSelect") {
      state.filters.sort = target.value;
      renderMenu();
    }
    if (target.id === "orderTypeSelect") syncCheckoutType();
    if (target.id === "adminOrderStatusFilter") {
      state.adminOrders.status = target.value;
      renderAdminOrders();
    }
    if (target.id === "adminOrderTypeFilter") {
      state.adminOrders.type = target.value;
      renderAdminOrders();
    }
    if (target.id === "adminOrderDate") {
      state.adminOrders.date = target.value;
      renderAdminOrders();
    }
    if (target.id === "productImageFile") {
      const file = target.files?.[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        toast("Zgjidhni një skedar imazhi.", "error");
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast("Imazhi është shumë i madh. Maksimumi 10MB.", "error");
        return;
      }
      processImageFile(file)
        .then((dataUrl) => {
          const input = $("#productImage");
          if (input) input.value = dataUrl;
          toast("Imazhi u përpunua.", "ok");
        })
        .catch((error) => {
          console.error(error);
          toast("Përpunimi i imazhit dështoi.", "error");
        });
    }
    if (target.id === "kdsSoundToggle") state.kdsSound = target.checked;
  });
}

/* ============================================================
   Nisja
   ============================================================ */
async function init() {
  state.api = await initApi();
  await loadAll();

  try {
    state.user = await state.api.sessionUser();
  } catch {
    state.user = null;
  }

  state.cart = JSON.parse(localStorage.getItem(CART_KEY) || "[]").map((item) => ({ ...item, name: txt(item.name) }));
  state.cart.forEach((item) => {
    if (!item.price) item.price = linePrice(item);
  });
  saveCart();

  if (state.user) await loadAdminData();

  bindEvents();
  route();

  state.api.subscribe(async () => {
    await loadAll();
    if (location.hash.startsWith("#/kitchen")) renderKitchen(true);
    else if (location.hash.startsWith("#/admin")) renderAdminSection();
  });

  setInterval(() => {
    if (location.hash.startsWith("#/kitchen")) renderKitchen(true);
  }, 7000);
}

init().catch((error) => {
  console.error(error);
  const view = document.getElementById("routeView");
  if (view) {
    view.classList.remove("hidden");
    view.innerHTML = `<div class="login-shell"><div class="login-card"><h2>⚠️ ${esc(error?.message || "Sistemi nuk u nis.")}</h2><button class="btn gold" onclick="location.reload()">Rifresko faqen</button></div></div>`;
  }
});
