import { useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ObjectIcon } from "@/components/opensvc/ObjectIcon";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { Markdown } from "@/components/ui/Markdown";
import { SlideOver } from "@/components/ui/SlideOver";
import { TrashIcon } from "@/components/ui/icons";
import {
  AI_MIME_TYPES,
  KIND_ICON,
  aiContentKey,
  deleteAIContent,
  saveAIResource,
  saveAISkill,
  useAIResource,
  useAISkill,
  type AIContentKind,
} from "./ai-content-api";
import {
  AI_LIMITS,
  EMPTY_RESOURCE,
  EMPTY_SKILL,
  checkResource,
  checkSkill,
  readFrontmatter,
  renameFrontmatter,
  resourceDraftOf,
  resourceInputOf,
  skillDraftOf,
  skillInputOf,
  toolsOf,
  type Problem,
  type ResourceDraft,
  type SkillDraft,
} from "./ai-content-draft";
import {
  BackendsField,
  BodyField,
  FIELDSET,
  Field,
  INPUT,
  InstructionsWarning,
  Problems,
  PublicationsField,
} from "./AIContentFields";
import { AISchedulesSection } from "./AISchedulesSection";

/**
 * The frame of both panels: the slide-over, the form, its checks, saving and
 * deleting. A draft holds changes not saved yet: a stray click beside the panel
 * must not drop them. The checks of the form run when it is sent, the API
 * checking again.
 */
