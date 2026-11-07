"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/form-controls";
import type { ActionResult } from "@/lib/validation";
import { backupNowAction } from "./actions";

export function BackupButton() {
  const [state, action] = useActionState<ActionResult | null, FormData>(backupNowAction, null);
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      <SubmitButton variant="secondary" pendingText="Zálohuji…">
        Zálohovat teď
      </SubmitButton>
    </form>
  );
}
