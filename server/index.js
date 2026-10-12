/* ============================================================
   SHARRI — Serveri (Node, pa asnjë varësi)

   Nisni me:  npm start   (ose: node server/index.js)
   Shërben faqen DHE API-në me validim të detyrueshëm:
   "Me veti" dhe "Për këtu" lejohen vetëm me ushqim.
   ============================================================ */

import http from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

import { createEngine } from "../lib/engine.js";
import { RuleError } from "../lib/rules.js";
import { DB_FILE, getDB, hashPassword, loadDB, newId, persist, repoRoot } from "./db.js";

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";
const COOKIE_NAME = "sharri_sid";
const SESSION_DAYS = 7;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json"
};

let engine = null;

/* ============================================================
   Ndihmëse HTTP
   ============================================================ */
function sendJSON(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...headers
  });
  res.end(body);
}

function ok(res, data, headers) {
  sendJSON(res, 200, { ok: true, data }, headers);
}

function ruleError(res, error) {
  sendJSON(res, error instanceof RuleError && error.code === "ORDER_NOT_FOUND" ? 404 : 400, {
    ok: false,
    error: { code: error.code || "GABIM", message: error.message, vars: error.vars || {} }
  });
}

function serverError(res, error) {
  console.error("Gabim në server:", error);
  sendJSON(res, 500, {
    ok: false,
    error: { code: "GABIM_SERVERI", message: "Gabim i papritur në server. Provoni përsëri." }
  });
}

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new RuleError("QTY_INVALID", {}, "Kërkesa është shumë e madhe."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new RuleError("EMPTY_ORDER", {}, "Kërkesa nuk është e saktë (JSON i pavlefshëm)."));
      }
    });
    req.on("error", reject);
  });
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const jar = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    jar[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return jar;
}

function sessionCookie(token, maxAgeSeconds) {
  const bits = [
    `${COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`
  ];
  return bits.join("; ");
}

function currentUser(req) {
  const db = getDB();
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) return null;
  const session = (db.sessions || []).find((s) => s.token === token);
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() < Date.now()) return null;
  return session;
}

function requireAdmin(req) {
  const session = currentUser(req);
  if (!session || session.role !== "admin") throw new RuleError("LOGIN_REQUIRED");
  return session;
}

/* ============================================================
   Shërbimi i skedarëve statikë
   ============================================================ */
const BLOCKED = [".git", "node_modules", "server/data", "server", ".arena", ".cache"];

async function serveStatic(req, res, pathname) {
  const relative = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
  const target = path.resolve(repoRoot, `.${path.posix.normalize(relative)}`);

  if (!target.startsWith(repoRoot)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Ndalohet.");
    return;
  }

  const relativeToRoot = path.relative(repoRoot, target);
  if (relativeToRoot.split(path.sep).some((part) => BLOCKED.includes(part) || part.startsWith("."))) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Nuk u gjet.");
    return;
  }

  try {
    const info = await stat(target);
    if (info.isDirectory()) return serveStatic(req, res, `${relative}index.html`);

    const extension = path.extname(target).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[extension] || "application/octet-stream",
      "Content-Length": info.size,
      "Cache-Control": extension === ".html" ? "no-cache" : "public, max-age=300"
    });
    if (req.method === "HEAD") return res.end();
    createReadStream(target).pipe(res);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Nuk u gjet.");
  }
}

/* ============================================================
   Rrugët e API-së
   ============================================================ */
const routes = [];

function route(method, pattern, handler, options = {}) {
  const keys = [];
  const regex = new RegExp(
    `^${pattern.replace(/:[a-zA-Z]+/g, (match) => {
      keys.push(match.slice(1));
      return "([^/]+)";
    })}$`
  );
  routes.push({ method, regex, keys, handler, admin: Boolean(options.admin) });
}

