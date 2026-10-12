/* ============================================================
   SHARRI — Baza e të dhënave e serverit (skedar JSON, pa varësi)
   ============================================================ */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defaultDB } from "../lib/catalog.js";
import { normalizeDB } from "../lib/normalize.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

export const DATA_DIR = process.env.SHARRI_DATA_DIR
  ? path.resolve(process.env.SHARRI_DATA_DIR)
  : path.join(repoRoot, "server", "data");
export const DB_FILE = path.join(DATA_DIR, "db.json");

export function hashPassword(text) {
  return createHash("sha256").update(String(text), "utf8").digest("hex");
}

export function newId() {
  return randomUUID();
}

let db = null;
let writing = Promise.resolve();

export async function loadDB() {
  await mkdir(DATA_DIR, { recursive: true });
  let parsed = null;
  try {
    const raw = await readFile(DB_FILE, "utf8");
    parsed = JSON.parse(raw);
  } catch {
    parsed = defaultDB();
  }

  db = normalizeDB(parsed);

  if (!db.users.length) {
    db.users.push({
      id: newId(),
      username: "admin",
      passwordHash: hashPassword("admin123"),
      role: "admin",
      createdAt: new Date().toISOString()
    });
  }

  await flush();
  return db;
}

export function getDB() {
  if (!db) throw new Error("Baza e të dhënave nuk është ngarkuar.");
  return db;
}

async function flush() {
  const payload = JSON.stringify(db, null, 2);
  const temp = `${DB_FILE}.tmp`;
  await writeFile(temp, payload, "utf8");
  await rename(temp, DB_FILE);
}

/* Ruajtja bëhet gjithmonë radhazi — asnjë mbishkrim i dyfishtë */
export function persist() {
  writing = writing.then(flush).catch((error) => {
    console.error("Ruajtja dështoi:", error.message);
  });
  return writing;
}

export async function waitForWrites() {
  await writing;
}

export { repoRoot };
