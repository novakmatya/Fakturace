import path from "node:path";
import { env } from "@/env";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { createEncryptedBackup, pruneBackups } from "../../scripts/backup-core.mjs";

export type BackupConfig = { enabled: true; dir: string; password: string } | { enabled: false; reason: string };

export function backupConfig(): BackupConfig {
  const dir = env.BACKUP_DIR?.trim();
  const password = env.BACKUP_PASSWORD ?? "";
  if (!dir) return { enabled: false, reason: "Není nastavená složka pro zálohy (BACKUP_DIR)." };
  if (password.length < 12) return { enabled: false, reason: "Heslo zálohy (BACKUP_PASSWORD) chybí nebo má méně než 12 znaků." };
  return { enabled: true, dir: path.resolve(dir), password };
}

/** Poslední úspěšná záloha podle auditního logu. */
export async function lastBackup() {
  const entry = await prisma.auditLog.findFirst({ where: { action: "BACKUP_CREATED" }, orderBy: { at: "desc" } });
  if (!entry) return null;
  const details = entry.details ? (JSON.parse(entry.details) as { file?: string; sizeBytes?: number }) : {};
  return { at: entry.at, file: details.file ?? null, sizeBytes: details.sizeBytes ?? null };
}

export async function runBackup(options: { now?: Date; actor?: "USER" | "SYSTEM" } = {}) {
  const config = backupConfig();
  if (!config.enabled) throw new Error(config.reason);
  try {
    const result = await createEncryptedBackup({
      dataDir: path.resolve(env.DATA_DIR),
      backupDir: config.dir,
      password: config.password,
      now: options.now,
    });
    const removed = pruneBackups(config.dir);
    await audit({
      action: "BACKUP_CREATED",
      actor: options.actor ?? "SYSTEM",
      details: { file: path.basename(result.file), sizeBytes: result.sizeBytes, sha256: result.sha256, removed },
    });
    return result;
  } catch (error) {
    await audit({
      action: "BACKUP_FAILED",
      actor: options.actor ?? "SYSTEM",
      details: { reason: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  }
}

/** Záloha jednou denně (spouští worker); vrací true, když zálohoval. */
export async function runDailyBackupIfDue(now = new Date()): Promise<boolean> {
  if (!backupConfig().enabled) return false;
  const last = await lastBackup();
  if (last && now.getTime() - last.at.getTime() < 20 * 3600_000) return false;
  await runBackup({ now });
  return true;
}
