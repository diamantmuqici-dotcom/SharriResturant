/* Testi i serverit — validimi i detyrueshëm përmes API-së (rregulli 31) */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.TEST_PORT || 8123);
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let child = null;
let dataDir = "";
let cookie = "";

async function call(pathname, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(BASE + pathname, {
    ...options,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const setCookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
  for (const value of setCookies) cookie = value.split(";")[0];
  const payload = await response.json().catch(() => null);
  return { status: response.status, ok: response.ok, body: payload };
}

before(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "sharri-test-"));
  child = spawn(process.execPath, [path.join(repoRoot, "server", "index.js")], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1", SHARRI_DATA_DIR: dataDir },
    stdio: "ignore"
  });

  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.ok) return;
    } catch {
      /* serveri ende po niset */
    }
    await sleep(120);
  }
  throw new Error("Serveri i testit nuk u nis.");
});

after(async () => {
  child?.kill("SIGTERM");
  await sleep(150);
  await rm(dataDir, { recursive: true, force: true });
});

test("shëndeti dhe katalogu: 50 tavolina", async () => {
  const health = await call("/api/health");
  assert.equal(health.body.data.app, "sharri");

  const catalog = await call("/api/catalog");
  assert.equal(catalog.body.data.tableCount, 50);
  assert.ok(catalog.body.data.products.length > 25);
});

test("API refuzon «Me veti» me vetëm Kokakolla", async () => {
  const response = await call("/api/orders", {
    method: "POST",
    body: { orderType: "ME_VETI", items: [{ productId: "coca-cola", qty: 2 }] }
  });
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, "ME_VETI_REQUIRES_FOOD");
  assert.equal(response.body.error.message, 'Porosia "Me veti" duhet të përmbajë të paktën një produkt ushqimor.');
});

test("API refuzon «Për këtu» me vetëm kafe", async () => {
  const response = await call("/api/orders", {
    method: "POST",
    body: { orderType: "PER_KETU", items: [{ productId: "kafe", qty: 1 }] }
  });
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, "PER_KETU_REQUIRES_FOOD");
});

test("API refuzon mashtrimin me «isFood» të rremë", async () => {
  const response = await call("/api/orders", {
    method: "POST",
    body: { orderType: "ME_VETI", items: [{ productId: "coca-cola", qty: 1, isFood: true, kind: "ushqim" }] }
  });
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, "ME_VETI_REQUIRES_FOOD");
});

test("API nuk lejon çmim të sajuar", async () => {
  const created = await call("/api/orders", {
    method: "POST",
    body: { orderType: "PER_KETU", items: [{ productId: "mish-viqi-1kg", qty: 1, price: 0.01 }] }
  });
  assert.equal(created.status, 200);
  assert.equal(created.body.data.items[0].price, 25);
  assert.equal(created.body.data.total, 25);
});

test("Rrjedha e plotë: tavolinë → shtim → pagesë → tavolina lirohet", async () => {
  const created = await call("/api/orders", {
    method: "POST",
    body: { orderType: "TAVOLINE", tableNumber: 12, waiter: "Ardit", items: [{ productId: "coca-cola", qty: 2 }] }
  });
  assert.equal(created.status, 200);
  const id = created.body.data.id;
  assert.equal(created.body.data.total, 2);

  const busy = await call("/api/orders", {
    method: "POST",
    body: { orderType: "TAVOLINE", tableNumber: 12, items: [{ productId: "kafe", qty: 1 }] }
  });
  assert.equal(busy.status, 400);
  assert.equal(busy.body.error.message, "Tavolina 12 ka një porosi aktive.");

  const counters1 = await call("/api/summary");
  assert.equal(counters1.body.data.occupiedTables, 1);
  assert.equal(counters1.body.data.tableCount, 50);

  const added = await call(`/api/orders/${id}/items`, { method: "POST", body: { items: [{ productId: "kafe", qty: 1 }], actor: "Ardit" } });
  assert.equal(added.body.data.total, 2.7);

  const shortPay = await call(`/api/orders/${id}/pay`, { method: "POST", body: { method: "cash", amount: 2 } });
  assert.equal(shortPay.status, 400);

  const paid = await call(`/api/orders/${id}/pay`, { method: "POST", body: { method: "cash", amount: 5, actor: "Ardit" } });
  assert.equal(paid.status, 200);
  assert.equal(paid.body.data.status, "paid");
  assert.equal(paid.body.data.payment.change, 2.3);
  assert.ok(paid.body.data.paidAt);

  const counters2 = await call("/api/summary");
  assert.equal(counters2.body.data.occupiedTables, 0);
  assert.equal(counters2.body.data.paidToday, 1);

  const active = await call("/api/orders?status=open&tableNumber=12");
  assert.equal(active.body.data.length, 0);

  const freeAgain = await call("/api/orders", {
    method: "POST",
    body: { orderType: "TAVOLINE", tableNumber: 12, items: [{ productId: "kafe", qty: 1 }] }
  });
  assert.equal(freeAgain.status, 200);
});

