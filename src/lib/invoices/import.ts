import { z } from "zod";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { isIsoDate, todayPrague } from "@/lib/dates";
import { storeFile } from "@/lib/files";
import { buildCustomerSnapshot, buildSupplierSnapshot, InvoiceError } from "@/lib/invoices/service";
import { parseCzkInput } from "@/lib/money";
import { recordPayment } from "@/lib/payments/service";

/** Jedna starší faktura vystavená mimo aplikaci (převzatá kvůli úplnému daňovému přehledu). */
export const importRowSchema = z
  .object({
    number: z.string().trim().min(1, "Zadejte číslo faktury.").max(30, "Číslo je příliš dlouhé."),
    issueDate: z.string().trim().refine(isIsoDate, "Zadejte datum vystavení."),
    dueDate: z.string().trim().refine(isIsoDate, "Zadejte datum splatnosti."),
    amount: z
      .string()
      .trim()
      .transform((v, ctx) => {
        const h = parseCzkInput(v);
        if (h === null || h <= 0) {
          ctx.addIssue({ code: "custom", message: "Zadejte kladnou částku." });
          return z.NEVER;
        }
        return h;
      }),
    description: z.string().trim().min(1, "Zadejte popis.").max(300),
    paidOn: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .refine((v) => v === null || isIsoDate(v), "Datum úhrady: zadejte platné datum."),
  })
  .refine((r) => r.dueDate >= r.issueDate, { message: "Splatnost nemůže být před vystavením.", path: ["dueDate"] });

export type ImportRow = z.infer<typeof importRowSchema>;

/**
 * Převezme starší fakturu s původním číslem: uloží se jako vystavená (neměnná),
 * mimo číselnou řadu aplikace; úhrada se zapíše s datem, kdy peníze přišly.
 * Údaje dodavatele a odběratele jsou z aktuálního nastavení (originál je v PDF).
 */
export async function importInvoice(
  input: { customerId: string; incomeSourceId: string; row: ImportRow; pdf?: Buffer | null },
  options: { now?: Date } = {},
) {
  const now = options.now ?? new Date();
  const { row } = input;
  if (row.issueDate > todayPrague(now)) throw new InvoiceError("Datum vystavení nemůže být v budoucnosti.");
  if (row.paidOn && row.paidOn > todayPrague(now)) throw new InvoiceError("Datum úhrady nemůže být v budoucnosti.");
  if (input.pdf && input.pdf.subarray(0, 5).toString() !== "%PDF-") throw new InvoiceError("Příloha není PDF.");

  const [supplier, customer, source, clash] = await Promise.all([
    prisma.supplierProfile.findUnique({ where: { id: 1 } }),
    prisma.customer.findUnique({ where: { id: input.customerId } }),
    prisma.incomeSource.findUnique({ where: { id: input.incomeSourceId } }),
    prisma.invoice.findFirst({ where: { type: "FAKTURA", number: row.number }, select: { id: true } }),
  ]);
  if (!supplier) throw new InvoiceError("Nejdřív vyplňte údaje dodavatele.");
  if (!customer) throw new InvoiceError("Vyberte odběratele.");
  if (!source) throw new InvoiceError("Vyberte činnost.");
  if (clash) throw new InvoiceError(`Faktura číslo ${row.number} už v aplikaci je.`);

  const invoice = await prisma.$transaction(async (tx) => {
    const draft = await tx.invoice.create({
      data: {
        origin: "IMPORT",
        customerId: customer.id,
        incomeSourceId: source.id,
        incomeSection: source.section,
        pausalCategory: source.pausalCategory,
        shareNumerator: source.shareNumerator,
        shareDenominator: source.shareDenominator,
        issueDate: row.issueDate,
        dueDate: row.dueDate,
        totalHalere: row.amount,
        amountDueHalere: row.amount,
        note: "Převzato ze starší evidence.",
        lines: {
          create: [{ position: 1, description: row.description, quantityMilli: 1000, unitPriceHalere: row.amount, totalHalere: row.amount }],
        },
      },
    });
    const vs = row.number.replace(/\D/g, "").slice(-10) || null;
    const issued = await tx.invoice.update({
      where: { id: draft.id },
      data: {
        number: row.number,
        status: "VYSTAVENA",
        issuedAt: now,
        variableSymbol: vs,
        supplierSnapshot: JSON.stringify(buildSupplierSnapshot(supplier, source)),
        customerSnapshot: JSON.stringify(buildCustomerSnapshot(customer)),
      },
    });
    await audit(
      { action: "INVOICE_IMPORTED", entityType: "Invoice", entityId: issued.id, details: { number: row.number, amountHalere: row.amount } },
      tx,
    );
    return issued;
  });

  if (input.pdf) {
    const safe = row.number.replace(/[^\w.-]+/g, "_");
    const file = await storeFile({
      kind: "INVOICE_PDF",
      relativePath: `doklady/prevzate/${row.issueDate.slice(0, 4)}/${safe}-${invoice.id.slice(-6)}.pdf`,
      data: input.pdf,
      mimeType: "application/pdf",
      originalName: `Faktura-${safe}.pdf`,
    });
    await prisma.invoice.update({ where: { id: invoice.id }, data: { pdfFileId: file.id, pdfSha256: file.sha256 } });
  }
  if (row.paidOn) {
    await recordPayment(invoice.id, { paidOn: row.paidOn, amount: row.amount, method: "PREVOD", note: null }, { now });
  }
  return invoice;
}

/**
 * Nastaví, od jakého čísla začne číselná řada aplikace v daném roce
 * (např. navázání na 10 dříve vystavených faktur). Jen dokud v roce není žádná.
 */
export async function setSeriesStart(year: number, nextNumber: number) {
  if (!Number.isInteger(nextNumber) || nextNumber < 1 || nextNumber > 9999) {
    throw new InvoiceError("Číslo musí být 1 až 9999.");
  }
  const existing = await prisma.numberSeries.findUnique({ where: { docType_year: { docType: "FAKTURA", year } } });
  if (existing) throw new InvoiceError(`Řada ${year} už začala (poslední číslo ${existing.lastNumber}). Změnit ji nelze.`);
  await prisma.numberSeries.create({ data: { docType: "FAKTURA", year, lastNumber: nextNumber - 1 } });
  await audit({ action: "SERIES_STARTED", entityType: "NumberSeries", details: { year, nextNumber } });
}
