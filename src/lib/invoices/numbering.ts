import type { Tx } from "@/lib/db";
import type { DocType } from "@/lib/invoices/types";

export const DOC_PREFIX: Record<DocType, string> = { FAKTURA: "", DOBROPIS: "D" };
export const MAX_PER_YEAR = 9999;

/** Číslo dokladu ve formátu RRRRNNNN (dobropis s předponou D). */
export function formatDocNumber(type: DocType, year: number, sequence: number): string {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) throw new Error("Neplatný rok řady.");
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > MAX_PER_YEAR) {
    throw new Error("Neplatné pořadí v řadě.");
  }
  return `${DOC_PREFIX[type]}${year}${String(sequence).padStart(4, "0")}`;
}

/**
 * Přidělí další číslo v řadě. Musí běžet uvnitř transakce vystavení, aby
 * případná chyba vrátila i přírůstek řady (žádné díry). Trigger v databázi
 * navíc dovolí řadu zvýšit jen o jedna a číslo dokladu ověří proti řadě.
 */
export async function allocateNumber(tx: Tx, type: DocType, year: number) {
  const series = await tx.numberSeries.upsert({
    where: { docType_year: { docType: type, year } },
    create: { docType: type, year, lastNumber: 0 },
    update: {},
  });
  if (series.lastNumber >= MAX_PER_YEAR) {
    throw new Error(`Číselná řada ${type} pro rok ${year} je vyčerpána.`);
  }
  const updated = await tx.numberSeries.update({
    where: { id: series.id, lastNumber: series.lastNumber },
    data: { lastNumber: { increment: 1 } },
  });
  return { number: formatDocNumber(type, year, updated.lastNumber), sequence: updated.lastNumber };
}