async function handleApi(req, res, url) {
  const method = req.method.toUpperCase();
  const pathname = url.pathname;

  for (const candidate of routes) {
    if (candidate.method !== method && !(candidate.method === "GET" && method === "HEAD")) continue;
    const match = pathname.match(candidate.regex);
    if (!match) continue;

    const params = {};
    candidate.keys.forEach((key, index) => {
      params[key] = decodeURIComponent(match[index + 1]);
    });

    if (candidate.admin) requireAdmin(req);

    const body = method === "GET" || method === "HEAD" ? {} : await readBody(req);
    const result = await candidate.handler({ req, res, params, body, session: currentUser(req) });
    if (result !== undefined && !res.writableEnded) ok(res, result);
    return;
  }

  sendJSON(res, 404, {
    ok: false,
    error: { code: "NUK_U_GJET", message: "Kërkesa nuk u gjet." }
  });
}

/* ---------- Publike: gjendja e sistemit ---------- */
route("GET", "/api/health", () => ({
  ok: true,
  app: "sharri",
  mode: "server",
  time: new Date().toISOString()
}));

route("GET", "/api/catalog", () => engine.getCatalog());
route("GET", "/api/summary", () => engine.getSummary());

route("GET", "/api/orders", ({ req }) => {
  const url = new URL(req.url, "http://localhost");
  const filters = {};
  for (const key of ["status", "orderType", "q", "date", "tableNumber", "activeOnly"]) {
    const value = url.searchParams.get(key);
    if (value !== null) filters[key] = key === "activeOnly" ? value === "true" : value;
  }
  return engine.listOrders(filters);
});

route("GET", "/api/orders/:id", ({ params }) => engine.getOrder(params.id));

/* ---------- Krijimi i porosisë (validim i detyrueshëm) ---------- */
route("POST", "/api/orders", ({ body }) => {
  const order = engine.createOrder(body);
  persist();
  return order;
});

route("POST", "/api/orders/:id/items", ({ params, body }) => {
  const order = engine.addItems(params.id, body.items || [], body.actor || "");
  persist();
  return order;
});

route("PATCH", "/api/orders/:id/items/:key", ({ params, body }) => {
  const order = engine.updateItem(params.id, params.key, { qty: body.qty, note: body.note }, body.actor || "");
  persist();
  return order;
});

route("DELETE", "/api/orders/:id/items/:key", async ({ params, body }) => {
  const order = engine.removeItem(params.id, params.key, body?.actor || "");
  persist();
  return order;
});

route("PATCH", "/api/orders/:id/identity", ({ params, body }) => {
  const order = engine.changeIdentity(
    params.id,
    { orderType: body.orderType, tableNumber: body.tableNumber, customerName: body.customerName },
    body.actor || ""
  );
  persist();
  return order;
});

route("PATCH", "/api/orders/:id/note", ({ params, body }) => {
  const order = engine.setNote(params.id, body.note || "", body.actor || "");
  persist();
  return order;
});

/* ---------- Pagesa ---------- */
route("POST", "/api/orders/:id/pay", ({ params, body }) => {
  const order = engine.payOrder(params.id, body, body.actor || "");
  persist();
  return order;
});

route("POST", "/api/orders/:id/cancel", ({ params, body }) => {
  const order = engine.cancelOrder(params.id, body.reason || "", body.actor || "");
  persist();
  return order;
});

route("POST", "/api/orders/:id/kitchen", ({ params, body }) => {
  const order = engine.setKitchenReady(params.id, Boolean(body.ready), body.actor || "");
  persist();
  return order;
});

/* ---------- Hyrja e administratorit ---------- */
const loginAttempts = new Map();

