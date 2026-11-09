import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Combobox } from "@/components/ui/Combobox";
import { CloseIcon } from "@/components/ui/icons";
import {
  KIND_ACTIONS,
  TARGET_KINDS,
  useFiltersetOptions,
  useTargetOptions,
  type CheckStep,
  type OrchestrationStep,
} from "./api";
import { BUTTON, CARD, INPUT } from "./ui";

type Mode = OrchestrationStep["targets"]["mode"];
type Pace = OrchestrationStep["pace"];
type FailureUnit = NonNullable<OrchestrationStep["failure_threshold"]>["unit"];

/**
 * A choice among a few options shown at once, as the side menu's views but of any
 * number: a radio group, one stop of the keyboard path, the arrows choosing.
 */
function Choice<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly { value: T; label: string; disabled?: boolean }[];
  onChange: (value: T) => void;
  label: string;
}) {
  const enabled = options.filter((o) => o.disabled !== true);
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex rounded-full bg-surface-sunken p-[3px]"
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const at = enabled.findIndex((o) => o.value === value);
        const next =
          enabled[(at + (event.key === "ArrowRight" ? 1 : enabled.length - 1)) % enabled.length];
        if (next === undefined) return;
        onChange(next.value);
        event.currentTarget
          .querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`)
          ?.focus();
      }}
    >
      {options.map((o) => {
        const checked = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={checked}
            data-value={o.value}
            disabled={o.disabled}
            tabIndex={checked ? 0 : -1}
            onClick={() => {
              onChange(o.value);
            }}
            className={`rounded-full px-2.5 text-data leading-6 whitespace-nowrap disabled:opacity-40 ${
              checked
                ? "bg-surface-raised font-medium text-ink shadow-sm ring-1 ring-line"
                : "text-ink-muted hover:text-ink"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <>
      {htmlFor === undefined ? (
        <span className="pt-1 text-ink-muted">{label}</span>
      ) : (
        <label htmlFor={htmlFor} className="pt-1 text-ink-muted">
          {label}
        </label>
      )}
      <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
    </>
  );
}

/**
 * One step of the editor: the action and the kind of target it acts on, the
 * targets (picked, a filterset, or those of an earlier step), the pace within the
 * step and its time limit. What the check of the plan says of the step shows
 * under it.
 */
