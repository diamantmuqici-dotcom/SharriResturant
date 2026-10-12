/* ============================================================
   SHARRI — Normalizimi i bazës së të dhënave
   Përdoret nga ruajtja lokale dhe nga serveri.
   ============================================================ */

import {
  TABLE_COUNT,
  defaultCategories,
  defaultDB,
  defaultProducts
} from "./catalog.js";
import { migrateOrder, normalizeOrderType } from "./rules.js";

export function mergeById(baseList, savedList) {
  const saved = (savedList || []).map((item) => ({ ...item }));
  const ids = new Set(saved.map((x) => x.id));
  for (const base of baseList) if (!ids.has(base.id)) saved.push(JSON.parse(JSON.stringify(base)));
  return saved;
}

export function normalizeDB(parsed) {
  const base = defaultDB();
  const settings = { ...base.settings, ...(parsed?.settings || {}) };

  if (!Number.isInteger(Number(settings.tableCount)) || Number(settings.tableCount) < 1) {
    settings.tableCount = TABLE_COUNT;
  }
  if (!Array.isArray(settings.waiters)) settings.waiters = base.settings.waiters;

  return {
    ...base,
    ...parsed,
    settings,
    counters: { ...base.counters, ...(parsed?.counters || {}) },
    categories: mergeById(defaultCategories(), parsed?.categories),
    products: mergeById(defaultProducts(), parsed?.products).map((p) => ({
      image: "",
      available: true,
      hidden: false,
      unit: null,
      kind: null,
      keywords: "",
      popular: false,
      daily: false,
      family: false,
      special: false,
      ...p
    })),
    orders: (parsed?.orders || []).map(migrateOrder).map((order) => ({
      ...order,
      orderType: normalizeOrderType(order.orderType) || "PER_KETU"
    })),
    cashReports: parsed?.cashReports || [],
    users: parsed?.users || [],
    logs: parsed?.logs || [],
    sessions: parsed?.sessions || []
  };
}
