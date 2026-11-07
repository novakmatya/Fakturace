import { audit } from "@/lib/audit";
import { todayPrague, yearOf } from "@/lib/dates";
import { prisma, type Tx } from "@/lib/db";
import { SENT_EMAILS_COUNT } from "@/lib/invoices/display";
import type { DraftData } from "@/lib/invoices/draft-schema";
import { allocateNumber } from "@/lib/invoices/numbering";
import type { CustomerSnapshot, DocType, SupplierSnapshot } from "@/lib/invoices/types";
import { lineTotalHalere, roundingToWholeCrowns } from "@/lib/money";

export class InvoiceError extends Error {}

function computeTotals(lines: DraftData["lines"], roundToCrowns: boolean) {
  const lineTotals = lines.map((l) => lineTotalHalere(l.quantity, l.unitPrice));
  const totalHalere = lineTotals.reduce((a, b) => a + b, 0);
  const roundingHalere = roundToCrowns ? roundingToWholeCrowns(totalHalere) : 0;
  return { lineTotals, totalHalere, roundingHalere, amountDueHalere: totalHalere + roundingHalere };
}

async function loadDraftContext(client: Tx, data: DraftData) {
  const [customer, source, settings] = await Promise.all([
    client.customer.findUnique({ where: { id: data.customerId } }),
    client.incomeSource.findUnique({ where: { id: data.incomeSourceId } }),
    client.appSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} }),
  ]);
  if (!customer) throw new InvoiceError("Odběratel neexistuje.");
  if (!source) throw new InvoiceError("Činnost neexistuje.");
  return { customer, source, settings };
}

function draftFields(data: DraftData, source: { section: string; pausalCategory: string | null; shareNumerator: number; shareDenominator: number }, totals: ReturnType<typeof computeTotals>) {
  return {
    customerId: data.customerId,
    incomeSourceId: data.incomeSourceId,
    incomeSection: source.section,
    pausalCategory: source.pausalCategory,
    shareNumerator: source.shareNumerator,
    shareDenominator: source.shareDenominator,
    issueDate: data.issueDate,
    dueDate: data.dueDate,
    supplyDate: data.supplyDate,
    paymentMethod: data.paymentMethod,
    constantSymbol: data.constantSymbol,
    specificSymbol: data.specificSymbol,
    note: data.note,
    totalHalere: totals.totalHalere,
    roundingHalere: totals.roundingHalere,
    amountDueHalere: totals.amountDueHalere,
  };
}

function lineRows(data: DraftData, totals: ReturnType<typeof computeTotals>) {
  return data.lines.map((line, index) => ({
    position: index + 1,
    description: line.description,
    quantityMilli: line.quantity,
    unit: line.unit,
    unitPriceHalere: line.unitPrice,
    totalHalere: totals.lineTotals[index],
    kind: line.kind,
  }));
}

/** Založí koncept faktury. Koncept nemá číslo a lze ho upravit i smazat. */
export async function createDraft(data: DraftData, options: { type?: DocType; correctsInvoiceId?: string } = {}) {
  return prisma.$transaction(async (tx) => {
    const { source, settings } = await loadDraftContext(tx, data);
    const totals = computeTotals(data.lines, settings.roundInvoiceTotal);
    const invoice = await tx.invoice.create({
      data: {
        type: options.type ?? "FAKTURA",
        correctsInvoiceId: options.correctsInvoiceId ?? null,
        ...draftFields(data, source, totals),
        lines: { create: lineRows(data, totals) },
      },
    });
    await audit({ action: "INVOICE_DRAFT_CREATED", entityType: "Invoice", entityId: invoice.id }, tx);
    return invoice;
  });
}

