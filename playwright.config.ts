import os from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

// E2E běží proti produkčnímu buildu (`next build` předem) s čistou databází.
// S E2E_BASE_URL běží proti už spuštěné instanci (např. kontejneru) – ta musí
// být čerstvá (bez účtu) a mít SETUP_TOKEN shodný s E2E_SETUP_TOKEN.
const port = 3100;
const mockEmailPort = 3101; // napodobenina Gmail skriptu – e-maily se nikam neposílají
const dataDir = path.join(os.tmpdir(), `fakturace-e2e-${process.pid}`);
const externalBaseUrl = process.env.E2E_BASE_URL;
const E2E_SETUP_TOKEN = process.env.E2E_SETUP_TOKEN ?? "e2e-setup-token-0123456789";
const E2E_GMAIL_SECRET = process.env.E2E_GMAIL_SECRET ?? "e2e-gmail-secret-0123456789-abcdef";

const mockEmail = {
  command: `node tests/helpers/mock-email.mjs ${mockEmailPort}`,
  url: `http://127.0.0.1:${mockEmailPort}/__messages`,
  reuseExistingServer: false,
  timeout: 30_000,
  env: { MOCK_GMAIL_SECRET: E2E_GMAIL_SECRET },
};

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  outputDir: path.join(os.tmpdir(), "fakturace-e2e-results"),
  use: {
    baseURL: externalBaseUrl ?? `http://localhost:${port}`,
    locale: "cs-CZ",
    timezoneId: "Europe/Prague",
    launchOptions: process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : undefined,
  },
  webServer: externalBaseUrl
    ? [mockEmail]
    : [
        mockEmail,
        {
          command: `rm -rf ${dataDir} && node scripts/migrate.mjs && npx next start -p ${port}`,
          url: `http://localhost:${port}/prihlaseni`,
          reuseExistingServer: false,
          timeout: 120_000,
          env: {
            DATA_DIR: dataDir,
            APP_URL: `http://localhost:${port}`,
            BETTER_AUTH_SECRET: "e2e-secret-0123456789-e2e-secret-0123456789",
            SETUP_TOKEN: E2E_SETUP_TOKEN,
            GMAIL_RELAY_URL: `http://127.0.0.1:${mockEmailPort}/gmail/exec`,
            GMAIL_RELAY_SECRET: E2E_GMAIL_SECRET,
            MAIL_FROM: "Jan Novák <jan.novak@gmail.com>",
          },
        },
      ],
});
