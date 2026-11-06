import { createCustomer } from "@/lib/customers";
import { draftSchema, type DraftInput } from "@/lib/invoices/draft-schema";
import { createIncomeSource, saveSupplier } from "@/lib/settings";
import { customerSchema, incomeSourceSchema, supplierSchema } from "@/lib/validation";

export const SUPPLIER_INPUT = {
  name: "Jan Novák",
  street: "Vinohradská 1511/230",
  city: "Praha 10",
  zip: "10000",
  country: "CZ",
  ico: "12345679",
  dic: "",
  bankAccount: "19-2000145399/0800",
  iban: "",
  bic: "",
  registerText: "Fyzická osoba zapsaná v živnostenském rejstříku.",
  email: "jan@example.cz",
  phone: "+420 777 123 456",
  web: "",
  defaultDueDays: "14",
  vatNote: "Nejsem plátce DPH.",
  footerText: "",
};

export async function seedBasics() {
  const supplier = await saveSupplier(supplierSchema.parse(SUPPLIER_INPUT));
  const s7 = await createIncomeSource(
    incomeSourceSchema.parse({
      name: "Právní a daňové konzultace",
      section: "S7",
      pausalCategory: "P60",
      shareNumerator: "1",
      shareDenominator: "1",
      printIco: true,
      printRegisterText: true,
    }),
  );
  const s9 = await createIncomeSource(
    incomeSourceSchema.parse({
      name: "Pronájem bytu",
      section: "S9",
      pausalCategory: "",
      shareNumerator: "1",
      shareDenominator: "1",
      printIco: false,
      printRegisterText: false,
    }),
  );
  const customer = await createCustomer(
    customerSchema.parse({
      kind: "BUSINESS",
      name: "Žluťoučká s.r.o.",
      street: "Jankovcova 1522/53",
      city: "Praha 7",
      zip: "17000",
      country: "CZ",
      ico: "87654326",
      dic: "CZ87654326",
      email: "fakturace@example.cz",
      emailCc: "",
      defaultIncomeSourceId: "",
      defaultDueDays: "",
      remindersEnabled: true,
      note: "",
    }),
  );
  return { supplier, s7, s9, customer };
}

export function draftData(
  base: { customerId: string; incomeSourceId: string },
  overrides: Partial<DraftInput> = {},
) {
  return draftSchema.parse({
    customerId: base.customerId,
    incomeSourceId: base.incomeSourceId,
    issueDate: "2026-11-02",
    dueDate: "2026-11-16",
    supplyDate: "",
    paymentMethod: "PREVOD",
    constantSymbol: "",
    specificSymbol: "",
    note: "",
    lines: [{ description: "Konzultace – smluvní dokumentace", quantity: "2", unit: "hod", unitPrice: "1 500" }],
    ...overrides,
  });
}

/** Čas, kdy je 2. 11. 2026 dávno platným datem vystavení. */
export const NOW = new Date("2026-11-06T12:00:00Z");
