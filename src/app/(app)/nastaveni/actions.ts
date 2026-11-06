"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { userMessage } from "@/lib/errors";
import { requireUser } from "@/lib/session";
import {
  createIncomeSource,
  saveSupplier,
  setIncomeSourceArchived,
  supplierBankChanged,
  updateAppSettings,
  updateIncomeSource,
} from "@/lib/settings";
import { verifyStepUp } from "@/lib/step-up";
import { type ActionResult, incomeSourceSchema, supplierSchema, toFieldErrors } from "@/lib/validation";

export type FormState = ActionResult & { values?: Record<string, string>; requireTotp?: boolean };

function formValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && !key.startsWith("$")) values[key] = value;
  }
  return values;
}

export async function saveSupplierAction(_prev: FormState | null, formData: FormData): Promise<FormState> {
  await requireUser();
  const values = formValues(formData);
  const parsed = supplierSchema.safeParse(values);
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error), values };

  if (await supplierBankChanged(parsed.data)) {
    const code = values.totpCode ?? "";
    if (!code) {
      return {
        ok: false,
        requireTotp: true,
        values,
        error: "Měníte platební údaje. Pro potvrzení zadejte kód z ověřovací aplikace.",
      };
    }
    const check = await verifyStepUp(code, "BANK_ACCOUNT_CHANGE");
    if (!check.ok) return { ok: false, requireTotp: true, values, fieldErrors: { totpCode: check.message } };
  }

  try {
    await saveSupplier(parsed.data);
  } catch (error) {
    return { ok: false, values, error: userMessage(error) };
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Údaje dodavatele jsou uložené." };
}

export async function saveAppSettingsAction(_prev: FormState | null, formData: FormData): Promise<FormState> {
  await requireUser();
  await updateAppSettings({ roundInvoiceTotal: formData.get("roundInvoiceTotal") === "on" });
  revalidatePath("/nastaveni");
  return { ok: true, message: "Nastavení je uložené." };
}

export async function saveIncomeSourceAction(_prev: FormState | null, formData: FormData): Promise<FormState> {
  await requireUser();
  const values = formValues(formData);
  const parsed = incomeSourceSchema.safeParse({
    ...values,
    printIco: values.printIco === "on",
    printRegisterText: values.printRegisterText === "on",
  });
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error), values };
  const id = values.id;
  try {
    if (id) await updateIncomeSource(id, parsed.data);
    else await createIncomeSource(parsed.data);
  } catch (error) {
    return { ok: false, values, error: userMessage(error) };
  }
  revalidatePath("/nastaveni/cinnosti");
  if (id) redirect("/nastaveni/cinnosti");
  return { ok: true, message: `Činnost „${parsed.data.name}“ je uložená.` };
}

export async function toggleIncomeSourceArchiveAction(formData: FormData) {
  await requireUser();
  const id = String(formData.get("id") ?? "");
  await setIncomeSourceArchived(id, formData.get("archived") === "true");
  revalidatePath("/nastaveni/cinnosti");
}
