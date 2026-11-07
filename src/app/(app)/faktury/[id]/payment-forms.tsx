"use client";

import { useActionState } from "react";
import { FormMessage, SelectField, SubmitButton, TextField } from "@/components/form-controls";
import type { ActionResult } from "@/lib/validation";
import { cancelPaymentAction, recordPaymentAction } from "../payment-actions";

const METHODS = [
  { value: "PREVOD", label: "Převodem na účet" },
  { value: "HOTOVOST", label: "V hotovosti" },
  { value: "JINE", label: "Jinak (karta, zápočet…)" },
];

export function PaymentForm({
  invoiceId,
  defaultDate,
  defaultAmount,
  defaultMethod,
}: {
  invoiceId: string;
  defaultDate: string;
  defaultAmount: string;
  defaultMethod: string;
}) {
  const [state, action] = useActionState<ActionResult | null, FormData>(recordPaymentAction, null);
  const errors = state && !state.ok ? state.fieldErrors : undefined;
  // Po úspěšném zápisu se formulář vrátí na výchozí hodnoty.
  const key = state?.ok ? `ok-${state.message}` : "form";
  return (
    <form action={action} className="space-y-4" key={key}>
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField name="paidOn" label="Datum úhrady" type="date" defaultValue={defaultDate} errors={errors} required />
        <TextField
          name="amount"
          label="Částka (Kč)"
          defaultValue={defaultAmount}
          inputMode="decimal"
          errors={errors}
          required
          className="tabular"
        />
        <SelectField name="method" label="Způsob" defaultValue={defaultMethod} errors={errors}>
          {METHODS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </SelectField>
      </div>
      <TextField name="note" label="Poznámka" errors={errors} placeholder="Např. platba z účtu jednatele" />
      <div className="flex justify-end">
        <SubmitButton variant="secondary" pendingText="Zapisuji…">
          Zapsat úhradu
        </SubmitButton>
      </div>
    </form>
  );
}

export function CancelPaymentForm({ invoiceId, paymentId }: { invoiceId: string; paymentId: string }) {
  const [state, action] = useActionState<ActionResult | null, FormData>(cancelPaymentAction, null);
  return (
    <details className="text-[13px]">
      <summary className="cursor-pointer text-muted underline-offset-4 hover:text-ink hover:underline">Stornovat</summary>
      <form action={action} className="mt-2 flex flex-wrap items-end gap-2">
        <input type="hidden" name="invoiceId" value={invoiceId} />
        <input type="hidden" name="paymentId" value={paymentId} />
        <label className="min-w-0 flex-1">
          <span className="sr-only">Důvod storna</span>
          <input
            name="reason"
            required
            maxLength={300}
            placeholder="Důvod, např. zapsáno k jiné faktuře"
            className="h-8 w-full rounded-md border border-line bg-surface px-2.5 text-[13px]"
          />
        </label>
        <SubmitButton variant="danger" className="h-8 px-3 text-[13px]" pendingText="Stornuji…">
          Stornovat úhradu
        </SubmitButton>
        {state && !state.ok ? <p className="w-full text-danger">{state.error}</p> : null}
      </form>
    </details>
  );
}
