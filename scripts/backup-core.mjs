// Šifrované zálohy: konzistentní snímek SQLite + uložené soubory (PDF, účtenky),
// zabalené do tar.gz a zašifrované AES-256-GCM klíčem odvozeným z hesla (scrypt).
// Formát souboru .fakz: "FAKZ1" | sůl (16 B) | IV (12 B) | šifrovaná data | tag (16 B).
// Sdílí ho aplikace (automatické zálohy) i scripts/restore-backup.mjs (obnova).

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import * as tar from "tar";

const MAGIC = Buffer.from("FAKZ1");
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function deriveKey(password, salt) {
  return crypto.scryptSync(password, salt, 32, SCRYPT);
}

export function encryptBuffer(plain, password) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(password, salt), iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, body, cipher.getAuthTag()]);
}

export function decryptBuffer(data, password) {
  if (data.length < MAGIC.length + 44 || !data.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("Soubor není záloha aplikace Fakturace.");
  }
  const salt = data.subarray(5, 21);
  const iv = data.subarray(21, 33);
  const tag = data.subarray(data.length - 16);
  const body = data.subarray(33, data.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey(password, salt), iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    throw new Error("Špatné heslo zálohy, nebo je soubor poškozený.");
  }
}

/**
 * Vytvoří zašifrovanou zálohu datového adresáře do `backupDir`.
 * @returns {Promise<{ file: string, sizeBytes: number, sha256: string }>}
 */
export async function createEncryptedBackup({ dataDir, backupDir, password, now = new Date() }) {
  if (!password || password.length < 12) throw new Error("Heslo zálohy musí mít aspoň 12 znaků.");
  fs.mkdirSync(backupDir, { recursive: true });
  const work = fs.mkdtempSync(path.join(dataDir, ".zaloha-"));
  try {
    // Online záloha SQLite: konzistentní i za běhu aplikace.
    const source = new Database(path.join(dataDir, "app.db"), { readonly: true, fileMustExist: true });
    try {
      await source.backup(path.join(work, "app.db"));
    } finally {
      source.close();
    }
    const entries = ["app.db"];
    if (fs.existsSync(path.join(dataDir, "files"))) {
      fs.cpSync(path.join(dataDir, "files"), path.join(work, "files"), { recursive: true });
      entries.push("files");
    }
    const tarFile = path.join(work, "zaloha.tar.gz");
    await tar.create({ gzip: true, cwd: work, file: tarFile, portable: true }, entries);
    const encrypted = encryptBuffer(fs.readFileSync(tarFile), password);

    const stamp = now.toISOString().slice(0, 16).replace("T", "-").replace(":", "");
    const target = path.join(backupDir, `fakturace-zaloha-${stamp}.fakz`);
    fs.writeFileSync(`${target}.tmp`, encrypted);
    fs.renameSync(`${target}.tmp`, target);
    return {
      file: target,
      sizeBytes: encrypted.length,
      sha256: crypto.createHash("sha256").update(encrypted).digest("hex"),
    };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/**
 * Ponechá posledních `keepRecent` záloh a k tomu nejnovější zálohu z každého měsíce.
 * @returns {string[]} smazané soubory
 */
export function pruneBackups(backupDir, keepRecent = 30) {
  if (!fs.existsSync(backupDir)) return [];
  const files = fs
    .readdirSync(backupDir)
    .filter((f) => /^fakturace-zaloha-\d{4}-\d{2}-\d{2}-\d{4}\.fakz$/.test(f))
    .sort()
    .reverse();
  const keep = new Set(files.slice(0, keepRecent));
  const months = new Set();
  for (const f of files) {
    const month = f.slice("fakturace-zaloha-".length, "fakturace-zaloha-".length + 7);
    if (!months.has(month)) {
      months.add(month);
      keep.add(f);
    }
  }
  const removed = files.filter((f) => !keep.has(f));
  for (const f of removed) fs.rmSync(path.join(backupDir, f), { force: true });
  return removed;
}

/** Rozbalí zálohu do prázdného adresáře `targetDir` (vznikne app.db a files/). */
export async function restoreEncryptedBackup({ file, password, targetDir }) {
  if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0) {
    throw new Error(`Cílový adresář ${targetDir} není prázdný – obnova nic nepřepisuje.`);
  }
  fs.mkdirSync(targetDir, { recursive: true });
  const plain = decryptBuffer(fs.readFileSync(file), password);
  const tarFile = path.join(targetDir, ".obnova.tar.gz");
  fs.writeFileSync(tarFile, plain);
  try {
    await tar.extract({ file: tarFile, cwd: targetDir, strict: true });
  } finally {
    fs.rmSync(tarFile, { force: true });
  }
  const check = new Database(path.join(targetDir, "app.db"), { readonly: true });
  try {
    const ok = check.pragma("integrity_check", { simple: true });
    if (ok !== "ok") throw new Error(`Obnovená databáze není v pořádku: ${ok}`);
  } finally {
    check.close();
  }
}
