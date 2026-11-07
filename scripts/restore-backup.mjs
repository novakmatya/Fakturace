#!/usr/bin/env node
// Obnova ze zálohy: node scripts/restore-backup.mjs <soubor.fakz> <prázdný-cílový-adresář>
// Heslo se čte z proměnné BACKUP_PASSWORD, nebo se na něj skript zeptá.
// Výsledek (app.db + files/) pak stačí použít jako DATA_DIR.

import readline from "node:readline/promises";
import { restoreEncryptedBackup } from "./backup-core.mjs";

const [file, targetDir] = process.argv.slice(2);
if (!file || !targetDir) {
  console.error("Použití: node scripts/restore-backup.mjs <soubor.fakz> <prázdný-cílový-adresář>");
  process.exit(1);
}
let password = process.env.BACKUP_PASSWORD;
if (!password) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  password = await rl.question("Heslo zálohy: ");
  rl.close();
}
try {
  await restoreEncryptedBackup({ file, password, targetDir });
  console.log(`Obnoveno do ${targetDir} (databáze prošla kontrolou integrity).`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
