import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink, EmptyState, PageHeader } from "@/components/ui";
import { addDays, todayPrague } from "@/lib/dates";
import { requireUser } from "@/lib/session";
import { loadInvoiceFormContext } from "../form-data";
import { InvoiceForm } from "../invoice-form";

export const metadata: Metadata = { title: "Nová faktura" };

export default async function NewInvoicePage({ searchParams }: PageProps<"/faktury/nova">) {
  await requireUser();
  const [context, query] = await Promise.all([loadInvoiceFormContext(), searchParams]);

  if (context.incomeSources.length === 0 || context.customers.length === 0) {
    return (
      <>
        <PageHeader eyebrow={<Link href="/faktury">Faktury</Link>} title="Nová faktura" />
        <EmptyState
          title={context.incomeSources.length === 0 ? "Nejdřív přidejte činnost" : "Nejdřív přidejte odběratele"}
          action={
            context.incomeSources.length === 0 ? (
              <ButtonLink href="/nastaveni/cinnosti">Přidat činnost</ButtonLink>
            ) : (
              <ButtonLink href="/odberatele/novy">Přidat odběratele</ButtonLink>
            )
          }
        >
          Činnost určuje paragraf příjmu (§ 7 nebo § 9), odběratel je příjemce faktury.
        </EmptyState>
      </>
    );
  }

  const preselected = typeof query.odberatel === "string" ? query.odberatel : "";
  const customer = context.customers.find((c) => c.id === preselected);
  const today = todayPrague();
  const dueDays = customer?.defaultDueDays ?? context.supplierDueDays;

  return (
    <>
      <PageHeader eyebrow={<Link href="/faktury">Faktury</Link>} title="Nová faktura" />
      <InvoiceForm
        {...context}
        defaults={{
          customerId: customer?.id ?? "",
          incomeSourceId: customer?.defaultIncomeSourceId ?? (context.incomeSources.length === 1 ? context.incomeSources[0].id : ""),
          issueDate: today,
          dueDate: addDays(today, dueDays),
          supplyDate: "",
          paymentMethod: "PREVOD",
          constantSymbol: "",
          specificSymbol: "",
          note: "",
          lines: [],
        }}
      />
    </>
  );
}