route("POST", "/api/login", async ({ req, res, body }) => {
  const db = getDB();
  const ip = req.socket.remoteAddress || "panjohur";
  const attempt = loginAttempts.get(ip) || { count: 0, until: 0 };

  if (attempt.until > Date.now()) {
    throw new RuleError("LOGIN_LOCKED");
  }

  const username = String(body.username || "").trim().toLowerCase();
  const password = String(body.password || "");
  const hash = hashPassword(password);
  const user = db.users.find((u) => u.username.toLowerCase() === username && u.passwordHash === hash);

  if (!user) {
    attempt.count += 1;
    if (attempt.count >= 5) {
      attempt.until = Date.now() + 5 * 60 * 1000;
      attempt.count = 0;
    }
    loginAttempts.set(ip, attempt);
    throw new RuleError("LOGIN_FAILED");
  }

  loginAttempts.delete(ip);
  const token = newId();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.sessions = db.sessions || [];
  db.sessions = db.sessions.filter((s) => new Date(s.expiresAt).getTime() > Date.now());
  db.sessions.push({ token, userId: user.id, username: user.username, role: user.role, createdAt: new Date().toISOString(), expiresAt });
  engine.log(`Administratori ${user.username} u kyç`, user.username);
  persist();

  ok(res, { id: user.id, username: user.username, role: user.role }, {
    "Set-Cookie": sessionCookie(token, SESSION_DAYS * 24 * 60 * 60)
  });
});

route("POST", "/api/logout", ({ req, res, session }) => {
  const db = getDB();
  if (session) {
    engine.log(`Administratori ${session.username} doli`, session.username);
    db.sessions = (db.sessions || []).filter((s) => s.token !== session.token);
    persist();
  }
  ok(res, { ok: true }, { "Set-Cookie": sessionCookie("", 0) });
});

route("GET", "/api/session", ({ session }) =>
  session ? { id: session.userId, username: session.username, role: session.role } : null
);

/* ---------- Administratori ---------- */
route("GET", "/api/logs", () => getDB().logs || [], { admin: true });

route("POST", "/api/products", ({ body, session }) => {
  const product = engine.saveProduct(body, session?.username || "administratori");
  persist();
  return product;
}, { admin: true });

route("DELETE", "/api/products/:id", async ({ params, body, session }) => {
  const result = engine.deleteProduct(params.id, body?.actor || session?.username || "administratori");
  persist();
  return result;
}, { admin: true });

route("PATCH", "/api/settings", ({ body, session }) => {
  const { actor, ...payload } = body || {};
  const settings = engine.saveSettings(payload, actor || session?.username || "administratori");
  persist();
  return settings;
}, { admin: true });

route("GET", "/api/cash-reports", () => {
  const db = getDB();
  return (db.cashReports || [])
    .slice()
    .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
}, { admin: true });

route("POST", "/api/cash-reports", ({ body, session }) => {
  const report = engine.saveCashReport(body.report || {}, body.actor || session?.username || "administratori");
  persist();
  return report;
}, { admin: true });

route("DELETE", "/api/cash-reports/:id", async ({ params, body, session }) => {
  const result = engine.deleteCashReport(params.id, body?.actor || session?.username || "administratori");
  persist();
  return result;
}, { admin: true });

/* ============================================================
   Nisja
   ============================================================ */
async function main() {
  await loadDB();
  const db = getDB();
  engine = createEngine({ db, persist: () => {} });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");

    try {
      if (url.pathname.startsWith("/api/")) {
        await handleApi(req, res, url);
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Metoda nuk lejohet.");
        return;
      }
      await serveStatic(req, res, url.pathname);
    } catch (error) {
      if (error instanceof RuleError) ruleError(res, error);
      else serverError(res, error);
    }
  });

  server.listen(PORT, HOST, () => {
    console.log(`SHARRI serveri është gati → http://${HOST}:${PORT}`);
    console.log(`Ekrani i kamarierit        → http://${HOST}:${PORT}/pos.html`);
    console.log(`Baza e të dhënave          → ${DB_FILE}`);
  });
}

main().catch((error) => {
  console.error("Serveri nuk u nis:", error);
  process.exit(1);
});
