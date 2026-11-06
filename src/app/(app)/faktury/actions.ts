"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
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
    return issueAndRedirect(savedId);
  }
  redirect(`/faktury/${savedId}?ulozeno=1`);
}

async function issueAndRedirect(id: string): Promise<DraftFormState> {
  try {
    await issueInvoice(id);
  } catch (error) {
    revalidatePath(`/faktury/${id}`);
    return { ok: false, error: userMessage(error) };
  }
  // PDF se vyrábí po potvrzení vystavení; když selže, detail nabídne nový pokus.
  try {
    await ensureInvoicePdf(id);
  } catch (error) {
    console.error("Vytvoření PDF selhalo", error);
  }
  revalidatePath("/faktury");
  revalidatePath(`/faktury/${id}`);
  redirect(`/faktury/${id}?vystaveno=1`);
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
