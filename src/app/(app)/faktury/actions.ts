"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseAddressList } from "@/lib/email/address";
import { buildInvoiceEmailDraft, queueInvoiceEmail } from "@/lib/email/invoice-email";
import { kickOutboxAfterResponse } from "@/lib/email/kick";
import { userMessage } from "@/lib/errors";
import { ensureInvoicePdf } from "@/lib/invoices/documents";
import { draftSchema } from "@/lib/invoices/draft-schema";
import { createDraft, deleteDraft, issueInvoice, updateDraft } from "@/lib/invoices/service";
import { requireUser } from "@/lib/session";
import { type ActionResult, toFieldErrors } from "@/lib/validation";

export type DraftFormState = ActionResult<{ id: string }>;

export async function saveDraftAction(_prev: DraftFormState | null, formData: FormData): Promise<DraftFormState> {
  await requireUser();
  let payload: unknown;
  try {
    payload = JSON.parse(String(formData.get("payload") ?? ""));
  } catch {
    return { ok: false, error: "Formulář se nepodařilo zpracovat." };
  }
  const parsed = draftSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error) };

  const id = String(formData.get("id") ?? "");
  let savedId: string;
  try {
    savedId = id ? (await updateDraft(id, parsed.data)).id : (await createDraft(parsed.data)).id;
  } catch (error) {
    return { ok: false, error: userMessage(error) };
  }
  revalidatePath("/faktury");
  if (formData.get("intent") === "issue") {
    return issueAndRedirect(savedId, { send: formData.get("sendAfterIssue") === "on" });
  }
  redirect(`/faktury/${savedId}?ulozeno=1`);
}

/** Zařadí e-mail s fakturou podle šablony na adresy z karty odběratele. */
async function queueAutomaticEmail(id: string): Promise<boolean> {
  try {
    const draft = await buildInvoiceEmailDraft(id);
    const to = parseAddressList(draft.to, { required: true });
    const cc = parseAddressList(draft.cc);
    if (!to.ok || !cc.ok) return false;
    await queueInvoiceEmail(id, { to: to.addresses, cc: cc.addresses, subject: draft.subject, body: draft.body, auto: true });
    kickOutboxAfterResponse();
    return true;
  } catch (error) {
    console.error("Zařazení e-mailu po vystavení selhalo", error);
    return false;
  }
}

async function issueAndRedirect(id: string, options: { send?: boolean } = {}): Promise<DraftFormState> {
  try {
    await issueInvoice(id);
  } catch (error) {
    revalidatePath(`/faktury/${id}`);
    return { ok: false, error: userMessage(error) };
  }
  return finishIssued(id, options);
}

async function finishIssued(id: string, options: { send?: boolean } = {}): Promise<DraftFormState> {
  // PDF se vyrábí po potvrzení vystavení; když selže, detail nabídne nový pokus.
  let pdfReady = false;
  try {
    await ensureInvoicePdf(id);
    pdfReady = true;
  } catch (error) {
    console.error("Vytvoření PDF selhalo", error);
  }
  let emailFlag = "";
  if (options.send) {
    emailFlag = pdfReady && (await queueAutomaticEmail(id)) ? "&email=fronta" : "&email=chyba";
  }
  revalidatePath("/faktury");
  revalidatePath(`/faktury/${id}`);
  redirect(`/faktury/${id}?vystaveno=1${emailFlag}`);
}

export async function issueInvoiceAction(_prev: DraftFormState | null, formData: FormData): Promise<DraftFormState> {
  await requireUser();
  return issueAndRedirect(String(formData.get("id") ?? ""));
}

export async function deleteDraftAction(formData: FormData) {
  await requireUser();
  const id = String(formData.get("id") ?? "");
  await deleteDraft(id);
  revalidatePath("/faktury");
  redirect("/faktury?smazano=1");
}

export async function regeneratePdfAction(formData: FormData) {
  await requireUser();
  const id = String(formData.get("id") ?? "");
  await ensureInvoicePdf(id);
  revalidatePath(`/faktury/${id}`);
}

/** Rychlá měsíční faktura z přehledu: stejný odběratel a činnost, nový popis a částka. */
export async function quickInvoiceAction(_prev: DraftFormState | null, formData: FormData): Promise<DraftFormState> {
  await requireUser();
  let id: string;
  try {
    const { issueQuickInvoice } = await import("@/lib/invoices/quick");
    const invoice = await issueQuickInvoice({
      description: String(formData.get("description") ?? ""),
      amount: String(formData.get("amount") ?? ""),
    });
    id = invoice.id;
  } catch (error) {
    return { ok: false, error: userMessage(error) };
  }
  // vystaveno – zbytek (PDF, e-mail, přesměrování) jako u běžné faktury
  return finishIssued(id, { send: formData.get("send") === "on" });
}
