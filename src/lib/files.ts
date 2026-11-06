import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { env } from "@/env";
import { prisma, type Tx } from "@/lib/db";

export type FileKind = "INVOICE_PDF" | "RECEIPT" | "LOGO" | "BANK_IMPORT" | "EXPORT";

export function filesRoot(): string {
  return path.resolve(env.DATA_DIR, "files");
}

function resolveInside(relativePath: string): string {
  const root = filesRoot();
  const absolute = path.resolve(root, relativePath);
  if (!absolute.startsWith(root + path.sep)) throw new Error("Neplatná cesta k souboru.");
  return absolute;
}

export function sha256(data: Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

/**
 * Uloží soubor na disk (nikdy nepřepisuje existující) a založí záznam FileObject.
 * Záznamy dokladů a účtenek jsou v databázi neměnné a nemazatelné.
 */
export async function storeFile(
  params: {
    kind: FileKind;
    relativePath: string;
    data: Buffer;
    mimeType: string;
    originalName?: string;
  },
  client: Tx = prisma,
) {
  const absolute = resolveInside(params.relativePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  const temporary = `${absolute}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, params.data, { flag: "wx" });
  try {
    fs.linkSync(temporary, absolute); // selže, pokud cílový soubor už existuje
  } finally {
    fs.unlinkSync(temporary);
  }
  return client.fileObject.create({
    data: {
      kind: params.kind,
      storagePath: params.relativePath,
      originalName: params.originalName ?? null,
      mimeType: params.mimeType,
      sizeBytes: params.data.length,
      sha256: sha256(params.data),
    },
  });
}

/** Přečte uložený soubor a ověří jeho otisk. */
export function readStoredFile(file: { storagePath: string; sha256: string }): Buffer {
  const data = fs.readFileSync(resolveInside(file.storagePath));
  if (sha256(data) !== file.sha256) {
    throw new Error("Uložený soubor neodpovídá otisku – může být poškozený.");
  }
  return data;
}
