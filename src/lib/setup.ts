import crypto from "node:crypto";
import { z } from "zod";
import { requireSecret } from "@/env";
import { audit } from "@/lib/audit";
import { getAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function isSetupDone(): Promise<boolean> {
  return (await prisma.user.count()) > 0;
}

export const setupSchema = z.object({
  name: z.string().trim().min(2, "Zadejte jméno.").max(120),
  email: z.email("Zadejte platný e-mail.").trim().toLowerCase(),
  password: z
    .string()
    .min(12, "Heslo musí mít alespoň 12 znaků.")
    .max(128, "Heslo je příliš dlouhé."),
  setupToken: z.string().min(1, "Zadejte instalační kód."),
});

function tokensMatch(given: string, expected: string): boolean {
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

export class SetupError extends Error {}

/** Založí jediný účet aplikace. Bez platného SETUP_TOKEN a po prvním účtu selže. */
export async function createOwnerAccount(input: z.infer<typeof setupSchema>) {
  const data = setupSchema.parse(input);
  if (!tokensMatch(data.setupToken, requireSecret("SETUP_TOKEN"))) {
    throw new SetupError("Neplatný instalační kód.");
  }
  if (await isSetupDone()) {
    throw new SetupError("Účet už existuje. Aplikace má jediného uživatele.");
  }
  const ctx = await getAuth().$context;
  const passwordHash = await ctx.password.hash(data.password);
  const user = await ctx.internalAdapter.createUser(
    { email: data.email, name: data.name, emailVerified: true },
    { method: "admin" },
  );
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: passwordHash,
  });
  await audit({ action: "ACCOUNT_CREATED", entityType: "user", entityId: user.id });
  return { id: user.id, email: user.email };
}
