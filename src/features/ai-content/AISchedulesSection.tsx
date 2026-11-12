import { useId, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { DateTime } from "@/components/ui/DateTime";
import { Markdown } from "@/components/ui/Markdown";
import { TrashIcon } from "@/components/ui/icons";
import {
  useNotificationChannels,
  type NotificationChannel,
} from "@/features/notifications/notifications-api";
import {
  SCHEDULE_DAYS,
  SCHEDULE_LIMITS,
  aiScheduleRunsKey,
  aiSchedulesKey,
  checkSchedule,
  deleteAISchedule,
  emptySchedule,
  knownTimezones,
  runAISchedule,
  saveAISchedule,
  scheduleDraftOf,
  scheduleInputOf,
  useAIScheduleRuns,
  useAISchedules,
  type AISchedule,
  type AIScheduleRun,
  type ScheduleDraft,
  type ScheduleProblem,
} from "./ai-schedules-api";
import { FIELDSET, Field, INPUT } from "./AIContentFields";

const BUTTON =
  "h-7 rounded-(--radius-control) border border-line px-2 text-sm hover:bg-surface-sunken disabled:opacity-60";

/** The days of a schedule, as a reader says them. */
function useDaysText() {
  const { t } = useTranslation();
  return (days: string[]) => {
    if (days.length === 7) return t("aiContent.schedules.everyDay");
    if (days.length === 5 && SCHEDULE_DAYS.slice(0, 5).every((d) => days.includes(d)))
      return t("aiContent.schedules.weekdays");
    return SCHEDULE_DAYS.filter((d) => days.includes(d))
      .map((d) => t(`notifications.days.${d}`))
      .join(", ");
  };
}

function channelName(channels: NotificationChannel[] | undefined, id: number): string {
  return channels?.find((c) => c.id === id)?.name ?? `#${String(id)}`;
}

const RUN_STATE_CLASS: Record<AIScheduleRun["state"], string> = {
  queued: "text-ink-muted",
  running: "text-accent",
  sent: "text-state-up",
  unsent: "text-state-warn",
  failed: "text-state-down",
};

/**
 * The calls of the tools a run made, as the agent summarized them, by name
 * only, and the request ID that finds the run in the logs of the agent: what
 * a conversation would have shown, for the debugging.
 */
function RunCalls({ run }: { run: AIScheduleRun }) {
  const { t } = useTranslation();
  const calls = run.calls ?? [];
  if (calls.length === 0 && run.request_id === undefined) return null;
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-ink-muted">
        {t("aiContent.schedules.calls", { count: calls.length })}
      </summary>
      <ol className="mt-1 list-decimal pl-6 font-mono text-sm">
        {calls.map((c, i) => (
          <li key={i} className={c.error ? "text-state-down" : undefined}>
            {c.name}{" "}
            <span className="text-ink-muted">
              {c.not_run !== undefined
                ? t(`aiContent.schedules.notRun.${c.not_run}`)
                : c.error
                  ? t("aiContent.schedules.callFailed", { ms: c.duration_ms })
                  : t("aiContent.schedules.callMs", { ms: c.duration_ms })}
            </span>
          </li>
        ))}
      </ol>
      {run.request_id !== undefined && (
        <p className="mt-1 text-ink-muted">
          {t("aiContent.schedules.requestId")} <span className="font-mono">{run.request_id}</span>
        </p>
      )}
    </details>
  );
}

