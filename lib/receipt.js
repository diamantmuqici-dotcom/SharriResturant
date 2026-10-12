/* ============================================================
   SHARRI — Fatura (e njëjtë në ekranin e kamarierit, në faqe
   dhe në linkun QR që hapet në telefon)
   ============================================================ */

import { PAYMENT_METHOD_LABELS, isPaid, orderLabel, orderTypeLabel } from "./rules.js";

export const RECEIPT_VERSION = "SH2";

/* Tekst i sigurt për kodin QR (pa shkronja me pika) */
export function ascii(value) {
  return String(value ?? "")
    .replace(/×/g, "x")
    .replace(/€/g, "E")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9().,:+ x-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function linePrice(item) {
  return Number(item?.price ?? item?.unitPrice ?? 0);
}

export function lineTotal(item) {
  return Math.round(linePrice(item) * Number(item?.qty || 0) * 100) / 100;
}

export function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* Identifikuesi i shkurtër për QR: numri i tavolinës ose emri */
function identifierFor(order) {
  if (order.orderType === "TAVOLINE") return String(order.tableNumber ?? "-");
  if (order.orderType === "EMER") return ascii(order.customerName || "-");
  return "-";
}

export function receiptQrPayload(order, settings = {}) {
  const currency = ascii(settings.currency || "€") || "E";
  const head = [RECEIPT_VERSION, ascii(order.number), order.orderType, identifierFor(order)];
  const total = `${currency}${Number(order.total || 0).toFixed(2)}`;
  const when = new Date(order.paidAt || order.createdAt || Date.now());
  const date = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}-${String(when.getDate()).padStart(2, "0")} ${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
  const payment = isPaid(order) ? order.payment?.method || "other" : "-";

  const fixedLength = head.join("|").length + total.length + date.length + payment.length + 4;
  let budget = 154 - fixedLength;

  const all = (order.items || []).map(
    (item) => `${item.qty}x${ascii(item.name)}${currency}${lineTotal(item).toFixed(2)}`
  );
  const parts = [];
  for (const part of all) {
    const need = (parts.length ? 1 : 0) + part.length;
    if (need <= budget) {
      parts.push(part);
      budget -= need;
    } else {
      parts.push(`+${all.length - parts.length}`);
      break;
    }
  }

  return [...head, parts.join(";"), total, date, payment].join("|");
}

export function receiptQrUrl(order, settings = {}, href = typeof location !== "undefined" ? location.href : "") {
  const base = href ? new URL("recepit.html", href).href : "recepit.html";
  return `${base}#${encodeURIComponent(receiptQrPayload(order, settings))}`;
}

export function paymentMethodLabel(method) {
  return PAYMENT_METHOD_LABELS[method] || method || "";
}

/* HTML e faturës — përdoret nga ekrani i kamarierit dhe nga faqja */
export function receiptHtml(order, { qr = "", settings = {}, locale = "sq-AL" } = {}) {
  const currency = settings.currency || "€";
  const money = (value) => `${currency}${Number(value || 0).toFixed(2)}`;
  const format = (iso, options) =>
    iso ? new Intl.DateTimeFormat(locale, options).format(new Date(iso)) : "";

  const items = (order.items || [])
    .map(
      (item) => `
      <div class="receipt-item">
        <div class="receipt-line">
          <span>${item.qty}× ${esc(item.name)}</span>
          <strong>${money(lineTotal(item))}</strong>
        </div>
        ${item.note ? `<small>${esc(item.note)}</small>` : ""}
      </div>`
    )
    .join("");

  const paid = isPaid(order);

  return `
    <div class="receipt-header">
      <div class="receipt-brand">${esc(settings.restaurantName || "SHARRI")}</div>
      <div>${esc(settings.address || "")}</div>
      <div>${esc(settings.phone || "")}</div>
    </div>
    <div class="receipt-divider"></div>
    <div class="receipt-line"><span>Porosia</span><strong>${esc(order.number)}</strong></div>
    <div class="receipt-line"><span>Data</span><strong>${esc(format(order.createdAt, { dateStyle: "medium", timeStyle: "short" }))}</strong></div>
    <div class="receipt-line"><span>Lloji</span><strong>${esc(orderTypeLabel(order.orderType))}</strong></div>
    <div class="receipt-line"><span>${order.orderType === "TAVOLINE" ? "Tavolina" : "Porosia"}</span><strong>${esc(orderLabel(order))}</strong></div>
    ${order.waiter ? `<div class="receipt-line"><span>Kamarieri</span><strong>${esc(order.waiter)}</strong></div>` : ""}
    <div class="receipt-divider"></div>
    <div class="receipt-items">${items}</div>
    <div class="receipt-divider"></div>
    <div class="receipt-line"><span>Nëntotali</span><strong>${money(order.subtotal)}</strong></div>
    <div class="receipt-line"><span>TVSH</span><strong>${money(order.vat)}</strong></div>
    <div class="receipt-line"><strong>Totali</strong><strong>${money(order.total)}</strong></div>
    ${
      paid
        ? `<div class="receipt-divider"></div>
    <div class="receipt-line"><span>Statusi</span><strong>Paguar</strong></div>
    <div class="receipt-line"><span>Mënyra e pagesës</span><strong>${esc(paymentMethodLabel(order.payment?.method))}</strong></div>
    <div class="receipt-line"><span>Ora e pagesës</span><strong>${esc(format(order.paidAt, { hour: "2-digit", minute: "2-digit" }))}</strong></div>
    ${order.payment?.change ? `<div class="receipt-line"><span>Rikthimi</span><strong>${money(order.payment.change)}</strong></div>` : ""}`
        : ""
    }
    ${qr ? `<div class="receipt-qr"><img src="${qr}" alt="Kodi QR i porosisë" /><small>${esc(order.number)}</small></div>` : ""}
    <div class="receipt-thanks">Faleminderit që zgjodhët ${esc(settings.restaurantName || "SHARRI")}!</div>`;
}
