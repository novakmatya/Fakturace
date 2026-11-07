import { prisma } from "@/lib/db";
import { addDays, todayPrague } from "@/lib/dates";
import { draftSchema } from "@/lib/invoices/draft-schema";
import { createDraft, InvoiceError, issueInvoice } from "@/lib/invoices/service";

const MONTHS = ["leden", "únor", "březen", "duben", "květen", "červen", "červenec", "srpen", "září", "říjen", "listopad", "prosinec"];
// delší názvy dřív, aby „červenec“ nevyhrál „červen“
const MONTH_RE = new RegExp(`(${[...MONTHS].sort((a, b) => b.length - a.length).join("|")})\\s+(\\d{4})`, "i");

/** „Právní služby za říjen 2026“ → „Právní služby za listopad 2026“ (prosinec → leden dalšího roku). */
export function nextMonthDescription(text: string): string {
  return text.replace(MONTH_RE, (_all, month: string, year: string) => {
    const index = MONTHS.indexOf(month.toLowerCase());
    const next = MONTHS[(index + 1) % 12];
    const nextYear = index === 11 ? Number(year) + 1 : Number(year);
    const cased = month[0] === month[0].toUpperCase() ? next[0].toUpperCase() + next.slice(1) : next;
    return `${cased} ${nextYear}`;
  });
}

/** Výchozí hodnoty pro rychlou měsíční fakturu podle poslední vystavené (i převzaté). */
export async function quickInvoiceDefaults() {
  const last = await prisma.invoice.findFirst({
    where: { type: "FAKTURA", status: "VYSTAVENA" },
    orderBy: [{ issueDate: "desc" }, { issuedAt: "desc" }],
    include: { lines: { orderBy: { position: "asc" }, take: 1 }, customer: true, incomeSource: true },
  });
  if (!last || last.customer.archived || last.incomeSource.archived) return null;
  return {
    customerId: last.customerId,
    customerName: last.customer.name,
    customerEmail: last.customer.email,
    incomeSourceId: last.incomeSourceId,
    paymentMethod: last.paymentMethod === "HOTOVOST" ? ("HOTOVOST" as const) : ("PREVOD" as const),
    description: nextMonthDescription(last.lines[0]?.description ?? "Právní služby"),
    lastAmountHalere: last.amountDueHalere,
    lastNumber: last.number,
  };
}

/** Vystaví fakturu s jednou položkou podle poslední faktury – mění se jen popis a částka. */
export async function issueQuickInvoice(input: { description: string; amount: string }, options: { now?: Date } = {}) {
  const defaults = await quickInvoiceDefaults();
  if (!defaults) throw new InvoiceError("Nejdřív vystavte nebo převezměte aspoň jednu fakturu.");
  const [customer, supplier] = await Promise.all([
    prisma.customer.findUniqueOrThrow({ where: { id: defaults.customerId } }),
    prisma.supplierProfile.findUnique({ where: { id: 1 } }),
  ]);
  const issueDate = todayPrague(options.now);
  const parsed = draftSchema.safeParse({
    customerId: defaults.customerId,
    incomeSourceId: defaults.incomeSourceId,
    issueDate,
    dueDate: addDays(issueDate, customer.defaultDueDays ?? supplier?.defaultDueDays ?? 14),
    supplyDate: "",
    paymentMethod: defaults.paymentMethod,
    constantSymbol: "",
    specificSymbol: "",
    note: "",
    lines: [{ description: input.description, quantity: "1", unit: "", unitPrice: input.amount, kind: "STANDARD" }],
  });
  if (!parsed.success) throw new InvoiceError(parsed.error.issues[0]?.message ?? "Neplatné údaje.");
  const draft = await createDraft(parsed.data);
  return issueInvoice(draft.id, options);
}
