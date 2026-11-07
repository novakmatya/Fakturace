"use client";

import Link from "next/link";
import { useActionState, useMemo, useRef, useState } from "react";
import { FormMessage } from "@/components/form-controls";
import { Alert, Button, cx, Field, inputClass } from "@/components/ui";
import { addDays, isIsoDate } from "@/lib/dates";
import { formatCzk, lineTotalHalere, parseCzkInput, parseQuantityInput, roundingToWholeCrowns } from "@/lib/money";
import { type DraftFormState, saveDraftAction } from "./actions";

export type LineValue = { key: string; description: string; quantity: string; unit: string; unitPrice: string; kind: string };

export type InvoiceFormDefaults = {
  customerId: string;
  incomeSourceId: string;
  issueDate: string;
  dueDate: string;
  supplyDate: string;
  paymentMethod: string;
  constantSymbol: string;
  specificSymbol: string;
  note: string;
  lines: Omit<LineValue, "key">[];
};

type CustomerOption = {
  id: string;
  name: string;
  defaultIncomeSourceId: string | null;
  defaultDueDays: number | null;
  email: string | null;
};
type SourceOption = { id: string; name: string; section: string };

let keyCounter = 0;
const newKey = () => `l${++keyCounter}`;
const emptyLine = (): LineValue => ({ key: newKey(), description: "", quantity: "1", unit: "", unitPrice: "", kind: "STANDARD" });

