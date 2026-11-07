import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, request, test } from "@playwright/test";
import { totpFromUri } from "../helpers/totp";

const OWNER = { name: "Jan Novák", email: "jan@example.cz", password: "velmi-dlouhe-heslo-2026" };
const shots = process.env.E2E_SCREENSHOTS ?? path.join(os.tmpdir(), "fakturace-e2e-screens");
fs.mkdirSync(shots, { recursive: true });

test("od instalace k vystavené faktuře s PDF", async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());
  await page.setViewportSize({ width: 1280, height: 900 });

  // 1) Instalace jediného účtu
  await page.goto("/");
  await expect(page).toHaveURL(/\/instalace/);
  await page.getByLabel("Jméno").fill(OWNER.name);
  await page.getByLabel("E-mail pro přihlášení").fill(OWNER.email);
  await page.getByLabel("Heslo", { exact: true }).fill(OWNER.password);
  await page.getByLabel("Heslo znovu").fill(OWNER.password);
  await page.getByLabel("Instalační kód").fill(process.env.E2E_SETUP_TOKEN ?? "e2e-setup-token-0123456789");
  await page.screenshot({ path: path.join(shots, "01-instalace.png") });
  await page.getByRole("button", { name: "Založit účet" }).click();

  // 2) Přihlášení
  await expect(page).toHaveURL(/\/prihlaseni/);
  await page.getByLabel("E-mail").fill(OWNER.email);
  await page.getByLabel("Heslo").fill(OWNER.password);
  await page.getByRole("button", { name: "Pokračovat" }).click();

  // 3) Povinné 2FA
  await expect(page).toHaveURL(/\/zabezpeceni/);
  await page.getByLabel("Potvrďte heslo").fill(OWNER.password);
  await page.getByRole("button", { name: "Pokračovat" }).click();
  const secret = (await page.locator("code").first().textContent())?.trim() ?? "";
  expect(secret).toMatch(/^[A-Z2-7]+=*$/);
  await page.screenshot({ path: path.join(shots, "02-2fa.png") });
  await page.getByLabel("Kód z aplikace").fill(totpFromUri(`otpauth://totp/x?secret=${secret}`));
  await page.getByRole("button", { name: "Zapnout dvoufázové ověření" }).click();
  await expect(page.getByText("Dvoufázové ověření je zapnuté.")).toBeVisible();
  await page.getByLabel(/Kódy mám bezpečně uložené/).check();
  await page.getByRole("button", { name: "Pokračovat do aplikace" }).click();
  await expect(page.getByRole("heading", { name: /Dobrý den, Jan/ })).toBeVisible();
  await page.screenshot({ path: path.join(shots, "03-prehled.png") });

  // 4) Dodavatel
  await page.getByRole("link", { name: "Nastavení" }).first().click();
  await page.getByLabel("Jméno a příjmení / obchodní firma").fill(OWNER.name);
  await page.getByLabel("Ulice a číslo").fill("Vinohradská 1511/230");
  await page.getByLabel("PSČ").fill("10000");
  await page.getByLabel("Obec").fill("Praha 10");
  await page.getByLabel("IČO").fill("12345679");
  await page.getByLabel("Údaj o zápisu do evidence").fill("Fyzická osoba zapsaná v živnostenském rejstříku.");
  await page.getByLabel("Číslo účtu").fill("19-2000145399/0800");
  await page.getByLabel("E-mail").fill(OWNER.email);
  await page.getByRole("button", { name: "Uložit údaje dodavatele" }).click();
  await expect(page.getByText("Údaje dodavatele jsou uložené.")).toBeVisible();
  await page.screenshot({ path: path.join(shots, "04-nastaveni.png"), fullPage: true });

  // 5) Činnost § 7
  await page.goto("/nastaveni/cinnosti");
  await page.getByLabel("Název činnosti").fill("Právní konzultace");
  await page.getByRole("button", { name: "Přidat činnost" }).click();
  await expect(page.getByText("Činnost „Právní konzultace“ je uložená.")).toBeVisible();

  // 6) Odběratel (ARES je v testu nedostupný – ruční zadání)
  await page.goto("/odberatele/novy");
  await page.getByLabel("IČO").fill("87654326");
  await page.getByLabel("Název").fill("Žluťoučká s.r.o.");
  await page.getByLabel("Ulice a číslo").fill("Jankovcova 1522/53");
  await page.getByLabel("PSČ").fill("17000");
  await page.getByLabel("Obec").fill("Praha 7");
  await page.getByLabel("E-mail pro faktury").fill("fakturace@example.cz");
  await page.getByRole("button", { name: "Uložit odběratele" }).click();
  await expect(page.getByText("Odběratel je uložený.")).toBeVisible();

  // 7) Faktura: koncept → vystavení
  await page.getByRole("link", { name: "Nová faktura" }).first().click();
  await expect(page.getByRole("heading", { name: "Nová faktura" })).toBeVisible();
  await page.getByLabel("Činnost (druh příjmu)").selectOption({ label: "Právní konzultace (§ 7)" });
  await page.getByLabel("Popis položky").fill("Revize nájemní smlouvy");
  await page.getByLabel("Množství").fill("2");
  await page.getByLabel("Jednotka").fill("hod");
  await page.getByLabel("Cena za jednotku").fill("1 500");
  await expect(page.getByText("3 000,00 Kč").first()).toBeVisible();
  // Odběratel má e-mail, odesílání je zapnuté → výchozí volba je vystavit a rovnou odeslat.
  await expect(page.getByLabel(/Po vystavení odeslat e-mailem/)).toBeChecked();
  await page.screenshot({ path: path.join(shots, "05-nova-faktura.png"), fullPage: true });
  const issuedAt = Date.now();
  await page.getByRole("button", { name: "Vystavit a odeslat" }).click();

  await expect(page.getByText(/Faktura \d{8} je vystavená/)).toBeVisible();
  const heading = await page.getByRole("heading", { level: 1 }).textContent();
  const number = heading?.match(/\d{8}/)?.[0];
  const pragueYear = new Intl.DateTimeFormat("en", { timeZone: "Europe/Prague", year: "numeric" }).format(new Date());
  expect(number).toBe(`${pragueYear}0001`);
  await page.screenshot({ path: path.join(shots, "06-faktura.png"), fullPage: true });

  // 8) Akceptační kritérium: e-mail s PDF odejde do 1 minuty od vystavení
  await expect(page.getByText("Odesláno", { exact: true })).toBeVisible({ timeout: 60_000 });
  expect(Date.now() - issuedAt).toBeLessThan(60_000);
  await expect(page.getByText("Odeslána", { exact: true })).toBeVisible();
  const mockUrl = process.env.E2E_MOCK_EMAIL_URL ?? "http://127.0.0.1:3101";
  const mailboxContext = await request.newContext();
  const messages = (await (await mailboxContext.get(`${mockUrl}/__messages`)).json()) as {
    channel: string;
    body: { to: string[]; subject: string; fromName: string; attachment: { filename: string; content: string } };
  }[];
  await mailboxContext.dispose();
  const mail = messages.find((m) => m.body.subject.includes(number!));
  expect(mail, "e-mail s fakturou dorazil do (napodobeného) Gmail skriptu").toBeTruthy();
  expect(mail!.channel).toBe("gmail");
  expect(mail!.body.fromName).toBe("Jan Novák");
  expect(mail!.body.to).toEqual(["fakturace@example.cz"]);
  expect(mail!.body.attachment.filename).toBe(`Faktura-${number}.pdf`);
  expect(Buffer.from(mail!.body.attachment.content, "base64").subarray(0, 5).toString()).toBe("%PDF-");
  await page.screenshot({ path: path.join(shots, "07-odeslano.png"), fullPage: true });
  const invoiceUrl = page.url();

  await page.goto("/nastaveni/emaily");
  await expect(page.getByRole("heading", { name: "E-maily", level: 1 })).toBeVisible();
  await page.screenshot({ path: path.join(shots, "08-nastaveni-emaily.png"), fullPage: true });
  await page.goto(invoiceUrl);

  // 9) PDF je dostupné jen přihlášenému
  const href = await page.getByRole("link", { name: "Stáhnout PDF" }).getAttribute("href");
  const pdf = await page.request.get(href!);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  const anonymousContext = await request.newContext();
  const anonymous = await anonymousContext.get(new URL(href!, page.url()).toString());
  expect(anonymous.status()).toBe(401);
  await anonymousContext.dispose();

  // 10) Úhrada jedním klikem → stav Uhrazena, příjem v přehledu podle data úhrady
  await page.getByRole("button", { name: /Uhrazeno dnes/ }).click();
  await expect(page.getByText("Uhrazena", { exact: true })).toBeVisible();
  await expect(page.getByText("Uhrazeno v plné výši")).toBeVisible();
  await page.screenshot({ path: path.join(shots, "09-uhrazeno.png"), fullPage: true });
  await page.getByRole("link", { name: "Přehled" }).first().click();
  await expect(page.getByText(`Přijato ${pragueYear}`)).toBeVisible();
  await expect(page.getByText("3 000,00 Kč").first()).toBeVisible();
  await page.screenshot({ path: path.join(shots, "10-prehled.png"), fullPage: true });

  // 11) Další měsíc jedním formulářem: stejný odběratel, jen nová částka
  await expect(page.getByRole("heading", { name: /Nová faktura pro Žluťoučká/ })).toBeVisible();
  await page.getByLabel("Částka (Kč)").fill("2 500");
  await page.getByRole("button", { name: "Vystavit a odeslat" }).click();
  await expect(page.getByText(`Faktura ${pragueYear}0002 je vystavená`)).toBeVisible();

  // 12) Převzetí starší faktury vystavené mimo aplikaci
  await page.goto("/faktury/prevzit");
  await page.getByLabel("Číslo faktury").fill("2025012");
  await page.getByLabel("Vystaveno").fill("2025-12-01");
  await page.getByLabel("Splatnost").fill("2025-12-15");
  await page.getByLabel("Částka (Kč)").fill("12 000");
  await page.getByLabel("Popis").fill("Právní služby za prosinec 2025");
  await page.getByLabel("Uhrazeno dne").fill("2025-12-10");
  await page.getByRole("button", { name: "Převzít fakturu" }).click();
  await expect(page.getByText(/Faktura 2025012 .* je převzatá/)).toBeVisible();
  await expect(page.getByLabel("Číslo faktury")).toHaveValue("2025013");
  await expect(page.getByLabel("Popis")).toHaveValue("Právní služby za leden 2026");
  await page.screenshot({ path: path.join(shots, "11-prevzit.png"), fullPage: true });
});
