import { beforeAll, describe, expect, it } from "vitest";
import { audit } from "@/lib/audit";
import { integrityMessage } from "@/lib/errors";
import { prisma } from "@/lib/db";
import { createDraft, deleteDraft, issueInvoice } from "@/lib/invoices/service";
import { draftData, NOW, seedBasics } from "../helpers/fixtures";

let base: { customerId: string; incomeSourceId: string };
let issuedId: string;

beforeAll(async () => {
  const { customer, s7 } = await seedBasics();
  base = { customerId: customer.id, incomeSourceId: s7.id };
  const draft = await createDraft(draftData(base));
  issuedId = (await issueInvoice(draft.id, { now: NOW })).id;
});

/** Ověří, že akci odmítl databázový trigger (ne jiná chyba). */
async function rejectedByTrigger(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, "očekávané odmítnutí triggerem").not.toBeNull();
  expect(integrityMessage(error)).toBeTruthy();
}

describe("vystavený doklad je v databázi neměnný a nemazatelný", () => {
  it("nelze ho smazat", async () => {
    await rejectedByTrigger(prisma.invoice.delete({ where: { id: issuedId } }));
    await rejectedByTrigger(prisma.$executeRawUnsafe(`DELETE FROM "Invoice" WHERE "id" = ?`, issuedId));
  });

  it("nelze změnit částku, odběratele, datum ani číslo", async () => {
    await rejectedByTrigger(prisma.invoice.update({ where: { id: issuedId }, data: { amountDueHalere: 1 } }),);
    await rejectedByTrigger(prisma.invoice.update({ where: { id: issuedId }, data: { issueDate: "2026-11-03" } }),);
    await rejectedByTrigger(prisma.invoice.update({ where: { id: issuedId }, data: { number: "20269999" } }),);
    await rejectedByTrigger(prisma.invoice.update({ where: { id: issuedId }, data: { status: "KONCEPT" } }),);
  });

  it("nelze měnit, přidat ani smazat položky", async () => {
    const line = await prisma.invoiceLine.findFirstOrThrow({ where: { invoiceId: issuedId } });
    await rejectedByTrigger(prisma.invoiceLine.update({ where: { id: line.id }, data: { description: "jiný popis" } }),);
    await rejectedByTrigger(prisma.invoiceLine.delete({ where: { id: line.id } }));
    await rejectedByTrigger(prisma.invoiceLine.create({
        data: {
          invoiceId: issuedId,
          position: 9,
          description: "navíc",
          quantityMilli: 1000,
          unitPriceHalere: 100,
          totalHalere: 100,
        },
      }),);
  });

  it("storno je dovolené jen s datem a nelze ho vrátit", async () => {
    await rejectedByTrigger(prisma.invoice.update({ where: { id: issuedId }, data: { status: "STORNOVANA" } }),);
  });
});

describe("číslování nelze obejít", () => {
  it("doklad nelze založit rovnou s číslem", async () => {
    await rejectedByTrigger(prisma.invoice.create({
        data: {
          number: "20260099",
          status: "VYSTAVENA",
          customerId: base.customerId,
          incomeSourceId: base.incomeSourceId,
          incomeSection: "S7",
          issueDate: "2026-11-02",
          dueDate: "2026-11-16",
        },
      }),);
  });

  it("číslo musí odpovídat řadě a řada smí růst jen o jedna", async () => {
    const draft = await createDraft(draftData(base));
    await rejectedByTrigger(prisma.invoice.update({
        where: { id: draft.id },
        data: {
          number: "20260050",
          seriesYear: 2026,
          status: "VYSTAVENA",
          issuedAt: new Date(),
          supplierSnapshot: "{}",
          customerSnapshot: "{}",
        },
      }),);

    const series = await prisma.numberSeries.findFirstOrThrow({ where: { docType: "FAKTURA", year: 2026 } });
    await rejectedByTrigger(prisma.numberSeries.update({ where: { id: series.id }, data: { lastNumber: series.lastNumber + 5 } }),);
    await rejectedByTrigger(prisma.numberSeries.update({ where: { id: series.id }, data: { lastNumber: series.lastNumber - 1 } }),);
    await rejectedByTrigger(prisma.numberSeries.delete({ where: { id: series.id } }));
    await deleteDraft(draft.id);
  });

  it("součet položky musí odpovídat množství a ceně", async () => {
    const draft = await createDraft(draftData(base));
    await rejectedByTrigger(prisma.invoiceLine.create({
        data: {
          invoiceId: draft.id,
          position: 2,
          description: "špatný součet",
          quantityMilli: 2000,
          unitPriceHalere: 10000,
          totalHalere: 19999,
        },
      }),);
    await deleteDraft(draft.id);
  });

  it("koncept lze smazat včetně položek", async () => {
    const draft = await createDraft(draftData(base));
    await deleteDraft(draft.id);
    expect(await prisma.invoiceLine.count({ where: { invoiceId: draft.id } })).toBe(0);
  });
});

describe("audit log a soubory", () => {
  it("audit log je jen pro zápis", async () => {
    await audit({ action: "TEST_ENTRY" });
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "TEST_ENTRY" } });
    await rejectedByTrigger(prisma.auditLog.update({ where: { id: entry.id }, data: { action: "PREPSANO" } }),);
    await rejectedByTrigger(prisma.auditLog.delete({ where: { id: entry.id } }));
  });

  it("záznam PDF dokladu nelze změnit ani smazat", async () => {
    const file = await prisma.fileObject.create({
      data: { kind: "INVOICE_PDF", storagePath: "x/test.pdf", mimeType: "application/pdf", sizeBytes: 1, sha256: "a" },
    });
    await rejectedByTrigger(prisma.fileObject.update({ where: { id: file.id }, data: { sha256: "b" } }));
    await rejectedByTrigger(prisma.fileObject.delete({ where: { id: file.id } }));
  });
});
