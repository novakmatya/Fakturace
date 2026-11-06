"use client";

import { useActionState, useState, useTransition } from "react";
import { CheckboxField, FormMessage, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/form-controls";
import { Alert, Button, Field, inputClass } from "@/components/ui";
import { type CustomerFormState, lookupAresAction, saveCustomerAction } from "./actions";

export type CustomerDefaults = Record<string, string> & { id?: string };

type Option = { id: string; name: string; section: string };

const ADDRESS_FIELDS = ["name", "street", "city", "zip", "country", "ico", "dic"] as const;

export function CustomerForm({ defaults, incomeSources }: { defaults: CustomerDefaults; incomeSources: Option[] }) {
  const [state, action] = useActionState<CustomerFormState | null, FormData>(saveCustomerAction, null);
  const failed = state && !state.ok ? state : null;
  const initial = failed?.values ?? defaults;
  const [fields, setFields] = useState<Record<string, string>>(() => ({ ...initial }));
  const [kind, setKind] = useState(initial.kind || "BUSINESS");
  const [aresRaw, setAresRaw] = useState("");
  const [aresMessage, setAresMessage] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [loading, startLookup] = useTransition();
  const errors = failed?.fieldErrors;

  const bind = (name: string) => ({
    value: fields[name] ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setFields((f) => ({ ...f, [name]: e.target.value })),
  });

  function lookup() {
    const ico = (fields.ico ?? "").trim();
    if (!ico) {
      setAresMessage({ tone: "danger", text: "Nejdřív zadejte IČO." });
      return;
    }
    startLookup(async () => {
      const result = await lookupAresAction(ico);
      if (!result.ok) {
        setAresMessage({ tone: "danger", text: result.error });
        return;
      }
      const c = result.company;
      setFields((f) => ({
        ...f,
        ...Object.fromEntries(ADDRESS_FIELDS.map((key) => [key, (c[key] ?? "") as string])),
      }));
      setKind("BUSINESS");
      setAresRaw(result.raw);
      setAresMessage({ tone: "ok", text: "Údaje jsou načtené z ARES. Před uložením je zkontrolujte." });
    });
  }

  return (
    <form action={action} className="space-y-6">
      <FormMessage state={state} />
      {defaults.id ? <input type="hidden" name="id" value={defaults.id} /> : null}
      <input type="hidden" name="aresRaw" value={aresRaw} />

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="label-caps mb-3">Odběratel</legend>
        <SelectField
          name="kind"
          label="Typ"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          errors={errors}
          className="sm:col-span-2"
        >
          <option value="BUSINESS">Firma nebo podnikatel (s IČO)</option>
          <option value="PERSON">Fyzická osoba – nepodnikatel (např. nájemník)</option>
        </SelectField>

        <Field label="IČO" htmlFor="ico" error={errors?.ico} hint={kind === "PERSON" ? "U nepodnikatele nevyplňujte." : undefined}>
          <div className="flex gap-2">
            <input id="ico" name="ico" inputMode="numeric" className={inputClass} aria-invalid={errors?.ico ? true : undefined} {...bind("ico")} />
            <Button type="button" variant="secondary" onClick={lookup} disabled={loading}>
              {loading ? "Načítám…" : "Načíst z ARES"}
            </Button>
          </div>
        </Field>
        <TextField name="dic" label="DIČ" errors={errors} {...bind("dic")} />
        {aresMessage ? (
          <div className="sm:col-span-2">
            <Alert tone={aresMessage.tone}>{aresMessage.text}</Alert>
          </div>
        ) : null}

        <TextField name="name" label={kind === "PERSON" ? "Jméno a příjmení" : "Název"} errors={errors} className="sm:col-span-2" required {...bind("name")} />
        <TextField name="street" label="Ulice a číslo" errors={errors} className="sm:col-span-2" required {...bind("street")} />
        <TextField name="zip" label="PSČ" errors={errors} required {...bind("zip")} />
        <TextField name="city" label="Obec" errors={errors} required {...bind("city")} />
        <TextField name="country" label="Stát (kód)" errors={errors} maxLength={2} hint="CZ, SK, DE…" {...bind("country")} />
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="label-caps mb-3">Fakturace</legend>
        <TextField name="email" label="E-mail pro faktury" type="email" errors={errors} {...bind("email")} />
        <TextField name="emailCc" label="Kopie (e-maily oddělené čárkou)" errors={errors} {...bind("emailCc")} />
        <SelectField name="defaultIncomeSourceId" label="Výchozí činnost" errors={errors} {...bind("defaultIncomeSourceId")}>
          <option value="">— vybrat při fakturaci —</option>
          {incomeSources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.section === "S7" ? "§ 7" : "§ 9"})
            </option>
          ))}
        </SelectField>
        <TextField
          name="defaultDueDays"
          label="Vlastní splatnost (dny)"
          type="number"
          min={0}
          max={365}
          errors={errors}
          hint="Prázdné = výchozí splatnost z nastavení."
          {...bind("defaultDueDays")}
        />
        <div className="sm:col-span-2">
          <CheckboxField
            name="remindersEnabled"
            label="Posílat automatické upomínky"
            hint="Vypněte např. u rodiny nebo dlouholetých nájemníků."
            defaultChecked={initial.remindersEnabled !== "false" && initial.remindersEnabled !== ""}
          />
        </div>
        <TextAreaField name="note" label="Interní poznámka" errors={errors} className="sm:col-span-2" {...bind("note")} />
      </fieldset>

      <div className="flex justify-end">
        <SubmitButton>{defaults.id ? "Uložit změny" : "Uložit odběratele"}</SubmitButton>
      </div>
    </form>
  );
}
