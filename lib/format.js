/* ============================================================
   SHARRI — Formatimi shqip (para, data, ora, kohëzgjatja)
   ============================================================ */

import { ORDER_STATUS_LABELS, ORDER_TYPE_LABELS, PAYMENT_METHOD_LABELS, normalizeOrderType } from "./rules.js";

export function money(value, currency = "€") {
  return `${currency}${Number(value || 0).toFixed(2)}`;
}

export function formatDate(iso, locale = "sq-AL") {
  if (!iso) return "";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

export function formatDay(iso, locale = "sq-AL") {
  if (!iso) return "";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(iso));
}

export function formatTime(iso, locale = "sq-AL") {
  if (!iso) return "";
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export function dayKey(iso) {
  const date = new Date(iso || Date.now());
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/* "12 min" / "1 orë 5 min" / "tani" */
export function elapsed(fromIso, now = Date.now()) {
  if (!fromIso) return "";
  const minutes = Math.max(0, Math.round((now - new Date(fromIso).getTime()) / 60000));
  if (minutes < 1) return "tani";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} orë ${rest} min` : `${hours} orë`;
}

export function orderTypeLabel(order) {
  return ORDER_TYPE_LABELS[normalizeOrderType(order?.orderType)] || "Porosi";
}

export function statusLabel(status) {
  return ORDER_STATUS_LABELS[status] || status || "";
}

export function paymentLabel(method) {
  return PAYMENT_METHOD_LABELS[method] || method || "";
}

export function pluralTables(count) {
  return count === 1 ? "1 tavolinë" : `${count} tavolina`;
}