/** The latest runs of a schedule, their reports folded. */
function ScheduleRuns({ id }: { id: number }) {
  const { t } = useTranslation();
  const runs = useAIScheduleRuns(id);
  if (runs.isPending) return <p className="text-ink-muted">{t("list.loading")}</p>;
  if (runs.isError)
    return (
      <p role="alert" className="text-state-down">
        ■ {runs.error.message}
      </p>
    );
  if (runs.data.length === 0)
    return <p className="text-ink-muted">{t("aiContent.schedules.noRun")}</p>;
  return (
    <ul className="flex flex-col gap-2">
      {runs.data.map((r) => (
        <li key={r.id} className="rounded-(--radius-control) bg-surface-sunken p-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className={`font-medium ${RUN_STATE_CLASS[r.state]}`}>
              {t(`aiContent.schedules.states.${r.state}`)}
            </span>
            <DateTime value={r.started ?? r.queued} />
            <span className="text-ink-muted">
              {t(`aiContent.schedules.triggers.${r.trigger}`, { by: r.queued_by })}
            </span>
            {r.ended !== undefined && (
              <span className="text-ink-muted">
                {t("aiContent.schedules.toolCalls", { count: r.tool_calls })}
                {r.refused_actions > 0 &&
                  ` · ${t("aiContent.schedules.refused", { count: r.refused_actions })}`}
              </span>
            )}
          </div>
          {r.error !== "" && <p className="mt-1 text-state-down">{r.error}</p>}
          {r.report !== "" && (
            <details className="mt-1">
              <summary className="cursor-pointer text-ink-muted">
                {t("aiContent.schedules.report")}
              </summary>
              <div className="mt-2 overflow-x-auto">
                <Markdown text={r.report} />
              </div>
            </details>
          )}
          <RunCalls run={r} />
        </li>
      ))}
    </ul>
  );
}

