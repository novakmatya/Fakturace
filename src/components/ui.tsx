import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap";
const buttonSizes = { sm: "h-8 px-3 text-[13px]", md: "h-10 px-4 text-sm" } as const;
const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white hover:bg-accent-strong shadow-sm",
  secondary: "border border-line bg-surface text-ink hover:bg-panel",
  ghost: "text-muted hover:text-ink hover:bg-panel",
  danger: "border border-danger/25 bg-surface text-danger hover:bg-danger-soft",
};

export function buttonClass(variant: ButtonVariant = "primary", size: keyof typeof buttonSizes = "md") {
  return cx(buttonBase, buttonSizes[size], buttonVariants[variant]);
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant; size?: keyof typeof buttonSizes }) {
  return <button className={cx(buttonClass(variant, size), className)} {...props} />;
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: keyof typeof buttonSizes }) {
  return <Link className={cx(buttonClass(variant, size), className)} {...props} />;
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cx("rounded-xl border border-line bg-surface p-5 sm:p-6", className)}>{children}</section>;
}

export function CardTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-4">
      <h2 className="text-[15px] font-semibold text-ink">{children}</h2>
      {hint ? <p className="mt-1 text-sm text-muted">{hint}</p> : null}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <header className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow ? <p className="label-caps mb-1.5 text-accent">{eyebrow}</p> : null}
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description ? <p className="mt-1.5 max-w-2xl text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

const badgeTones = {
  neutral: "bg-panel text-muted",
  accent: "bg-accent-soft text-accent",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
} as const;

export function Badge({ tone = "neutral", children }: { tone?: keyof typeof badgeTones; children: ReactNode }) {
  return (
    <span className={cx("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", badgeTones[tone])}>
      {children}
    </span>
  );
}

export const inputClass =
  "block w-full rounded-lg border border-line bg-surface px-3 py-2 text-[15px] text-ink placeholder:text-faint shadow-[inset_0_1px_0_rgba(0,0,0,0.02)] transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15 disabled:bg-panel aria-[invalid=true]:border-danger";

export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor: string;
  error?: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-[13px] font-medium text-ink">
        {label}
      </label>
      {children}
      {error ? (
        <p className="mt-1.5 text-[13px] text-danger" id={`${htmlFor}-error`}>
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-[13px] text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function Alert({
  tone = "neutral",
  title,
  children,
}: {
  tone?: "neutral" | "ok" | "warn" | "danger" | "accent";
  title?: ReactNode;
  children?: ReactNode;
}) {
  const tones = {
    neutral: "border-line bg-panel text-ink",
    accent: "border-accent/20 bg-accent-soft text-accent-strong",
    ok: "border-ok/20 bg-ok-soft text-ok",
    warn: "border-warn/20 bg-warn-soft text-warn",
    danger: "border-danger/20 bg-danger-soft text-danger",
  };
  return (
    <div className={cx("rounded-lg border px-4 py-3 text-sm", tones[tone])} role={tone === "danger" ? "alert" : "status"}>
      {title ? <p className="font-medium">{title}</p> : null}
      {children ? <div className={cx(title ? "mt-1" : null, "opacity-90")}>{children}</div> : null}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-surface px-6 py-12 text-center">
      <p className="font-medium text-ink">{title}</p>
      {children ? <p className="mx-auto mt-1.5 max-w-md text-sm text-muted">{children}</p> : null}
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function DefinitionList({ items }: { items: { label: ReactNode; value: ReactNode; wide?: boolean }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
      {items.map((item, i) => (
        <div key={i} className={item.wide ? "sm:col-span-2" : undefined}>
          <dt className="label-caps">{item.label}</dt>
          <dd className="mt-1 text-[15px] text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
