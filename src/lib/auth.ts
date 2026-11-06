import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins";
import { env, requireSecret } from "@/env";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";

/**
 * Přihlášení: e-mail + heslo, povinné TOTP 2FA se záložními kódy.
 * Aplikace má jediného uživatele: veřejná registrace je vypnutá, účet se zakládá
 * jen průvodcem /instalace s SETUP_TOKEN a databázový trigger druhý účet odmítne.
 */
function createAuth() {
  return betterAuth({
    appName: "Fakturace",
    baseURL: env.APP_URL,
    secret: requireSecret("BETTER_AUTH_SECRET"),
    trustedOrigins: [env.APP_URL],
    database: prismaAdapter(prisma, { provider: "sqlite" }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    session: {
      expiresIn: 60 * 60 * 12, // absolutně 12 hodin
      updateAge: 60 * 15,
      freshAge: 60 * 10,
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 15 * 60, max: 10 },
        "/two-factor/verify-totp": { window: 15 * 60, max: 10 },
        "/two-factor/verify-backup-code": { window: 15 * 60, max: 10 },
      },
    },
    advanced: {
      useSecureCookies: env.NODE_ENV === "production",
      defaultCookieAttributes: { sameSite: "lax", httpOnly: true },
    },
    databaseHooks: {
      session: {
        create: {
          after: async (session) => {
            await audit({
              action: "SESSION_CREATED",
              entityType: "user",
              entityId: session.userId,
              details: { ipAddress: session.ipAddress ?? null, userAgent: session.userAgent ?? null },
            });
          },
        },
      },
    },
    plugins: [
      twoFactor({
        issuer: "Fakturace",
        backupCodeOptions: { amount: 10, length: 10 },
      }),
      // nextCookies zapisuje cookies přes next/headers – mimo Next (testy) není k dispozici.
      ...(env.NODE_ENV === "test" ? [] : [nextCookies()]),
    ],
  });
}

type Auth = ReturnType<typeof createAuth>;

let instance: Auth | undefined;

/** Instance se vytváří líně, aby build nepotřeboval produkční tajemství. */
export function getAuth(): Auth {
  instance ??= createAuth();
  return instance;
}

export type Session = Auth["$Infer"]["Session"];
