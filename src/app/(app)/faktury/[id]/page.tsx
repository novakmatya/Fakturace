import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Badge, ButtonLink, Card, CardTitle, DefinitionList, PageHeader } from "@/components/ui";
import { formatIban } from "@/lib/bank";
import { formatCzDate, todayPrague } from "@/lib/dates";
import { emailConfig } from "@/lib/email/config";
import { listEmailsForInvoice } from "@/lib/email/outbox";
import { listPayments } from "@/lib/payments/service";
import { displayStatus, statusBadge } from "@/lib/invoices/display";
import { getInvoice } from "@/lib/invoices/service";
import { type CustomerSnapshot, PAYMENT_METHOD_LABEL, type PaymentMethod, type SupplierSnapshot } from "@/lib/invoices/types";
import { formatCzk, formatQuantity } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { deleteDraftAction, regeneratePdfAction } from "../actions";
import { loadInvoiceFormContext } from "../form-data";
import { InvoiceForm } from "../invoice-form";
import { EmailLog } from "./email-log";
import { PaymentsCard } from "./payments-card";

export const metadata: Metadata = { title: "Doklad" };

function Party({ label, party }: { label: string; party: SupplierSnapshot | CustomerSnapshot }) {
  return (
    <div>
      <p className="label-caps mb-1.5">{label}</p>
      <p className="font-medium">{party.name}</p>
      <p className="text-sm text-muted">{party.street}</p>
      <p className="text-sm text-muted">
        {party.zip} {party.city}
        {party.country !== "CZ" ? `, ${party.country}` : ""}
      </p>
      {party.ico ? <p className="mt-1 text-sm">IČO: {party.ico}</p> : null}
      {party.dic ? <p className="text-sm">DIČ: {party.dic}</p> : null}
    </div>
  );
}

