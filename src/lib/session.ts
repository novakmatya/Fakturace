import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";

export async function getSession() {
  return getAuth().api.getSession({ headers: await headers() });
}

/**
 * Vyžaduje přihlášeného uživatele s aktivním 2FA. Volá se v každé stránce,
 * server action i API route – layout sám akce nechrání.
 */
export async function requireUser(options: { allowWithoutTwoFactor?: boolean } = {}) {
  const session = await getSession();
  if (!session) redirect("/prihlaseni");
  if (!session.user.twoFactorEnabled && !options.allowWithoutTwoFactor) redirect("/zabezpeceni");
  return session;
}
