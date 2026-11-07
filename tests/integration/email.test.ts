import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/env";
import { prisma } from "@/lib/db";
import { emailConfig } from "@/lib/email/config";
import { buildInvoiceEmailDraft, InvoiceEmailError, queueInvoiceEmail, queueTestEmail } from "@/lib/email/invoice-email";
import { MAX_ATTEMPTS, processOutbox } from "@/lib/email/outbox";
import { pingGmailRelay } from "@/lib/email/transport";
import { DEFAULT_TEMPLATES, resetTemplate, saveTemplate, TemplateError } from "@/lib/email/templates";
import { integrityMessage } from "@/lib/errors";
import { sha256 } from "@/lib/files";
import { invoiceStatusBadge } from "@/lib/invoices/display";
import { createDraft, getInvoice, issueInvoice } from "@/lib/invoices/service";
import { saveSupplier, updateAppSettings } from "@/lib/settings";
import { supplierSchema } from "@/lib/validation";
import { draftData, NOW, seedBasics, SUPPLIER_INPUT } from "../helpers/fixtures";
import { startMockEmail } from "../helpers/mock-email.mjs";

type Mock = Awaited<ReturnType<typeof startMockEmail>>;
let mock: Mock;
let base: Awaited<ReturnType<typeof seedBasics>>;

/** Okamžik těsně po zařazení do fronty (zprávy dostávají čas zařazení z hodin systému). */
const soon = () => new Date(Date.now() + 1_000);
const plain = (text: string) => text.replace(/\u00a0/g, " ");

function useResend(url: string) {
  delete process.env.GMAIL_RELAY_URL;
  delete process.env.GMAIL_RELAY_SECRET;
  process.env.RESEND_API_KEY = "re_test";
  process.env.RESEND_API_URL = url;
  process.env.MAIL_FROM = "Kancelář Novák <faktury@example.cz>";
  resetEnvCache();
}

function useGmail(m: Mock) {
  delete process.env.RESEND_API_KEY;
  process.env.GMAIL_RELAY_URL = m.gmailUrl;
  process.env.GMAIL_RELAY_SECRET = m.gmailSecret;
  process.env.MAIL_FROM = "Jan Novák <jan.novak@gmail.com>";
  resetEnvCache();
}

function disableEmail() {
  delete process.env.RESEND_API_KEY;
  delete process.env.GMAIL_RELAY_URL;
  delete process.env.GMAIL_RELAY_SECRET;
  delete process.env.MAIL_FROM;
  resetEnvCache();
}

async function issued(overrides: Parameters<typeof draftData>[1] = {}) {
  const draft = await createDraft(draftData({ customerId: base.customer.id, incomeSourceId: base.s7.id }, overrides));
  return issueInvoice(draft.id, { now: NOW });
}

async function rejected(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, "očekávané odmítnutí").not.toBeNull();
  const message = integrityMessage(error);
  expect(message, "odmítnutí triggerem v databázi").toBeTruthy();
  return message!;
}

async function queueDefault(invoiceId: string) {
  const draft = await buildInvoiceEmailDraft(invoiceId);
  return queueInvoiceEmail(invoiceId, { to: [draft.to], cc: [], subject: draft.subject, body: draft.body });
}

beforeAll(async () => {
  mock = await startMockEmail();
  useResend(mock.url);
  base = await seedBasics();
});

afterAll(async () => {
  await mock.close();
});

beforeEach(async () => {
  mock.reset();
  useResend(mock.url);
  // každý test začíná s prázdnou frontou (zrušení je jediná povolená změna čekající zprávy)
  await prisma.emailMessage.updateMany({ where: { status: "QUEUED" }, data: { status: "CANCELLED" } });
});

describe("konfigurace", () => {
  it("bez klíče mimo vývoj e-maily neodesílá a řekne proč", () => {
    disableEmail();
    const config = emailConfig();
    expect(config.mode).toBe("off");
    useResend(mock.url);
    expect(emailConfig().mode).toBe("resend");
  });

  it("odmítne neplatný MAIL_FROM", () => {
    process.env.MAIL_FROM = "není adresa";
    resetEnvCache();
    const config = emailConfig();
    expect(config.mode).toBe("off");
    if (config.mode === "off") expect(config.reason).toMatch(/MAIL_FROM/);
  });
});

