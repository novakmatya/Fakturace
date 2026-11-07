import { z } from "zod";

/**
 * Konfigurace z proměnných prostředí. Tajné hodnoty jsou jen v .env / v nastavení
 * hostingu, nikdy v kódu ani v prohlížeči (žádný prefix NEXT_PUBLIC_).
 * Načítá se líně a tajemství se ověřují až při použití, takže `next build`
 * produkční tajemství nepotřebuje. Při startu serveru se ověří vše (assertRuntimeEnv).
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATA_DIR: z.string().min(1).default("./data"),
  APP_URL: z.url().default("http://localhost:3000"),
  BETTER_AUTH_SECRET: z.string().optional(),
  SETUP_TOKEN: z.string().optional(),
  ARES_BASE_URL: z
    .url()
    .default("https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty"),
  // E-maily jdou přes HTTPS (Railway Hobby odchozí SMTP blokuje):
  // a) Gmail – webová aplikace Google Apps Script ve vašem účtu (bez vlastní domény),
  // b) Resend – HTTPS API, vyžaduje ověřenou vlastní doménu.
  GMAIL_RELAY_URL: z.url().optional(),
  GMAIL_RELAY_SECRET: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  RESEND_API_URL: z.url().default("https://api.resend.com"),
  MAIL_FROM: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

const SECRET_RULES = {
  BETTER_AUTH_SECRET: { min: 32, hint: "openssl rand -base64 32" },
  SETUP_TOKEN: { min: 16, hint: "openssl rand -hex 16" },
} as const;

type SecretName = keyof typeof SECRET_RULES;

let cached: Env | undefined;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Neplatná konfigurace prostředí:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Vrátí tajemství a ověří jeho délku. Chybějící tajemství je chyba konfigurace. */
export function requireSecret(name: SecretName): string {
  const value = getEnv()[name];
  const rule = SECRET_RULES[name];
  if (!value || value.length < rule.min) {
    throw new Error(`${name} chybí nebo je kratší než ${rule.min} znaků (vygenerujte: ${rule.hint}).`);
  }
  return value;
}

/** Ověří celou konfiguraci při startu serveru, aby chyba nebyla až u prvního požadavku. */
export function assertRuntimeEnv(): void {
  getEnv();
  (Object.keys(SECRET_RULES) as SecretName[]).forEach(requireSecret);
}

/** Jen pro testy: vynutí nové načtení po změně process.env. */
export function resetEnvCache() {
  cached = undefined;
}

export const env: Env = new Proxy({} as Env, {
  get(_target, key: string) {
    return getEnv()[key as keyof Env];
  },
});
