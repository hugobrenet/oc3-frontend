import { useEffect, useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CrossLink } from "@/components/opensvc/CrossLink";
import { ChevronDownIcon } from "@/components/ui/icons";
import { AGENT_TOOLS, type Step } from "./assistant-client";
import type { ChatMessage } from "./use-assistant-chat";
import type { Target } from "./use-targets";
import {
  answerDuration,
  clock,
  formatDuration,
  paramOf,
  stepDuration,
  stepSentence,
} from "./steps";

/** The arguments of the tools of the collector that name a node or a service. */
export const TARGET_ARGUMENTS = ["node", "service"] as const;

/**
 * A node or a service an answer or a step names, as the badge of its record when
 * the collector holds it, among what the user may see: a name the model made up
 * stays code.
 */
export function TargetBadge({ value, targets }: { value: string; targets: Map<string, Target> }) {
  const target = targets.get(value);
  if (target === undefined)
    return (
      <code className="rounded-(--radius-control) bg-surface-sunken px-1 font-mono text-data break-words">
        {value}
      </code>
    );
  return (
    <CrossLink kind={target.kind} id={target.id}>
      {target.name}
    </CrossLink>
  );
}

const STATUS_LOOK: Record<Step["status"], { glyph: string; ink: string }> = {
  running: { glyph: "○", ink: "text-ink-muted animate-pulse" },
  pending: { glyph: "▲", ink: "text-state-warn" },
  completed: { glyph: "●", ink: "text-state-up" },
  failed: { glyph: "■", ink: "text-state-down" },
  rejected: { glyph: "▲", ink: "text-state-warn" },
  interrupted: { glyph: "○", ink: "text-state-unknown" },
};

/** The mark of the status of a step, its name for screen readers. */
function StepStatus({ status }: { status: Step["status"] }) {
  const { t } = useTranslation();
  const look = STATUS_LOOK[status];
  return (
    <span className={`inline-flex w-3 justify-center ${look.ink}`}>
      <span aria-hidden="true">{look.glyph}</span>
      <span className="sr-only">{t(`assistant.steps.status.${status}`)}</span>
    </span>
  );
}

const PRE =
  "max-h-48 overflow-auto rounded-(--radius-control) p-2 font-mono text-data whitespace-pre-wrap [overflow-wrap:anywhere]";

