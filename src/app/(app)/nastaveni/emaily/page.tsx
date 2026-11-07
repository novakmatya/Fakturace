import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { CopyButton } from "@/components/copy-button";
import { SubmitButton } from "@/components/form-controls";
import { Alert, Badge, Card, CardTitle, PageHeader } from "@/components/ui";
import { prisma } from "@/lib/db";
import { formatCzDateTime } from "@/lib/dates";
import { env } from "@/env";
import { EMAIL_MODE_LABEL, emailConfig, GMAIL_SECRET_MIN } from "@/lib/email/config";
import { gmailRelayScript } from "@/lib/email/gmail-relay-script";
import { formatMailbox } from "@/lib/email/address";
import { getTemplate, TEMPLATE_LABEL, type TemplateKey } from "@/lib/email/templates";
import { requireUser } from "@/lib/session";
import { getAppSettings, getSupplier } from "@/lib/settings";
import { resetTemplateAction, sendTestEmailAction } from "./actions";
import { EmailSettingsForm } from "./email-settings-form";
import { RelayCheck } from "./relay-check";
import { ReminderSettingsForm } from "./reminder-settings-form";
import { TemplateEditor } from "./template-editor";

export const metadata: Metadata = { title: "E-maily" };

const TEST_STATUS: Record<string, { label: string; tone: "neutral" | "ok" | "danger" }> = {
  QUEUED: { label: "Ve frontě", tone: "neutral" },
  SENDING: { label: "Odesílá se", tone: "neutral" },
  SENT: { label: "Odesláno", tone: "ok" },
  FAILED: { label: "Neodesláno", tone: "danger" },
  CANCELLED: { label: "Zrušeno", tone: "neutral" },
};