test("heqja e të vetmit ushqim nga «Me veti» refuzohet edhe përmes API-së", async () => {
  const created = await call("/api/orders", {
    method: "POST",
    body: { orderType: "ME_VETI", items: [{ productId: "hamburger-pomfrit", qty: 1 }, { productId: "coca-cola", qty: 1 }] }
  });
  const order = created.body.data;
  const foodKey = order.items.find((i) => i.isFood).key;

  const removed = await call(`/api/orders/${order.id}/items/${foodKey}`, { method: "DELETE", body: {} });
  assert.equal(removed.status, 400);
  assert.equal(removed.body.error.code, "ME_VETI_REQUIRES_FOOD");

  const stillThere = await call(`/api/orders/${order.id}`);
  assert.equal(stillThere.body.data.items.length, 2);
});

test("veprimet e administratorit kërkojnë hyrje", async () => {
  cookie = "";
  const forbidden = await call("/api/products", { method: "POST", body: { name: "Provë", price: 1 } });
  assert.equal(forbidden.status, 400);
  assert.equal(forbidden.body.error.code, "LOGIN_REQUIRED");

  const wrongLogin = await call("/api/login", { method: "POST", body: { username: "admin", password: "gabim" } });
  assert.equal(wrongLogin.status, 400);
  assert.equal(wrongLogin.body.error.code, "LOGIN_FAILED");

  const login = await call("/api/login", { method: "POST", body: { username: "admin", password: "admin123" } });
  assert.equal(login.status, 200);
  assert.equal(login.body.data.role, "admin");

  const product = await call("/api/products", {
    method: "POST",
    body: { name: "Çaj Mali", category: "kafe", price: 0.6, kind: "pije", desc: "Çaj mali", emoji: "🍵" }
  });
  assert.equal(product.status, 200);
  assert.equal(product.body.data.kind, "pije");

  const logs = await call("/api/logs");
  assert.equal(logs.status, 200);
  assert.ok(logs.body.data.length > 0);

  const settings = await call("/api/settings", { method: "PATCH", body: { tableCount: 50, waiters: ["Ardit", "Blerta"] } });
  assert.equal(settings.status, 200);
  assert.deepEqual(settings.body.data.waiters, ["Ardit", "Blerta"]);
});

test("faqja dhe skedarët shërbehen", async () => {
  const home = await fetch(`${BASE}/index.html`);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /SHARRI/);

  const pos = await fetch(`${BASE}/pos.html`);
  assert.equal(pos.status, 200);

  const module = await fetch(`${BASE}/lib/rules.js`);
  assert.equal(module.status, 200);
  assert.match(module.headers.get("content-type") || "", /javascript/);

  const blocked = await fetch(`${BASE}/server/index.js`);
  assert.equal(blocked.status, 404);

  const data = await fetch(`${BASE}/server/data/db.json`);
  assert.equal(data.status, 404);

  const git = await fetch(`${BASE}/.git/config`);
  assert.equal(git.status, 404);

  const traversal = await fetch(`${BASE}/%2e%2e%2f%2e%2e%2fetc%2fpasswd`);
  assert.notEqual(traversal.status, 200);
});
