"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { emailConfig } from "@/lib/email/config";
import { queueTestEmail } from "@/lib/email/invoice-email";
import { kickOutboxAfterResponse } from "@/lib/email/kick";
import { resetTemplate, saveTemplate, TEMPLATE_KEYS, type TemplateKey, TemplateError } from "@/lib/email/templates";
import { pingGmailRelay } from "@/lib/email/transport";
import { userMessage } from "@/lib/errors";
import { requireUser } from "@/lib/session";
import { getSupplier, updateAppSettings } from "@/lib/settings";
import { z } from "zod";
import { type ActionResult, toFieldErrors } from "@/lib/validation";

function templateKey(formData: FormData): TemplateKey {
  const key = String(formData.get("key") ?? "");
  if (!(TEMPLATE_KEYS as readonly string[]).includes(key)) throw new Error("Neznámá šablona.");
  return key as TemplateKey;
}

export async function saveEmailSettingsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireUser();
  await updateAppSettings({
    emailAutoSendOnIssue: formData.get("emailAutoSendOnIssue") === "on",
    emailBccSelf: formData.get("emailBccSelf") === "on",
  });
  revalidatePath("/nastaveni/emaily");
  return { ok: true, message: "Nastavení e-mailů je uložené." };
}

export async function saveTemplateAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireUser();
  const key = templateKey(formData);
  try {
    await saveTemplate(key, {
      subject: String(formData.get("subject") ?? ""),
      body: String(formData.get("body") ?? ""),
    });
  } catch (error) {
    return { ok: false, error: error instanceof TemplateError ? error.message : userMessage(error) };
  }
  revalidatePath("/nastaveni/emaily");
  redirect(`/nastaveni/emaily?sablona=ulozena&klic=${key}`);
}

export async function resetTemplateAction(formData: FormData) {
  await requireUser();
  const key = templateKey(formData);
  await resetTemplate(key);
  revalidatePath("/nastaveni/emaily");
  redirect(`/nastaveni/emaily?sablona=vychozi&klic=${key}`);
}

export async function sendTestEmailAction() {
  await requireUser();
  const supplier = await getSupplier();
  if (!supplier?.email) redirect("/nastaveni/emaily?test=bez-adresy");
  try {
    await queueTestEmail(supplier.email);
  } catch {
    redirect("/nastaveni/emaily?test=chyba");
  }
  kickOutboxAfterResponse();
  redirect("/nastaveni/emaily?test=odeslano");
}

export async function pingRelayAction(): Promise<ActionResult> {
  await requireUser();
  const config = emailConfig();
  if (config.mode !== "gmail") return { ok: false, error: "Gmail není nastavený." };
  const result = await pingGmailRelay(config);
  if (!result.ok) return { ok: false, error: result.error };
  return {
    ok: true,
    message:
      result.remaining === null
        ? "Spojení se skriptem funguje."
        : `Spojení se skriptem funguje. Dnes můžete odeslat ještě ${result.remaining} e-mailů.`,
  };
}

const reminderSettingsSchema = z.object({
  remindersAuto: z.boolean(),
  reminderFirstDays: z.coerce.number().int("Celé číslo.").min(1, "Nejméně 1 den.").max(90, "Nejvýše 90 dní."),
  reminderRepeatDays: z.coerce.number().int("Celé číslo.").min(0, "Nejméně 0.").max(90, "Nejvýše 90 dní."),
  reminderMaxCount: z.coerce.number().int("Celé číslo.").min(1, "Nejméně 1.").max(10, "Nejvýše 10."),
});

export async function saveReminderSettingsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireUser();
  const parsed = reminderSettingsSchema.safeParse({
    remindersAuto: formData.get("remindersAuto") === "on",
    reminderFirstDays: formData.get("reminderFirstDays"),
    reminderRepeatDays: formData.get("reminderRepeatDays"),
    reminderMaxCount: formData.get("reminderMaxCount"),
  });
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  await updateAppSettings(parsed.data);
  revalidatePath("/nastaveni/emaily");
  return {
    ok: true,
    message: parsed.data.remindersAuto ? "Automatické upomínky jsou zapnuté." : "Nastavení upomínek je uložené (automatika vypnutá).",
  };
}
