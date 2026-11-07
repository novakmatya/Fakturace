"use server";

import { revalidatePath } from "next/cache";
import { userMessage } from "@/lib/errors";
import { importInvoice, importRowSchema, setSeriesStart } from "@/lib/invoices/import";
import { nextMonthDescription } from "@/lib/invoices/quick";
import { formatCzk } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { type ActionResult, toFieldErrors } from "@/lib/validation";

export type ImportValues = {
  customerId: string;
  incomeSourceId: string;
  number: string;
  issueDate: string;
  dueDate: string;
  amount: string;
  description: string;
  paidOn: string;
};
export type ImportState = ActionResult & { values?: ImportValues };

/** Další měsíc v ISO datu (31. 1. → 28./29. 2.). */
function plusMonth(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const year = m === 12 ? y + 1 : y;
  const month = m === 12 ? 1 : m + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/** „2026007“ → „2026008“ (zachová počet číslic). */
function nextNumber(number: string): string {
  const m = /^(.*?)(\d+)$/.exec(number);
  if (!m) return "";
  return m[1] + String(Number(m[2]) + 1).padStart(m[2].length, "0");
}

export async function importInvoiceAction(_prev: ImportState | null, formData: FormData): Promise<ImportState> {
  await requireUser();
  const values: ImportValues = {
    customerId: String(formData.get("customerId") ?? ""),
    incomeSourceId: String(formData.get("incomeSourceId") ?? ""),
    number: String(formData.get("number") ?? ""),
    issueDate: String(formData.get("issueDate") ?? ""),
    dueDate: String(formData.get("dueDate") ?? ""),
    amount: String(formData.get("amount") ?? ""),
    description: String(formData.get("description") ?? ""),
    paidOn: String(formData.get("paidOn") ?? ""),
  };
  const parsed = importRowSchema.safeParse(values);
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error), values };
  const file = formData.get("pdf");
  const pdf = file instanceof File && file.size > 0 ? Buffer.from(await file.arrayBuffer()) : null;
  try {
    await importInvoice({ customerId: values.customerId, incomeSourceId: values.incomeSourceId, row: parsed.data, pdf });
  } catch (error) {
    return { ok: false, error: userMessage(error), values };
  }
  revalidatePath("/faktury/prevzit");
  revalidatePath("/faktury");
  revalidatePath("/");
  // předvyplnit další měsíc – u pravidelné faktury se obvykle mění jen částka
  return {
    ok: true,
    message: `Faktura ${parsed.data.number} (${formatCzk(parsed.data.amount)}) je převzatá. Formulář je připravený na další měsíc.`,
    values: {
      ...values,
      number: nextNumber(values.number),
      issueDate: plusMonth(values.issueDate),
      dueDate: plusMonth(values.dueDate),
      paidOn: values.paidOn ? plusMonth(values.paidOn) : "",
      description: nextMonthDescription(values.description),
      amount: "",
    },
  };
}

export async function seriesStartAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireUser();
  const year = Number(formData.get("year"));
  const next = Number(formData.get("nextNumber"));
  try {
    await setSeriesStart(year, next);
  } catch (error) {
    return { ok: false, error: userMessage(error) };
  }
  revalidatePath("/faktury/prevzit");
  return { ok: true, message: `První faktura vystavená v aplikaci bude mít číslo ${year}${String(next).padStart(4, "0")}.` };
}