/** One step: its status, its sentence, its targets, its duration; its details on demand. */
function StepRow({
  step,
  targets,
  parallel,
}: {
  step: Step;
  targets: Map<string, Target>;
  parallel: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const agent = AGENT_TOOLS.has(step.tool);
  const duration = stepDuration(step);
  const named = agent
    ? []
    : TARGET_ARGUMENTS.flatMap((name) => {
        const value = paramOf(step.arguments?.[name]);
        return value === undefined ? [] : [value];
      });
  return (
    <li className={agent ? "text-ink-muted" : undefined}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <StepStatus status={step.status} />
        <button
          type="button"
          aria-expanded={open}
          aria-controls={detailsId}
          onClick={() => {
            setOpen(!open);
          }}
          className="min-w-0 text-left [overflow-wrap:anywhere] hover:underline"
        >
          {stepSentence(step, t, i18n)}
        </button>
        {named.map((value) => (
          <TargetBadge key={value} value={value} targets={targets} />
        ))}
        {parallel && <span className="text-ink-muted">{t("assistant.steps.parallel")}</span>}
        {step.editedArgs !== undefined && (
          <span className="text-ink-muted">{t("assistant.steps.withChanges")}</span>
        )}
        {duration !== null && (
          <span className="ml-auto text-ink-muted tabular-nums">
            {formatDuration(duration, i18n.language)}
          </span>
        )}
      </div>
      <div id={detailsId} hidden={!open} className="mt-1 ml-5 flex flex-col gap-1">
        <p className="text-ink-muted">
          <code className="font-mono">{step.tool}</code> ·{" "}
          {t(`assistant.steps.status.${step.status}`)}
        </p>
        {step.arguments !== null && Object.keys(step.arguments).length > 0 && (
          <pre aria-label={t("assistant.steps.arguments")} className={`bg-surface-sunken ${PRE}`}>
            {JSON.stringify(step.arguments, null, 2)}
          </pre>
        )}
        {step.arguments === null && step.argumentsOmitted === true && (
          <p className="text-ink-muted">{t("assistant.steps.argumentsOmitted")}</p>
        )}
        {step.refusal !== "" && (
          <div>
            <p className="font-medium text-state-down">{t("assistant.steps.refusal")}</p>
            <pre className={`bg-state-down-soft ${PRE}`}>{step.refusal}</pre>
          </div>
        )}
        {step.resultExcerpt !== "" && (
          <div>
            <p className="text-ink-muted">
              {step.resultTruncated
                ? t("assistant.steps.excerptTruncated")
                : t("assistant.steps.excerpt")}
            </p>
            <pre className={`bg-surface-sunken ${PRE}`}>{step.resultExcerpt}</pre>
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * The steps of an answer, folded in one line, its live timer while it runs: the
 * time counted on the clock of the page since the run started, the durations
 * shown from the clock of the agent. Unfolded, the steps in the order they
 * started, the time of the model between them, the ones that ran at once said so.
 */
export function AnswerSteps({
  message,
  targets,
}: {
  message: ChatMessage;
  targets: Map<string, Target>;
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const listId = useId();
  const [now, setNow] = useState(() => Date.now());
  const liveSince = message.liveSince;
  useEffect(() => {
    if (liveSince === null) return undefined;
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [liveSince]);
  const steps = message.steps;
  // Sent, the run not started yet: the answer waits for the agent.
  if (steps.length === 0 && liveSince === null)
    return message.status === "running" ? (
      <p role="status" className="text-ink-muted">
        <span aria-hidden="true" className="animate-pulse">
          ○{" "}
        </span>
        {t("assistant.steps.waiting")}
      </p>
    ) : null;
  // In the order they started when all have a start; as served otherwise, such
  // as the steps of a turn stored before the times were.
  const timed = steps.every((step) => step.startedAt !== null);
  const ordered = timed
    ? [...steps].sort((left, right) => (left.startedAt ?? 0) - (right.startedAt ?? 0))
    : steps;
  const current = steps.find((step) => step.status === "running");
  const summary =
    liveSince !== null
      ? t("assistant.steps.running", { time: clock(now - liveSince) })
      : t("assistant.steps.summary", {
          count: steps.length,
          duration: formatDuration(answerDuration(message.runs), i18n.language),
        });
  // The time of the model before a step: since the end of the steps before it,
  // or the start of its run.
  const rows: ReactNode[] = [];
  let lastEnd: number | null = null;
  ordered.forEach((step, index) => {
    const startedAt = step.startedAt;
    const runStart =
      startedAt === null
        ? undefined
        : (message.runs.filter((run) => run.startedAt !== null && run.startedAt <= startedAt).at(-1)
            ?.startedAt ?? undefined);
    const since =
      lastEnd !== null && runStart !== undefined && runStart !== null
        ? Math.max(lastEnd, runStart)
        : (lastEnd ?? runStart ?? null);
    const parallel = index > 0 && startedAt !== null && lastEnd !== null && startedAt < lastEnd;
    if (startedAt !== null && since !== null && startedAt - since >= 100 && !parallel)
      rows.push(
        <li key={`model-${step.id}`} className="ml-5 text-ink-muted">
          {t("assistant.steps.model", {
            duration: formatDuration(startedAt - since, i18n.language),
          })}
        </li>,
      );
    rows.push(<StepRow key={step.id} step={step} targets={targets} parallel={parallel} />);
    if (step.endedAt !== null) lastEnd = Math.max(lastEnd ?? step.endedAt, step.endedAt);
  });
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => {
          setOpen(!open);
        }}
        className="inline-flex items-center gap-1 text-ink-muted hover:text-ink"
      >
        <ChevronDownIcon
          aria-hidden="true"
          className={`h-3 w-3 transition-transform ${open ? "" : "-rotate-90"}`}
        />
        {summary}
      </button>
      {liveSince !== null && current !== undefined && !open && (
        <p className="ml-4 [overflow-wrap:anywhere] text-ink-muted">
          {stepSentence(current, t, i18n)}
        </p>
      )}
      <ol
        id={listId}
        hidden={!open}
        aria-label={t("assistant.steps.label")}
        className="mt-1 flex flex-col gap-1 border-l border-line pl-3"
      >
        {rows}
      </ol>
    </div>
  );
}

/** The foot of an answer: its duration, its steps, its tokens, and the actions the user rejected. */
export function AnswerFooter({ message }: { message: ChatMessage }) {
  const { t, i18n } = useTranslation();
  const rejected = message.steps.filter((step) => step.status === "rejected").length;
  const parts: string[] = [];
  const duration = answerDuration(message.runs);
  if (duration > 0) parts.push(formatDuration(duration, i18n.language));
  if (message.steps.length > 0)
    parts.push(t("assistant.steps.count", { count: message.steps.length }));
  if (message.usage !== null)
    parts.push(t("assistant.message.tokens", { total: message.usage.totalTokens }));
  if (rejected > 0) parts.push(t("assistant.steps.rejected", { count: rejected }));
  if (parts.length === 0) return null;
  return <p className="text-ink-muted">{parts.join(" · ")}</p>;
}
