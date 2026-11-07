"use client";

import { useActionState } from "react";
import { CheckboxField, FormMessage, SubmitButton, TextField } from "@/components/form-controls";
import type { ActionResult } from "@/lib/validation";
import { saveReminderSettingsAction } from "./actions";

export function ReminderSettingsForm({
  auto,
  firstDays,
  repeatDays,
  maxCount,
}: {
  auto: boolean;
  firstDays: number;
  repeatDays: number;
  maxCount: number;
}) {
  const [state, action] = useActionState<ActionResult | null, FormData>(saveReminderSettingsAction, null);
  const errors = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <CheckboxField
        name="remindersAuto"
        label="Automaticky posílat upomínky neuhrazených faktur"
        hint="Jen v pracovní dny 8–18 h a jen odběratelům, kteří mají upomínky zapnuté na své kartě."
        defaultChecked={auto}
      />
      <div className="grid grid-cols-3 gap-3">
        <TextField
          name="reminderFirstDays"
          label="První po"
          hint="dnech po splatnosti"
          type="number"
          min={1}
          max={90}
          defaultValue={firstDays}
          errors={errors}
        />
        <TextField
          name="reminderRepeatDays"
          label="Další po"
          hint="dnech (0 = jen jedna)"
          type="number"
          min={0}
          max={90}
          defaultValue={repeatDays}
          errors={errors}
        />
        <TextField
          name="reminderMaxCount"
          label="Nejvýše"
          hint="upomínek k faktuře"
          type="number"
          min={1}
          max={10}
          defaultValue={maxCount}
          errors={errors}
        />
      </div>
      <div className="flex justify-end">
        <SubmitButton variant="secondary">Uložit</SubmitButton>
      </div>
    </form>
  );
}
