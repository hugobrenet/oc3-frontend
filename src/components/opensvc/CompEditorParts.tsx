import { useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CrossLink, type CrossKind } from "@/components/opensvc/CrossLink";
import { ObjectIcon } from "@/components/opensvc/ObjectIcon";
import { Combobox } from "@/components/ui/Combobox";
import { personalGroupUser, useTeamLabel } from "@/components/opensvc/use-team-label";
import { COMP_BUTTON, type ChangeOutcome } from "./comp-changes";
import {
  AlertTriangleIcon,
  CheckIcon,
  CloseIcon,
  PencilIcon,
  PlusIcon,
} from "@/components/ui/icons";

/**
 * The parts the panels of the compliance objects (rulesets, modulesets) are made
 * of: each change is written to the collector at once, and its outcome told at the
 * top of the panel.
 */

/** The outcome of the last change, a mark and words telling its tone. */
export function ChangeOutcomeLine({
  outcome,
  onDismiss,
}: {
  outcome: ChangeOutcome | null;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div aria-live="polite">
      {outcome !== null && (
        <p
          role={outcome.tone === "refused" ? "alert" : "status"}
          className={`flex items-start gap-1.5 rounded-(--radius-control) border px-2 py-1 ${
            outcome.tone === "refused"
              ? "border-state-down bg-state-down-soft"
              : "border-state-up bg-state-up-soft"
          }`}
        >
          {outcome.tone === "refused" ? (
            <AlertTriangleIcon className="mt-0.5 shrink-0 text-state-down" />
          ) : (
            <CheckIcon className="mt-0.5 shrink-0 text-state-up" />
          )}
          <span className="min-w-0 flex-1">{outcome.text}</span>
          <button
            type="button"
            onClick={onDismiss}
            aria-label={t("detail.close")}
            title={t("detail.close")}
            className="rounded-(--radius-control) p-0.5 text-ink-muted hover:text-ink"
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        </p>
      )}
    </div>
  );
}

/** A part of a panel: a heading with a count, its actions, its content. */
export function EditorPart({
  title,
  count,
  actions,
  children,
}: {
  title: string;
  count?: number;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-(--radius-panel) border border-line bg-surface p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">
          {title}
          {count !== undefined && (
            <span className="ml-1 font-normal text-ink-muted">({count})</span>
          )}
        </h3>
        <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>
      </div>
      {children}
    </section>
  );
}

