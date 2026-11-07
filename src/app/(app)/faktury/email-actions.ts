"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseAddressList } from "@/lib/email/address";
import { queueInvoiceEmail } from "@/lib/email/invoice-email";
import { kickOutboxAfterResponse } from "@/lib/email/kick";
import { cancelQueuedEmail } from "@/lib/email/outbox";
import { BODY_MAX, SUBJECT_MAX } from "@/lib/email/templates";
import { userMessage } from "@/lib/errors";
import { requireUser } from "@/lib/session";
import type { ActionResult, FieldErrors } from "@/lib/validation";

export type SendFormValues = { to: string; cc: string; subject: string; body: string };
export type SendFormState = ActionResult & { values?: SendFormValues };

export async function sendInvoiceEmailAction(_prev: SendFormState | null, formData: FormData): Promise<SendFormState> {
  await requireUser();
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const values: SendFormValues = {
    to: String(formData.get("to") ?? ""),
    cc: String(formData.get("cc") ?? ""),
    subject: String(formData.get("subject") ?? "").replace(/[\r\n]+/g, " ").trim(),
    body: String(formData.get("body") ?? "").replace(/\r\n/g, "\n").trim(),
  };

  const fieldErrors: FieldErrors = {};
  const to = parseAddressList(values.to, { required: true });
  if (!to.ok) fieldErrors.to = to.error;
  const cc = parseAddressList(values.cc);
  if (!cc.ok) fieldErrors.cc = cc.error;
  if (!values.subject) fieldErrors.subject = "Vyplňte předmět.";
  else if (values.subject.length > SUBJECT_MAX) fieldErrors.subject = `Nejvýše ${SUBJECT_MAX} znaků.`;
  if (!values.body) fieldErrors.body = "Vyplňte text e-mailu.";
  else if (values.body.length > BODY_MAX) fieldErrors.body = `Nejvýše ${BODY_MAX} znaků.`;
  if (!to.ok || !cc.ok || Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors, values };

  try {
    await queueInvoiceEmail(invoiceId, {
      to: to.addresses,
      cc: cc.addresses,
      subject: values.subject,
      body: values.body,
    });
  } catch (error) {
    return { ok: false, error: userMessage(error), values };
  }
  kickOutboxAfterResponse();
  revalidatePath("/faktury");
  revalidatePath(`/faktury/${invoiceId}`);
  redirect(`/faktury/${invoiceId}?email=fronta`);
}

export async function cancelEmailAction(formData: FormData) {
  await requireUser();
  const id = String(formData.get("emailId") ?? "");
  const invoiceId = String(formData.get("invoiceId") ?? "");
  await cancelQueuedEmail(id);
  revalidatePath(`/faktury/${invoiceId}`);
}
