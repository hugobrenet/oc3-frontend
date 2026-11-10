import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { YamlCode } from "@/components/ui/YamlCode";
import { dateTimeFormat } from "@/lib/date-format";
import { formatRelativeInstant } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { ArgumentsForm } from "./ArgumentsForm";
import {
  argumentsOf,
  compileSchema,
  draftOf,
  formFields,
  sameArguments,
  type Draft,
  type FieldError,
} from "./arguments-form";
import type { Args, Preview, PreviewChange, ToolDoc } from "./assistant-client";
import type { ChatConfirmation } from "./use-assistant-chat";

/** The MIME types shown as YAML: the registered one and its usual aliases. */
const YAML_TYPES = new Set(["application/yaml", "application/x-yaml", "text/yaml", "text/x-yaml"]);

const BOX = "rounded-(--radius-control) bg-surface-sunken p-2 font-mono text-data";

/** A text, its lines numbered: a file the call writes. */
function NumberedText({ text }: { text: string }) {
  const lines = text.replace(/\n$/, "").split("\n");
  return (
    <pre className={`max-h-80 overflow-auto whitespace-pre ${BOX}`}>
      <code className="table">
        {lines.map((line, index) => (
          <span key={index} className="table-row">
            <span
              data-testid="content-line-number"
              aria-hidden="true"
              className="table-cell pr-3 text-right text-ink-muted select-none"
            >
              {index + 1}
            </span>
            <span className="table-cell">{line}</span>
          </span>
        ))}
      </code>
    </pre>
  );
}

/**
 * The arguments of the call, each as its MIME type says (`argumentTypes`), never
 * as its content looks: YAML as code, coloured, indentation kept; any other text
 * as written, its line breaks and spaces kept; a value other than text as JSON.
 * A short value stands on the line of its name, as in the om3 webapp; a block,
 * a YAML or a text of several lines, under it, the width of the card. What an
 * argument is, from the tools of the agent, shows on hover of its name.
 */