export function StepEditor({
  step,
  index,
  steps,
  check,
  selected,
  onSelect,
  onChange,
  onRemove,
  onMove,
}: {
  step: OrchestrationStep;
  index: number;
  steps: readonly OrchestrationStep[];
  check: CheckStep | undefined;
  selected: boolean;
  onSelect: () => void;
  onChange: (step: OrchestrationStep) => void;
  onRemove: () => void;
  onMove: (by: -1 | 1) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const mode = step.targets.mode;
  const options = useTargetOptions(step.kind, mode === "pick");
  const filtersets = useFiltersetOptions(mode === "filterset");
  const picked = step.targets.ids ?? [];
  const labels = new Map((options.data ?? []).map((o) => [o.value, o.label]));
  // The earlier steps of the same kind, whose targets this one may take.
  const sources = steps.flatMap((s, i) => (i < index && s.kind === step.kind ? [i] : []));
  const set = (patch: Partial<OrchestrationStep>) => {
    onChange({ ...step, ...patch });
  };
  const setTargets = (targets: OrchestrationStep["targets"]) => {
    set({ targets });
  };

  return (
    <li
      className={`${CARD} p-3 ${selected ? "border-accent ring-1 ring-accent" : ""}`}
      onFocusCapture={onSelect}
      onPointerDown={onSelect}
    >
      <div className="mb-2 flex items-center gap-2">
        <span
          aria-hidden="true"
          className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border text-data font-semibold ${
            selected
              ? "border-accent bg-accent text-accent-ink"
              : "border-line-strong bg-surface-sunken"
          }`}
        >
          {index + 1}
        </span>
        <label htmlFor={`${id}-name`} className="sr-only">
          {t("orchestrations.step.name", { n: index + 1 })}
        </label>
        <input
          id={`${id}-name`}
          value={step.name}
          placeholder={t("orchestrations.step.namePlaceholder", { n: index + 1 })}
          onChange={(event) => {
            set({ name: event.target.value });
          }}
          className={`${INPUT} min-w-0 flex-1 font-medium`}
        />
        <button
          type="button"
          onClick={() => {
            onMove(-1);
          }}
          disabled={index === 0}
          title={t("orchestrations.step.moveUp")}
          className={BUTTON}
        >
          ↑<span className="sr-only">{t("orchestrations.step.moveUp")}</span>
        </button>
        <button
          type="button"
          onClick={() => {
            onMove(1);
          }}
          disabled={index === steps.length - 1}
          title={t("orchestrations.step.moveDown")}
          className={BUTTON}
        >
          ↓<span className="sr-only">{t("orchestrations.step.moveDown")}</span>
        </button>
        <button
          type="button"
          onClick={onRemove}
          title={t("orchestrations.step.remove")}
          className={BUTTON}
        >
          <CloseIcon className="h-3.5 w-3.5" />
          <span className="sr-only">{t("orchestrations.step.remove")}</span>
        </button>
      </div>

      <div className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 pl-8">
        <Field label={t("orchestrations.step.kind")}>
          <Choice
            label={t("orchestrations.step.kind")}
            value={step.kind}
            options={TARGET_KINDS.map((kind) => ({
              value: kind,
              label: t(`orchestrations.kinds.${kind}`, { count: 2 }),
            }))}
            onChange={(kind) => {
              set({
                kind,
                // The action and the targets of another kind no longer apply.
                action: KIND_ACTIONS[kind].includes(step.action) ? step.action : "",
                targets:
                  mode === "filterset"
                    ? { mode: "filterset", filterset_id: step.targets.filterset_id }
                    : { mode: "pick", ids: [] },
                rid: kind === "instance" ? step.rid : undefined,
              });
            }}
          />
        </Field>

        <Field label={t("orchestrations.step.action")} htmlFor={`${id}-action`}>
          <select
            id={`${id}-action`}
            value={step.action}
            onChange={(event) => {
              set({ action: event.target.value });
            }}
            className={`${INPUT} min-w-48`}
          >
            <option value="">{t("orchestrations.step.chooseAction")}</option>
            {KIND_ACTIONS[step.kind].map((action) => (
              <option key={action} value={action}>
                {action}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t("orchestrations.step.targets")}>
          <Choice<Mode>
            label={t("orchestrations.step.targetsMode")}
            value={mode}
            options={[
              { value: "pick", label: t("orchestrations.step.modes.pick") },
              { value: "filterset", label: t("orchestrations.step.modes.filterset") },
              {
                value: "same_as",
                label: t("orchestrations.step.modes.sameAs"),
                disabled: sources.length === 0,
              },
            ]}
            onChange={(next) => {
              if (next === "pick") setTargets({ mode: "pick", ids: [] });
              else if (next === "filterset") setTargets({ mode: "filterset" });
              else setTargets({ mode: "same_as", step: sources[sources.length - 1] });
            }}
          />
          {mode === "pick" && (
            <>
              {picked.map((value) => (
                <span
                  key={value}
                  className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2 text-data"
                >
                  {labels.get(value) ?? value}
                  <button
                    type="button"
                    onClick={() => {
                      setTargets({ mode: "pick", ids: picked.filter((v) => v !== value) });
                    }}
                    title={t("orchestrations.step.removeTarget", {
                      name: labels.get(value) ?? value,
                    })}
                    className="text-ink-muted hover:text-ink"
                  >
                    <CloseIcon className="h-3 w-3" />
                    <span className="sr-only">
                      {t("orchestrations.step.removeTarget", { name: labels.get(value) ?? value })}
                    </span>
                  </button>
                </span>
              ))}
              <Combobox
                options={(options.data ?? []).filter((o) => !picked.includes(o.value))}
                value=""
                onChange={(value) => {
                  if (value !== "") setTargets({ mode: "pick", ids: [...picked, value] });
                }}
                label={t("orchestrations.step.addTarget", {
                  kind: t(`orchestrations.kinds.${step.kind}`, { count: 1 }),
                })}
                placeholder={
                  options.isPending
                    ? t("detail.loading")
                    : t("orchestrations.step.addTarget", {
                        kind: t(`orchestrations.kinds.${step.kind}`, { count: 1 }),
                      })
                }
                emptyText={t("orchestrations.step.noMatch")}
                className="w-64"
              />
            </>
          )}
          {mode === "filterset" && (
            <Combobox
              options={filtersets.data ?? []}
              value={
                step.targets.filterset_id === undefined ? "" : String(step.targets.filterset_id)
              }
              onChange={(value) => {
                setTargets({
                  mode: "filterset",
                  filterset_id: value === "" ? undefined : Number(value),
                });
              }}
              label={t("orchestrations.step.filterset")}
              placeholder={t("orchestrations.step.chooseFilterset")}
              emptyText={t("orchestrations.step.noMatch")}
              className="w-64"
            />
          )}
          {mode === "same_as" && (
            <select
              aria-label={t("orchestrations.step.sameAsStep")}
              value={step.targets.step ?? ""}
              onChange={(event) => {
                setTargets({ mode: "same_as", step: Number(event.target.value) });
              }}
              className={INPUT}
            >
              {sources.map((i) => (
                <option key={i} value={i}>
                  {t("orchestrations.step.sameAsOption", {
                    n: i + 1,
                    name: steps[i]?.name === "" ? steps[i]?.action : steps[i]?.name,
                  })}
                </option>
              ))}
            </select>
          )}
          {check !== undefined && check.message === "" && (
            <span className="text-ink-muted">
              {t("orchestrations.step.matches", { count: check.targets.length })}
            </span>
          )}
        </Field>

        {step.kind === "instance" && (
          <Field label={t("orchestrations.step.rid")} htmlFor={`${id}-rid`}>
            <input
              id={`${id}-rid`}
              value={step.rid ?? ""}
              placeholder={t("orchestrations.step.ridPlaceholder")}
              onChange={(event) => {
                set({ rid: event.target.value === "" ? undefined : event.target.value });
              }}
              className={`${INPUT} w-48 font-mono`}
            />
            <span className="text-ink-muted">{t("orchestrations.step.ridHint")}</span>
          </Field>
        )}

        <Field label={t("orchestrations.step.pace")}>
          <Choice<Pace>
            label={t("orchestrations.step.pace")}
            value={step.pace}
            options={[
              { value: "all", label: t("orchestrations.step.paces.all") },
              { value: "one", label: t("orchestrations.step.paces.one") },
              { value: "batch", label: t("orchestrations.step.paces.batch") },
            ]}
            onChange={(pace) => {
              set({ pace, batch_size: pace === "batch" ? (step.batch_size ?? 3) : undefined });
            }}
          />
          {step.pace === "batch" && (
            <label className="inline-flex items-center gap-1.5">
              <input
                type="number"
                min={1}
                value={step.batch_size ?? 3}
                onChange={(event) => {
                  set({ batch_size: Math.max(1, Number(event.target.value)) });
                }}
                className={`${INPUT} w-16 tabular-nums`}
              />
              {t("orchestrations.step.batchUnit")}
            </label>
          )}
        </Field>

        <Field label={t("orchestrations.step.timeout")} htmlFor={`${id}-timeout`}>
          <input
            id={`${id}-timeout`}
            type="number"
            min={0}
            value={step.timeout === undefined ? 0 : Math.round(step.timeout / 60)}
            onChange={(event) => {
              const minutes = Math.max(0, Number(event.target.value));
              set({ timeout: minutes === 0 ? undefined : minutes * 60 });
            }}
            className={`${INPUT} w-16 tabular-nums`}
          />
          <span className="text-ink-muted">{t("orchestrations.step.timeoutHint")}</span>
        </Field>

        <Field label={t("orchestrations.step.failureThreshold")} htmlFor={`${id}-threshold`}>
          <input
            id={`${id}-threshold`}
            type="number"
            min={0}
            max={step.failure_threshold?.unit === "percent" ? 100 : undefined}
            value={step.failure_threshold?.value ?? 0}
            onChange={(event) => {
              const unit = step.failure_threshold?.unit ?? "count";
              const raw = Math.max(0, Math.floor(Number(event.target.value)));
              const value = unit === "percent" ? Math.min(100, raw) : raw;
              set({ failure_threshold: value === 0 ? undefined : { value, unit } });
            }}
            className={`${INPUT} w-16 tabular-nums`}
          />
          <Choice<FailureUnit>
            label={t("orchestrations.step.failureUnit")}
            value={step.failure_threshold?.unit ?? "count"}
            options={[
              { value: "count", label: t("orchestrations.step.failureUnits.count") },
              { value: "percent", label: t("orchestrations.step.failureUnits.percent") },
            ]}
            onChange={(unit) => {
              // A unit chosen before a value starts from a usual one.
              const current = step.failure_threshold?.value;
              const value =
                current === undefined
                  ? unit === "percent"
                    ? 10
                    : 1
                  : unit === "percent"
                    ? Math.min(100, current)
                    : current;
              set({ failure_threshold: { value, unit } });
            }}
          />
          <span className="text-ink-muted">{t("orchestrations.step.failureThresholdHint")}</span>
        </Field>
      </div>

      {check !== undefined && check.message !== "" && (
        <p role="alert" className="mt-2 pl-8 text-state-down">
          ■ {check.message}
        </p>
      )}
    </li>
  );
}
