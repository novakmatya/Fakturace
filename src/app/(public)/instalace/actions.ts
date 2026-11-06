"use server";

import { redirect } from "next/navigation";
import { createOwnerAccount, SetupError, setupSchema } from "@/lib/setup";
import { type ActionResult, toFieldErrors } from "@/lib/validation";

export async function setupAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = setupSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    setupToken: formData.get("setupToken"),
  });
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  if (parsed.data.password !== formData.get("passwordConfirm")) {
    return { ok: false, fieldErrors: { passwordConfirm: "Hesla se neshodují." } };
  }
  try {
    await createOwnerAccount(parsed.data);
  } catch (error) {
    if (error instanceof SetupError) return { ok: false, error: error.message };
    throw error;
  }
  redirect("/prihlaseni?ucet=vytvoren");
}