describe("odeslání faktury", () => {
  it("předvyplní e-mail ze šablony a zmrazených údajů dokladu", async () => {
    const invoice = await issued();
    const draft = await buildInvoiceEmailDraft(invoice.id);
    expect(draft.to).toBe("fakturace@example.cz");
    expect(draft.subject).toBe(`Faktura č. ${invoice.number} – Jan Novák`);
    expect(plain(draft.body)).toContain(`fakturu č. ${invoice.number} na částku 3 000,00 Kč se splatností 16. 11. 2026`);
    expect(draft.body).toContain(`na účet 19-2000145399/0800 s variabilním symbolem ${invoice.number}`);
    expect(draft.body).toContain("Jan Novák\n+420 777 123 456\njan@example.cz");
    expect(draft.body).not.toMatch(/\{[a-z_]+\}/);
  });

  it("odešle e-mail s originálním PDF, odpovědí a skrytou kopií na dodavatele", async () => {
    const invoice = await issued();
    const queued = await queueDefault(invoice.id);
    expect(queued.status).toBe("QUEUED");

    const result = await processOutbox({ now: soon() });
    expect(result).toEqual({ sent: 1, retried: 0, failed: 0 });
    expect(mock.messages).toHaveLength(1);

    const [received] = mock.messages;
    expect(received.idempotencyKey).toBe(queued.id);
    expect(received.body.from).toBe("Kancelář Novák <faktury@example.cz>");
    expect(received.body.to).toEqual(["fakturace@example.cz"]);
    expect(received.body.reply_to).toBe("jan@example.cz");
    expect(received.body.bcc).toEqual(["jan@example.cz"]);
    expect(received.body.subject).toBe(`Faktura č. ${invoice.number} – Jan Novák`);
    expect(received.body.html).toContain("<p");
    expect(received.body.text).toContain("S pozdravem");

    const fresh = await getInvoice(invoice.id);
    expect(received.body.attachments).toHaveLength(1);
    expect(received.body.attachments[0].filename).toBe(`Faktura-${invoice.number}.pdf`);
    const pdf = Buffer.from(received.body.attachments[0].content, "base64");
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(sha256(pdf)).toBe(fresh!.pdfSha256);

    const stored = await prisma.emailMessage.findUniqueOrThrow({ where: { id: queued.id } });
    expect(stored.status).toBe("SENT");
    expect(stored.providerMessageId).toBe(received.id);
    expect(stored.attempts).toBe(1);
    expect(invoiceStatusBadge(fresh!).label).toBe("Odeslána");
  });

  it("bez skryté kopie, když je vypnutá", async () => {
    await updateAppSettings({ emailBccSelf: false });
    try {
      const invoice = await issued();
      await queueDefault(invoice.id);
      await processOutbox({ now: soon() });
      expect(mock.messages[0].body.bcc).toBeUndefined();
    } finally {
      await updateAppSettings({ emailBccSelf: true });
    }
  });

  it("koncept odeslat nejde – aplikace ani databáze", async () => {
    const draft = await createDraft(draftData({ customerId: base.customer.id, incomeSourceId: base.s7.id }));
    await expect(buildInvoiceEmailDraft(draft.id)).rejects.toBeInstanceOf(InvoiceEmailError);
    await rejected(
      prisma.emailMessage.create({
        data: {
          kind: "INVOICE",
          invoiceId: draft.id,
          fromAddress: "a@example.cz",
          toAddresses: "[]",
          subject: "x",
          bodyText: "x",
          bodyHtml: "x",
        },
      }),
    );
  });

  it("při vypnutém odesílání nic nezařadí", async () => {
    const invoice = await issued();
    disableEmail();
    await expect(
      queueInvoiceEmail(invoice.id, { to: ["a@example.cz"], cc: [], subject: "x", body: "y" }),
    ).rejects.toThrow(/není nastavené/);
    expect(await processOutbox({ now: soon() })).toEqual({ sent: 0, retried: 0, failed: 0 });
  });

  it("platba v hotovosti má v e-mailu jinou větu", async () => {
    const invoice = await issued({ paymentMethod: "HOTOVOST" });
    const draft = await buildInvoiceEmailDraft(invoice.id);
    expect(draft.body).toContain("prosím uhraďte v hotovosti");
    expect(draft.body).not.toContain("variabilním symbolem");
  });

  it("text uživatele se v HTML escapuje", async () => {
    const invoice = await issued();
    const message = await queueInvoiceEmail(invoice.id, {
      to: ["a@example.cz"],
      cc: [],
      subject: "Test",
      body: "Pozor <script>alert(1)</script> & spol.",
    });
    expect(message.bodyHtml).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; spol.");
    expect(message.bodyHtml).not.toContain("<script>");
  });
});