/** Creating or editing a schedule of the skill. */
function ScheduleForm({
  skill,
  schedule,
  channels,
  channelsError,
  onDone,
}: {
  skill: string;
  schedule: AISchedule | undefined;
  channels: NotificationChannel[] | undefined;
  channelsError: Error | null;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const queryClient = useQueryClient();
  const timezones = useMemo(() => knownTimezones(), []);
  const [draft, setDraft] = useState<ScheduleDraft>(() =>
    schedule === undefined ? emptySchedule() : scheduleDraftOf(schedule),
  );
  const [problems, setProblems] = useState<ScheduleProblem[]>([]);
  const set = (patch: Partial<ScheduleDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  };
  const save = useMutation({
    mutationFn: () => saveAISchedule(schedule?.id, scheduleInputOf(skill, draft)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: aiSchedulesKey(skill) });
      onDone();
    },
  });
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = checkSchedule(draft, timezones);
    setProblems(found);
    if (found.length === 0) save.mutate();
  }
  // The channels the schedule names, listed even when the caller may not read
  // the channels, to keep them.
  const listed: { id: number; name: string; type?: string }[] = [
    ...(channels ?? []).map((c) => ({ id: c.id, name: c.name, type: c.type })),
    ...draft.channels
      .filter((c) => channels?.find((x) => x.id === c) === undefined)
      .map((c) => ({ id: c, name: `#${String(c)}` })),
  ];

  return (
    <form onSubmit={onSubmit} className={`${FIELDSET} mt-2`}>
      <Field
        id={`${id}-name`}
        label={t("aiContent.fields.name")}
        hint={t("aiContent.schedules.nameHint")}
      >
        <input
          id={`${id}-name`}
          value={draft.name}
          maxLength={SCHEDULE_LIMITS.name}
          onChange={(e) => {
            set({ name: e.target.value });
          }}
          placeholder="morning-report"
          spellCheck={false}
          className={`${INPUT} font-mono`}
        />
      </Field>
      <Field
        id={`${id}-prompt`}
        label={t("aiContent.schedules.prompt")}
        hint={t("aiContent.schedules.promptHint")}
      >
        <textarea
          id={`${id}-prompt`}
          rows={3}
          value={draft.prompt}
          onChange={(e) => {
            set({ prompt: e.target.value });
          }}
          className="w-full rounded-(--radius-control) border border-line bg-surface px-2 py-1"
        />
      </Field>
      <fieldset>
        <legend className="mb-1 font-medium">{t("aiContent.schedules.days")}</legend>
        <div className="flex flex-wrap gap-3">
          {SCHEDULE_DAYS.map((day) => (
            <label key={day} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={draft.days.includes(day)}
                onChange={(e) => {
                  set({
                    days: e.target.checked
                      ? [...draft.days, day]
                      : draft.days.filter((d) => d !== day),
                  });
                }}
              />
              {t(`notifications.days.${day}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap gap-4">
        <Field id={`${id}-at`} label={t("aiContent.schedules.at")}>
          <input
            id={`${id}-at`}
            type="time"
            value={draft.at}
            onChange={(e) => {
              set({ at: e.target.value });
            }}
            className={`${INPUT} w-32`}
          />
        </Field>
        <Field
          id={`${id}-timezone`}
          label={t("aiContent.schedules.timezone")}
          hint={t("aiContent.schedules.timezoneHint")}
        >
          <input
            id={`${id}-timezone`}
            list={`${id}-timezones`}
            value={draft.timezone}
            onChange={(e) => {
              set({ timezone: e.target.value });
            }}
            spellCheck={false}
            className={`${INPUT} w-64`}
          />
          <datalist id={`${id}-timezones`}>
            {timezones.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
        </Field>
      </div>
      <fieldset>
        <legend className="mb-1 font-medium">{t("aiContent.schedules.channels")}</legend>
        {channelsError !== null && (
          <p className="mb-1 text-ink-muted">{t("aiContent.schedules.channelsUnreadable")}</p>
        )}
        {listed.length === 0 && channelsError === null ? (
          <p className="text-ink-muted">{t("aiContent.schedules.noChannel")}</p>
        ) : (
          <div className="flex flex-col gap-1">
            {listed.map((c) => (
              <label key={c.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.channels.includes(c.id)}
                  onChange={(e) => {
                    set({
                      channels: e.target.checked
                        ? [...draft.channels, c.id]
                        : draft.channels.filter((x) => x !== c.id),
                    });
                  }}
                />
                <span className="font-mono">{c.name}</span>
                {c.type !== undefined && <span className="text-ink-muted">{c.type}</span>}
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={draft.sendFailures}
          onChange={(e) => {
            set({ sendFailures: e.target.checked });
          }}
        />
        {t("aiContent.schedules.sendFailures")}
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(e) => {
            set({ enabled: e.target.checked });
          }}
        />
        {t("aiContent.schedules.enabled")}
      </label>
      {problems.length > 0 && (
        <ul role="alert" className="text-state-down">
          {problems.map((p) => (
            <li key={p}>
              ■{" "}
              {t(`aiContent.schedules.problems.${p}`, {
                max: p === "prompt" ? SCHEDULE_LIMITS.prompt : SCHEDULE_LIMITS.channels,
              })}
            </li>
          ))}
        </ul>
      )}
      {save.isError && (
        <p role="alert" className="text-state-down">
          ■ {save.error.message}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={save.isPending}
          className="h-8 rounded-(--radius-control) bg-accent px-3 font-medium text-accent-ink disabled:opacity-60"
        >
          {save.isPending
            ? t("aiContent.form.saving")
            : schedule === undefined
              ? t("aiContent.form.saveCreate")
              : t("aiContent.form.saveEdit")}
        </button>
        <button type="button" onClick={onDone} className={BUTTON}>
          {t("designer.cancel")}
        </button>
      </div>
    </form>
  );
}

/** A schedule: when it runs, where it sends, its actions and its runs. */
function ScheduleRow({
  skill,
  schedule,
  channels,
  onEdit,
}: {
  skill: string;
  schedule: AISchedule;
  channels: NotificationChannel[] | undefined;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const daysText = useDaysText();
  const queryClient = useQueryClient();
  const [showRuns, setShowRuns] = useState(false);
  const run = useMutation({
    mutationFn: () => runAISchedule(schedule.id),
    onSuccess: async () => {
      setShowRuns(true);
      await queryClient.invalidateQueries({ queryKey: aiScheduleRunsKey(schedule.id) });
    },
  });
  const remove = useMutation({
    mutationFn: () => deleteAISchedule(schedule.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: aiSchedulesKey(skill) });
    },
  });
  return (
    <li className="rounded-(--radius-panel) border border-line p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-mono font-medium">{schedule.name}</span>
        <span className={schedule.enabled ? "text-state-up" : "text-ink-muted"}>
          {schedule.enabled ? t("aiContent.schedules.on") : t("aiContent.schedules.off")}
        </span>
      </div>
      <p>
        {t("aiContent.schedules.when", {
          days: daysText(schedule.days),
          at: schedule.at,
          timezone: schedule.timezone,
        })}
      </p>
      <p className="text-ink-muted">
        {t("aiContent.schedules.to", {
          channels: schedule.channels.map((c) => channelName(channels, c)).join(", "),
        })}
      </p>
      {schedule.prompt !== "" && (
        <p className="mt-1 whitespace-pre-wrap text-ink-muted">« {schedule.prompt} »</p>
      )}
      {schedule.next_run !== undefined && (
        <p className="mt-1 flex items-center gap-1">
          {t("aiContent.schedules.nextRun")} <DateTime value={schedule.next_run} />
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" className={BUTTON} onClick={onEdit}>
          {t("aiContent.schedules.edit")}
        </button>
        <button
          type="button"
          className={BUTTON}
          disabled={run.isPending}
          onClick={() => {
            run.mutate();
          }}
        >
          {t("aiContent.schedules.runNow")}
        </button>
        <button
          type="button"
          className={BUTTON}
          aria-expanded={showRuns}
          onClick={() => {
            setShowRuns(!showRuns);
          }}
        >
          {t("aiContent.schedules.history")}
        </button>
        <ConfirmButton
          label={t("aiContent.form.delete")}
          question={t("aiContent.schedules.deleteQuestion", { name: schedule.name })}
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
      {run.isSuccess && (
        <p role="status" className="mt-1 text-ink-muted">
          ✓ {t("aiContent.schedules.queued")}
        </p>
      )}
      {(run.isError || remove.isError) && (
        <p role="alert" className="mt-1 text-state-down">
          ■ {(run.error ?? remove.error)?.message}
        </p>
      )}
      {showRuns && (
        <div className="mt-3">
          <ScheduleRuns id={schedule.id} />
        </div>
      )}
    </li>
  );
}

/**
 * The schedules of a skill: the collector asks the assistant to run it at
 * their times, as its technical account and without any change, and sends the
 * answer to notification channels.
 */
export function AISchedulesSection({
  skill,
  restricted = false,
}: {
  skill: string;
  /**
   * The skill is published to some groups only: the technical account reads
   * it, and the runs succeed, only when it is a member of one of them.
   */
  restricted?: boolean;
}) {
  const { t } = useTranslation();
  const schedules = useAISchedules(skill);
  const channels = useNotificationChannels();
  const [editing, setEditing] = useState<number | "new" | undefined>(undefined);
  return (
    <section className="mt-6 border-t border-line pt-4" aria-labelledby="ai-schedules-title">
      <h3 id="ai-schedules-title" className="font-medium">
        {t("aiContent.schedules.title")}
      </h3>
      <p className="mb-3 text-ink-muted">{t("aiContent.schedules.intro")}</p>
      {restricted && (
        <p className="mb-3 text-state-warn">
          <span aria-hidden="true">▲</span> {t("aiContent.schedules.restricted")}
        </p>
      )}
      {schedules.isPending ? (
        <p className="text-ink-muted">{t("list.loading")}</p>
      ) : schedules.isError ? (
        <p role="alert" className="text-state-down">
          ■ {schedules.error.message}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {schedules.data.map((s) =>
            editing === s.id ? (
              <li key={s.id}>
                <ScheduleForm
                  skill={skill}
                  schedule={s}
                  channels={channels.data}
                  channelsError={channels.error}
                  onDone={() => {
                    setEditing(undefined);
                  }}
                />
              </li>
            ) : (
              <ScheduleRow
                key={s.id}
                skill={skill}
                schedule={s}
                channels={channels.data}
                onEdit={() => {
                  setEditing(s.id);
                }}
              />
            ),
          )}
        </ul>
      )}
      {editing === "new" ? (
        <ScheduleForm
          skill={skill}
          schedule={undefined}
          channels={channels.data}
          channelsError={channels.error}
          onDone={() => {
            setEditing(undefined);
          }}
        />
      ) : (
        <button
          type="button"
          className={`${BUTTON} mt-3`}
          onClick={() => {
            setEditing("new");
          }}
        >
          {t("aiContent.schedules.add")}
        </button>
      )}
    </section>
  );
}
