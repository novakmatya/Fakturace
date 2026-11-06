"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton, TextAreaField, TextField } from "@/components/form-controls";
import { saveSupplierAction, type FormState } from "./actions";

export type SupplierDefaults = Record<string, string>;

export function SupplierForm({ defaults }: { defaults: SupplierDefaults }) {
  const [state, action] = useActionState<FormState | null, FormData>(saveSupplierAction, null);
  const values = (state && !state.ok && state.values) || defaults;
  const errors = state && !state.ok ? state.fieldErrors : undefined;
  const v = (key: string) => values[key] ?? "";

  return (
    <form action={action} className="space-y-6" key={JSON.stringify(values)}>
      <FormMessage state={state} />

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="label-caps mb-3">Identifikace</legend>
        <TextField name="name" label="Jméno a příjmení / obchodní firma" defaultValue={v("name")} errors={errors} className="sm:col-span-2" required />
        <TextField name="street" label="Ulice a číslo" defaultValue={v("street")} errors={errors} className="sm:col-span-2" required />
        <TextField name="zip" label="PSČ" defaultValue={v("zip")} errors={errors} inputMode="numeric" required />
        <TextField name="city" label="Obec" defaultValue={v("city")} errors={errors} required />
        <TextField name="ico" label="IČO" defaultValue={v("ico")} errors={errors} inputMode="numeric" hint="U podnikání (§ 7) povinné na dokladech." />
        <TextField name="dic" label="DIČ" defaultValue={v("dic")} errors={errors} hint="Nepovinné, tvar CZ…" />
        <input type="hidden" name="country" value={v("country") || "CZ"} />
        <TextAreaField
          name="registerText"
          label="Údaj o zápisu do evidence"
          defaultValue={v("registerText")}
          errors={errors}
          className="sm:col-span-2"
          rows={2}
          hint="Např. „Fyzická osoba zapsaná v živnostenském rejstříku.“ Tiskne se jen u činností, kde to zapnete."
        />
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="label-caps mb-3">Platební údaje</legend>
        <TextField name="bankAccount" label="Číslo účtu" defaultValue={v("bankAccount")} errors={errors} placeholder="123456789/0100" required />
        <TextField name="iban" label="IBAN" defaultValue={v("iban")} errors={errors} hint="Prázdné = dopočítá se z čísla účtu." />
        <TextField name="bic" label="BIC / SWIFT" defaultValue={v("bic")} errors={errors} hint="Nepovinné." />
        <TextField name="defaultDueDays" label="Výchozí splatnost (dny)" type="number" min={0} max={365} defaultValue={v("defaultDueDays") || "14"} errors={errors} required />
        {state && !state.ok && state.requireTotp ? (
          <TextField
            name="totpCode"
            label="Kód z ověřovací aplikace"
            errors={errors}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            className="sm:col-span-2"
            hint="Změna účtu je nejčastější cíl podvodu, proto ji potvrzujete kódem 2FA."
            autoFocus
          />
        ) : null}
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="label-caps mb-3">Kontakt a texty na dokladu</legend>
        <TextField name="email" label="E-mail" type="email" defaultValue={v("email")} errors={errors} />
        <TextField name="phone" label="Telefon" defaultValue={v("phone")} errors={errors} />
        <TextField name="web" label="Web" defaultValue={v("web")} errors={errors} className="sm:col-span-2" />
        <TextField name="vatNote" label="Text o DPH" defaultValue={v("vatNote") || "Nejsem plátce DPH."} errors={errors} className="sm:col-span-2" required />
        <TextAreaField name="footerText" label="Patička dokladu" defaultValue={v("footerText")} errors={errors} className="sm:col-span-2" rows={2} hint="Nepovinné – např. poděkování nebo poznámka k platbě." />
      </fieldset>

      <div className="flex justify-end">
        <SubmitButton>Uložit údaje dodavatele</SubmitButton>
      </div>
    </form>
  );
}
