/* ============================================================
   Ndihmëse për testet e ndërfaqes (opsionale — kërkojnë jsdom)

   Këto teste nuk janë të detyrueshme: nëse jsdom nuk është i
   instaluar, testet anashkalohen dhe `npm test` mbetet pa varësi.
     npm i -D jsdom      # vetëm nëse doni të provoni ndërfaqen
     npm run test:ui
   ============================================================ */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let JSDOM = null;
try {
  ({ JSDOM } = await import("jsdom"));
} catch {
  JSDOM = null;
}

export const hasJsdom = Boolean(JSDOM);
export const skipReason = hasJsdom ? false : "Kërkon jsdom (opsional): npm i -D jsdom";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.once("listening", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
    probe.listen(0, "127.0.0.1");
  });
}

/* Nis serverin real me të dhëna të pastra për kohëzgjatjen e testit */
export async function startServer() {
  const port = await freePort();
  const dataDir = await mkdtemp(path.join(tmpdir(), "sharri-ui-"));
  const baseUrl = `http://127.0.0.1:${port}`;

  const child = spawn(process.execPath, [path.join(repoRoot, "server", "index.js")], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", SHARRI_DATA_DIR: dataDir },
    stdio: "ignore"
  });

  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) break;
    } catch {
      /* serveri ende po niset */
    }
    await sleep(120);
  }

  return {
    baseUrl,
    async stop() {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGTERM");
      const done = await Promise.race([exited.then(() => true), sleep(2500).then(() => false)]);
      if (!done) child.kill("SIGKILL");
      await Promise.race([exited, sleep(1500)]);
      await rm(dataDir, { recursive: true, force: true });
    }
  };
}

/* Hap faqen në jsdom dhe lidh globals që modulet e aplikacionit të punojnë */
export async function createDom({ page, baseUrl, pageUrl, localOnly = false, cookieJar = true }) {
  const { readFileSync } = await import("node:fs");
  const dom = new JSDOM(readFileSync(path.join(repoRoot, page), "utf8"), {
    url: pageUrl || `${baseUrl || "https://sharri.example"}/${page}`,
    pretendToBeVisual: true,
    runScripts: "outside-only"
  });

  const { window } = dom;
  if (localOnly) window.SHARRI_LOCAL_ONLY = true;
  window.print = () => {};
  window.confirm = () => true;
  window.alert = () => {};

  globalThis.window = window;
  globalThis.document = window.document;
  Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });
  globalThis.location = window.location;
  globalThis.localStorage = window.localStorage;
  globalThis.sessionStorage = window.sessionStorage;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  globalThis.Event = window.Event;
  globalThis.MouseEvent = window.MouseEvent;
  globalThis.FileReader = window.FileReader;
  globalThis.Image = window.Image;
  globalThis.FormData = window.FormData;
  globalThis.Blob = window.Blob;
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);

  /* Aplikacioni hap intervale (p.sh. pyetja e përmbledhjes çdo 5 s).
     Në Node ato e mbajnë procesin gjallë, prandaj i regjistrojmë dhe i pastrojmë. */
  const intervals = new Set();
  const realSetInterval = globalThis.setInterval;
  const realClearInterval = globalThis.clearInterval;
  globalThis.setInterval = (...args) => {
    const id = realSetInterval(...args);
    intervals.add(id);
    return id;
  };
  globalThis.clearInterval = (id) => {
    intervals.delete(id);
    return realClearInterval(id);
  };

  const realFetch = globalThis.fetch;
  let cookie = "";
  let networkCalls = 0;

  globalThis.fetch = async (input, init = {}) => {
    networkCalls++;
    if (localOnly) throw new Error("Nuk duhet të ketë thirrje rrjeti në mënyrën statike.");
    if (typeof input === "string" && input.startsWith("/")) input = baseUrl + input;
    const headers = { ...(init.headers || {}) };
    if (cookieJar && cookie) headers.Cookie = cookie;
    const response = await realFetch(input, { ...init, headers });
    if (cookieJar) {
      for (const value of response.headers.getSetCookie ? response.headers.getSetCookie() : []) {
        cookie = value.split(";")[0];
      }
    }
    return response;
  };

  const wait = (ms = 170) => sleep(ms);
  const $ = (selector) => window.document.querySelector(selector);
  const $$ = (selector) => [...window.document.querySelectorAll(selector)];
  const text = () => window.document.body.textContent.replace(/\s+/g, " ").trim();
  const sheetText = () => ($$(".sheet").pop()?.textContent || "").replace(/\s+/g, " ").trim();
  const modalText = () => ($$(".modal-overlay").pop()?.textContent || "").replace(/\s+/g, " ").trim();

  async function click(target) {
    const el = typeof target === "string" ? $(target) : target;
    assert.ok(el, `Butoni nuk u gjet: ${target}`);
    el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    await wait();
    return el;
  }

  async function clickByText(selector, needle) {
    const el = $$(selector).find((node) => node.textContent.toLowerCase().includes(String(needle).toLowerCase()));
    assert.ok(el, `Nuk u gjet «${needle}» ndër ${selector}`);
    return click(el);
  }

  async function typeInto(selector, value, eventName = "input") {
    const el = $(selector);
    assert.ok(el, `Fusha nuk u gjet: ${selector}`);
    el.value = value;
    el.dispatchEvent(new window.Event(eventName, { bubbles: true }));
    await wait(90);
    return el;
  }

  async function submit(selector) {
    const el = $(selector);
    assert.ok(el, `Forma nuk u gjet: ${selector}`);
    el.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    await wait(520);
  }

  async function goHash(hash) {
    window.location.hash = hash;
    window.dispatchEvent(new window.Event("hashchange", { bubbles: true }));
    await wait(360);
  }

  /* Mbledh dështimet dhe i raporton të gjitha në fund */
  const failures = [];
  let total = 0;
  function check(name, condition, detail = "") {
    total++;
    if (!condition) failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  }
  function done() {
    assert.deepEqual(failures, [], `${failures.length}/${total} kontrollë dështuan:\n  • ${failures.join("\n  • ")}`);
    return total;
  }

  return {
    window,
    document: window.document,
    localStorage: window.localStorage,
    $,
    $$,
    text,
    sheetText,
    modalText,
    click,
    clickByText,
    typeInto,
    submit,
    goHash,
    wait,
    check,
    done,
    networkCalls: () => networkCalls,
    close() {
      for (const id of intervals) realClearInterval(id);
      intervals.clear();
      globalThis.setInterval = realSetInterval;
      globalThis.clearInterval = realClearInterval;
      globalThis.fetch = realFetch;
      dom.window.close();
    }
  };
}
