"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge, inputClass } from "@/components/ui";

export type CustomerRow = {
  id: string;
  name: string;
  kind: string;
  ico: string | null;
  city: string;
  email: string | null;
  invoiceCount: number;
  archived: boolean;
};

function normalize(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Hledání běží v prohlížeči – hledaný text (jméno, IČO) se neposílá v URL. */
export function CustomerList({ rows }: { rows: CustomerRow[] }) {
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    return rows.filter(
      (r) =>
        (showArchived || !r.archived) &&
        (!q || normalize(`${r.name} ${r.ico ?? ""} ${r.city} ${r.email ?? ""}`).includes(q)),
    );
  }, [rows, query, showArchived]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="search"
          placeholder="Hledat podle názvu, IČO, obce…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={`${inputClass} sm:max-w-sm`}
          aria-label="Hledat odběratele"
        />
        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="size-4 accent-[var(--color-accent)]"
          />
          Zobrazit archivované
        </label>
      </div>
      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-line bg-panel/60 text-left">
            <tr>
              <th className="label-caps px-4 py-2.5">Odběratel</th>
              <th className="label-caps hidden px-4 py-2.5 sm:table-cell">IČO</th>
              <th className="label-caps hidden px-4 py-2.5 md:table-cell">Obec</th>
              <th className="label-caps px-4 py-2.5 text-right">Dokladů</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {filtered.map((r) => (
              <tr key={r.id} className="hover:bg-panel/50">
                <td className="px-4 py-3">
                  <Link href={`/odberatele/${r.id}`} className="font-medium text-ink hover:text-accent">
                    {r.name}
                  </Link>
                  <div className="mt-0.5 flex gap-2 text-[13px] text-muted">
                    {r.kind === "PERSON" ? "Fyzická osoba" : r.email ?? ""}
                    {r.archived ? <Badge>Archivováno</Badge> : null}
                  </div>
                </td>
                <td className="tabular hidden px-4 py-3 text-muted sm:table-cell">{r.ico ?? "—"}</td>
                <td className="hidden px-4 py-3 text-muted md:table-cell">{r.city}</td>
                <td className="tabular px-4 py-3 text-right text-muted">{r.invoiceCount}</td>
              </tr>
            ))}
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-muted">
                  Nic nenalezeno.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
