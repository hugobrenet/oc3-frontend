import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { Draft, FieldError, FormField } from "./arguments-form";

const CONTROL =
  "w-full rounded-(--radius-control) border border-line bg-surface px-2 text-ink disabled:opacity-60";

/** An error of a field, in the language of the page when it is one of the form's own. */
function useErrorText() {
  const { t } = useTranslation();
  return (error: FieldError) =>
    typeof error === "string" ? t(`assistant.confirm.formErrors.${error}`) : error.message;
}

/** One control of the form: its label from the schema, its description, its error. */
function Field({
  field,
  value,
  error,
  disabled,
  onChange,
}: {
  field: FormField;
  value: Draft;
  error: FieldError | undefined;
  disabled: boolean;
  onChange: (value: Draft) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const errorText = useErrorText();
  const hint =
    field.description !== ""
      ? field.description
      : field.kind === "lines"
        ? t("assistant.confirm.oneValuePerLine")
        : "";
  const label = (
    <>
      <code className="font-mono">{field.name}</code>
      {field.required && <span aria-hidden="true"> *</span>}
      {field.mediaType !== "" && (
        <span className="ml-2 font-normal text-ink-muted">{field.mediaType}</span>
      )}
    </>
  );
  const describedBy = [hint !== "" ? `${id}-hint` : "", error !== undefined ? `${id}-error` : ""]
    .filter((part) => part !== "")
    .join(" ");
  const common = {
    id,
    disabled,
    "aria-required": field.required || undefined,
    "aria-invalid": error !== undefined || undefined,
    "aria-describedby": describedBy === "" ? undefined : describedBy,
  };
  const text = typeof value === "string" ? value : "";
  return (
    <div className="flex flex-col gap-1">
      {field.kind === "boolean" ? (
        <label className="flex items-center gap-2 font-medium">
          <input
            type="checkbox"
            {...common}
            checked={value === true}
            onChange={(event) => {
              onChange(event.target.checked);
            }}
          />
          {label}
        </label>
      ) : (
        <label htmlFor={id} className="font-medium">
          {label}
        </label>
      )}
      {field.kind === "enum" ? (
        <select
          {...common}
          value={text}
          onChange={(event) => {
            onChange(event.target.value);
          }}
          className={`h-8 ${CONTROL}`}
        >
          {!field.required && <option value="">—</option>}
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : field.kind === "number" || field.kind === "string" ? (
        <input
          type="text"
          {...common}
          inputMode={field.kind === "number" ? "decimal" : undefined}
          value={text}
          onChange={(event) => {
            onChange(event.target.value);
          }}
          className={`h-8 ${CONTROL}`}
        />
      ) : field.kind === "boolean" ? null : (
        <textarea
          {...common}
          rows={Math.min(12, Math.max(3, text.split("\n").length))}
          spellCheck={false}
          value={text}
          onChange={(event) => {
            onChange(event.target.value);
          }}
          className={`resize-y py-1 font-mono text-data whitespace-pre ${CONTROL}`}
        />
      )}
      {hint !== "" && (
        <p id={`${id}-hint`} className="text-ink-muted">
          {hint}
        </p>
      )}
      {error !== undefined && (
        <p id={`${id}-error`} className="text-state-down">
          {errorText(error)}
        </p>
      )}
    </div>
  );
}

/**
 * The controls of the arguments of a call the user may edit, one per field of
 * its input schema. The labels and descriptions come from the MCP; the values
 * the model proposed are filled in, as text.
 */
export function ArgumentsForm({
  fields,
  drafts,
  errors,
  disabled,
  onChange,
}: {
  fields: FormField[];
  drafts: Record<string, Draft>;
  errors: Record<string, FieldError>;
  disabled: boolean;
  onChange: (name: string, value: Draft) => void;
}) {
  const errorText = useErrorText();
  const general = errors[""];
  return (
    <div className="flex flex-col gap-2">
      {fields.map((field) => (
        <Field
          key={field.name}
          field={field}
          value={drafts[field.name] ?? ""}
          error={errors[field.name]}
          disabled={disabled}
          onChange={(value) => {
            onChange(field.name, value);
          }}
        />
      ))}
      {general !== undefined && (
        <p role="alert" className="text-state-down">
          {errorText(general)}
        </p>
      )}
    </div>
  );
}
