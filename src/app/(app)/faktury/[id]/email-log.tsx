import Link from "next/link";
import { Badge, ButtonLink, Card, CardTitle } from "@/components/ui";
import { formatCzDateTime } from "@/lib/dates";
import { type EmailStatus, parseStoredList } from "@/lib/email/outbox";
import { cancelEmailAction } from "../email-actions";
import { AutoRefresh } from "@/components/auto-refresh";

type EmailRow = {
  id: string;
  kind: string;
  status: string;
  auto: boolean;
  toAddresses: string;
  ccAddresses: string | null;
  subject: string;
  bodyText: string;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: Date;
  queuedAt: Date;
  sentAt: Date | null;
};

const STATUS: Record<EmailStatus, { label: string; tone: "neutral" | "accent" | "ok" | "warn" | "danger" }> = {
  QUEUED: { label: "Ve frontě", tone: "neutral" },
  SENDING: { label: "Odesílá se", tone: "neutral" },
  SENT: { label: "Odesláno", tone: "ok" },
  FAILED: { label: "Neodesláno", tone: "danger" },
  CANCELLED: { label: "Zrušeno", tone: "neutral" },
};

export function EmailLog({ invoiceId, emails, canSend }: { invoiceId: string; emails: EmailRow[]; canSend: boolean }) {
  const pending = emails.some((e) => e.status === "SENDING" || (e.status === "QUEUED" && e.attempts === 0));
  return (
    <Card>
      <AutoRefresh active={pending} />
      <CardTitle hint="Trvalý záznam všech e-mailů s touto fakturou – nelze ho upravit ani smazat.">E-maily</CardTitle>
      {emails.length === 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">Faktura zatím nebyla odeslána.</p>
          {canSend ? (
            <ButtonLink href={`/faktury/${invoiceId}/odeslat`} variant="secondary" size="sm">
              Odeslat e-mailem
            </ButtonLink>
          ) : null}
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {emails.map((email) => {
            const status = STATUS[email.status as EmailStatus] ?? { label: email.status, tone: "neutral" as const };
            const recipients = [...parseStoredList(email.toAddresses), ...parseStoredList(email.ccAddresses)];
            const waitingForRetry = email.status === "QUEUED" && email.attempts > 0;
            return (
              <li key={email.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <Badge tone={status.tone}>{status.label}</Badge>
                  <span className="tabular text-muted">
                    {email.sentAt ? formatCzDateTime(email.sentAt) : formatCzDateTime(email.queuedAt)}
                  </span>
                  {email.kind === "REMINDER" ? <span className="text-[13px] font-medium text-danger">Upomínka</span> : null}
                  <span className="min-w-0 flex-1 truncate">{recipients.join(", ")}</span>
                  {email.auto ? <span className="text-[13px] text-muted">automaticky</span> : null}
                </div>
                {email.lastError && email.status !== "SENT" ? (
                  <p className="mt-1.5 text-[13px] text-danger">
                    {email.lastError}
                    {waitingForRetry ? ` Další pokus ${formatCzDateTime(email.nextAttemptAt)}.` : ""}
                  </p>
                ) : null}
                <details className="mt-1.5 text-[13px] text-muted">
                  <summary className="cursor-pointer select-none hover:text-ink">{email.subject}</summary>
                  <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-panel p-3 font-sans text-[13px] text-ink">
                    {email.bodyText}
                  </pre>
                </details>
                {waitingForRetry || email.status === "FAILED" ? (
                  <div className="mt-2 flex gap-3 text-[13px]">
                    {waitingForRetry ? (
                      <form action={cancelEmailAction}>
                        <input type="hidden" name="emailId" value={email.id} />
                        <input type="hidden" name="invoiceId" value={invoiceId} />
                        <button type="submit" className="text-muted underline-offset-4 hover:text-ink hover:underline">
                          Zrušit další pokusy
                        </button>
                      </form>
                    ) : null}
                    {email.status === "FAILED" && canSend ? (
                      <Link href={`/faktury/${invoiceId}/odeslat`} className="font-medium text-accent underline-offset-4 hover:underline">
                        Odeslat znovu
                      </Link>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
