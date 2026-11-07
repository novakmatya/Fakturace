import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { resetEnvCache } from "@/env";
import { lastBackup, runBackup, runDailyBackupIfDue } from "@/lib/backup";
import { ensureInvoicePdf } from "@/lib/invoices/documents";
import { createDraft, issueInvoice } from "@/lib/invoices/service";
import { decryptBuffer, pruneBackups, restoreEncryptedBackup } from "../../scripts/backup-core.mjs";
import { draftData, NOW, seedBasics } from "../helpers/fixtures";

const PASSWORD = "zalohove-heslo-123";

describe("šifrované zálohy", () => {
  it("záloha obsahuje databázi i PDF, bez hesla je nečitelná a obnoví se beze ztráty", async () => {
    const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "fakturace-zalohy-"));
    process.env.BACKUP_DIR = backupDir;
    process.env.BACKUP_PASSWORD = PASSWORD;
    resetEnvCache();

    const base = await seedBasics();
    const draft = await createDraft(draftData({ customerId: base.customer.id, incomeSourceId: base.s7.id }));
    const invoice = await issueInvoice(draft.id, { now: NOW });
    const pdf = await ensureInvoicePdf(invoice.id);

    const result = await runBackup({ actor: "USER" });
    const raw = fs.readFileSync(result.file);
    expect(raw.includes(Buffer.from("SQLite format"))).toBe(false);
    expect(raw.includes(Buffer.from(invoice.number!))).toBe(false);
    expect(() => decryptBuffer(raw, "spatne-heslo-123")).toThrow(/Špatné heslo/);
    expect((await lastBackup())?.file).toBe(path.basename(result.file));

    const target = fs.mkdtempSync(path.join(os.tmpdir(), "fakturace-obnova-"));
    await restoreEncryptedBackup({ file: result.file, password: PASSWORD, targetDir: target });
    const db = new Database(path.join(target, "app.db"), { readonly: true });
    expect(db.prepare(`SELECT number FROM "Invoice" WHERE id = ?`).get(invoice.id)).toEqual({ number: invoice.number });
    db.close();
    expect(fs.readFileSync(path.join(target, "files", pdf.storagePath)).equals(fs.readFileSync(path.join(process.env.DATA_DIR!, "files", pdf.storagePath)))).toBe(true);
    await expect(restoreEncryptedBackup({ file: result.file, password: PASSWORD, targetDir: target })).rejects.toThrow(/není prázdný/);

    // denní záloha: hned po záloze se neopakuje
    expect(await runDailyBackupIfDue()).toBe(false);
    expect(await runDailyBackupIfDue(new Date(Date.now() + 21 * 3600_000))).toBe(true);
  });

  it("uchová posledních 30 záloh a jednu za každý starší měsíc", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fakturace-prune-"));
    const names: string[] = [];
    for (let m = 1; m <= 3; m++) {
      for (let d = 1; d <= 28; d++) {
        const name = `fakturace-zaloha-2026-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}-0300.fakz`;
        fs.writeFileSync(path.join(dir, name), "x");
        names.push(name);
      }
    }
    pruneBackups(dir, 30);
    const left = fs.readdirSync(dir).sort();
    expect(left).toHaveLength(31); // 30 posledních + nejnovější z ledna
    expect(left).toContain("fakturace-zaloha-2026-01-28-0300.fakz");
    expect(left).toContain("fakturace-zaloha-2026-03-28-0300.fakz");
  });
});
