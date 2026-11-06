"use server";

import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/session";

/** Zapíše do auditu, že bylo zapnuto 2FA (ověřuje se na serveru podle relace). */
export async function recordTwoFactorEnabled() {
  const session = await requireUser({ allowWithoutTwoFactor: true });
  if (session.user.twoFactorEnabled) {
    await audit({ action: "TWO_FACTOR_ENABLED", entityType: "user", entityId: session.user.id });
  }
}
