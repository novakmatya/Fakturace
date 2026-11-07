import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Alert, ButtonLink, Card, CardTitle, DefinitionList, PageHeader } from "@/components/ui";
import { formatCzDateTime } from "@/lib/dates";
import { formatMailbox } from "@/lib/email/address";
import { emailConfig } from "@/lib/email/config";
import { buildInvoiceEmailDraft } from "@/lib/email/invoice-email";
import { listEmailsForInvoice, parseStoredList } from "@/lib/email/outbox";
import { getInvoice } from "@/lib/invoices/service";
import type { SupplierSnapshot } from "@/lib/invoices/types";
import { requireUser } from "@/lib/session";
import { getAppSettings } from "@/lib/settings";
import { SendInvoiceForm } from "./send-form";

export const metadata: Metadata = { title: "Odeslat fakturu" };

export default async function SendInvoicePage({ params }: PageProps<"/faktury/[id]/odeslat">) {
  await requireUser();
  const { id } = await params;
  const invoice = await getInvoice(id);
  if (!invoice) notFound();
  if (!invoice.number) redirect(`/faktury/${id}`);

  const config = emailConfig();
  const header = (
    <PageHeader
      eyebrow={<Link href={`/faktury/${id}`}>Faktura {invoice.number}</Link>}
      title="Odeslat e-mailem"
      description="Text je předvyplněný ze šablony. Úpravy platí jen pro tento e-mail."
    />
  );

  if (invoice.type !== "FAKTURA") {
    return (
      <>
        {header}
        <Alert tone="warn">Odesílání dobropisů přibude spolu s dobropisy.</Alert>
      </>
    );
  }
  if (config.mode === "off") {
    return (
      <>
        {header}
        <Alert tone="warn" title="Odesílání e-mailů není nastavené.">
          {config.reason}{" "}
          <Link href="/nastaveni/emaily" className="font-medium underline">
            Nastavení e-mailů
          </Link>
        </Alert>
      </>
    );
  }

  const [draft, settings, history] = await Promise.all([
    buildInvoiceEmailDraft(id),
    getAppSettings(),
    listEmailsForInvoice(id),
  ]);
  const supplier = JSON.parse(invoice.supplierSnapshot ?? "{}") as SupplierSnapshot;
  const lastSent = history.find((m) => m.status === "SENT");
  const from = formatMailbox(config.from.name ?? supplier.name, config.from.address);
  const replyTo = supplier.email && supplier.email.toLowerCase() !== config.from.address.toLowerCase() ? supplier.email : null;
  const pdfSizeKb = invoice.pdfFile ? Math.max(1, Math.round(invoice.pdfFile.sizeBytes / 1024)) : null;

  return (
    <>
      {header}
      {lastSent?.sentAt ? (
        <div className="mb-6">
          <Alert tone="accent">
            Faktura už byla odeslána {formatCzDateTime(lastSent.sentAt)} na {parseStoredList(lastSent.toAddresses).join(", ")}.
            Nový e-mail odejde jako další zpráva.
          </Alert>
        </div>
      ) : null}
      {config.mode === "file" ? (
        <div className="mb-6">
          <Alert tone="warn">
            Vývojový režim: e-mail se neodešle, jen se uloží do složky dev-mail v datovém adresáři.
          </Alert>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <SendInvoiceForm
            invoiceId={id}
            defaults={{ to: draft.to, cc: draft.cc, subject: draft.subject, body: draft.body }}
          />
        </Card>
        <div className="space-y-6">
          <Card>
            <CardTitle>Příloha</CardTitle>
            <p className="text-sm font-medium">Faktura-{invoice.number}.pdf</p>
            <p className="text-[13px] text-muted">
              {pdfSizeKb ? `${pdfSizeKb} kB · uložený originál dokladu s QR platbou` : "PDF se vytvoří při odeslání."}
            </p>
          </Card>
          <Card>
            <CardTitle>Odesílá se</CardTitle>
            <DefinitionList
              items={[
                { label: "Od", value: <span className="break-all text-sm">{from}</span>, wide: true },
                ...(replyTo ? [{ label: "Odpovědi na", value: <span className="break-all text-sm">{replyTo}</span>, wide: true }] : []),
                {
                  label: "Skrytá kopie",
                  value: (
                    <span className="text-sm">
                      {settings.emailBccSelf && supplier.email ? supplier.email : "vypnuto"}
                    </span>
                  ),
                  wide: true,
                },
              ]}
            />
            <div className="mt-4">
              <ButtonLink href="/nastaveni/emaily" variant="ghost" className="-ml-3">
                Upravit šablonu a nastavení →
              </ButtonLink>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
