import "server-only";
import { headers } from "next/headers";
import { audit } from "@/lib/audit";
import { getAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

export type StepUpResult = { ok: true } | { ok: false; message: string };

/**
 * Opětovné ověření kódem 2FA pro citlivé akce (změna účtu, export…).
 * Neúspěšné pokusy se počítají v audit logu: po 5 chybách za 15 minut se další pokusy odmítají.
 */
export async function verifyStepUp(code: string, action: string): Promise<StepUpResult> {
  const since = new Date(Date.now() - WINDOW_MS);
  const failures = await prisma.auditLog.count({ where: { action: "STEP_UP_FAILED", at: { gte: since } } });
  if (failures >= MAX_FAILURES) {
    return { ok: false, message: "Příliš mnoho chybných kódů. Zkuste to znovu za 15 minut." };
  }
  const clean = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return { ok: false, message: "Zadejte šestimístný kód z ověřovací aplikace." };
  try {
    await getAuth().api.verifyTOTP({ body: { code: clean }, headers: await headers() });
  } catch {
    await audit({ action: "STEP_UP_FAILED", details: { for: action } });
    return { ok: false, message: "Kód nesouhlasí." };
  }
  await audit({ action: "STEP_UP_OK", details: { for: action } });
  return { ok: true };
}
