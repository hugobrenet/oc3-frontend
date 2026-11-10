import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Combobox } from "@/components/ui/Combobox";
import { Markdown } from "@/components/ui/Markdown";
import { CloseIcon } from "@/components/ui/icons";
import { AI_BACKENDS, useAIGroups, type AIBackend } from "./ai-content-api";
import { AI_LIMITS, byteLength, type Problem } from "./ai-content-draft";

export const INPUT = "h-8 w-full rounded-(--radius-control) border border-line bg-surface px-2";
export const AREA =
  "w-full rounded-(--radius-control) border border-line bg-surface px-2 py-1 font-mono";
export const FIELDSET = "flex flex-col gap-3 rounded-(--radius-panel) border border-line p-3";

/** A labelled field of the form, its hint under it. */
export function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block font-medium" htmlFor={id}>
        {label}
      </label>
      {children}
      {hint !== undefined && <p className="mt-1 text-ink-muted">{hint}</p>}
    </div>
  );
}

/**
 * What every text of the assistant carries: the model takes it as instructions,
 * for each user it is published to.
 */
export function InstructionsWarning() {
  const { t } = useTranslation();
  return (
    <p
      role="note"
      className="rounded-(--radius-control) border border-state-warn/40 bg-state-warn/10 px-3 py-2"
    >
      <span aria-hidden="true" className="text-state-warn">
        ▲
      </span>{" "}
      {t("aiContent.warning")}
    </p>
  );
}

/** The backends a text is for: the collector, the clusters, or both. */
export function BackendsField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: AIBackend[];
  onChange: (value: AIBackend[]) => void;
}) {
  const { t } = useTranslation();
  return (
    <div role="group" aria-labelledby={`${id}-backends`}>
      <p id={`${id}-backends`} className="mb-1 font-medium">
        {t("aiContent.fields.backends")}
      </p>
      <div className="flex flex-wrap gap-4">
        {AI_BACKENDS.map((b) => (
          <label key={b} className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={value.includes(b)}
              onChange={(event) => {
                onChange(
                  event.target.checked
                    ? AI_BACKENDS.filter((x) => x === b || value.includes(x))
                    : value.filter((x) => x !== b),
                );
              }}
            />
            {t(`aiContent.backends.${b}`)}
          </label>
        ))}
      </div>
      <p className="mt-1 text-ink-muted">{t("aiContent.form.backendsHint")}</p>
    </div>
  );
}

/** The groups a text is published to; none, everybody reads it. */
export function PublicationsField({
  value,
  onChange,
}: {
  value: number[];
  onChange: (value: number[]) => void;
}) {
  const { t } = useTranslation();
  const groups = useAIGroups();
  const chosen = value.map(
    (gid) => groups.data?.find((g) => g.id === gid) ?? { id: gid, role: String(gid) },
  );
  return (
    <fieldset className={FIELDSET}>
      <legend className="px-1 font-medium">{t("aiContent.fields.publications")}</legend>
      <p className="text-ink-muted">{t("aiContent.form.publicationsHint")}</p>
      {chosen.length === 0 ? (
        <p>
          <span aria-hidden="true" className="text-state-warn">
            ▲
          </span>{" "}
          {t("aiContent.everybody")}
        </p>
      ) : (
        <ul aria-label={t("aiContent.fields.publications")} className="flex flex-wrap gap-1.5">
          {chosen.map((entry) => (
            <li
              key={entry.id}
              className="flex h-6 items-center gap-1 rounded-full border border-line bg-surface pr-0.5 pl-2"
            >
              {entry.role}
              <button
                type="button"
                onClick={() => {
                  onChange(value.filter((gid) => gid !== entry.id));
                }}
                title={t("aiContent.form.removeGroup", { group: entry.role })}
                className="rounded-full p-0.5 text-ink-muted hover:bg-surface-sunken hover:text-ink"
              >
                <CloseIcon className="h-3 w-3" />
                <span className="sr-only">
                  {t("aiContent.form.removeGroup", { group: entry.role })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Combobox
        options={(groups.data ?? [])
          .filter((g) => !value.includes(g.id))
          .map((g) => ({ value: String(g.id), label: g.role }))}
        // Picking a group adds it: the field is ready for the next one.
        value=""
        onChange={(picked) => {
          if (picked !== "") onChange([...value, Number(picked)]);
        }}
        label={t("aiContent.form.addGroup")}
        placeholder={t("aiContent.form.addGroup")}
        emptyText={t("compEditor.noMatch")}
        className="w-64"
      />
    </fieldset>
  );
}

/**
 * The text itself, written or previewed: a Markdown text renders as the
 * assistant's answers do, a plain one as it is. Its size against the bound of
 * the API, in bytes.
 */
export function BodyField({
  id,
  label,
  hint,
  value,
  onChange,
  markdown,
  preview,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  markdown: boolean;
  /** What the preview shows, when not the text as is (a SKILL.md without its frontmatter). */
  preview?: ReactNode;
}) {
  const { t } = useTranslation();
  const [previewing, setPreviewing] = useState(false);
  const size = byteLength(value);
  const tab = (on: boolean, text: string) => (
    <button
      type="button"
      aria-pressed={previewing === on}
      onClick={() => {
        setPreviewing(on);
      }}
      className={`rounded-(--radius-control) px-2 py-0.5 ${
        previewing === on ? "bg-accent-soft text-ink" : "text-ink-muted hover:text-ink"
      }`}
    >
      {text}
    </button>
  );
  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <label className="font-medium" htmlFor={id}>
          {label}
        </label>
        <span className="ml-auto flex gap-1">
          {tab(false, t("aiContent.form.write"))}
          {tab(true, t("aiContent.form.preview"))}
        </span>
      </div>
      {previewing ? (
        <div className="max-h-[60vh] min-h-40 overflow-auto rounded-(--radius-control) border border-line bg-surface p-3">
          {preview ??
            (markdown ? (
              <Markdown text={value} />
            ) : (
              <pre className="font-mono whitespace-pre-wrap">{value}</pre>
            ))}
        </div>
      ) : (
        <textarea
          id={id}
          rows={18}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
          }}
          spellCheck={false}
          className={AREA}
        />
      )}
      <p className="mt-1 flex flex-wrap gap-x-3 text-ink-muted">
        {hint !== undefined && <span>{hint}</span>}
        <span className={`ml-auto ${size > AI_LIMITS.body ? "text-state-down" : ""}`}>
          {t("aiContent.form.size", { size, max: AI_LIMITS.body })}
        </span>
      </p>
    </div>
  );
}

/** Why the form was not sent, as the checks of `ai-content-draft` found it. */
export function Problems({ problems }: { problems: Problem[] }) {
  const { t } = useTranslation();
  if (problems.length === 0) return null;
  return (
    <ul role="alert" className="flex flex-col gap-0.5 text-state-down">
      {problems.map((p) => (
        <li key={p.key}>■ {t(`aiContent.problems.${p.key}`, p.values)}</li>
      ))}
    </ul>
  );
}