describe("chyby a opakování", () => {
  it("dočasnou chybu zkouší znovu s rostoucí prodlevou, pak odešle", async () => {
    const invoice = await issued();
    const queued = await queueDefault(invoice.id);
    mock.failNext(500, 429);
    const t = soon();

    expect(await processOutbox({ now: t })).toMatchObject({ retried: 1 });
    let row = await prisma.emailMessage.findUniqueOrThrow({ where: { id: queued.id } });
    expect(row.status).toBe("QUEUED");
    expect(row.nextAttemptAt.getTime()).toBe(t.getTime() + 60_000);
    expect(row.lastError).toMatch(/500/);

    // ještě není na řadě
    expect(await processOutbox({ now: new Date(t.getTime() + 30_000) })).toMatchObject({ sent: 0, retried: 0 });

    const second = new Date(t.getTime() + 61_000);
    expect(await processOutbox({ now: second })).toMatchObject({ retried: 1 });
    row = await prisma.emailMessage.findUniqueOrThrow({ where: { id: queued.id } });
    expect(row.nextAttemptAt.getTime()).toBe(second.getTime() + 5 * 60_000);

    expect(await processOutbox({ now: new Date(second.getTime() + 6 * 60_000) })).toMatchObject({ sent: 1 });
    row = await prisma.emailMessage.findUniqueOrThrow({ where: { id: queued.id } });
    expect(row.status).toBe("SENT");
    expect(row.attempts).toBe(3);
    expect(mock.messages).toHaveLength(1);
  });

  it("trvalou chybu (např. neověřená doména) neopakuje", async () => {
    const invoice = await issued();
    const queued = await queueDefault(invoice.id);
    mock.failNext(422);
    expect(await processOutbox({ now: soon() })).toMatchObject({ failed: 1 });
    const row = await prisma.emailMessage.findUniqueOrThrow({ where: { id: queued.id } });
    expect(row.status).toBe("FAILED");
    expect(row.lastError).toMatch(/Resend e-mail odmítl/);
    const log = await prisma.auditLog.findFirst({ where: { action: "EMAIL_FAILED", entityId: queued.id } });
    expect(log).not.toBeNull();
  });

  it(`po ${MAX_ATTEMPTS} neúspěšných pokusech to vzdá`, async () => {
    const invoice = await issued();
    const queued = await queueDefault(invoice.id);
    mock.failNext(...Array.from({ length: MAX_ATTEMPTS }, () => 503));
    let now = soon();
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await processOutbox({ now });
      now = new Date(now.getTime() + 2 * 3600_000);
    }
    const row = await prisma.emailMessage.findUniqueOrThrow({ where: { id: queued.id } });
    expect(row.status).toBe("FAILED");
    expect(row.attempts).toBe(MAX_ATTEMPTS);
    expect(mock.requestCount).toBe(MAX_ATTEMPTS);
  });

  it("souběžné zpracování fronty neodešle nic dvakrát", async () => {
    const invoices = await Promise.all([issued(), issued(), issued()]);
    for (const invoice of invoices) await queueDefault(invoice.id);
    await Promise.all([processOutbox({ now: soon() }), processOutbox({ now: soon() }), processOutbox({ now: soon() })]);
    expect(mock.messages).toHaveLength(3);
    expect(new Set(mock.messages.map((m) => m.idempotencyKey)).size).toBe(3);
  });

  it("zprávu přerušenou pádem pošle znovu se stejným klíčem – bez duplikátu", async () => {
    const invoice = await issued();
    const queued = await queueDefault(invoice.id);
    // první pokus doručil, ale proces spadl dřív, než stihl zapsat výsledek
    const t = soon();
    await prisma.emailMessage.update({
      where: { id: queued.id },
      data: { status: "SENDING", attempts: 1, nextAttemptAt: t },
    });
    await fetch(`${mock.url}/emails`, {
      method: "POST",
      headers: { Authorization: "Bearer re_test", "Idempotency-Key": queued.id, "Content-Type": "application/json" },
      body: JSON.stringify({ from: "a@example.cz", to: ["b@example.cz"], subject: "x" }),
    });
    expect(mock.messages).toHaveLength(1);

    const later = new Date(t.getTime() + 10 * 60_000);
    await processOutbox({ now: later }); // vrátí do fronty a odešle znovu se stejným klíčem
    const row = await prisma.emailMessage.findUniqueOrThrow({ where: { id: queued.id } });
    expect(row.status).toBe("SENT");
    expect(mock.messages).toHaveLength(1); // Resend vrátil původní zprávu
    expect(row.providerMessageId).toBe(mock.messages[0].id);
  });
});