export default async function InvoicePage({ params, searchParams }: PageProps<"/faktury/[id]">) {
  await requireUser();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const invoice = await getInvoice(id);
  if (!invoice) notFound();

  if (invoice.status === "KONCEPT") {
    const context = await loadInvoiceFormContext();
    return (
      <>
        <PageHeader
          eyebrow={<Link href="/faktury">Faktury</Link>}
          title="Koncept faktury"
          description="Koncept nemá číslo. Lze ho libovolně upravit nebo smazat; číslo se přidělí až při vystavení."
          actions={
            <form action={deleteDraftAction}>
              <input type="hidden" name="id" value={invoice.id} />
              <button type="submit" className="h-10 rounded-lg border border-danger/25 bg-surface px-4 text-sm text-danger hover:bg-danger-soft">
                Smazat koncept
              </button>
            </form>
          }
        />
        {query.ulozeno ? (
          <div className="mb-6">
            <Alert tone="ok">Koncept je uložený.</Alert>
          </div>
        ) : null}
        <InvoiceForm
          {...context}
          invoiceId={invoice.id}
          defaults={{
            customerId: invoice.customerId,
            incomeSourceId: invoice.incomeSourceId,
            issueDate: invoice.issueDate,
            dueDate: invoice.dueDate,
            supplyDate: invoice.supplyDate ?? "",
            paymentMethod: invoice.paymentMethod,
            constantSymbol: invoice.constantSymbol ?? "",
            specificSymbol: invoice.specificSymbol ?? "",
            note: invoice.note ?? "",
            lines: invoice.lines.map((l) => ({
              description: l.description,
              quantity: formatQuantity(l.quantityMilli).replace(/ /g, ""),
              unit: l.unit ?? "",
              unitPrice: (l.unitPriceHalere / 100).toFixed(2).replace(".", ","),
              kind: l.kind,
            })),
          }}
        />
      </>
    );
  }

  const supplier = JSON.parse(invoice.supplierSnapshot ?? "{}") as SupplierSnapshot;
  const customer = JSON.parse(invoice.customerSnapshot ?? "{}") as CustomerSnapshot;
  const today = todayPrague();
  const status = displayStatus(invoice, today);
  const badge = statusBadge(status);
  const title = invoice.type === "DOBROPIS" ? "Dobropis" : "Faktura";
  const [emails, payments] = await Promise.all([listEmailsForInvoice(invoice.id), listPayments(invoice.id)]);
  const canSend = invoice.type === "FAKTURA" && invoice.status === "VYSTAVENA" && emailConfig().mode !== "off";
  const alreadySent = emails.some((e) => e.status === "SENT" && e.kind === "INVOICE");

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/faktury">Faktury</Link>}
        title={
          <span className="flex items-center gap-3">
            {title} {invoice.number}
            <Badge tone={badge.tone}>{badge.label}</Badge>
          </span>
        }
        description={`${customer.name} · splatnost ${formatCzDate(invoice.dueDate)}`}
        actions={
          <>
            {invoice.pdfFile ? (
              <>
                <ButtonLink href={`/api/soubory/${invoice.pdfFile.id}`} target="_blank" variant="secondary">
                  Otevřít PDF
                </ButtonLink>
                <ButtonLink href={`/api/soubory/${invoice.pdfFile.id}?stahnout=1`} variant="secondary">
                  Stáhnout PDF
                </ButtonLink>
              </>
            ) : null}
            {canSend && status === "PO_SPLATNOSTI" ? (
              <ButtonLink href={`/faktury/${invoice.id}/odeslat?typ=upominka`}>Poslat upomínku</ButtonLink>
            ) : null}
            {canSend && status !== "UHRAZENA" && status !== "PO_SPLATNOSTI" ? (
              <ButtonLink href={`/faktury/${invoice.id}/odeslat`} variant={alreadySent ? "secondary" : "primary"}>
                {alreadySent ? "Odeslat znovu" : "Odeslat e-mailem"}
              </ButtonLink>
            ) : null}
          </>
        }
      />

      <div className="mb-6 space-y-3">
        {query.vystaveno ? (
          <Alert tone="ok" title={`Faktura ${invoice.number} je vystavená.`}>
            Číslo je přidělené, údaje zmrazené{invoice.pdfFile ? " a PDF s QR platbou uložené" : ""}.
            {query.email === "fronta" ? " E-mail s fakturou se odesílá – stav vidíte níže v sekci E-maily." : ""}
          </Alert>
        ) : null}
        {query.uhrazeno ? <Alert tone="ok">Úhrada je zapsaná – faktura je uhrazená.</Alert> : null}
        {!query.vystaveno && query.email === "fronta" ? (
          <Alert tone="ok">E-mail s fakturou se odesílá – stav vidíte níže v sekci E-maily.</Alert>
        ) : null}
        {query.email === "chyba" ? (
          <Alert tone="warn" title="E-mail se nepodařilo připravit.">
            Faktura je vystavená, ale e-mail se nezařadil k odeslání (zkontrolujte e-mail odběratele a nastavení e-mailů).
            Odeslat ji můžete tlačítkem Odeslat e-mailem.
          </Alert>
        ) : null}
        {!invoice.pdfFile ? (
          <Alert tone="warn" title="PDF zatím není vytvořené.">
            <form action={regeneratePdfAction} className="mt-2">
              <input type="hidden" name="id" value={invoice.id} />
              <button type="submit" className="font-medium underline">
                Vytvořit PDF
              </button>
            </form>
          </Alert>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <div className="grid gap-6 sm:grid-cols-2">
              <Party label="Dodavatel" party={supplier} />
              <Party label="Odběratel" party={customer} />
            </div>
            <div className="mt-6 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-ink/80 text-left">
                  <tr>
                    <th className="label-caps py-2 pr-3">Popis</th>
                    <th className="label-caps py-2 pr-3 text-right">Množství</th>
                    <th className="label-caps py-2 pr-3 text-right">Jedn. cena</th>
                    <th className="label-caps py-2 text-right">Celkem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {invoice.lines.map((line) => (
                    <tr key={line.id}>
                      <td className="py-2.5 pr-3">{line.description}</td>
                      <td className="tabular py-2.5 pr-3 text-right">
                        {formatQuantity(line.quantityMilli)} {line.unit}
                      </td>
                      <td className="tabular py-2.5 pr-3 text-right">{formatCzk(line.unitPriceHalere)}</td>
                      <td className="tabular py-2.5 text-right">{formatCzk(line.totalHalere)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-5 ml-auto max-w-xs space-y-1 text-sm">
              {invoice.roundingHalere !== 0 ? (
                <div className="flex justify-between text-muted">
                  <span>Zaokrouhlení</span>
                  <span className="tabular">{formatCzk(invoice.roundingHalere)}</span>
                </div>
              ) : null}
              <div className="flex items-baseline justify-between border-t border-line pt-2">
                <span className="font-medium">Celkem k úhradě</span>
                <span className="tabular text-xl font-semibold text-accent">{formatCzk(invoice.amountDueHalere)}</span>
              </div>
              <p className="text-right text-[13px] text-muted">{supplier.vatNote}</p>
            </div>
            {invoice.note ? <p className="mt-6 text-sm text-muted">{invoice.note}</p> : null}
          </Card>
          {invoice.type === "FAKTURA" ? (
            <PaymentsCard
              invoice={invoice}
              payments={payments}
              today={today}
              canRecord={invoice.status === "VYSTAVENA"}
            />
          ) : null}
          {invoice.type === "FAKTURA" ? <EmailLog invoiceId={invoice.id} emails={emails} canSend={canSend} /> : null}
        </div>

        <div className="space-y-6">
          <Card>
            <CardTitle>Údaje dokladu</CardTitle>
            <DefinitionList
              items={[
                { label: "Vystaveno", value: formatCzDate(invoice.issueDate) },
                { label: "Splatnost", value: formatCzDate(invoice.dueDate) },
                { label: "Úhrada", value: PAYMENT_METHOD_LABEL[invoice.paymentMethod as PaymentMethod] },
                { label: "Var. symbol", value: <span className="tabular">{invoice.variableSymbol ?? "—"}</span> },
                { label: "Účet", value: <span className="tabular whitespace-nowrap">{supplier.bankAccount}</span>, wide: true },
                {
                  label: "IBAN",
                  value: <span className="tabular whitespace-nowrap text-sm">{formatIban(supplier.iban)}</span>,
                  wide: true,
                },
              ]}
            />
          </Card>
          <Card>
            <CardTitle hint="Zmrazeno při vystavení – rozhoduje o zařazení v ročních podkladech.">Daňové zařazení</CardTitle>
            <DefinitionList
              items={[
                { label: "Paragraf", value: invoice.incomeSection === "S7" ? "§ 7 – samostatná činnost" : "§ 9 – nájem" },
                { label: "Činnost", value: invoice.incomeSource.name },
                ...(invoice.shareNumerator !== invoice.shareDenominator
                  ? [{ label: "Podíl", value: `${invoice.shareNumerator}/${invoice.shareDenominator}` }]
                  : []),
              ]}
            />
          </Card>
          {invoice.pdfFile ? (
            <Card>
              <CardTitle hint="Originál dokladu je v databázi neměnný.">Archiv</CardTitle>
              <p className="label-caps">Otisk PDF (SHA-256)</p>
              <p className="tabular mt-1 break-all font-mono text-xs text-muted">{invoice.pdfFile.sha256}</p>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
