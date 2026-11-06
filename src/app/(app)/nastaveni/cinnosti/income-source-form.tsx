"use client";

import { useActionState, useState } from "react";
import { CheckboxField, FormMessage, SelectField, SubmitButton, TextField } from "@/components/form-controls";
import { PAUSAL_CATEGORIES } from "@/lib/validation";
import { saveIncomeSourceAction, type FormState } from "../actions";

export type IncomeSourceDefaults = {
  id?: string;
  name: string;
  section: "S7" | "S9";
  pausalCategory: string;
  shareNumerator: string;
  shareDenominator: string;
  printIco: boolean;
  printRegisterText: boolean;
};

export const EMPTY_SOURCE: IncomeSourceDefaults = {
  name: "",
  section: "S7",
  pausalCategory: "P60",
  shareNumerator: "1",
  shareDenominator: "1",
  printIco: true,
  printRegisterText: true,
};

type SubmitState = (FormState & { at: number }) | null;

export function IncomeSourceForm({ defaults }: { defaults: IncomeSourceDefaults }) {
  const [state, action] = useActionState<SubmitState, FormData>(
    async (prev, formData) => ({ ...(await saveIncomeSourceAction(prev, formData)), at: Date.now() }),
    null,
  );
  const failed = state && !state.ok ? state : null;
  // Po každém odeslání se pole vykreslí znovu: po chybě s odeslanými hodnotami, po úspěchu prázdná.
  return (
    <form action={action} className="space-y-5" key={state ? `${state.ok}-${state.at}` : "initial"}>
      <FormMessage state={state} />
      <IncomeSourceFields defaults={defaults} values={failed?.values} errors={failed?.fieldErrors} />
    </form>
  );
}

function IncomeSourceFields({
  defaults,
  values,
  errors,
}: {
  defaults: IncomeSourceDefaults;
  values?: Record<string, string>;
  errors?: Record<string, string>;
}) {
  const v = (key: keyof IncomeSourceDefaults) => String(values?.[key] ?? defaults[key] ?? "");
  const [section, setSection] = useState<"S7" | "S9">(values?.section === "S9" ? "S9" : values ? "S7" : defaults.section);

  return (
    <>
      {defaults.id ? <input type="hidden" name="id" value={defaults.id} /> : null}
      <TextField name="name" label="Název činnosti" defaultValue={v("name")} errors={errors} required placeholder="Např. Právní konzultace, Pronájem bytu" />
      <SelectField
        name="section"
        label="Druh příjmu"
        defaultValue={section}
        errors={errors}
        onChange={(e) => setSection(e.target.value as "S7" | "S9")}
      >
        <option value="S7">§ 7 – samostatná činnost (podnikání)</option>
        <option value="S9">§ 9 – nájem</option>
      </SelectField>
      {section === "S7" ? (
        <SelectField
          name="pausalCategory"
          label="Kategorie paušálu"
          defaultValue={v("pausalCategory") || "P60"}
          errors={errors}
          hint="Sazby a stropy se berou z daňových parametrů daného roku."
        >
          {Object.entries(PAUSAL_CATEGORIES).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </SelectField>
      ) : (
        <input type="hidden" name="pausalCategory" value="" />
      )}
      <div className="grid grid-cols-2 gap-4">
        <TextField name="shareNumerator" label="Podíl – čitatel" type="number" min={1} defaultValue={v("shareNumerator") || "1"} errors={errors} />
        <TextField name="shareDenominator" label="Podíl – jmenovatel" type="number" min={1} defaultValue={v("shareDenominator") || "1"} errors={errors} />
      </div>
      <p className="-mt-2 text-[13px] text-muted">Podíl na příjmu, např. 1/2 u nemovitosti ve spoluvlastnictví. Výchozí 1/1. (Pravidla ke spoluvlastnictví: OVĚŘIT 5.)</p>
      <div className="space-y-3">
        <CheckboxField name="printIco" label="Tisknout na dokladu IČO" defaultChecked={values ? values.printIco === "on" : defaults.printIco} />
        <CheckboxField
          name="printRegisterText"
          label="Tisknout údaj o zápisu do živnostenského rejstříku"
          hint="U pronájmu, který není podnikáním, obvykle vypnout."
          defaultChecked={values ? values.printRegisterText === "on" : defaults.printRegisterText}
        />
      </div>
      <div className="flex justify-end">
        <SubmitButton>{defaults.id ? "Uložit změny" : "Přidat činnost"}</SubmitButton>
      </div>
    </>
  );
}
