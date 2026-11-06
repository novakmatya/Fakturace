"use client";

import { useFormStatus } from "react-dom";
import type { ComponentProps, ReactNode } from "react";
import { Alert, buttonClass, cx, Field, inputClass } from "@/components/ui";
import type { ActionResult } from "@/lib/validation";

export function SubmitButton({
  children,
  pendingText = "Ukládám…",
  variant = "primary",
  className,
  ...props
}: ComponentProps<"button"> & { pendingText?: string; variant?: "primary" | "secondary" | "danger" | "ghost" }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || props.disabled}
      className={cx(buttonClass(variant), className)}
      {...props}
    >
      {pending ? pendingText : children}
    </button>
  );
}

type ControlProps = {
  name: string;
  label: ReactNode;
  errors?: Record<string, string>;
  hint?: ReactNode;
  className?: string;
};

export function TextField({
  name,
  label,
  errors,
  hint,
  className,
  ...input
}: ControlProps & Omit<ComponentProps<"input">, "name">) {
  const error = errors?.[name];
  return (
    <Field label={label} htmlFor={name} error={error} hint={hint} className={className}>
      <input
        id={name}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${name}-error` : undefined}
        className={inputClass}
        {...input}
      />
    </Field>
  );
}

export function SelectField({
  name,
  label,
  errors,
  hint,
  className,
  children,
  ...select
}: ControlProps & Omit<ComponentProps<"select">, "name">) {
  const error = errors?.[name];
  return (
    <Field label={label} htmlFor={name} error={error} hint={hint} className={className}>
      <select id={name} name={name} aria-invalid={error ? true : undefined} className={inputClass} {...select}>
        {children}
      </select>
    </Field>
  );
}

export function TextAreaField({
  name,
  label,
  errors,
  hint,
  className,
  ...area
}: ControlProps & Omit<ComponentProps<"textarea">, "name">) {
  const error = errors?.[name];
  return (
    <Field label={label} htmlFor={name} error={error} hint={hint} className={className}>
      <textarea id={name} name={name} aria-invalid={error ? true : undefined} className={inputClass} rows={3} {...area} />
    </Field>
  );
}

export function CheckboxField({
  name,
  label,
  hint,
  defaultChecked,
}: {
  name: string;
  label: ReactNode;
  hint?: ReactNode;
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex items-start gap-3 text-sm" htmlFor={name}>
      <input
        id={name}
        name={name}
        type="checkbox"
        defaultChecked={defaultChecked}
        className="mt-0.5 size-4 rounded border-line accent-[var(--color-accent)]"
      />
      <span>
        <span className="font-medium text-ink">{label}</span>
        {hint ? <span className="mt-0.5 block text-[13px] text-muted">{hint}</span> : null}
      </span>
    </label>
  );
}

export function FormMessage({ state }: { state: ActionResult<unknown> | null }) {
  if (!state) return null;
  if (state.ok && state.message) return <Alert tone="ok">{state.message}</Alert>;
  if (!state.ok && state.error) return <Alert tone="danger">{state.error}</Alert>;
  if (!state.ok && state.fieldErrors && Object.keys(state.fieldErrors).length > 0) {
    return <Alert tone="danger">Zkontrolujte prosím zvýrazněná pole.</Alert>;
  }
  return null;
}
