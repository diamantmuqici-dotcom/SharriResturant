/* ============================================================
   SHARRI — Ruajtja lokale (kur faqja hapet pa server)

   E njëjta logjikë si serveri: përdor lib/engine.js dhe
   lib/rules.js, prandaj rregullat zbatohen gjithmonë.
   ============================================================ */

import {
  CART_KEY,
  DB_KEY,
  LOGIN_LIMIT_KEY,
  SESSION_KEY,
  defaultDB,
  defaultSettings
} from "./catalog.js";
import { createEngine, uid } from "./engine.js";
import { normalizeDB } from "./normalize.js";
import { RuleError } from "./rules.js";

export { DB_KEY, CART_KEY, SESSION_KEY, LOGIN_LIMIT_KEY };

export function readDB() {
  if (typeof localStorage === "undefined") return defaultDB();
  const raw = localStorage.getItem(DB_KEY);
  if (!raw) {
    const fresh = defaultDB();
    localStorage.setItem(DB_KEY, JSON.stringify(fresh));
    return fresh;
  }
  try {
    const db = normalizeDB(JSON.parse(raw));
    localStorage.setItem(DB_KEY, JSON.stringify(db));
    return db;
  } catch {
    const fresh = defaultDB();
    localStorage.setItem(DB_KEY, JSON.stringify(fresh));
    return fresh;
  }
}

export function writeDB(db) {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  } catch {
    /* hapësira e mbushur — nuk ndërpritet puna e kamarierit */
  }
}

export async function hashPassword(text) {
  try {
    if (globalThis.crypto?.subtle) {
      const data = new TextEncoder().encode(text);
      const digest = await crypto.subtle.digest("SHA-256", data);
      return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    }
  } catch {
    /* bie në metodën rezervë */
  }
  let h = 0;
  const value = String(text);
  for (let i = 0; i < value.length; i++) h = ((h << 5) - h) + value.charCodeAt(i);
  return "fallback_" + Math.abs(h) + "_" + value.length;
}

/* ============================================================
   API lokale — e njëjta formë si API e serverit
   ============================================================ */
export function createLocalApi() {
  let db = readDB();
  const listeners = new Set();
  let session = null;

  function persist() {
    writeDB(db);
  }

  const engine = createEngine({ db, persist });

  function emit() {
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        /* një dëgjues i dëmtuar nuk e ndal ekranin */
      }
    }
  }

  async function ensureAdminUser() {
    if (!db.users.length) {
      db.users.push({
        id: uid(),
        username: "admin",
        passwordHash: await hashPassword("admin123"),
        role: "admin",
        createdAt: new Date().toISOString()
      });
      persist();
    }
  }

  function reload() {
    const fresh = readDB();
    db.settings = fresh.settings;
    db.categories = fresh.categories;
    db.products = fresh.products;
    db.orders = fresh.orders;
    db.cashReports = fresh.cashReports;
    db.users = fresh.users;
    db.logs = fresh.logs;
    db.counters = fresh.counters;
  }

  try {
    const raw = typeof sessionStorage === "undefined" ? null : sessionStorage.getItem(SESSION_KEY);
    if (raw) session = JSON.parse(raw);
  } catch {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* seancë e pavlefshme — fillon nga e para */
    }
  }

  return {
    mode: "lokal",
    modeLabel: "Pa server (ruajtje në këtë pajisje)",

    async init() {
      await ensureAdminUser();
      if (typeof window !== "undefined") {
        window.addEventListener("storage", (event) => {
          if (event.key === DB_KEY) {
            reload();
            emit();
          }
        });
      }
      return { mode: this.mode };
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    notify: emit,
    getDB: () => db,

    async catalog() {
      return engine.getCatalog();
    },

    async summary() {
      return engine.getSummary();
    },

    async orders(filters = {}) {
      return engine.listOrders(filters);
    },

    async order(id) {
      return engine.getOrder(id);
    },

    async createOrder(payload) {
      const order = engine.createOrder({ ...payload, waiter: payload.waiter });
      emit();
      return order;
    },

    async addItems(id, items, actor) {
      const order = engine.addItems(id, items, actor);
      emit();
      return order;
    },

    async updateItem(id, key, patch, actor) {
      const order = engine.updateItem(id, key, patch, actor);
      emit();
      return order;
    },

    async removeItem(id, key, actor) {
      const order = engine.removeItem(id, key, actor);
      emit();
      return order;
    },

    async changeIdentity(id, payload, actor) {
      const order = engine.changeIdentity(id, payload, actor);
      emit();
      return order;
    },

    async setNote(id, note, actor) {
      const order = engine.setNote(id, note, actor);
      emit();
      return order;
    },

    async pay(id, payload, actor) {
      const order = engine.payOrder(id, payload, actor);
      emit();
      return order;
    },

    async cancel(id, reason, actor) {
      const order = engine.cancelOrder(id, reason, actor);
      emit();
      return order;
    },

    async kitchenReady(id, ready, actor) {
      const order = engine.setKitchenReady(id, ready, actor);
      emit();
      return order;
    },

    async saveProduct(payload, actor) {
      const product = engine.saveProduct(payload, actor);
      emit();
      return product;
    },

    async deleteProduct(id, actor) {
      const result = engine.deleteProduct(id, actor);
      emit();
      return result;
    },

    async saveSettings(payload, actor) {
      const settings = engine.saveSettings(payload, actor);
      emit();
      return settings;
    },

    async cashReports() {
      return (db.cashReports || []).slice().sort(
        (a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0)
      );
    },

    async saveCashReport(report, actor) {
      const saved = engine.saveCashReport(report, actor);
      emit();
      return saved;
    },

    async deleteCashReport(id, actor) {
      const result = engine.deleteCashReport(id, actor);
      emit();
      return result;
    },

    async logs() {
      return db.logs || [];
    },

    async login(username, password) {
      const lockRaw = localStorage.getItem(LOGIN_LIMIT_KEY);
      const lock = lockRaw ? JSON.parse(lockRaw) : { count: 0, until: 0 };
      if (lock.until > Date.now()) throw new RuleError("LOGIN_LOCKED");

      const hash = await hashPassword(password);
      const user = db.users.find(
        (u) => u.username.toLowerCase() === String(username).trim().toLowerCase() && u.passwordHash === hash
      );

      if (!user) {
        lock.count += 1;
        if (lock.count >= 5) {
          lock.until = Date.now() + 5 * 60 * 1000;
          lock.count = 0;
        }
        localStorage.setItem(LOGIN_LIMIT_KEY, JSON.stringify(lock));
        throw new RuleError("LOGIN_FAILED");
      }

      localStorage.removeItem(LOGIN_LIMIT_KEY);
      session = { id: user.id, username: user.username, role: user.role };
      try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
      } catch {
        /* seanca mbahet vetëm në këtë pajisje */
      }
      engine.log(`Administratori ${session.username} u kyç`, session.username);
      persist();
      emit();
      return session;
    },

    async logout() {
      if (session) engine.log(`Administratori ${session.username} doli`, session.username);
      session = null;
      try {
        sessionStorage.removeItem(SESSION_KEY);
      } catch {
        /* seanca mbyllet */
      }
      persist();
      emit();
      return { ok: true };
    },

    async sessionUser() {
      return session;
    }
  };
}

export { defaultSettings };