export default async function EmailSettingsPage({ searchParams }: PageProps<"/nastaveni/emaily">) {
  await requireUser();
  const query = await searchParams;
  const config = emailConfig();
  const [settings, supplier, invoiceTemplate, reminderTemplate, tests] = await Promise.all([
    getAppSettings(),
    getSupplier(),
    getTemplate("INVOICE"),
    getTemplate("REMINDER"),
    prisma.emailMessage.findMany({ where: { kind: "TEST" }, orderBy: { queuedAt: "desc" }, take: 3 }),
  ]);
  const testPending = tests.some((t) => t.status === "SENDING" || (t.status === "QUEUED" && t.attempts === 0));

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/nastaveni">Nastavení</Link>}
        title="E-maily"
        description="Odesílání faktur a upomínek, šablony e-mailů a kopie pro vás."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          <TemplateCard
            templateKey="INVOICE"
            template={invoiceTemplate}
            notice={query.klic === "INVOICE" || !query.klic ? query.sablona : undefined}
          />
          <TemplateCard
            templateKey="REMINDER"
            template={reminderTemplate}
            notice={query.klic === "REMINDER" ? query.sablona : undefined}
          />
        </div>

        <div className="space-y-6">
          <Card>
            <AutoRefresh active={testPending} />
            <CardTitle>Odesílání</CardTitle>
            {config.mode === "gmail" || config.mode === "resend" ? (
              <div className="space-y-3 text-sm">
                <p className="flex items-center gap-2">
                  <Badge tone="ok">Zapnuto</Badge> {EMAIL_MODE_LABEL[config.mode]}
                </p>
                <p>
                  <span className="label-caps block">Odesílatel</span>
                  <span className="break-all">{formatMailbox(config.from.name ?? supplier?.name ?? null, config.from.address)}</span>
                </p>
                {config.mode === "gmail" ? <RelayCheck /> : null}
              </div>
            ) : config.mode === "file" ? (
              <Alert tone="warn" title="Vývojový režim">
                E-maily se neodesílají, ukládají se do složky dev-mail v datovém adresáři.
              </Alert>
            ) : (
              <Alert tone="warn" title="Odesílání není nastavené.">
                {config.reason} Postup je níže v části Propojení Gmailu.
              </Alert>
            )}

            {config.mode !== "off" ? (
              <div className="mt-5 border-t border-line pt-4">
                {query.test === "odeslano" ? (
                  <div className="mb-3">
                    <Alert tone="ok">Zkušební e-mail je na cestě na {supplier?.email}.</Alert>
                  </div>
                ) : null}
                {query.test === "bez-adresy" ? (
                  <div className="mb-3">
                    <Alert tone="warn">Nejdřív doplňte e-mail v údajích dodavatele.</Alert>
                  </div>
                ) : null}
                {query.test === "chyba" ? (
                  <div className="mb-3">
                    <Alert tone="danger">Zkušební e-mail se nepodařilo připravit.</Alert>
                  </div>
                ) : null}
                <form action={sendTestEmailAction}>
                  <SubmitButton variant="secondary" pendingText="Odesílám…" disabled={!supplier?.email}>
                    Poslat zkušební e-mail
                  </SubmitButton>
                </form>
                <p className="mt-2 text-[13px] text-muted">
                  {supplier?.email ? `Přijde na ${supplier.email}.` : "Chybí e-mail v údajích dodavatele."}
                </p>
                {tests.length ? (
                  <ul className="mt-3 space-y-2 text-[13px]">
                    {tests.map((t) => {
                      const s = TEST_STATUS[t.status] ?? { label: t.status, tone: "neutral" as const };
                      return (
                        <li key={t.id}>
                          <span className="flex items-center gap-2">
                            <Badge tone={s.tone}>{s.label}</Badge>
                            <span className="tabular text-muted">{formatCzDateTime(t.sentAt ?? t.queuedAt)}</span>
                          </span>
                          {t.lastError && t.status !== "SENT" ? <span className="mt-1 block text-danger">{t.lastError}</span> : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </Card>

          <Card>
            <CardTitle hint="Neuhrazené faktury po splatnosti. Ručně ji pošlete z detailu faktury.">Upomínky</CardTitle>
            <ReminderSettingsForm
              auto={settings.remindersAuto}
              firstDays={settings.reminderFirstDays}
              repeatDays={settings.reminderRepeatDays}
              maxCount={settings.reminderMaxCount}
            />
          </Card>

          <Card>
            <CardTitle>Chování</CardTitle>
            <EmailSettingsForm
              autoSend={settings.emailAutoSendOnIssue}
              bccSelf={settings.emailBccSelf}
              supplierEmail={supplier?.email ?? null}
            />
          </Card>
        </div>
      </div>

      {config.mode !== "resend" ? (
        <div className="mt-6">
          <GmailSetup
            configured={config.mode === "gmail"}
            secret={env.GMAIL_RELAY_SECRET && env.GMAIL_RELAY_SECRET.length >= GMAIL_SECRET_MIN ? env.GMAIL_RELAY_SECRET : null}
          />
        </div>
      ) : null}
    </>
  );
}

function GmailSetup({ configured, secret }: { configured: boolean; secret: string | null }) {
  const script = gmailRelayScript(secret);
  const steps: { title: string; body: React.ReactNode }[] = [
    {
      title: "Proměnné na Railway",
      body: (
        <>
          V proměnných služby nastavte <code>GMAIL_RELAY_SECRET</code> (náhodný klíč, např. výstup{" "}
          <code>openssl rand -hex 24</code>) a <code>MAIL_FROM</code> ve tvaru <code>Jméno Příjmení &lt;vas.ucet@gmail.com&gt;</code>.
          {secret ? " Klíč je nastavený a níže ve skriptu už je doplněný." : " Po uložení se aplikace restartuje a klíč se objeví ve skriptu níže."}
        </>
      ),
    },
    {
      title: "Skript v Google účtu",
      body: (
        <>
          Přihlaste se do Gmailu, ze kterého chcete posílat, otevřete{" "}
          <a href="https://script.google.com/home" target="_blank" rel="noreferrer" className="font-medium text-accent underline">
            script.google.com
          </a>{" "}
          → Nový projekt, smažte předvyplněný kód a vložte skript níže. Uložte.
        </>
      ),
    },
    {
      title: "Nasazení jako webová aplikace",
      body: (
        <>
          Nasadit → Nové nasazení → typ Webová aplikace (Deploy → New deployment → Web app). Spustit jako: <b>Já</b> (Execute
          as: Me), Kdo má přístup: <b>Kdokoli</b> (Who has access: Anyone). Při povolení Google upozorní, že aplikace není
          ověřená – je to váš vlastní skript: Rozšířené → Přejít na projekt → Povolit. Skript smí jen odesílat e-maily, poštu
          nečte.
        </>
      ),
    },
    {
      title: "Adresa skriptu do Railway",
      body: (
        <>
          Zkopírujte URL webové aplikace (končí <code>/exec</code>) a uložte ji na Railway jako <code>GMAIL_RELAY_URL</code>.
          Pak tady klikněte na Ověřit spojení a pošlete si zkušební e-mail.
        </>
      ),
    },
  ];
  return (
    <Card>
      <CardTitle hint="Faktury odcházejí z vašeho Gmailu a zůstávají ve složce Odeslané. Bez vlastní domény, jednorázově asi 10 minut.">
        {configured ? "Propojení Gmailu (hotovo)" : "Propojení Gmailu"}
      </CardTitle>
      <ol className="space-y-4">
        {steps.map((step, i) => (
          <li key={step.title} className="flex gap-3 text-sm">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-panel text-xs font-medium text-muted">
              {i + 1}
            </span>
            <div>
              <p className="font-medium">{step.title}</p>
              <p className="mt-0.5 text-muted">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <details className="mt-5 rounded-lg border border-line" open={!configured}>
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Skript pro Google Apps Script</summary>
        <div className="flex justify-end border-t border-line px-4 py-2">
          <CopyButton text={script} label="Zkopírovat skript" />
        </div>
        <pre className="max-h-96 overflow-auto border-t border-line bg-panel px-4 py-3 text-xs leading-relaxed">
          <code>{script}</code>
        </pre>
      </details>
      <p className="mt-3 text-[13px] text-muted">
        Běžný účet Gmail smí přes skripty odeslat 100 e-mailů denně. Klíč ve skriptu nikomu neposílejte – kdo ho zná, může přes váš
        Gmail odesílat e-maily.
      </p>
    </Card>
  );
}

function TemplateCard({
  templateKey,
  template,
  notice,
}: {
  templateKey: TemplateKey;
  template: { subject: string; body: string; custom: boolean };
  notice: string | string[] | undefined;
}) {
  return (
    <Card>
      <CardTitle hint="Proměnné ve složených závorkách se při odeslání nahradí údaji z faktury.">
        Šablona: {TEMPLATE_LABEL[templateKey].toLowerCase()}
      </CardTitle>
      {notice === "ulozena" ? (
        <div className="mb-4">
          <Alert tone="ok">Šablona je uložená. Platí pro e-maily připravené od této chvíle.</Alert>
        </div>
      ) : null}
      {notice === "vychozi" ? (
        <div className="mb-4">
          <Alert tone="ok">Šablona je vrácená na výchozí text.</Alert>
        </div>
      ) : null}
      <TemplateEditor
        key={JSON.stringify([template.subject, template.body])}
        templateKey={templateKey}
        initial={{ subject: template.subject, body: template.body }}
      />
      {template.custom ? (
        <form action={resetTemplateAction} className="mt-4 border-t border-line pt-4">
          <input type="hidden" name="key" value={templateKey} />
          <button type="submit" className="text-[13px] text-muted underline-offset-4 hover:text-ink hover:underline">
            Obnovit výchozí text šablony
          </button>
        </form>
      ) : null}
    </Card>
  );
}
