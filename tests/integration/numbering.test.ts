import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createDraft, deleteDraft, InvoiceError, issueInvoice } from "@/lib/invoices/service";
import { draftData, NOW, seedBasics } from "../helpers/fixtures";

let base: { customerId: string; incomeSourceId: string };

beforeAll(async () => {
  const { customer, s7 } = await seedBasics();
  base = { customerId: customer.id, incomeSourceId: s7.id };
});

async function issueNew(overrides: Parameters<typeof draftData>[1] = {}, now = NOW) {
  const draft = await createDraft(draftData(base, overrides));
  return issueInvoice(draft.id, { now });
}

describe("číslování faktur RRRRNNNN", () => {
  it("koncept nemá číslo, vystavení přidělí souvislou řadu", async () => {
    const draft = await createDraft(draftData(base));
    expect(draft.number).toBeNull();
    expect(draft.status).toBe("KONCEPT");

    const a = await issueInvoice(draft.id, { now: NOW });
    const b = await issueNew();
    expect(a.number).toBe("20260001");
    expect(b.number).toBe("20260002");
    expect(a.variableSymbol).toBe("20260001");
    expect(a.status).toBe("VYSTAVENA");
  });

  it("smazaný koncept nezanechá díru v řadě", async () => {
    const draft = await createDraft(draftData(base));
    await deleteDraft(draft.id);
    const next = await issueNew();
    expect(next.number).toBe("20260003");
  });

  it("neúspěšné vystavení nespotřebuje číslo", async () => {
    // datum v budoucnosti → vystavení selže ještě před přidělením čísla
    const future = await createDraft(draftData(base, { issueDate: "2026-12-01", dueDate: "2026-12-15" }));
    await expect(issueInvoice(future.id, { now: NOW })).rejects.toBeInstanceOf(InvoiceError);
    const series = await prisma.numberSeries.findUnique({
      where: { docType_year: { docType: "FAKTURA", year: 2026 } },
    });
    expect(series?.lastNumber).toBe(3);
    await deleteDraft(future.id);
  });

  it("řada musí jít chronologicky", async () => {
    const older = await createDraft(draftData(base, { issueDate: "2026-10-01", dueDate: "2026-10-15" }));
    await expect(issueInvoice(older.id, { now: NOW })).rejects.toThrow(/chronologicky/);
    await deleteDraft(older.id);
  });

  it("souběžné vystavení dá unikátní čísla bez děr", async () => {
    const drafts = await Promise.all(Array.from({ length: 6 }, () => createDraft(draftData(base))));
    const issued = await Promise.all(drafts.map((d) => issueInvoice(d.id, { now: NOW })));
    const numbers = issued.map((i) => i.number).sort();
    expect(numbers).toEqual(["20260004", "20260005", "20260006", "20260007", "20260008", "20260009"]);
  });

  it("nový rok začíná od 0001 a počet vystavených sedí s řadou", async () => {
    const january = await issueNew(
      { issueDate: "2027-01-04", dueDate: "2027-01-18" },
      new Date("2027-01-04T09:00:00Z"),
    );
    expect(january.number).toBe("20270001");

    const issued2026 = await prisma.invoice.count({ where: { seriesYear: 2026, type: "FAKTURA" } });
    const series2026 = await prisma.numberSeries.findUnique({
      where: { docType_year: { docType: "FAKTURA", year: 2026 } },
    });
    expect(issued2026).toBe(series2026?.lastNumber);
  });

  it("vystavený doklad nejde vystavit podruhé", async () => {
    const invoice = await issueNew();
    await expect(issueInvoice(invoice.id, { now: NOW })).rejects.toThrow(/už je vystavený/);
  });
});

describe("snímek údajů na faktuře", () => {
  it("zmrazí dodavatele, odběratele i paragraf činnosti", async () => {
    const invoice = await issueNew();
    const supplier = JSON.parse(invoice.supplierSnapshot!);
    const customer = JSON.parse(invoice.customerSnapshot!);
    expect(supplier).toMatchObject({ name: "Jan Novák", iban: "CZ6508000000192000145399", ico: "12345679" });
    expect(customer).toMatchObject({ name: "Žluťoučká s.r.o.", ico: "87654326" });
    expect(invoice.incomeSection).toBe("S7");
    expect(invoice.pausalCategory).toBe("P60");

    // pozdější změna odběratele vystavenou fakturu neovlivní
    await prisma.customer.update({ where: { id: base.customerId }, data: { name: "Nový název s.r.o." } });
    const reloaded = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(JSON.parse(reloaded.customerSnapshot!).name).toBe("Žluťoučká s.r.o.");
  });

  it("u § 9 bez tisku IČO a textu o zápisu je ve snímku vynechá", async () => {
    const s9 = await prisma.incomeSource.findFirstOrThrow({ where: { section: "S9" } });
    const draft = await createDraft(draftData({ ...base, incomeSourceId: s9.id }));
    const invoice = await issueInvoice(draft.id, { now: NOW });
    const supplier = JSON.parse(invoice.supplierSnapshot!);
    expect(supplier.ico).toBeNull();
    expect(supplier.registerText).toBeNull();
    expect(invoice.incomeSection).toBe("S9");
  });
});