export async function updateDraft(id: string, data: DraftData) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.invoice.findUnique({ where: { id } });
    if (!existing) throw new InvoiceError("Doklad neexistuje.");
    if (existing.number !== null || existing.status !== "KONCEPT") {
      throw new InvoiceError("Vystavený doklad nelze upravit. Opravu proveďte dobropisem.");
    }
    const { source, settings } = await loadDraftContext(tx, data);
    const totals = computeTotals(data.lines, settings.roundInvoiceTotal);
    await tx.invoiceLine.deleteMany({ where: { invoiceId: id } });
    const invoice = await tx.invoice.update({
      where: { id },
      data: { ...draftFields(data, source, totals), lines: { create: lineRows(data, totals) } },
    });
    await audit({ action: "INVOICE_DRAFT_UPDATED", entityType: "Invoice", entityId: id }, tx);
    return invoice;
  });
}

export async function deleteDraft(id: string) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.invoice.findUnique({ where: { id } });
    if (!existing) throw new InvoiceError("Doklad neexistuje.");
    if (existing.number !== null || existing.status !== "KONCEPT") {
      throw new InvoiceError("Vystavený doklad nelze smazat, jen stornovat dobropisem.");
    }
    await tx.invoice.delete({ where: { id } });
    await audit({ action: "INVOICE_DRAFT_DELETED", entityType: "Invoice", entityId: id }, tx);
  });
}

export function buildSupplierSnapshot(
  supplier: {
    name: string; street: string; city: string; zip: string; country: string;
    ico: string | null; dic: string | null; registerText: string | null;
    email: string | null; phone: string | null; web: string | null;
    bankAccount: string; iban: string; bic: string | null; vatNote: string; footerText: string | null;
  },
  source: { printIco: boolean; printRegisterText: boolean },
): SupplierSnapshot {
  return {
    name: supplier.name,
    street: supplier.street,
    city: supplier.city,
    zip: supplier.zip,
    country: supplier.country,
    ico: source.printIco ? supplier.ico : null,
    dic: supplier.dic,
    registerText: source.printRegisterText ? supplier.registerText : null,
    email: supplier.email,
    phone: supplier.phone,
    web: supplier.web,
    bankAccount: supplier.bankAccount,
    iban: supplier.iban,
    bic: supplier.bic,
    vatNote: supplier.vatNote,
    footerText: supplier.footerText,
  };
}

export function buildCustomerSnapshot(customer: {
  kind: string; name: string; street: string; city: string; zip: string; country: string;
  ico: string | null; dic: string | null;
}): CustomerSnapshot {
  return {
    kind: customer.kind === "PERSON" ? "PERSON" : "BUSINESS",
    name: customer.name,
    street: customer.street,
    city: customer.city,
    zip: customer.zip,
    country: customer.country,
    ico: customer.ico,
    dic: customer.dic,
  };
}

/**
 * Vystaví doklad: v jedné transakci přidělí číslo, zmrazí údaje dodavatele,
 * odběratele i činnosti a přepne stav. Při jakékoli chybě se vrátí vše včetně
 * přírůstku číselné řady. PDF se vyrábí až po potvrzení transakce.
 */
