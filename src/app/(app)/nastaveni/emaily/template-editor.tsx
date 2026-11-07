"use client";

import { useActionState, useRef, useState } from "react";
import { FormMessage, SubmitButton } from "@/components/form-controls";
import { Field, inputClass } from "@/components/ui";
import {
  findUnknownPlaceholders,
  PLACEHOLDERS,
  type PlaceholderName,
  renderTemplateText,
  sampleVars,
  type TemplateKey,
} from "@/lib/email/template-text";
import type { ActionResult } from "@/lib/validation";
import { saveTemplateAction } from "./actions";

const samples = sampleVars();

export function TemplateEditor({
  templateKey,
  initial,
}: {
  templateKey: TemplateKey;
  initial: { subject: string; body: string };
}) {
  const [state, action] = useActionState<ActionResult | null, FormData>(saveTemplateAction, null);
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const unknown = findUnknownPlaceholders(`${subject}\n${body}`);

  function insert(name: PlaceholderName) {
    const area = bodyRef.current;
    const token = `{${name}}`;
    if (!area) return setBody((b) => b + token);
    const start = area.selectionStart ?? body.length;
    const end = area.selectionEnd ?? body.length;
    const next = body.slice(0, start) + token + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(start + token.length, start + token.length);
    });
  }

  const previewSubject = renderTemplateText(subject, samples);
  const previewParagraphs = renderTemplateText(body, samples)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <form action={action} className="space-y-4">
        <input type="hidden" name="key" value={templateKey} />
        <FormMessage state={state} />
        <Field label="Předmět" htmlFor="subject">
          <input id="subject" name="subject" className={inputClass} value={subject} onChange={(e) => setSubject(e.target.value)} required />
        </Field>
        <Field label="Text" htmlFor="body">
          <textarea
            id="body"
            name="body"
            ref={bodyRef}
            rows={14}
            className={inputClass}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
          />
        </Field>
        <div>
          <p className="label-caps mb-2">Vložit proměnnou</p>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(PLACEHOLDERS) as PlaceholderName[]).map((name) => (
              <button
                key={name}
                type="button"
                title={PLACEHOLDERS[name].label}
                onClick={() => insert(name)}
                className="rounded-md border border-line bg-panel px-2 py-1 font-mono text-xs text-ink hover:border-accent/40 hover:text-accent"
              >
                {`{${name}}`}
              </button>
            ))}
          </div>
          {unknown.length ? (
            <p className="mt-2 text-[13px] text-danger">
              Neznámé proměnné: {unknown.map((u) => `{${u}}`).join(", ")} – šablonu s nimi nelze uložit.
            </p>
          ) : null}
        </div>
        <div className="flex justify-end">
          <SubmitButton disabled={unknown.length > 0}>Uložit šablonu</SubmitButton>
        </div>
      </form>

      <div>
        <p className="label-caps mb-2">Náhled s ukázkovými údaji</p>
        <div className="rounded-xl border border-line bg-[#f4f3ef] p-4">
          <div className="rounded-lg border border-line border-t-[3px] border-t-accent bg-surface px-6 py-5">
            <p className="mb-4 border-b border-line pb-3 text-sm font-medium">{previewSubject}</p>
            <div className="space-y-3 text-[14px] leading-relaxed">
              {previewParagraphs.map((p, i) => (
                <p key={i} className="whitespace-pre-line">
                  {p}
                </p>
              ))}
            </div>
            <p className="mt-4 text-[12px] text-muted">Příloha: Faktura-20260001.pdf</p>
          </div>
        </div>
      </div>
    </div>
  );
}
