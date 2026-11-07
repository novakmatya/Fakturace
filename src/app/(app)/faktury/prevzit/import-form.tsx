"use client";

import { useActionState } from "react";
import { FormMessage, SelectField, SubmitButton, TextField } from "@/components/form-controls";
import { Field, inputClass } from "@/components/ui";
import type { ActionResult } from "@/lib/validation";
import { importInvoiceAction, type ImportState, type ImportValues, seriesStartAction } from "./actions";

export function ImportForm({
  customers,
  sources,
  initial,
}: {
  customers: { id: string; name: string }[];
  sources: { id: string; name: string; section: string }[];
  initial: ImportValues;
}) {
  const [state, action] = useActionState<ImportState | null, FormData>(importInvoiceAction, null);
  const v = state?.values ?? initial;
  const errors = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form action={action} className="space-y-4" key={JSON.stringify(v)}>
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField name="customerId" label="Odběratel" defaultValue={v.customerId} errors={errors} required>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
        <SelectField name="incomeSourceId" label="Činnost" defaultValue={v.incomeSourceId} errors={errors} required>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.section === "S9" ? "§ 9" : "§ 7"})
            </option>
          ))}
        </SelectField>
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        <TextField name="number" label="Číslo faktury" defaultValue={v.number} errors={errors} required placeholder="např. 2026001" />
        <TextField name="issueDate" label="Vystaveno" type="date" defaultValue={v.issueDate} errors={errors} required />
        <TextField name="dueDate" label="Splatnost" type="date" defaultValue={v.dueDate} errors={errors} required />
        <TextField name="amount" label="Částka (Kč)" defaultValue={v.amount} inputMode="decimal" errors={errors} required />
      </div>
      <TextField name="description" label="Popis" defaultValue={v.description} errors={errors} required placeholder="např. Právní služby za leden 2026" />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          name="paidOn"
          label="Uhrazeno dne"
          type="date"
          defaultValue={v.paidOn}
          errors={errors}
          hint="Rozhoduje o roce příjmu. Prázdné = zatím neuhrazena."
        />
        <Field label="PDF originálu (nepovinné)" htmlFor="pdf" hint="Uloží se k faktuře jako archivní originál.">
          <input id="pdf" name="pdf" type="file" accept="application/pdf" className={`${inputClass} py-1.5`} />
        </Field>
      </div>
      <div className="flex justify-end">
        <SubmitButton pendingText="Ukládám…">Převzít fakturu</SubmitButton>
      </div>
    </form>
  );
}

export function SeriesStartForm({ year, suggested }: { year: number; suggested: number }) {
  const [state, action] = useActionState<ActionResult | null, FormData>(seriesStartAction, null);
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      <input type="hidden" name="year" value={year} />
      <div className="flex items-end gap-3">
        <TextField name="nextNumber" label={`Pořadí první faktury v roce ${year}`} type="number" min={1} max={9999} defaultValue={suggested} />
        <SubmitButton variant="secondary">Nastavit</SubmitButton>
      </div>
    </form>
  );
}