function ConfirmationArguments({
  args,
  types,
  descriptions,
}: {
  args: Args;
  types: Record<string, string>;
  descriptions: Record<string, string>;
}) {
  return (
    <dl className="grid max-h-96 grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1 overflow-auto">
      {Object.entries(args).map(([name, value]) => {
        const type = Object.hasOwn(types, name) ? types[name] : undefined;
        const description = Object.hasOwn(descriptions, name) ? descriptions[name] : undefined;
        const yaml = typeof value === "string" && type !== undefined && YAML_TYPES.has(type);
        const block =
          yaml || (typeof value === "string" && (type !== undefined || value.includes("\n")));
        const span = block ? "col-span-2" : "";
        return (
          <div key={name} className="contents">
            <dt className={`flex items-baseline gap-2 ${span}`}>
              <code
                title={description}
                className={`font-mono font-medium ${description !== undefined ? "cursor-help underline decoration-dotted underline-offset-2" : ""}`}
              >
                {name}
              </code>
              {type !== undefined && <span className="text-data text-ink-muted">{type}</span>}
            </dt>
            <dd className={`min-w-0 ${span}`}>
              {yaml ? (
                <YamlCode text={value} lineNumbers className={`overflow-x-auto ${BOX}`} />
              ) : typeof value === "string" && (type !== undefined || value.includes("\n")) ? (
                <pre className={`break-words whitespace-pre-wrap ${BOX}`}>{value}</pre>
              ) : (
                <code className="font-mono text-data [overflow-wrap:anywhere]">
                  {typeof value === "string" ? value : JSON.stringify(value)}
                </code>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether an argument carries nothing: null, an empty text, list or object, or
 * false for a plain boolean of the schema, none of which the MCP tells from the
 * argument left out. A model may fill every optional filter of a tool so: they
 * change nothing in the call, and would bury the one that names its target.
 */
function unsetArgument(value: unknown, property: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  if (isRecord(value)) return Object.keys(value).length === 0;
  // A boolean that may be null, or that defaults to true, means something false.
  return (
    value === false &&
    isRecord(property) &&
    property.type === "boolean" &&
    !Object.hasOwn(property, "default")
  );
}

/** The arguments of a call that carry a value: the required ones always. */
function setArguments(args: Args, schema: Args | undefined): Args {
  const properties = isRecord(schema?.properties) ? schema.properties : {};
  const required = new Set(Array.isArray(schema?.required) ? (schema.required as unknown[]) : []);
  return Object.fromEntries(
    Object.entries(args).filter(
      ([name, value]) =>
        required.has(name) ||
        !unsetArgument(value, Object.hasOwn(properties, name) ? properties[name] : undefined),
    ),
  );
}

/** A value of the preview, as text; its absence, by what it means. */
function PreviewValue({ value, missing }: { value: string | undefined; missing: string }) {
  if (value === undefined || value === "")
    return <span className="text-ink-muted italic">{missing}</span>;
  return <code className="font-mono break-all whitespace-pre-wrap">{value}</code>;
}

/**
 * What the call would do, as the MCP told it: the keys it changes, with their
 * configured value read now and the one the MCP computes, the sections it
 * deletes with their keys, the file it writes.
 */
function PreviewDetails({ preview }: { preview: Preview }) {
  const { t, i18n } = useTranslation();
  // The notes of a change, in the language of the page by their keys when it
  // knows them all, as the MCP wrote them otherwise.
  const note = (change: PreviewChange) =>
    change.noteKeys.length > 0 &&
    change.noteKeys.every((key) => i18n.exists(`assistant.confirm.notes.${key}`))
      ? change.noteKeys.map((key) => t(`assistant.confirm.notes.${key}`)).join("; ")
      : change.note;
  // A creation has no current values: the column is left out.
  const current = preview.changes.some((change) => change.before !== undefined);
  const content = preview.content;
  const time = dateTimeFormat({ hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return (
    <div className="flex flex-col gap-2">
      {preview.changes.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">{t("assistant.confirm.changes")}</caption>
            <thead>
              <tr className="border-b border-line text-ink-muted">
                <th scope="col" className="py-1 pr-3 font-medium">
                  {t("assistant.confirm.key")}
                </th>
                {current && (
                  <th scope="col" className="py-1 pr-3 font-medium">
                    {t("assistant.confirm.current")}
                  </th>
                )}
                <th scope="col" className="py-1 pr-3 font-medium">
                  {t("assistant.confirm.operation")}
                </th>
                <th scope="col" className="py-1 font-medium">
                  {t("assistant.confirm.proposed")}
                  <span aria-hidden="true">*</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {preview.changes.map((change, index) => {
                const secret =
                  change.before === undefined &&
                  change.after === undefined &&
                  change.value === undefined &&
                  change.op !== "unset";
                return (
                  <tr key={index} className="border-b border-line align-top last:border-b-0">
                    <th scope="row" className="py-1 pr-3 font-normal">
                      <code className="font-mono break-all">{change.key}</code>
                      {change.note !== "" && (
                        <span className="block text-ink-muted">{note(change)}</span>
                      )}
                    </th>
                    {current && (
                      <td className="py-1 pr-3">
                        <PreviewValue
                          value={change.before}
                          missing={
                            secret ? t("assistant.confirm.hidden") : t("assistant.confirm.empty")
                          }
                        />
                      </td>
                    )}
                    <td className="py-1 pr-3">
                      {t(`assistant.confirm.ops.${change.op}`)}
                      {change.value !== undefined && (
                        <>
                          {" "}
                          <code className="font-mono break-all whitespace-pre-wrap">
                            {change.value}
                          </code>
                        </>
                      )}
                    </td>
                    <td className="py-1">
                      {change.after !== undefined ? (
                        <PreviewValue value={change.after} missing={t("assistant.confirm.empty")} />
                      ) : (
                        <span className="text-ink-muted italic">
                          {secret
                            ? t("assistant.confirm.hidden")
                            : t("assistant.confirm.notComputed")}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-1 text-ink-muted">
            <span aria-hidden="true">* </span>
            {t("assistant.confirm.computed")}
          </p>
        </div>
      )}
      {preview.deleted.map((section) => (
        <div key={section.section}>
          <p>
            {section.keys.length > 0
              ? t("assistant.confirm.deleted", {
                  section: section.section,
                  count: section.keys.length,
                })
              : t("assistant.confirm.deletedEmpty", { section: section.section })}
          </p>
          {section.secretsOmitted > 0 && (
            <p className="text-ink-muted">
              {t("assistant.confirm.deletedSecrets", { count: section.secretsOmitted })}
            </p>
          )}
          {section.keys.length > 0 && (
            <ul aria-label={section.section} className="ml-4 list-disc">
              {section.keys.map((key) => (
                <li key={key}>
                  <code className="font-mono break-all">{key}</code>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      {content !== undefined && (
        <div
          role="group"
          aria-label={t("assistant.confirm.content")}
          className="flex flex-col gap-1"
        >
          <p className="flex items-baseline gap-2">
            <span className="font-medium">{t("assistant.confirm.content")}</span>
            <span className="text-data text-ink-muted">{content.mediaType}</span>
          </p>
          {YAML_TYPES.has(content.mediaType) ? (
            <YamlCode text={content.text} lineNumbers className={`max-h-80 overflow-auto ${BOX}`} />
          ) : (
            <NumberedText text={content.text} />
          )}
          {content.truncated && (
            <p className="text-ink-muted">{t("assistant.confirm.contentTruncated")}</p>
          )}
        </div>
      )}
      {preview.secretsOmitted > 0 && (
        <p className="text-ink-muted">
          {t("assistant.confirm.secrets", { count: preview.secretsOmitted })}
        </p>
      )}
      {preview.warnings.map((warning, index) => (
        <p key={index} className="text-state-warn">
          {warning}
        </p>
      ))}
      {preview.readAt !== "" && (
        <p className="text-ink-muted">
          {t("assistant.confirm.readAt", { time: time.format(new Date(preview.readAt)) })}
        </p>
      )}
    </div>
  );
}

/**
 * The tool call waiting for the decision of the user. It shows the call as the
 * agent stored it, the one that runs if approved, never the text of the model;
 * and, when the MCP told it, what the call would do. A call the user may edit is
 * edited in a form built from the input schema of its tool, the arguments the
 * model proposed filled in; after an edit, the preview is asked again for the
 * edited arguments, nothing running. Past its expiry, the call cannot run.
 */
export function ConfirmationCard({
  confirmation,
  doc,
  busy,
  previewing,
  queued,
  onApprove,
  onReject,
  onPreview,
}: {
  confirmation: ChatConfirmation;
  /** What the tool and its arguments do, from the tools of the agent, when it lists them. */
  doc: ToolDoc | undefined;
  busy: boolean;
  previewing: boolean;
  /** A message waits in the queue for the decision. */
  queued: boolean;
  onApprove: (editedArgs?: Args) => void;
  onReject: () => void;
  onPreview: (editedArgs: Args) => void;
}) {
  const { t, i18n } = useTranslation();
  const now = useNow(1000);
  const expiresAt = Date.parse(confirmation.expiresAt);
  const expired = expiresAt <= now;
  const destructive = confirmation.tool.destructive;
  const preview = confirmation.preview;
  // The arguments that carry a value: the empty ones change nothing in the call.
  const shown = useMemo(
    () => setArguments(confirmation.arguments, confirmation.inputSchema),
    [confirmation],
  );
  const fields = useMemo(
    () =>
      confirmation.editable
        ? formFields(confirmation.inputSchema, confirmation.arguments, confirmation.argumentTypes)
        : [],
    [confirmation],
  );
  const validate = useMemo(
    () => (confirmation.editable ? compileSchema(confirmation.inputSchema) : null),
    [confirmation],
  );
  const draftsOf = (args: Args) =>
    Object.fromEntries(fields.map((field) => [field.name, draftOf(field, args[field.name])]));
  // A preview asked again for an edit comes back with that edit: the form shows
  // it again. The card is keyed by its confirmation, which starts it afresh.
  const [editing, setEditing] = useState(confirmation.previewArguments !== undefined);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    draftsOf(confirmation.previewArguments ?? confirmation.arguments),
  );
  const edit = editing ? argumentsOf(fields, drafts, confirmation.arguments) : null;
  const changed = edit !== null && !sameArguments(edit.args, confirmation.arguments);
  const errors: Record<string, FieldError> =
    edit === null
      ? {}
      : { ...(changed && validate !== null ? validate(edit.args) : {}), ...edit.errors };
  const invalid = Object.keys(errors).length > 0;
  const approve = () => {
    onApprove(changed ? edit.args : undefined);
  };
  // The arguments the preview is of: those of the call, or an edit.
  const previewOf = confirmation.previewArguments ?? confirmation.arguments;
  const stale = edit !== null && !invalid && !sameArguments(edit.args, previewOf);
  const description = doc?.description ?? "";
  const muted = "text-data text-ink-muted";

  return (
    <section
      aria-label={t("assistant.confirm.region")}
      className={`mx-3 mb-2 flex max-h-[60dvh] flex-col gap-2 overflow-y-auto rounded-(--radius-panel) border bg-surface-raised p-3 ${destructive ? "border-state-down" : "border-state-warn"}`}
    >
      <p className="font-medium">
        <span aria-hidden="true" className={destructive ? "text-state-down" : "text-state-warn"}>
          ▲{" "}
        </span>
        {destructive ? t("assistant.confirm.destructive") : t("assistant.confirm.action")}
      </p>
      {preview !== undefined && (
        <p className="font-medium [overflow-wrap:anywhere]">{preview.summary.text}</p>
      )}
      <p className="[overflow-wrap:anywhere]">
        <span className={preview !== undefined ? muted : "font-medium"}>
          {confirmation.tool.title}
        </span>
        <span className={muted}> · {t("assistant.confirm.tool")} </span>
        {/* What the tool does, as the model read it, on hover. */}
        <code
          title={description !== "" ? description : undefined}
          className={`font-mono text-data font-semibold ${description !== "" ? "cursor-help underline decoration-dotted underline-offset-2" : ""}`}
        >
          {confirmation.tool.name}
        </code>
      </p>
      {preview !== undefined && <PreviewDetails preview={preview} />}
      {confirmation.previewError !== undefined && (
        <p className={muted}>
          {t("assistant.confirm.previewError", { error: confirmation.previewError })}
        </p>
      )}
      {preview !== undefined && confirmation.previewArguments !== undefined && !stale && (
        <p className={muted}>{t("assistant.confirm.previewOfEdit")}</p>
      )}
      {preview !== undefined && stale && (
        <p className="text-data text-state-warn">{t("assistant.confirm.previewStale")}</p>
      )}
      {editing ? (
        <form
          aria-label={t("assistant.confirm.form")}
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy && !invalid && !expired) approve();
          }}
        >
          <ArgumentsForm
            fields={fields}
            drafts={drafts}
            errors={errors}
            disabled={busy}
            onChange={(name, value) => {
              setDrafts((previous) => ({ ...previous, [name]: value }));
            }}
          />
        </form>
      ) : Object.keys(shown).length > 0 ? (
        // Folded: the tool and the preview name the action; the list holds its arguments.
        <details>
          <summary className="cursor-pointer text-ink-muted">
            {t("assistant.confirm.arguments")}
          </summary>
          <div className="mt-1">
            <ConfirmationArguments
              args={shown}
              types={confirmation.argumentTypes}
              descriptions={doc?.arguments ?? {}}
            />
          </div>
        </details>
      ) : (
        <p className={muted}>{t("assistant.confirm.noArguments")}</p>
      )}
      {Number.isFinite(expiresAt) && (
        <p className={expired ? "text-state-down" : muted}>
          {expired
            ? `■ ${t("assistant.confirm.expired")}`
            : t("assistant.confirm.expires", {
                when: formatRelativeInstant(expiresAt, i18n.language, now),
              })}
          {!expired && changed && t("assistant.confirm.withChanges")}
        </p>
      )}
      {preview !== undefined && <p className={muted}>{t("assistant.confirm.mayRefuse")}</p>}
      {queued && <p className={muted}>{t("assistant.confirm.queuedNote")}</p>}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {previewing && (
          <span role="status" className="text-ink-muted">
            <span aria-hidden="true" className="animate-pulse">
              ○{" "}
            </span>
            {t("assistant.confirm.previewing")}
          </span>
        )}
        {confirmation.editable && !editing && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setEditing(true);
            }}
            className="h-8 rounded-(--radius-control) border border-line px-3 disabled:opacity-60"
          >
            {t("assistant.confirm.edit")}
          </button>
        )}
        {editing && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setDrafts(draftsOf(confirmation.arguments));
              setEditing(false);
            }}
            className="h-8 rounded-(--radius-control) border border-line px-3 disabled:opacity-60"
          >
            {t("assistant.confirm.discard")}
          </button>
        )}
        {editing && preview !== undefined && changed && (
          <button
            type="button"
            disabled={busy || invalid || !stale}
            onClick={() => {
              onPreview(edit.args);
            }}
            className="h-8 rounded-(--radius-control) border border-line px-3 disabled:opacity-60"
          >
            {t("assistant.confirm.recompute")}
          </button>
        )}
        <button
          type="button"
          autoFocus
          disabled={busy}
          onClick={onReject}
          className="h-8 rounded-(--radius-control) border border-line px-3 disabled:opacity-60"
        >
          {t("assistant.confirm.reject")}
        </button>
        <button
          type="button"
          disabled={busy || invalid || expired}
          onClick={approve}
          className={`h-8 rounded-(--radius-control) px-3 font-medium text-accent-ink disabled:opacity-60 ${destructive ? "bg-state-down" : "bg-accent"}`}
        >
          {changed ? t("assistant.confirm.approveEdited") : t("assistant.confirm.approve")}
        </button>
      </div>
    </section>
  );
}