function ContentPanel<D>({
  kind,
  open,
  name,
  loading,
  loadError,
  saved,
  draft,
  check,
  save,
  onClose,
  onSaved,
  children,
  after,
}: {
  kind: AIContentKind;
  open: boolean;
  /** The text edited; absent, the form creates one. */
  name: string | undefined;
  loading: boolean;
  loadError: Error | null;
  saved: D;
  draft: D;
  check: (draft: D) => Problem[];
  save: (draft: D) => Promise<{ name: string }>;
  onClose: () => void;
  onSaved: (name: string) => void;
  children: ReactNode;
  /** Shown under the form, outside of it, for a text saved already. */
  after?: ReactNode;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const editing = name !== undefined;
  const [problems, setProblems] = useState<Problem[]>([]);
  useEffect(() => {
    if (open) setProblems([]);
  }, [open, name]);
  const unsaved = JSON.stringify(draft) !== JSON.stringify(saved);

  const mutation = useMutation({
    mutationFn: () => save(draft),
    onSuccess: async (meta) => {
      await queryClient.invalidateQueries({ queryKey: aiContentKey(kind) });
      onSaved(meta.name);
    },
  });
  const remove = useMutation({
    mutationFn: () => deleteAIContent(kind, name ?? ""),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: aiContentKey(kind, name) });
      await queryClient.invalidateQueries({ queryKey: aiContentKey(kind) });
      onClose();
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = check(draft);
    setProblems(found);
    if (found.length === 0) mutation.mutate();
  }

  return (
    <SlideOver
      closeOnOutsideClick={!unsaved}
      open={open}
      title={
        editing ? t(`aiContent.${kind}.editTitle`, { name }) : t(`aiContent.${kind}.createTitle`)
      }
      onClose={onClose}
      closeLabel={t("detail.close")}
      resizeLabel={t("detail.resize")}
      leading={<ObjectIcon kind={KIND_ICON[kind]} />}
      size="wide"
    >
      {loading ? (
        <p className="text-ink-muted">{t("list.loading")}</p>
      ) : loadError !== null ? (
        <p role="alert" className="text-state-down">
          ■ {loadError.message}
        </p>
      ) : (
        <>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <InstructionsWarning />
            {children}
            <Problems problems={problems} />
            {mutation.isError && (
              <p role="alert" className="text-state-down">
                ■ {mutation.error.message}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={mutation.isPending}
                className="h-8 rounded-(--radius-control) bg-accent px-3 font-medium text-accent-ink disabled:opacity-60"
              >
                {mutation.isPending
                  ? t("aiContent.form.saving")
                  : editing
                    ? t("aiContent.form.saveEdit")
                    : t("aiContent.form.saveCreate")}
              </button>
              {mutation.isSuccess && !mutation.isPending && !unsaved && (
                <span role="status" className="text-ink-muted">
                  ✓ {t("aiContent.form.saved")}
                </span>
              )}
            </div>
          </form>

          {editing && after}

          {editing && (
            <div className="mt-6 border-t border-line pt-4">
              {remove.isError && (
                <p role="alert" className="mb-2 text-state-down">
                  ■ {remove.error.message}
                </p>
              )}
              <ConfirmButton
                label={t("aiContent.form.delete")}
                question={t(`aiContent.${kind}.deleteQuestion`, { name })}
                confirmLabel={t("aiContent.form.deleteConfirm")}
                cancelLabel={t("designer.cancel")}
                pendingLabel={t("aiContent.form.deleting")}
                pending={remove.isPending}
                icon={<TrashIcon className="h-3.5 w-3.5" />}
                onConfirm={() => {
                  remove.mutate();
                }}
              />
            </div>
          )}
        </>
      )}
    </SlideOver>
  );
}

/** The name of a new text; once created, it stays. */
function NameField({
  id,
  value,
  editing,
  onChange,
}: {
  id: string;
  value: string;
  editing: boolean;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Field
      id={`${id}-name`}
      label={t("aiContent.fields.name")}
      hint={editing ? t("aiContent.form.nameFixed") : t("aiContent.form.nameHint")}
    >
      <input
        id={`${id}-name`}
        value={value}
        readOnly={editing}
        maxLength={AI_LIMITS.name}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        placeholder="disk-capacity"
        spellCheck={false}
        className={`${INPUT} font-mono read-only:bg-surface-sunken read-only:text-ink-muted`}
      />
    </Field>
  );
}

/**
 * Creating or editing a resource: a text the assistant reads when its
 * description tells it the question needs it, a procedure, a glossary, the
 * conventions of a site.
 */
export function AIResourcePanel({
  open,
  name,
  onClose,
  onSaved,
}: {
  open: boolean;
  name?: string;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const resource = useAIResource(open ? name : undefined);
  const editing = name !== undefined;
  const saved = useMemo(
    () =>
      editing && resource.data !== undefined ? resourceDraftOf(resource.data) : EMPTY_RESOURCE,
    [editing, resource.data],
  );
  const [draft, setDraft] = useState<ResourceDraft>(saved);
  useEffect(() => {
    if (open) setDraft(saved);
  }, [open, saved]);
  const set = (patch: Partial<ResourceDraft>) => {
    setDraft({ ...draft, ...patch });
  };

  return (
    <ContentPanel
      kind="resources"
      open={open}
      name={name}
      loading={editing && resource.isPending}
      loadError={resource.error}
      saved={saved}
      draft={draft}
      check={checkResource}
      save={(d) => saveAIResource(name, resourceInputOf(d))}
      onClose={onClose}
      onSaved={onSaved}
    >
      <fieldset className={FIELDSET}>
        <legend className="px-1 font-medium">{t("aiContent.form.general")}</legend>
        <NameField
          id={id}
          value={draft.name}
          editing={editing}
          onChange={(value) => {
            set({ name: value });
          }}
        />
        <Field id={`${id}-title`} label={t("aiContent.fields.title")}>
          <input
            id={`${id}-title`}
            value={draft.title}
            onChange={(event) => {
              set({ title: event.target.value });
            }}
            className={INPUT}
          />
        </Field>
        <Field
          id={`${id}-description`}
          label={t("aiContent.fields.description")}
          hint={t("aiContent.form.descriptionHint")}
        >
          <textarea
            id={`${id}-description`}
            rows={3}
            value={draft.description}
            onChange={(event) => {
              set({ description: event.target.value });
            }}
            className="w-full rounded-(--radius-control) border border-line bg-surface px-2 py-1"
          />
        </Field>
        <BackendsField
          id={id}
          value={draft.backends}
          onChange={(backends) => {
            set({ backends });
          }}
        />
        <Field id={`${id}-mime`} label={t("aiContent.fields.mime_type")}>
          <select
            id={`${id}-mime`}
            value={draft.mimeType}
            onChange={(event) => {
              set({
                mimeType: event.target.value === "text/plain" ? "text/plain" : "text/markdown",
              });
            }}
            className={`${INPUT} w-64`}
          >
            {AI_MIME_TYPES.map((m) => (
              <option key={m} value={m}>
                {t(`aiContent.mime.${m === "text/plain" ? "plain" : "markdown"}`)}
              </option>
            ))}
          </select>
        </Field>
      </fieldset>

      <BodyField
        id={`${id}-body`}
        label={t("aiContent.fields.body")}
        value={draft.body}
        markdown={draft.mimeType === "text/markdown"}
        onChange={(body) => {
          set({ body });
        }}
      />

      <PublicationsField
        value={draft.groupIds}
        onChange={(groupIds) => {
          set({ groupIds });
        }}
      />
    </ContentPanel>
  );
}

/** What the assistant sees of a skill before loading it: its frontmatter. */
function SkillPreview({ body }: { body: string }) {
  const { t } = useTranslation();
  const frontmatter = readFrontmatter(body);
  const lines = body.split("\n");
  const end = lines.findIndex((line, i) => i > 0 && line.replace(/\r$/, "") === "---");
  const text = frontmatter.error === undefined && end > 0 ? lines.slice(end + 1).join("\n") : body;
  const description = frontmatter.values.description;
  const tools = toolsOf(frontmatter.values);
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-(--radius-control) bg-surface-sunken p-2">
        <dt className="text-ink-muted">{t("aiContent.fields.name")}</dt>
        <dd className="font-mono">{String(frontmatter.values.name ?? "")}</dd>
        <dt className="text-ink-muted">{t("aiContent.fields.description")}</dt>
        <dd>{typeof description === "string" ? description : ""}</dd>
        <dt className="text-ink-muted">{t("aiContent.fields.tools")}</dt>
        <dd className="font-mono">{tools.length === 0 ? "—" : tools.join(", ")}</dd>
      </dl>
      <Markdown text={text} />
    </div>
  );
}

/**
 * Creating or editing a skill: a SKILL.md whose frontmatter names it, tells the
 * assistant when to load it and the tools it uses, the steps following.
 */
export function AISkillPanel({
  open,
  name,
  onClose,
  onSaved,
}: {
  open: boolean;
  name?: string;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const skill = useAISkill(open ? name : undefined);
  const editing = name !== undefined;
  const saved = useMemo(
    () => (editing && skill.data !== undefined ? skillDraftOf(skill.data) : EMPTY_SKILL),
    [editing, skill.data],
  );
  const [draft, setDraft] = useState<SkillDraft>(saved);
  useEffect(() => {
    if (open) setDraft(saved);
  }, [open, saved]);
  const set = (patch: Partial<SkillDraft>) => {
    setDraft({ ...draft, ...patch });
  };

  return (
    <ContentPanel
      kind="skills"
      open={open}
      name={name}
      loading={editing && skill.isPending}
      loadError={skill.error}
      saved={saved}
      draft={draft}
      check={checkSkill}
      save={(d) => saveAISkill(name, skillInputOf(d))}
      onClose={onClose}
      onSaved={onSaved}
      after={
        // The collector runs the schedules on the assistant of its own backend.
        name !== undefined && skill.data?.backends.includes("oc3") === true ? (
          <AISchedulesSection
            skill={name}
            restricted={(skill.data.publications?.length ?? 0) > 0}
          />
        ) : undefined
      }
    >
      <fieldset className={FIELDSET}>
        <legend className="px-1 font-medium">{t("aiContent.form.general")}</legend>
        <NameField
          id={id}
          value={draft.name}
          editing={editing}
          onChange={(value) => {
            // A new skill: its frontmatter takes the name as it is typed.
            set({ name: value, body: renameFrontmatter(draft.body, draft.name, value) });
          }}
        />
        <BackendsField
          id={id}
          value={draft.backends}
          onChange={(backends) => {
            set({ backends });
          }}
        />
      </fieldset>

      <BodyField
        id={`${id}-body`}
        label={t("aiContent.fields.skillBody")}
        hint={t("aiContent.form.skillBodyHint", { max: AI_LIMITS.tools })}
        value={draft.body}
        markdown
        preview={<SkillPreview body={draft.body} />}
        onChange={(body) => {
          set({ body });
        }}
      />

      <PublicationsField
        value={draft.groupIds}
        onChange={(groupIds) => {
          set({ groupIds });
        }}
      />
    </ContentPanel>
  );
}
