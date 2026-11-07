import { prisma } from "@/lib/db";

export type CashIncome = {
  year: number;
  totalHalere: number;
  bySection: { S7: number; S9: number };
  bySource: { incomeSourceId: string; name: string; section: string; totalHalere: number }[];
  paymentCount: number;
};

/**
 * Příjmy roku podle peněžního principu: rozhoduje datum úhrady, ne datum vystavení.
 * Paragraf (§ 7 / § 9) je ten zmrazený na faktuře při vystavení. Částky jsou hrubé
 * (bez rozdělení podle spoluvlastnických podílů – to řeší až daňový modul).
 */
export async function cashIncome(year: number): Promise<CashIncome> {
  const payments = await prisma.payment.findMany({
    where: { cancelledAt: null, paidOn: { gte: `${year}-01-01`, lte: `${year}-12-31` } },
    select: {
      amountHalere: true,
      invoice: { select: { incomeSection: true, incomeSourceId: true, incomeSource: { select: { name: true } } } },
    },
  });

  const bySection = { S7: 0, S9: 0 };
  const sources = new Map<string, { incomeSourceId: string; name: string; section: string; totalHalere: number }>();
  let total = 0;
  for (const p of payments) {
    total += p.amountHalere;
    const section = p.invoice.incomeSection === "S9" ? "S9" : "S7";
    bySection[section] += p.amountHalere;
    const key = p.invoice.incomeSourceId;
    const entry = sources.get(key) ?? { incomeSourceId: key, name: p.invoice.incomeSource.name, section, totalHalere: 0 };
    entry.totalHalere += p.amountHalere;
    sources.set(key, entry);
  }
  return {
    year,
    totalHalere: total,
    bySection,
    bySource: [...sources.values()].sort((a, b) => b.totalHalere - a.totalHalere),
    paymentCount: payments.length,
  };
}
