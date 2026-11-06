"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AresError, fetchAresCompany } from "@/lib/ares";
import { createCustomer, setCustomerArchived, updateCustomer } from "@/lib/customers";
import { userMessage } from "@/lib/errors";
import { requireUser } from "@/lib/session";
import { type ActionResult, customerSchema, toFieldErrors } from "@/lib/validation";

export type CustomerFormState = ActionResult & { values?: Record<string, string> };

export type AresLookupResult =
  | {
      ok: true;
      company: { ico: string; name: string; dic: string | null; street: string; city: string; zip: string; country: string };
      raw: string;
    }
  | { ok: false; error: string };

export async function lookupAresAction(ico: string): Promise<AresLookupResult> {
  await requireUser();
  try {
    const company = await fetchAresCompany(ico);
    const { raw, ...rest } = company;
    return { ok: true, company: rest, raw: JSON.stringify(raw) };
  } catch (error) {
    if (error instanceof AresError) return { ok: false, error: error.message };
    return { ok: false, error: "Načtení z ARES se nezdařilo." };
  }
}

export async function saveCustomerAction(_prev: CustomerFormState | null, formData: FormData): Promise<CustomerFormState> {
  await requireUser();
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && !key.startsWith("$")) values[key] = value;
  }
  const parsed = customerSchema.safeParse({ ...values, remindersEnabled: values.remindersEnabled === "on" });
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error), values };

  let id = values.id;
  try {
    if (id) {
      await updateCustomer(id, parsed.data);
    } else {
      const aresRaw = values.aresRaw ? (JSON.parse(values.aresRaw) as unknown) : undefined;
      id = (await createCustomer(parsed.data, aresRaw)).id;
    }
  } catch (error) {
    return { ok: false, values, error: userMessage(error) };
  }
  revalidatePath("/odberatele");
  redirect(`/odberatele/${id}?ulozeno=1`);
}

export async function toggleCustomerArchiveAction(formData: FormData) {
  await requireUser();
  const id = String(formData.get("id") ?? "");
  await setCustomerArchived(id, formData.get("archived") === "true");
  revalidatePath("/odberatele");
  revalidatePath(`/odberatele/${id}`);
}
