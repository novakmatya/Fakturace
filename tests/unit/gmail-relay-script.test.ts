import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { GMAIL_SECRET_PLACEHOLDER, gmailRelayScript } from "@/lib/email/gmail-relay-script";

// Skript běží v Google Apps Script – tady ho spustíme v izolovaném prostředí
// s náhradami služeb MailApp, CacheService, LockService, Utilities a ContentService.
const SECRET = "test-secret-0123456789-abcdef";

type Sent = { to: string; subject: string; body: string; options: Record<string, unknown> };

function sandbox(options: { failWith?: string } = {}) {
  const sent: Sent[] = [];
  const cache = new Map<string, string>();
  const context = vm.createContext({
    MailApp: {
      sendEmail(to: string, subject: string, body: string, opts: Record<string, unknown>) {
        if (options.failWith) throw new Error(options.failWith);
        sent.push({ to, subject, body, options: opts });
      },
      getRemainingDailyQuota: () => 100 - sent.length,
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k: string) => cache.get(k) ?? null,
        put: (k: string, v: string) => void cache.set(k, v),
      }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      base64Decode: (s: string) => Array.from(Buffer.from(s, "base64")),
      newBlob: (bytes: number[], contentType: string, name: string) => ({ bytes, contentType, name }),
    },
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput: (text: string) => ({ text, setMimeType() { return this; } }),
    },
  });
  vm.runInContext(gmailRelayScript(SECRET), context);
  const post = (payload: unknown): Record<string, unknown> => {
    const output = (context.doPost as (e: unknown) => { text: string })({
      postData: { contents: typeof payload === "string" ? payload : JSON.stringify(payload) },
    });
    return JSON.parse(output.text);
  };
  return { post, sent };
}

const message = {
  secret: SECRET,
  id: "msg-1",
  fromName: "Jan Novák",
  to: ["a@example.cz", "b@example.cz"],
  cc: ["c@example.cz"],
  bcc: [],
  replyTo: "jan@example.cz",
  subject: "Faktura č. 20260001",
  text: "Dobrý den",
  html: "<p>Dobrý den</p>",
  attachment: { filename: "Faktura-20260001.pdf", contentType: "application/pdf", content: Buffer.from("%PDF-1.7").toString("base64") },
};

describe("skript pro Gmail (Apps Script)", () => {
  it("bez klíče má zástupný text, s klíčem ho bezpečně vloží", () => {
    expect(gmailRelayScript(null)).toContain(`const TAJNY_KLIC = "${GMAIL_SECRET_PLACEHOLDER}";`);
    expect(gmailRelayScript('a"b')).toContain('const TAJNY_KLIC = "a\\"b";');
  });

  it("odmítne neplatný klíč a nesmyslný požadavek", () => {
    const { post, sent } = sandbox();
    expect(post({ ...message, secret: "jiny" })).toMatchObject({ ok: false, permanent: true });
    expect(post("není json")).toMatchObject({ ok: false, permanent: true });
    expect(sent).toHaveLength(0);
  });

  it("ping jen ověří spojení a vrátí limit", () => {
    const { post, sent } = sandbox();
    expect(post({ secret: SECRET, ping: true })).toEqual({ ok: true, remaining: 100 });
    expect(sent).toHaveLength(0);
  });

  it("odešle e-mail se všemi údaji a PDF přílohou", () => {
    const { post, sent } = sandbox();
    expect(post(message)).toEqual({ ok: true, remaining: 99 });
    expect(sent).toHaveLength(1);
    const [mail] = sent;
    expect(mail.to).toBe("a@example.cz,b@example.cz");
    expect(mail.subject).toBe("Faktura č. 20260001");
    expect(mail.body).toBe("Dobrý den");
    expect(mail.options).toMatchObject({ name: "Jan Novák", cc: "c@example.cz", replyTo: "jan@example.cz", htmlBody: "<p>Dobrý den</p>" });
    expect(mail.options.bcc).toBeUndefined();
    const [blob] = mail.options.attachments as { bytes: number[]; contentType: string; name: string }[];
    expect(blob.name).toBe("Faktura-20260001.pdf");
    expect(blob.contentType).toBe("application/pdf");
    expect(Buffer.from(blob.bytes).toString()).toBe("%PDF-1.7");
  });

  it("stejné ID zprávy podruhé neodešle", () => {
    const { post, sent } = sandbox();
    post(message);
    expect(post(message)).toMatchObject({ ok: true, duplicate: true });
    expect(sent).toHaveLength(1);
  });

  it("chybu Gmailu vrátí jako odpověď, nespadne", () => {
    const { post } = sandbox({ failWith: "Service invoked too many times for one day: email." });
    expect(post(message)).toEqual({ ok: false, error: "Service invoked too many times for one day: email." });
  });
});