export async function issueInvoice(id: string, options: { now?: Date } = {}) {
  const now = options.now ?? new Date();
  const today = todayPrague(now);

  return prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({
      where: { id },
      include: { lines: { orderBy: { position: "asc" } }, customer: true, incomeSource: true, correctsInvoice: true },
    });
    if (!invoice) throw new InvoiceError("Doklad neexistuje.");
    if (invoice.number !== null || invoice.status !== "KONCEPT") {
      throw new InvoiceError("Doklad už je vystavený.");
    }
    if (invoice.lines.length === 0) throw new InvoiceError("Doklad nemá žádnou položku.");
    if (invoice.issueDate > today) throw new InvoiceError("Datum vystavení nemůže být v budoucnosti.");
    if (invoice.dueDate < invoice.issueDate) throw new InvoiceError("Splatnost je dřív než vystavení.");
    if (invoice.customer.archived) throw new InvoiceError("Odběratel je archivovaný.");
    if (invoice.incomeSource.archived) throw new InvoiceError("Činnost je archivovaná.");

    const supplier = await tx.supplierProfile.findUnique({ where: { id: 1 } });
    if (!supplier) throw new InvoiceError("Nejdřív vyplňte údaje dodavatele v Nastavení.");

    const type = invoice.type as DocType;
    const year = yearOf(invoice.issueDate);

    // Řada zůstává chronologická: datum nesmí předběhnout poslední vystavený doklad.
    const last = await tx.invoice.findFirst({
      where: { type, seriesYear: year, number: { not: null } },
      orderBy: { number: "desc" },
      select: { number: true, issueDate: true },
    });
    if (last && last.issueDate > invoice.issueDate) {
      throw new InvoiceError(
        `Datum vystavení je starší než u dokladu ${last.number} (${last.issueDate}). Řada musí jít chronologicky.`,
      );
    }

    if (type === "DOBROPIS" && !invoice.correctsInvoice?.number) {
      throw new InvoiceError("Dobropis musí odkazovat na vystavenou fakturu.");
    }

    const settings = await tx.appSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
    const lineTotals = invoice.lines.map((l) => lineTotalHalere(l.quantityMilli, l.unitPriceHalere));
    const totalHalere = lineTotals.reduce((a, b) => a + b, 0);
    const roundingHalere = settings.roundInvoiceTotal ? roundingToWholeCrowns(totalHalere) : 0;
    const amountDueHalere = totalHalere + roundingHalere;
    if (type === "FAKTURA" && amountDueHalere <= 0) throw new InvoiceError("Částka faktury musí být kladná.");
    if (type === "DOBROPIS" && amountDueHalere >= 0) throw new InvoiceError("Částka dobropisu musí být záporná.");

    const { number } = await allocateNumber(tx, type, year);
    const variableSymbol =
      type === "FAKTURA" ? number : (invoice.correctsInvoice?.variableSymbol ?? invoice.correctsInvoice?.number ?? null);

    const issued = await tx.invoice.update({
      where: { id },
      data: {
        number,
        seriesYear: year,
        status: "VYSTAVENA",
        issuedAt: now,
        variableSymbol,
        supplyDate: invoice.supplyDate ?? invoice.issueDate,
        incomeSection: invoice.incomeSource.section,
        pausalCategory: invoice.incomeSource.pausalCategory,
        shareNumerator: invoice.incomeSource.shareNumerator,
        shareDenominator: invoice.incomeSource.shareDenominator,
        totalHalere,
        roundingHalere,
        amountDueHalere,
        supplierSnapshot: JSON.stringify(buildSupplierSnapshot(supplier, invoice.incomeSource)),
        customerSnapshot: JSON.stringify(buildCustomerSnapshot(invoice.customer)),
      },
    });
    await audit(
      { action: "INVOICE_ISSUED", entityType: "Invoice", entityId: id, details: { number, amountDueHalere } },
      tx,
    );
    return issued;
  });
}

export async function getInvoice(id: string) {
  return prisma.invoice.findUnique({
    where: { id },
    include: {
      lines: { orderBy: { position: "asc" } },
      customer: true,
      incomeSource: true,
      correctsInvoice: { select: { id: true, number: true } },
      creditNotes: { select: { id: true, number: true, status: true } },
      pdfFile: true,
      ...SENT_EMAILS_COUNT,
    },
  });
}

/** Filtr stavu: uložené stavy + odvozené ODESLANA / NEODESLANA (podle logu e-mailů). */
function statusWhere(status: string | undefined) {
  const sent = { some: { kind: "INVOICE", status: "SENT" } };
  switch (status) {
    case undefined:
    case "":
      return {};
    case "ODESLANA":
      return { status: "VYSTAVENA", emails: sent };
    case "NEODESLANA":
      return { status: "VYSTAVENA", type: "FAKTURA", emails: { none: { kind: "INVOICE", status: "SENT" } } };
    default:
      return { status };
  }
}

export async function listInvoices(filter: { year?: number; status?: string; customerId?: string } = {}) {
  return prisma.invoice.findMany({
    where: {
      ...(filter.year ? { issueDate: { gte: `${filter.year}-01-01`, lte: `${filter.year}-12-31` } } : {}),
      ...statusWhere(filter.status),
      ...(filter.customerId ? { customerId: filter.customerId } : {}),
    },
    orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
    include: { customer: { select: { id: true, name: true } }, ...SENT_EMAILS_COUNT },
  });
}
