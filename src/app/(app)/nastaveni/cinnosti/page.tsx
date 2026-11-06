import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, CardTitle, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/session";
import { listIncomeSources } from "@/lib/settings";
import { PAUSAL_CATEGORIES, type PausalCategory } from "@/lib/validation";
import { toggleIncomeSourceArchiveAction } from "../actions";
import { EMPTY_SOURCE, IncomeSourceForm } from "./income-source-form";

export const metadata: Metadata = { title: "Činnosti" };

export default async function IncomeSourcesPage() {
  await requireUser();
  const sources = await listIncomeSources({ includeArchived: true });
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/nastaveni">Nastavení</Link>}
        title="Činnosti"
        description="Každá faktura patří k jedné činnosti. Činnost určuje paragraf příjmu pro roční podklady; při vystavení se na fakturu zmrazí."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardTitle>Přehled</CardTitle>
          {sources.length === 0 ? (
            <p className="text-sm text-muted">Zatím žádná činnost. Přidejte první vpravo.</p>
          ) : (
            <ul className="divide-y divide-line">
              {sources.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{s.name}</p>
                    <p className="text-[13px] text-muted">
                      {s.section === "S7"
                        ? `§ 7 · paušál ${PAUSAL_CATEGORIES[s.pausalCategory as PausalCategory] ?? "—"}`
                        : "§ 9 · nájem"}
                      {s.shareNumerator !== s.shareDenominator ? ` · podíl ${s.shareNumerator}/${s.shareDenominator}` : ""}
                    </p>
                  </div>
                  {s.archived ? <Badge>Archivováno</Badge> : null}
                  <Link href={`/nastaveni/cinnosti/${s.id}`} className="text-sm font-medium text-accent hover:underline">
                    Upravit
                  </Link>
                  <form action={toggleIncomeSourceArchiveAction}>
                    <input type="hidden" name="id" value={s.id} />
                    <input type="hidden" name="archived" value={String(!s.archived)} />
                    <button type="submit" className="text-sm text-muted hover:text-ink">
                      {s.archived ? "Obnovit" : "Archivovat"}
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardTitle>Nová činnost</CardTitle>
          <IncomeSourceForm defaults={EMPTY_SOURCE} />
        </Card>
      </div>
    </>
  );
}
