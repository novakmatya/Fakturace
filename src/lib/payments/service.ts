import { z } from "zod";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { isIsoDate, todayPrague } from "@/lib/dates";
import { parseCzkInput } from "@/lib/money";

export class PaymentError extends Error {}

export type PaymentMethod = "PREVOD" | "HOTOVOST" | "JINE";
export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "PREVOD", label: "Převodem na účet" },
  { value: "HOTOVOST", label: "V hotovosti" },
  { value: "JINE", label: "Jinak (karta, zápočet…)" },
];
export const PAYMENT_METHOD_SHORT: Record<string, string> = { PREVOD: "převod", HOTOVOST: "hotovost", JINE: "jinak" };

const MAX_AMOUNT_HALERE = 100_000_000_00; // 100 mil. Kč – ochrana proti překlepu

export const paymentInputSchema = z.object({
  paidOn: z
    .string()
    .trim()
    .refine(isIsoDate, "Zadejte platné datum úhrady."),
  amount: z
    .string()
    .trim()
    .transform((v, ctx) => {
      const halere = parseCzkInput(v);
      if (halere === null || halere <= 0) {
        ctx.addIssue({ code: "custom", message: "Zadejte kladnou částku, např. 1 500 nebo 1 500,50." });
        return z.NEVER;
      }
      if (halere > MAX_AMOUNT_HALERE) {
        ctx.addIssue({ code: "custom", message: "Částka je nepravděpodobně vysoká." });
        return z.NEVER;
      }
      return halere;
    }),
  method: z.enum(["PREVOD", "HOTOVOST", "JINE"]).default("PREVOD"),
  note: z
    .string()
    .trim()
    .max(300, "Nejvýše 300 znaků.")
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .default(null),
});

export type PaymentInput = z.infer<typeof paymentInputSchema>;

/** Součet platných (nestornovaných) úhrad a zbývající částka. */
export function paymentSummary(
  invoice: { amountDueHalere: number },
  payments: { amountHalere: number; cancelledAt: Date | null }[],
) {
  const paid = payments.filter((p) => p.cancelledAt === null).reduce((sum, p) => sum + p.amountHalere, 0);
  const remaining = invoice.amountDueHalere - paid;
  return {
    paidHalere: paid,
    remainingHalere: Math.max(remaining, 0),
    overpaidHalere: Math.max(-remaining, 0),
    fullyPaid: invoice.amountDueHalere > 0 && remaining <= 0,
  };
}

/** Zapíše úhradu k vystavené faktuře. Datum úhrady rozhoduje o roce zdanění. */
export async function recordPayment(
  invoiceId: string,
  input: PaymentInput,
  options: { now?: Date; source?: "MANUAL" | "BANK_IMPORT"; bankReference?: string | null } = {},
) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, number: true, type: true, status: true },
  });
  if (!invoice) throw new PaymentError("Doklad neexistuje.");
  if (!invoice.number) throw new PaymentError("Úhradu lze zapsat jen k vystavenému dokladu.");
  if (invoice.status !== "VYSTAVENA") throw new PaymentError("Ke stornovanému dokladu nelze zapsat úhradu.");
  if (invoice.type !== "FAKTURA") throw new PaymentError("Vrácení peněz k dobropisu přibude s dobropisy.");
  if (input.paidOn > todayPrague(options.now)) throw new PaymentError("Datum úhrady nemůže být v budoucnosti.");

  const payment = await prisma.payment.create({
    data: {
      invoiceId,
      paidOn: input.paidOn,
      amountHalere: input.amount,
      method: input.method,
      note: input.note,
      source: options.source ?? "MANUAL",
      bankReference: options.bankReference ?? null,
    },
  });
  await audit({
    action: "PAYMENT_RECORDED",
    actor: options.source === "BANK_IMPORT" ? "SYSTEM" : "USER",
    entityType: "Payment",
    entityId: payment.id,
    details: { invoiceId, number: invoice.number, paidOn: input.paidOn, amountHalere: input.amount, method: input.method },
  });
  return payment;
}

/** Storno chybně zapsané úhrady. Záznam zůstává v evidenci s důvodem. */
export async function cancelPayment(paymentId: string, reason: string) {
  const trimmed = reason.trim();
  if (!trimmed) throw new PaymentError("Uveďte důvod storna úhrady.");
  if (trimmed.length > 300) throw new PaymentError("Důvod může mít nejvýše 300 znaků.");
  const { count } = await prisma.payment.updateMany({
    where: { id: paymentId, cancelledAt: null },
    data: { cancelledAt: new Date(), cancelReason: trimmed },
  });
  if (count === 0) throw new PaymentError("Úhrada neexistuje nebo už je stornovaná.");
  await audit({ action: "PAYMENT_CANCELLED", entityType: "Payment", entityId: paymentId, details: { reason: trimmed } });
}

export async function listPayments(invoiceId: string) {
  return prisma.payment.findMany({ where: { invoiceId }, orderBy: [{ paidOn: "asc" }, { createdAt: "asc" }] });
}