describe("log e-mailů je v databázi neměnný", () => {
  it("odeslaný záznam nejde změnit ani smazat", async () => {
    const invoice = await issued();
    const queued = await queueDefault(invoice.id);
    await processOutbox({ now: soon() });
    await rejected(prisma.emailMessage.delete({ where: { id: queued.id } }));
    await rejected(prisma.emailMessage.update({ where: { id: queued.id }, data: { subject: "Jiný předmět" } }));
    await rejected(prisma.emailMessage.update({ where: { id: queued.id }, data: { status: "QUEUED" } }));
    await rejected(prisma.emailMessage.update({ where: { id: queued.id }, data: { sentAt: new Date() } }));
  });

  it("obsah zprávy ve frontě nejde změnit a stav jen dopředu", async () => {
    const invoice = await issued();
    const queued = await queueDefault(invoice.id);
    await rejected(prisma.emailMessage.update({ where: { id: queued.id }, data: { toAddresses: '["jiny@example.cz"]' } }));
    await rejected(prisma.emailMessage.update({ where: { id: queued.id }, data: { status: "SENT" } }));
    await rejected(
      prisma.emailMessage.create({
        data: { kind: "TEST", status: "SENT", fromAddress: "a@example.cz", toAddresses: "[]", subject: "x", bodyText: "x", bodyHtml: "x" },
      }),
    );
  });
});

describe("šablony", () => {
  it("neznámou proměnnou odmítne, vlastní šablonu použije, reset vrátí výchozí", async () => {
    await expect(saveTemplate("INVOICE", { subject: "Faktura {cislo}", body: "Dobrý den {jmeno}" })).rejects.toBeInstanceOf(
      TemplateError,
    );
    await saveTemplate("INVOICE", { subject: "Doklad {cislo}", body: "Zasílám doklad {cislo}.\n\n{podpis}" });
    const invoice = await issued();
    const draft = await buildInvoiceEmailDraft(invoice.id);
    expect(draft.subject).toBe(`Doklad ${invoice.number}`);
    expect(draft.body.startsWith(`Zasílám doklad ${invoice.number}.`)).toBe(true);
    await resetTemplate("INVOICE");
    const again = await buildInvoiceEmailDraft(invoice.id);
    expect(again.subject).toBe(DEFAULT_TEMPLATES.INVOICE.subject.replace("{cislo}", invoice.number!).replace("{dodavatel}", "Jan Novák"));
  });

  it("zkušební e-mail odejde bez přílohy", async () => {
    await queueTestEmail("jan@example.cz");
    await processOutbox({ now: soon() });
    expect(mock.messages).toHaveLength(1);
    expect(mock.messages[0].body.attachments).toBeUndefined();
    expect(mock.messages[0].body.subject).toMatch(/Zkušební/);
  });
});

