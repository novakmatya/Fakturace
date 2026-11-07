"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { todayPrague } from "@/lib/dates";
import { userMessage } from "@/lib/errors";
import { formatCzk } from "@/lib/money";
import { cancelPayment, listPayments, paymentInputSchema, paymentSummary, recordPayment } from "@/lib/payments/service";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { type ActionResult, toFieldErrors } from "@/lib/validation";

function refresh(invoiceId: string) {
  revalidatePath(`/faktury/${invoiceId}`);
  revalidatePath("/faktury");
  revalidatePath("/");
}

export async function recordPaymentAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireUser();
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const parsed = paymentInputSchema.safeParse({
    paidOn: String(formData.get("paidOn") ?? ""),
    amount: String(formData.get("amount") ?? ""),
    method: String(formData.get("method") ?? "PREVOD"),
    note: String(formData.get("note") ?? ""),
  });
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  try {
    await recordPayment(invoiceId, parsed.data);
  } catch (error) {
    return { ok: false, error: userMessage(error) };
  }
  refresh(invoiceId);
  return { ok: true, message: `Úhrada ${formatCzk(parsed.data.amount)} je zapsaná.` };
}

/** Jedním klikem: zbývající částka uhrazená dnes způsobem z faktury. */
export async function payInFullTodayAction(formData: FormData) {
  await requireUser();
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { amountDueHalere: true, paymentMethod: true } });
  if (!invoice) return;
  const { remainingHalere } = paymentSummary(invoice, await listPayments(invoiceId));
  if (remainingHalere <= 0) return;
  await recordPayment(invoiceId, {
    paidOn: todayPrague(),
    amount: remainingHalere,
    method: invoice.paymentMethod === "HOTOVOST" ? "HOTOVOST" : "PREVOD",
    note: null,
  });
  refresh(invoiceId);
  redirect(`/faktury/${invoiceId}?uhrazeno=1`);
}

export async function cancelPaymentAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireUser();
  const invoiceId = String(formData.get("invoiceId") ?? "");
  try {
    await cancelPayment(String(formData.get("paymentId") ?? ""), String(formData.get("reason") ?? ""));
  } catch (error) {
    return { ok: false, error: userMessage(error) };
  }
  refresh(invoiceId);
  return { ok: true, message: "Úhrada je stornovaná." };
}