/** Objects named in a list of chips, each opening its record when it has an id, removable when `onRemove` is given. */
export function ObjectChips({
  kind,
  names,
  linkId,
  kindOf,
  label,
  empty,
  removeLabel,
  onRemove,
}: {
  kind: CrossKind;
  names: string[];
  linkId?: (name: string) => string | undefined;
  /** The kind of one chip, when it differs from `kind`; `linkId` then gives its id. */
  kindOf?: (name: string) => CrossKind;
  /** The text of a chip, the name when absent. */
  label?: (name: string) => string;
  empty: string;
  removeLabel: (name: string) => string;
  onRemove?: (name: string) => void;
}) {
  if (names.length === 0) return <p className="text-ink-muted">{empty}</p>;
  return (
    <ul className="flex flex-wrap gap-1">
      {names.map((name) => {
        const id = linkId?.(name);
        const chipKind = kindOf?.(name) ?? kind;
        const text = label?.(name) ?? name;
        return (
          <li key={name} className="inline-flex items-center gap-0.5">
            {id !== undefined ? (
              <CrossLink kind={chipKind} id={id}>
                {text}
              </CrossLink>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-1.5 text-data">
                <ObjectIcon kind={chipKind} className="h-3.5 w-3.5 shrink-0" />
                {text}
              </span>
            )}
            {onRemove !== undefined && (
              <RemoveButton
                label={removeLabel(name)}
                round
                onClick={() => {
                  onRemove(name);
                }}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function RemoveButton({
  label,
  onClick,
  disabled = false,
  round = false,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  round?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`${round ? "rounded-full" : "rounded-(--radius-control)"} p-0.5 text-ink-muted hover:bg-surface-sunken hover:text-state-down disabled:opacity-40`}
    >
      <CloseIcon className="h-3.5 w-3.5" />
    </button>
  );
}

/**
 * A name shown as text, turned into a field by its pencil: Enter keeps the new
 * name, Escape gives it up. A refused name keeps the field open with the reason.
 */
export function InlineName({
  value,
  label,
  editable,
  onCommit,
}: {
  value: string;
  label: string;
  editable: boolean;
  onCommit: (name: string) => Promise<string | null>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (editing === null)
    return (
      <span className="group inline-flex items-center gap-1">
        <span>{value}</span>
        {editable && (
          <button
            type="button"
            title={label}
            aria-label={label}
            onClick={() => {
              setEditing(value);
              setError(null);
            }}
            className="rounded-(--radius-control) p-0.5 text-ink-muted opacity-60 group-hover:opacity-100 hover:text-ink focus:opacity-100"
          >
            <PencilIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </span>
    );
  const commit = async () => {
    const next = editing.trim();
    if (next === value || next === "") {
      setEditing(null);
      return;
    }
    const refused = await onCommit(next);
    if (refused === null) setEditing(null);
    else setError(refused);
  };
  return (
    <span className="inline-flex flex-col">
      <input
        autoFocus
        aria-label={label}
        value={editing}
        onChange={(event) => {
          setEditing(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") void commit();
          if (event.key === "Escape") {
            // The panel closes on Escape: here it only gives the edit up.
            event.stopPropagation();
            setEditing(null);
          }
        }}
        onBlur={() => {
          void commit();
        }}
        className="h-7 rounded-(--radius-control) border border-accent bg-surface px-2"
      />
      {error !== null && (
        <span className="flex items-center gap-1 text-state-down">
          <AlertTriangleIcon className="shrink-0" />
          {error}
        </span>
      )}
    </span>
  );
}

/** A field and a button adding something by its name; `children` go between them. */
export function AddByName({
  label,
  placeholder,
  disabled,
  onAdd,
  children,
}: {
  label: string;
  placeholder: string;
  disabled: boolean;
  onAdd: (name: string) => Promise<string | null>;
  children?: ReactNode;
}) {
  const [name, setName] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const next = name.trim();
    if (next === "") return;
    if ((await onAdd(next)) === null) setName("");
  }
  return (
    <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => void submit(event)}>
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        value={name}
        onChange={(event) => {
          setName(event.target.value);
        }}
        className="h-7 w-56 rounded-(--radius-control) border border-line bg-surface px-2"
      />
      {children}
      <button type="submit" disabled={disabled || name.trim() === ""} className={COMP_BUTTON}>
        <PlusIcon className="h-3.5 w-3.5" />
        {label}
      </button>
    </form>
  );
}

/** A group a compliance object can be published to or put under the responsibility of. */
export interface CompGroup {
  id: number;
  role: string;
}

export type TeamRole = "responsibles" | "publications";

/** The responsible and publication teams of an object, each added and removed in place. */
export function TeamsPart({
  teams,
  roles = ["responsibles", "publications"],
  groups,
  editable,
  busy,
  onAdd,
  onRemove,
}: {
  teams: Record<TeamRole, string[]>;
  /** The lists shown, both by default: an object without responsibles shows its publications only. */
  roles?: readonly TeamRole[];
  /** The groups that can be added, privilege groups left out. */
  groups: CompGroup[];
  editable: boolean;
  busy: boolean;
  onAdd: (role: TeamRole, group: CompGroup, list: string) => void;
  /** `groupId` is the id of the group when known, its role otherwise, as the API accepts both. */
  onRemove: (role: TeamRole, team: string, groupId: string, list: string) => void;
}) {
  const { t } = useTranslation();
  const label = useTeamLabel();
  const idOf = (team: string) => groups.find((g) => g.role === team)?.id;
  return (
    <EditorPart title={t("compEditor.teams")}>
      <div className={roles.length > 1 ? "grid gap-3 sm:grid-cols-2" : "grid gap-3"}>
        {roles.map((role) => {
          const list = t(`compEditor.${role}`);
          const own = teams[role];
          return (
            <div key={role} className="rounded-(--radius-control) border border-line p-2">
              <p className="mb-1 font-medium">{list}</p>
              <ObjectChips
                kind="group"
                names={own}
                // The private group of a user is named after them and opens their record.
                kindOf={(team) => (personalGroupUser(team) === undefined ? "group" : "user")}
                linkId={(team) => {
                  const user = personalGroupUser(team);
                  if (user !== undefined) return user;
                  const id = idOf(team);
                  return id === undefined ? undefined : String(id);
                }}
                label={label}
                empty={t("compEditor.noTeam")}
                removeLabel={(team) => t("compEditor.removeTeam", { team: label(team), list })}
                onRemove={
                  editable && !busy
                    ? (team) => {
                        onRemove(role, team, String(idOf(team) ?? team), list);
                      }
                    : undefined
                }
              />
              {editable && (
                <div className="mt-2">
                  <Combobox
                    options={groups
                      .filter((g) => !own.includes(g.role))
                      .map((g) => ({ value: String(g.id), label: label(g.role) }))}
                    value=""
                    onChange={(id) => {
                      const group = groups.find((g) => String(g.id) === id);
                      if (group !== undefined) onAdd(role, group, list);
                    }}
                    label={t("compEditor.addTeam", { list })}
                    placeholder={t("compEditor.addTeam", { list })}
                    emptyText={t("compEditor.noMatch")}
                    className="w-full"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </EditorPart>
  );
}

/** What an object is used by, one line per kind of user. */
export interface CompUsage {
  modulesets?: { id: string; name: string }[];
  rulesets?: { id: string; name: string }[];
  nodes: { id: string; name: string }[];
  services: { id: string; name: string }[];
}

export function UsedByPart({
  usage,
  errorMessage,
}: {
  usage: CompUsage | undefined;
  errorMessage: string | null;
}) {
  const { t } = useTranslation();
  const lines = (
    [
      ["moduleset", usage?.modulesets ?? []],
      ["ruleset", usage?.rulesets ?? []],
      ["node", usage?.nodes ?? []],
      ["service", usage?.services ?? []],
    ] as const
  ).filter(([, items]) => items.length > 0);
  return (
    <EditorPart title={t("compEditor.usedBy")}>
      {errorMessage !== null && (
        <p role="alert" className="flex items-center gap-1 text-state-down">
          <AlertTriangleIcon className="shrink-0" />
          {errorMessage}
        </p>
      )}
      {usage !== undefined && lines.length === 0 && (
        <p className="text-ink-muted">{t("compEditor.unused")}</p>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {lines.map(([kind, items]) => (
          <div key={kind} className="contents">
            <dt className="text-ink-muted">
              {t(`compEditor.usage.${kind}`, { count: items.length })}
            </dt>
            <dd className="flex flex-wrap gap-1">
              {items.map((item) => (
                <CrossLink key={item.id} kind={kind} id={item.id}>
                  {item.name}
                </CrossLink>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </EditorPart>
  );
}