describe("Gmail přes Apps Script (bez vlastní domény)", () => {
  beforeEach(() => useGmail(mock));

  it("konfigurace vyžaduje dost dlouhý tajný klíč a MAIL_FROM", () => {
    expect(emailConfig().mode).toBe("gmail");
    process.env.GMAIL_RELAY_SECRET = "kratky";
    resetEnvCache();
    expect(emailConfig()).toMatchObject({ mode: "off", reason: expect.stringMatching(/GMAIL_RELAY_SECRET/) });
    useGmail(mock);
    delete process.env.MAIL_FROM;
    resetEnvCache();
    expect(emailConfig()).toMatchObject({ mode: "off", reason: expect.stringMatching(/MAIL_FROM/) });
  });

  it("odešle fakturu z Gmailu: jméno odesílatele, příjemci, PDF a odpověď na e-mail dodavatele", async () => {
    const invoice = await issued();
    const queued = await queueDefault(invoice.id);
    expect(await processOutbox({ now: soon() })).toMatchObject({ sent: 1 });

    expect(mock.messages).toHaveLength(1);
    const [received] = mock.messages;
    expect(received.channel).toBe("gmail");
    expect(received.body.secret).toBeUndefined();
    expect(received.body.id).toBe(queued.id);
    expect(received.body.fromName).toBe("Jan Novák");
    expect(received.body.to).toEqual(["fakturace@example.cz"]);
    expect(received.body.replyTo).toBe("jan@example.cz");
    expect(received.body.bcc).toEqual(["jan@example.cz"]);
    expect(received.body.attachment.filename).toBe(`Faktura-${invoice.number}.pdf`);
    expect(received.body.attachment.contentType).toBe("application/pdf");
    const fresh = await getInvoice(invoice.id);
    expect(sha256(Buffer.from(received.body.attachment.content, "base64"))).toBe(fresh!.pdfSha256);

    const row = await prisma.emailMessage.findUniqueOrThrow({ where: { id: queued.id } });
    expect(row.status).toBe("SENT");
    expect(row.providerMessageId).toBe(`gmail-${queued.id}`);
    expect(row.fromAddress).toBe("Jan Novák <jan.novak@gmail.com>");
  });

  it("když je e-mail dodavatele stejný Gmail, neposílá skrytou kopii ani odpověď jinam", async () => {
    await saveSupplier(supplierSchema.parse({ ...SUPPLIER_INPUT, email: "Jan.Novak@gmail.com" }));
    try {
      const invoice = await issued();
      await queueDefault(invoice.id);
      await processOutbox({ now: soon() });
      expect(mock.messages[0].body.bcc).toEqual([]);
      expect(mock.messages[0].body.replyTo).toBeNull();
    } finally {
      await saveSupplier(supplierSchema.parse(SUPPLIER_INPUT));
    }
  });

  it("vyčerpaný denní limit Gmailu zkouší znovu a hlásí česky", async () => {
    const invoice = await issued();
    const queued = await queueDefault(invoice.id);
    mock.failNext("Service invoked too many times for one day: email.");
    expect(await processOutbox({ now: soon() })).toMatchObject({ retried: 1 });
    const row = await prisma.emailMessage.findUniqueOrThrow({ where: { id: queued.id } });
    expect(row.status).toBe("QUEUED");
    expect(row.lastError).toMatch(/denní limit/);
  });

  it("neplatnou adresu příjemce a špatný klíč neopakuje", async () => {
    const invoice = await issued();
    const first = await queueDefault(invoice.id);
    mock.failNext("Invalid email: fakturace@example");
    expect(await processOutbox({ now: soon() })).toMatchObject({ failed: 1 });
    expect((await prisma.emailMessage.findUniqueOrThrow({ where: { id: first.id } })).lastError).toMatch(/adresu příjemce/);

    const second = await queueDefault(invoice.id);
    process.env.GMAIL_RELAY_SECRET = "jiny-klic-0123456789-0123456789";
    resetEnvCache();
    expect(await processOutbox({ now: soon() })).toMatchObject({ failed: 1 });
    expect((await prisma.emailMessage.findUniqueOrThrow({ where: { id: second.id } })).lastError).toMatch(/tajný klíč/);
  });

  it("špatně nasazený skript (přihlašovací stránka místo JSON, 404) je trvalá chyba s návodem", async () => {
    const invoice = await issued();
    const html = await queueDefault(invoice.id);
    const loginPage = (async () =>
      new Response("<html>Přihlásit se – Účty Google</html>", { status: 200, headers: { "content-type": "text/html" } })) as typeof fetch;
    expect(await processOutbox({ now: soon(), fetchImpl: loginPage })).toMatchObject({ failed: 1 });
    expect((await prisma.emailMessage.findUniqueOrThrow({ where: { id: html.id } })).lastError).toMatch(/Kdokoli/);

    const missing = await queueDefault(invoice.id);
    mock.failNext(404);
    expect(await processOutbox({ now: soon() })).toMatchObject({ failed: 1 });
    expect((await prisma.emailMessage.findUniqueOrThrow({ where: { id: missing.id } })).lastError).toMatch(/GMAIL_RELAY_URL/);
  });

  it("opakovaný pokus po pádu skript nepošle podruhé (idempotence podle ID zprávy)", async () => {
    const invoice = await issued();
    const queued = await queueDefault(invoice.id);
    const t = soon();
    await prisma.emailMessage.update({ where: { id: queued.id }, data: { status: "SENDING", attempts: 1, nextAttemptAt: t } });
    await fetch(mock.gmailUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: mock.gmailSecret, id: queued.id, to: ["b@example.cz"], subject: "x", text: "x", html: "x" }),
    });
    expect(mock.messages).toHaveLength(1);
    await processOutbox({ now: new Date(t.getTime() + 10 * 60_000) });
    expect((await prisma.emailMessage.findUniqueOrThrow({ where: { id: queued.id } })).status).toBe("SENT");
    expect(mock.messages).toHaveLength(1);
  });

  it("ověření spojení vrátí zbývající limit, se špatným klíčem chybu", async () => {
    const config = emailConfig();
    if (config.mode !== "gmail") throw new Error("očekávaný režim gmail");
    expect(await pingGmailRelay(config)).toEqual({ ok: true, remaining: 100 });
    expect(await pingGmailRelay({ ...config, secret: "spatny-klic-0123456789-0123456789" })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/tajný klíč/),
    });
  });
});
