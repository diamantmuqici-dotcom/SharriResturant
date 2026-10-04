/* ============================================================
   SHARRI — Klienti i API-së

   Nëse serveri është i hapur (`npm start`) → të gjitha të dhënat
   dhe validimi bëhen në server.
   Nëse faqja hapet statike (GitHub Pages) → përdoret e njëjta
   logjikë rregullash në këtë pajisje (lib/engine.js + lib/rules.js).

   Në të dyja rastet ndërfaqja është e njëjtë, prandaj asnjë
   rrugë nuk mund ta anashkalojë validimin.
   ============================================================ */

import { createLocalApi } from "./store.js";
import { RuleError } from "./rules.js";

const HEALTH_PATH = "/api/health";
const POLL_MS = 5000;

function canUseServer() {
  if (typeof window === "undefined") return false;
  if (window.SHARRI_LOCAL_ONLY) return false;
  const protocol = window.location.protocol;
  return protocol === "http:" || protocol === "https:";
}

async function probeServer(timeoutMs = 1200) {
  if (!canUseServer()) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(HEALTH_PATH, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      credentials: "same-origin"
    });
    if (!response.ok) return false;
    const data = await response.json();
    return Boolean(data?.ok && data?.app === "sharri");
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function createRemoteApi() {
  const listeners = new Set();
  let pollTimer = null;
  let lastSignature = "";

  async function request(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(options.headers || {})
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok) {
      const code = data?.error?.code || "GABIM";
      const message = data?.error?.message || "Veprimi nuk u krye. Provoni përsëri.";
      throw new RuleError(code, data?.error?.vars || {}, message);
    }

    if (data && typeof data === "object" && "data" in data) return data.data;
    return data;
  }

  const get = (path) => request(path);
  const post = (path, body) => request(path, { method: "POST", body });
  const patch = (path, body) => request(path, { method: "PATCH", body });
  const del = (path, body) => request(path, { method: "DELETE", body });

  function emit() {
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        /* dëgjuesi i dëmtuar nuk e ndal ekranin */
      }
    }
  }

  async function poll() {
    try {
      const summary = await get("/api/summary");
      const signature = JSON.stringify([
        summary.activeOrders,
        summary.occupiedTables,
        summary.ordersTotal,
        summary.revenueToday
      ]);
      if (signature !== lastSignature) {
        lastSignature = signature;
        emit();
      }
    } catch {
      /* rrjeti u ndërpre — vazhdohet në provën tjetër */
    }
  }

  return {
    mode: "server",
    modeLabel: "I lidhur me serverin",

    async init() {
      if (!pollTimer) pollTimer = setInterval(poll, POLL_MS);
      return { mode: this.mode };
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    notify: emit,

    catalog: () => get("/api/catalog"),
    summary: () => get("/api/summary"),
    orders: (filters = {}) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) {
        if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
      }
      const query = params.toString();
      return get(`/api/orders${query ? `?${query}` : ""}`);
    },
    order: (id) => get(`/api/orders/${encodeURIComponent(id)}`),
    createOrder: (payload) => post("/api/orders", payload),
    addItems: (id, items, actor) => post(`/api/orders/${encodeURIComponent(id)}/items`, { items, actor }),
    updateItem: (id, key, patchBody, actor) =>
      patch(`/api/orders/${encodeURIComponent(id)}/items/${encodeURIComponent(key)}`, { ...patchBody, actor }),
    removeItem: (id, key, actor) =>
      del(`/api/orders/${encodeURIComponent(id)}/items/${encodeURIComponent(key)}`, { actor }),
    setNote: (id, note, actor) => patch(`/api/orders/${encodeURIComponent(id)}/note`, { note, actor }),
    changeIdentity: (id, payload, actor) =>
      patch(`/api/orders/${encodeURIComponent(id)}/identity`, { ...payload, actor }),
    pay: (id, payload, actor) => post(`/api/orders/${encodeURIComponent(id)}/pay`, { ...payload, actor }),
    cancel: (id, reason, actor) => post(`/api/orders/${encodeURIComponent(id)}/cancel`, { reason, actor }),
    kitchenReady: (id, ready, actor) => post(`/api/orders/${encodeURIComponent(id)}/kitchen`, { ready, actor }),

    saveProduct: (payload, actor) => post("/api/products", { ...payload, actor }),
    deleteProduct: (id, actor) => del(`/api/products/${encodeURIComponent(id)}`, { actor }),
    saveSettings: (payload, actor) => patch("/api/settings", { ...payload, actor }),

    cashReports: () => get("/api/cash-reports"),
    saveCashReport: (report, actor) => post("/api/cash-reports", { report, actor }),
    deleteCashReport: (id, actor) => del(`/api/cash-reports/${encodeURIComponent(id)}`, { actor }),

    logs: () => get("/api/logs"),

    login: (username, password) => post("/api/login", { username, password }),
    logout: () => post("/api/logout", {}),
    sessionUser: () => get("/api/session")
  };
}

let apiInstance = null;

export async function initApi() {
  if (apiInstance) return apiInstance;
  const serverAvailable = await probeServer();
  apiInstance = serverAvailable ? createRemoteApi() : createLocalApi();
  await apiInstance.init();
  return apiInstance;
}

export function getApi() {
  if (!apiInstance) throw new Error("API nuk është gati.");
  return apiInstance;
}

export { probeServer };
