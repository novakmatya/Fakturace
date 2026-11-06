import fs from "node:fs";
import path from "node:path";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { filesRoot, storeFile } from "@/lib/files";
import { type InvoicePdfData, renderInvoicePdf } from "@/lib/invoices/pdf";
import type { CustomerSnapshot, DocType, PaymentMethod, SupplierSnapshot } from "@/lib/invoices/types";

type IssuedInvoice = NonNullable<Awaited<ReturnType<typeof loadIssued>>>;

function loadIssued(id: string) {
  return prisma.invoice.findUnique({
    where: { id },
    include: {
      lines: { orderBy: { position: "asc" } },
      correctsInvoice: { select: { number: true } },
      pdfFile: true,
    },
  });
}

export function toPdfData(invoice: IssuedInvoice): InvoicePdfData {
  if (!invoice.number || !invoice.supplierSnapshot || !invoice.customerSnapshot) {
    throw new Error("PDF lze vytvořit jen z vystaveného dokladu.");
  }
  return {
    type: invoice.type as DocType,
    number: invoice.number,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    paymentMethod: invoice.paymentMethod as PaymentMethod,
    variableSymbol: invoice.variableSymbol,
    constantSymbol: invoice.constantSymbol,
    specificSymbol: invoice.specificSymbol,
    note: invoice.note,
    totalHalere: invoice.totalHalere,
    roundingHalere: invoice.roundingHalere,
    amountDueHalere: invoice.amountDueHalere,
    correctsNumber: invoice.correctsInvoice?.number ?? null,
    supplier: JSON.parse(invoice.supplierSnapshot) as SupplierSnapshot,
    customer: JSON.parse(invoice.customerSnapshot) as CustomerSnapshot,
    lines: invoice.lines.map((l) => ({
      description: l.description,
      quantityMilli: l.quantityMilli,
      unit: l.unit,
      unitPriceHalere: l.unitPriceHalere,
      totalHalere: l.totalHalere,
    })),
  };
}

/**
 * Vyrobí a uloží PDF vystaveného dokladu, pokud ještě neexistuje.
 * Uložené PDF je originál: znovu se negeneruje a v databázi je neměnné.
 */
export async function ensureInvoicePdf(id: string) {
  const invoice = await loadIssued(id);
  if (!invoice) throw new Error("Doklad neexistuje.");
  if (invoice.pdfFile) return invoice.pdfFile;

  const data = toPdfData(invoice);
  const { pdf } = await renderInvoicePdf(data);
  const relativePath = path.posix.join("doklady", String(invoice.seriesYear), `${invoice.number}.pdf`);

  // Soubor bez záznamu v databázi zbyl po přerušeném pokusu – odložit stranou.
  const absolute = path.join(filesRoot(), relativePath);
  if (fs.existsSync(absolute)) {
    const known = await prisma.fileObject.findUnique({ where: { storagePath: relativePath } });
    if (!known) fs.renameSync(absolute, `${absolute}.orphan-${Date.now()}`);
  }

  return prisma.$transaction(async (tx) => {
    const file = await storeFile(
      {
        kind: "INVOICE_PDF",
        relativePath,
        data: pdf,
        mimeType: "application/pdf",
        originalName: `${data.type === "DOBROPIS" ? "Dobropis" : "Faktura"}-${invoice.number}.pdf`,
      },
      tx,
    );
    await tx.invoice.update({ where: { id }, data: { pdfFileId: file.id, pdfSha256: file.sha256 } });
    await audit(
      { action: "INVOICE_PDF_STORED", entityType: "Invoice", entityId: id, details: { sha256: file.sha256 } },
      tx,
    );
    return file;
  });
}
