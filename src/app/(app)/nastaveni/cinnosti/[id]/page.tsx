import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Card, PageHeader } from "@/components/ui";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { IncomeSourceForm } from "../income-source-form";

export const metadata: Metadata = { title: "Upravit činnost" };

export default async function EditIncomeSourcePage({ params }: PageProps<"/nastaveni/cinnosti/[id]">) {
  await requireUser();
  const { id } = await params;
  const source = await prisma.incomeSource.findUnique({ where: { id } });
  if (!source) notFound();
  const issuedCount = await prisma.invoice.count({ where: { incomeSourceId: id, number: { not: null } } });
  return (
    <>
      <PageHeader eyebrow={<Link href="/nastaveni/cinnosti">Činnosti</Link>} title={source.name} />
      <div className="max-w-xl space-y-4">
        {issuedCount > 0 ? (
          <Alert tone="accent">
            Na této činnosti je {issuedCount} vystavených dokladů. Změna se projeví jen u nových faktur – vystavené mají
            paragraf zmrazený.
          </Alert>
        ) : null}
        <Card>
          <IncomeSourceForm
            defaults={{
              id: source.id,
              name: source.name,
              section: source.section === "S9" ? "S9" : "S7",
              pausalCategory: source.pausalCategory ?? "",
              shareNumerator: String(source.shareNumerator),
              shareDenominator: String(source.shareDenominator),
              printIco: source.printIco,
              printRegisterText: source.printRegisterText,
            }}
          />
        </Card>
      </div>
    </>
  );
}
