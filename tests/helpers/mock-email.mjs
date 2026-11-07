// Napodobenina e-mailových služeb pro testy – nic se nikam neposílá:
// - Resend: POST /emails (Bearer klíč, Idempotency-Key),
// - Gmail skript (Google Apps Script): POST /gmail/exec odpoví přesměrováním
//   na /gmail/echo/<token> s výsledkem – stejně jako skutečná webová aplikace.
// Pro E2E se spouští samostatně: node tests/helpers/mock-email.mjs <port> [host]

import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @param {{ port?: number, host?: string, apiKey?: string, gmailSecret?: string }} [options]
 */
export async function startMockEmail({
  port = 0,
  host = "127.0.0.1",
  apiKey = "re_test",
  gmailSecret = "test-gmail-secret-0123456789abcdef",
} = {}) {
  /** @type {{ channel: "resend" | "gmail", id: string, idempotencyKey: string | null, body: any, receivedAt: string }[]} */
  const messages = [];
  /** @type {(number | string)[]} čísla = HTTP chyba, text = chyba hlášená skriptem */
  let failures = [];
  const idempotency = new Map();
  const echoes = new Map();
  let requestCount = 0;

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const send = (status, payload) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      const url = req.url ?? "";

      if (req.method === "GET" && url === "/__messages") return send(200, messages);
      if (req.method === "POST" && url === "/__reset") {
        reset();
        return send(200, { ok: true });
      }

      // --- Gmail skript -----------------------------------------------------
      if (req.method === "GET" && url.startsWith("/gmail/echo/")) {
        const token = url.slice("/gmail/echo/".length);
        return echoes.has(token) ? send(200, echoes.get(token)) : send(404, { error: "not found" });
      }
      if (req.method === "POST" && url === "/gmail/exec") {
        requestCount++;
        const failure = failures.shift();
        if (typeof failure === "number") return send(failure, { error: `Simulovaná chyba ${failure}` });
        const reply = (payload) => {
          const token = crypto.randomUUID();
          echoes.set(token, payload);
          res.writeHead(302, { Location: `/gmail/echo/${token}` });
          res.end();
        };
        let body;
        try {
          body = JSON.parse(raw);
        } catch {
          return reply({ ok: false, permanent: true, error: "Neplatný požadavek." });
        }
        if (body.secret !== gmailSecret) return reply({ ok: false, permanent: true, error: "Neplatný tajný klíč." });
        if (body.ping) return reply({ ok: true, remaining: 100 - messages.filter((m) => m.channel === "gmail").length });
        if (typeof failure === "string") return reply({ ok: false, error: failure });
        if (idempotency.has(body.id)) return reply({ ok: true, duplicate: true });
        idempotency.set(body.id, true);
        const rest = { ...body };
        delete rest.secret; // tajný klíč se do záznamu nikdy neukládá
        messages.push({ channel: "gmail", id: body.id, idempotencyKey: body.id, body: rest, receivedAt: new Date().toISOString() });
        return reply({ ok: true, remaining: 99 });
      }

      // --- Resend -----------------------------------------------------------
      if (req.method !== "POST" || url !== "/emails") return send(404, { message: "Not found" });
      requestCount++;
      if (req.headers.authorization !== `Bearer ${apiKey}`) {
        return send(401, { statusCode: 401, name: "validation_error", message: "API key is invalid" });
      }
      const failure = failures.shift();
      if (typeof failure === "number") {
        return send(failure, { statusCode: failure, name: "mock_error", message: `Simulovaná chyba ${failure}` });
      }
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return send(400, { statusCode: 400, name: "invalid_json", message: "Invalid JSON" });
      }
      if (!body.from || !body.to || !body.subject) {
        return send(422, { statusCode: 422, name: "validation_error", message: "Missing required field" });
      }
      const key = req.headers["idempotency-key"] ?? null;
      if (key && idempotency.has(key)) return send(200, { id: idempotency.get(key) });
      const id = crypto.randomUUID();
      if (key) idempotency.set(key, id);
      messages.push({ channel: "resend", id, idempotencyKey: key, body, receivedAt: new Date().toISOString() });
      return send(200, { id });
    });
  });

  function reset() {
    messages.length = 0;
    failures = [];
    idempotency.clear();
    echoes.clear();
    requestCount = 0;
  }

  await new Promise((resolve) => server.listen(port, host, resolve));
  const address = server.address();
  const url = `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${typeof address === "object" && address ? address.port : port}`;
  return {
    url,
    gmailUrl: `${url}/gmail/exec`,
    gmailSecret,
    messages,
    get requestCount() {
      return requestCount;
    },
    /** Další požadavky selžou: číslo = HTTP stav, text = chyba hlášená Gmail skriptem. */
    failNext(...items) {
      failures = items;
    },
    reset,
    close: () => new Promise((resolve) => server.close(() => resolve(undefined))),
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.argv[2] ?? 3101);
  const host = process.argv[3] ?? "0.0.0.0";
  const mock = await startMockEmail({ port, host, gmailSecret: process.env.MOCK_GMAIL_SECRET });
  console.log(`Napodobenina e-mailu běží na ${mock.url}`);
}