export function InvoiceForm({
  invoiceId,
  defaults,
  customers,
  incomeSources,
  supplierDueDays,
  roundTotals,
  canIssue,
  emailEnabled,
  autoSendDefault,
}: {
  invoiceId?: string;
  defaults: InvoiceFormDefaults;
  customers: CustomerOption[];
  incomeSources: SourceOption[];
  supplierDueDays: number;
  roundTotals: boolean;
  canIssue: boolean;
  emailEnabled: boolean;
  autoSendDefault: boolean;
}) {
  const [state, action] = useActionState<DraftFormState | null, FormData>(saveDraftAction, null);
  const [form, setForm] = useState(() => ({ ...defaults, lines: undefined }));
  const [lines, setLines] = useState<LineValue[]>(() =>
    defaults.lines.length ? defaults.lines.map((l) => ({ ...l, key: newKey() })) : [emptyLine()],
  );
  const dueTouched = useRef(Boolean(invoiceId));
  const [sendAfterIssue, setSendAfterIssue] = useState(autoSendDefault);
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  const set = (name: keyof InvoiceFormDefaults, value: string) => setForm((f) => ({ ...f, [name]: value }));

  function dueDaysFor(customerId: string) {
    return customers.find((c) => c.id === customerId)?.defaultDueDays ?? supplierDueDays;
  }

  function onCustomer(customerId: string) {
    const customer = customers.find((c) => c.id === customerId);
    setForm((f) => ({
      ...f,
      customerId,
      incomeSourceId: customer?.defaultIncomeSourceId ?? f.incomeSourceId,
      dueDate: !dueTouched.current && isIsoDate(f.issueDate) ? addDays(f.issueDate, dueDaysFor(customerId)) : f.dueDate,
    }));
  }

  function onIssueDate(issueDate: string) {
    setForm((f) => ({
      ...f,
      issueDate,
      dueDate: !dueTouched.current && isIsoDate(issueDate) ? addDays(issueDate, dueDaysFor(f.customerId)) : f.dueDate,
    }));
  }

  const totals = useMemo(() => {
    const lineTotals = lines.map((l) => {
      const q = parseQuantityInput(l.quantity);
      const p = parseCzkInput(l.unitPrice);
      return q !== null && p !== null ? lineTotalHalere(q, p) : null;
    });
    const total = lineTotals.reduce<number>((a, b) => a + (b ?? 0), 0);
    const rounding = roundTotals ? roundingToWholeCrowns(total) : 0;
    return { lineTotals, total, rounding, due: total + rounding };
  }, [lines, roundTotals]);

  const selectedSource = incomeSources.find((s) => s.id === form.incomeSourceId);
  const customerEmail = customers.find((c) => c.id === form.customerId)?.email ?? null;
  const canSend = emailEnabled && Boolean(customerEmail);
  const willSend = canSend && sendAfterIssue;
  const payload = JSON.stringify({
    ...form,
    lines: lines.map((l) => ({ description: l.description, quantity: l.quantity, unit: l.unit, unitPrice: l.unitPrice, kind: l.kind })),
  });

  const err = (name: string) => errors[name];

  return (
    <form action={action} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <input type="hidden" name="payload" value={payload} />
      {invoiceId ? <input type="hidden" name="id" value={invoiceId} /> : null}

      <div className="space-y-6">
        <FormMessage state={state} />

        <section className="rounded-xl border border-line bg-surface p-5 sm:p-6">
          <h2 className="label-caps mb-4">Odběratel a činnost</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Odběratel" htmlFor="customerId" error={err("customerId")} hint={<Link className="text-accent hover:underline" href="/odberatele/novy">Přidat nového odběratele</Link>}>
              <select id="customerId" className={inputClass} value={form.customerId} onChange={(e) => onCustomer(e.target.value)} aria-invalid={err("customerId") ? true : undefined}>
                <option value="">— vyberte —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Činnost (druh příjmu)"
              htmlFor="incomeSourceId"
              error={err("incomeSourceId")}
              hint={selectedSource ? (selectedSource.section === "S7" ? "Příjem podle § 7" : "Příjem podle § 9 (nájem)") : undefined}
            >
              <select id="incomeSourceId" className={inputClass} value={form.incomeSourceId} onChange={(e) => set("incomeSourceId", e.target.value)} aria-invalid={err("incomeSourceId") ? true : undefined}>
                <option value="">— vyberte —</option>
                {incomeSources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.section === "S7" ? "§ 7" : "§ 9"})
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </section>

        <section className="rounded-xl border border-line bg-surface p-5 sm:p-6">
          <h2 className="label-caps mb-4">Data a úhrada</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Datum vystavení" htmlFor="issueDate" error={err("issueDate")}>
              <input id="issueDate" type="date" className={inputClass} value={form.issueDate} onChange={(e) => onIssueDate(e.target.value)} />
            </Field>
            <Field label="Datum splatnosti" htmlFor="dueDate" error={err("dueDate")}>
              <input
                id="dueDate"
                type="date"
                className={inputClass}
                value={form.dueDate}
                onChange={(e) => {
                  dueTouched.current = true;
                  set("dueDate", e.target.value);
                }}
              />
            </Field>
            <Field label="Způsob úhrady" htmlFor="paymentMethod">
              <select id="paymentMethod" className={inputClass} value={form.paymentMethod} onChange={(e) => set("paymentMethod", e.target.value)}>
                <option value="PREVOD">Převodem (s QR platbou)</option>
                <option value="HOTOVOST">V hotovosti</option>
              </select>
            </Field>
          </div>
        </section>

        <section className="rounded-xl border border-line bg-surface p-5 sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="label-caps">Položky</h2>
            {err("lines") ? <p className="text-[13px] text-danger">{err("lines")}</p> : null}
          </div>
          <div className="space-y-3">
            {lines.map((line, index) => (
              <div key={line.key} className="rounded-lg border border-line p-3 sm:border-0 sm:p-0">
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_84px_72px_120px_112px_32px] sm:items-start">
                  <div>
                    <input
                      aria-label="Popis položky"
                      placeholder="Popis plnění"
                      className={inputClass}
                      value={line.description}
                      aria-invalid={err(`lines.${index}.description`) ? true : undefined}
                      onChange={(e) => setLines((ls) => ls.map((l) => (l.key === line.key ? { ...l, description: e.target.value } : l)))}
                    />
                    {err(`lines.${index}.description`) ? <p className="mt-1 text-[13px] text-danger">{err(`lines.${index}.description`)}</p> : null}
                  </div>
                  <div>
                    <input
                      aria-label="Množství"
                      inputMode="decimal"
                      className={cx(inputClass, "tabular text-right")}
                      value={line.quantity}
                      aria-invalid={err(`lines.${index}.quantity`) ? true : undefined}
                      onChange={(e) => setLines((ls) => ls.map((l) => (l.key === line.key ? { ...l, quantity: e.target.value } : l)))}
                    />
                  </div>
                  <input
                    aria-label="Jednotka"
                    placeholder="ks"
                    className={inputClass}
                    value={line.unit}
                    onChange={(e) => setLines((ls) => ls.map((l) => (l.key === line.key ? { ...l, unit: e.target.value } : l)))}
                  />
                  <div>
                    <input
                      aria-label="Cena za jednotku"
                      inputMode="decimal"
                      placeholder="0,00"
                      className={cx(inputClass, "tabular text-right")}
                      value={line.unitPrice}
                      aria-invalid={err(`lines.${index}.unitPrice`) ? true : undefined}
                      onChange={(e) => setLines((ls) => ls.map((l) => (l.key === line.key ? { ...l, unitPrice: e.target.value } : l)))}
                    />
                  </div>
                  <p className="tabular flex h-10 items-center justify-end text-sm font-medium text-ink">
                    {totals.lineTotals[index] === null ? "—" : formatCzk(totals.lineTotals[index]!)}
                  </p>
                  <button
                    type="button"
                    aria-label="Odebrat položku"
                    disabled={lines.length === 1}
                    className="flex h-10 items-center justify-center rounded-md text-faint hover:bg-panel hover:text-danger disabled:opacity-30"
                    onClick={() => setLines((ls) => ls.filter((l) => l.key !== line.key))}
                  >
                    ×
                  </button>
                </div>
                {(err(`lines.${index}.quantity`) || err(`lines.${index}.unitPrice`)) ? (
                  <p className="mt-1 text-[13px] text-danger">{err(`lines.${index}.quantity`) ?? err(`lines.${index}.unitPrice`)}</p>
                ) : null}
                {selectedSource?.section === "S9" ? (
                  <select
                    aria-label="Druh položky"
                    className="mt-2 rounded-md border border-line bg-surface px-2 py-1 text-[13px] text-muted"
                    value={line.kind}
                    onChange={(e) => setLines((ls) => ls.map((l) => (l.key === line.key ? { ...l, kind: e.target.value } : l)))}
                  >
                    <option value="STANDARD">Nájemné / běžná položka</option>
                    <option value="SERVICE_ADVANCE">Zálohy na služby</option>
                  </select>
                ) : null}
              </div>
            ))}
          </div>
          <Button type="button" variant="ghost" size="sm" className="mt-3" onClick={() => setLines((ls) => [...ls, emptyLine()])}>
            + Přidat položku
          </Button>
        </section>

        <section className="rounded-xl border border-line bg-surface p-5 sm:p-6">
          <h2 className="label-caps mb-4">Doplňující údaje</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Variabilní symbol" htmlFor="vs" hint="Doplní se automaticky číslem faktury.">
              <input id="vs" className={inputClass} disabled value="= číslo faktury" readOnly />
            </Field>
            <Field label="Konstantní symbol" htmlFor="constantSymbol" error={err("constantSymbol")}>
              <input id="constantSymbol" inputMode="numeric" className={inputClass} value={form.constantSymbol} onChange={(e) => set("constantSymbol", e.target.value)} />
            </Field>
            <Field label="Specifický symbol" htmlFor="specificSymbol" error={err("specificSymbol")}>
              <input id="specificSymbol" inputMode="numeric" className={inputClass} value={form.specificSymbol} onChange={(e) => set("specificSymbol", e.target.value)} />
            </Field>
            <Field label="Poznámka na faktuře" htmlFor="note" error={err("note")} className="sm:col-span-3">
              <textarea id="note" rows={2} className={inputClass} value={form.note} onChange={(e) => set("note", e.target.value)} placeholder="Např. Fakturuji dle objednávky č. …" />
            </Field>
          </div>
        </section>
      </div>

      <aside className="lg:sticky lg:top-20 lg:self-start">
        <div className="rounded-xl border border-line bg-surface p-5">
          <h2 className="label-caps mb-4">Souhrn</h2>
          <dl className="space-y-2 text-sm">
            {totals.rounding !== 0 ? (
              <>
                <div className="flex justify-between text-muted">
                  <dt>Součet položek</dt>
                  <dd className="tabular">{formatCzk(totals.total)}</dd>
                </div>
                <div className="flex justify-between text-muted">
                  <dt>Zaokrouhlení</dt>
                  <dd className="tabular">{formatCzk(totals.rounding)}</dd>
                </div>
              </>
            ) : null}
            <div className="flex items-baseline justify-between border-t border-line pt-3">
              <dt className="font-medium">Celkem k úhradě</dt>
              <dd className="tabular text-xl font-semibold text-accent">{formatCzk(totals.due)}</dd>
            </div>
          </dl>
          <p className="mt-2 text-right text-[13px] text-muted">Nejsem plátce DPH.</p>
          <div className="mt-6 space-y-2">
            <Button type="submit" name="intent" value="save" variant="secondary" className="w-full">
              Uložit koncept
            </Button>
            <Button
              type="submit"
              name="intent"
              value="issue"
              className="w-full"
              disabled={!canIssue}
              onClick={(e) => {
                const sending = willSend ? ` Faktura se zároveň odešle e-mailem na ${customerEmail}.` : "";
                if (
                  !confirm(
                    `Po vystavení už fakturu nelze upravit ani smazat – opravit ji půjde jen dobropisem.${sending} Vystavit?`,
                  )
                ) {
                  e.preventDefault();
                }
              }}
            >
              {willSend ? "Vystavit a odeslat" : "Uložit a vystavit"}
            </Button>
          </div>
          <label className={cx("mt-4 flex items-start gap-2.5 text-sm", !canSend && "text-muted")}>
            <input
              type="checkbox"
              name="sendAfterIssue"
              className="mt-0.5 size-4 accent-[var(--color-accent)]"
              checked={willSend}
              disabled={!canSend}
              onChange={(e) => setSendAfterIssue(e.target.checked)}
            />
            <span>
              Po vystavení odeslat e-mailem
              <span className="block text-[13px] text-muted">
                {!emailEnabled
                  ? "Odesílání e-mailů není nastavené."
                  : customerEmail
                    ? `na ${customerEmail} (s PDF v příloze)`
                    : "Odběratel nemá vyplněný e-mail."}
              </span>
            </span>
          </label>
          {!canIssue ? (
            <div className="mt-4">
              <Alert tone="warn">
                Před vystavením vyplňte <Link href="/nastaveni" className="underline">údaje dodavatele</Link>.
              </Alert>
            </div>
          ) : (
            <p className="mt-4 text-[13px] text-muted">Vystavením se přidělí číslo z řady a vytvoří PDF s QR platbou.</p>
          )}
        </div>
      </aside>
    </form>
  );
}
