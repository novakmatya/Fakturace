"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FormMessage, SubmitButton, TextAreaField, TextField } from "@/components/form-controls";
import { sendInvoiceEmailAction, type SendFormState, type SendFormValues } from "../../email-actions";

export function SendInvoiceForm({ invoiceId, defaults }: { invoiceId: string; defaults: SendFormValues }) {
  const [state, action] = useActionState<SendFormState | null, FormData>(sendInvoiceEmailAction, null);
  const values = state && !state.ok && state.values ? state.values : defaults;
  const errors = state && !state.ok ? state.fieldErrors : undefined;
  // Po chybě se formulář znovu vykreslí s odeslanými hodnotami (key vynutí nové výchozí hodnoty).
  const formKey = state && !state.ok ? JSON.stringify(values) : "initial";

  return (
    <form action={action} className="space-y-5" key={formKey}>
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <FormMessage state={state} />
      <TextField
        name="to"
        label="Komu"
        errors={errors}
        defaultValue={values.to}
        required
        autoComplete="off"
        hint="Více adres oddělte čárkou."
      />
      <TextField name="cc" label="Kopie" errors={errors} defaultValue={values.cc} autoComplete="off" />
      <TextField name="subject" label="Předmět" errors={errors} defaultValue={values.subject} required />
      <TextAreaField name="body" label="Text" errors={errors} defaultValue={values.body} rows={16} required />
      <div className="flex items-center justify-end gap-3">
        <Link href={`/faktury/${invoiceId}`} className="text-sm text-muted hover:text-ink">
          Zpět na fakturu
        </Link>
        <SubmitButton pendingText="Odesílám…">Odeslat</SubmitButton>
      </div>
    </form>
  );
}
