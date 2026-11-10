import { Link, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { OutputLines } from "@/components/opensvc/LogLines";
import { AnsiText } from "@/components/ui/AnsiText";
import { ObjectIcon } from "@/components/opensvc/ObjectIcon";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { DateTime } from "@/components/ui/DateTime";
import { Modal } from "@/components/ui/Modal";
import { formatDuration } from "@/lib/format";
import { useRun, useRunCommand, type Run, type RunStep, type RunTarget } from "./api";
import { COUNT_ORDER, elapsed } from "./helpers";
import {
  ContinueRunConfirmation,
  ResumeRunConfirmation,
  StartRunConfirmation,
} from "./RunConfirmations";
import { RunStatusPill } from "./RunStatusPill";
import { BUTTON, CARD, PRIMARY } from "./ui";

const STRIP: Record<RunStep["status"], string> = {
  succeeded: "border-state-up/40 bg-state-up-soft",
  running: "border-accent/50 bg-accent-soft",
  failed: "border-state-down/40 bg-state-down-soft",
  stopped: "border-state-warn/40 bg-state-warn-soft",
  waiting: "border-line bg-surface-raised",
  acknowledged: "border-state-warn/40 bg-state-warn-soft",
  not_run: "border-dashed border-line-strong bg-surface-sunken",
};

/** The last line written to an output, for the table: the whole is in the window. */
function lastLine(text: string | undefined): string {
  const lines = (text ?? "").trimEnd().split("\n");
  return lines[lines.length - 1] ?? "";
}

/**
 * A run of an orchestration (`/orchestrations/runs/$runId`): the strip of its
 * steps, where the run is; then each step and its targets, the status, return
 * code, duration and last output line of each, a click opening the whole. Live:
 * refreshed by the collector's events while it runs. A run that failed or was
 * stopped says why and what it leaves undone, and resumes from that step, unless
 * it is cancelled: a run cancelled, while it runs or after, never resumes.
 */
export function RunPage() {
  const { t, i18n } = useTranslation();
  const params = useParams({ strict: false });
  const id = Number((params as { runId?: string }).runId);
  const run = useRun(id);
  const stop = useRunCommand(id, "stop");
  const cancelRun = useRunCommand(id, "cancel");
  // "Run again" and "Resume" open a confirmation first, as a run from the editor.
  const [confirm, setConfirm] = useState<"again" | "resume" | "continue" | null>(null);
  const [shown, setShown] = useState<RunTarget | null>(null);
  const [open, setOpen] = useState<Record<number, boolean>>({});

  if (run.isPending) return <p className="text-ink-muted">{t("detail.loading")}</p>;
  if (run.isError) return <p className="text-state-down">■ {run.error.message}</p>;
  const r = run.data;
  const seconds = elapsed(r.started, r.ended);
  const inFlight = r.steps.some((step) =>
    (step.targets ?? []).some(
      (target) => target.status === "queued" || target.status === "running",
    ),
  );
  // Ended before its last step: a failed or stopped run may resume, a cancelled one not.
  const resumable = r.status === "failed" || r.status === "stopped";
  const ended = resumable || r.status === "cancelled";
  const notRun = r.steps.filter((step) => step.status === "not_run").map((step) => step.step + 1);
  const error = stop.error ?? cancelRun.error;

  return (
    <section>
      <div className="mb-1 text-data text-ink-muted">
        <Link to="/orchestrations" className="hover:underline">
          {t("orchestrations.title")}
        </Link>{" "}
        ›{" "}
        <Link to="/orchestrations/runs" className="hover:underline">
          {t("orchestrations.runs.title")}
        </Link>{" "}
        › #{r.id}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="flex items-center gap-2 text-title font-semibold">
          <ObjectIcon kind="orchestration" className="h-5 w-5" />
          {r.orchestration_id === null || r.orchestration_id === undefined ? (
            r.name
          ) : (
            <Link
              to="/orchestrations/$orchestrationId"
              params={{ orchestrationId: String(r.orchestration_id) }}
              className="hover:underline"
            >
              {r.name}
            </Link>
          )}
        </h1>
        <RunStatusPill
          status={r.status}
          suffix={
            r.status === "running"
              ? `· ${t("orchestrations.run.stepOf", { n: r.current_step + 1, count: r.steps.length })}`
              : undefined
          }
        />
        <span className="text-ink-muted">
          {t("orchestrations.run.startedBy", { by: r.started_by })} <DateTime value={r.started} />
          {seconds !== undefined && ` · ${formatDuration(seconds, i18n.language)}`}
        </span>
        {/* Beside the title: the right edge is where the panel anchor floats (`PanelAnchor`). */}
        {r.status === "running" && (
          <ConfirmButton
            label={`■ ${t("orchestrations.run.stop")}`}
            question={t("orchestrations.run.stopQuestion")}
            details={t("orchestrations.run.stopDetails")}
            confirmLabel={t("orchestrations.run.stop")}
            cancelLabel={t("detail.cancel")}
            pendingLabel={t("orchestrations.run.stopping")}
            pending={stop.isPending}
            onConfirm={() => {
              stop.mutate();
            }}
          />
        )}
        {ended && r.orchestration_id !== null && r.orchestration_id !== undefined && (
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={() => {
              setConfirm("again");
            }}
            className={BUTTON}
          >
            {t("orchestrations.run.again")}
          </button>
        )}
        {(r.status === "running" || resumable) && (
          <ConfirmButton
            label={`⊘ ${t("orchestrations.run.cancel")}`}
            question={t("orchestrations.run.cancelQuestion")}
            details={
              r.status === "running"
                ? t("orchestrations.run.cancelRunningDetails")
                : t("orchestrations.run.cancelDetails")
            }
            confirmLabel={t("orchestrations.run.cancel")}
            cancelLabel={t("detail.cancel")}
            pendingLabel={t("orchestrations.run.cancelling")}
            pending={cancelRun.isPending}
            onConfirm={() => {
              cancelRun.mutate();
            }}
          />
        )}
        {resumable && (
          <button
            type="button"
            disabled={inFlight}
            aria-haspopup="dialog"
            title={inFlight ? t("orchestrations.run.resumeWait") : undefined}
            onClick={() => {
              setConfirm("resume");
            }}
            className={PRIMARY}
          >
            ↻ {t("orchestrations.run.resume", { n: r.current_step + 1 })}
          </button>
        )}
        {resumable && (
          <button
            type="button"
            disabled={inFlight}
            aria-haspopup="dialog"
            title={
              inFlight ? t("orchestrations.run.resumeWait") : t("orchestrations.run.continueHint")
            }
            onClick={() => {
              setConfirm("continue");
            }}
            className={BUTTON}
          >
            ◆ {t("orchestrations.run.continue")}
          </button>
        )}
      </div>
      {error !== null && (
        <p role="alert" className="mb-3 text-state-down">
          ■ {error.message}
        </p>
      )}

      {ended && (
        <div
          role="status"
          className={`mb-3 flex items-start gap-2 rounded-(--radius-panel) border px-3 py-2 ${
            r.status === "failed"
              ? "border-state-down/40 bg-state-down-soft text-state-down"
              : "border-state-warn/40 bg-state-warn-soft text-state-warn"
          }`}
        >
          <span aria-hidden="true">{r.status === "failed" ? "✕" : "■"}</span>
          <span>
            <strong className="text-ink">
              {t(
                r.status === "failed"
                  ? "orchestrations.run.failedAt"
                  : r.status === "cancelled"
                    ? "orchestrations.run.cancelledAt"
                    : "orchestrations.run.stoppedAt",
                {
                  n: r.current_step + 1,
                },
              )}
            </strong>{" "}
            {/* The message names the step already, which the sentence says. */}
            {r.message.replace(/^step \d+: /, "")}
            {r.message === "" ? "" : "."}
            {notRun.length > 0 && (
              <>
                {" "}
                {t("orchestrations.run.notRun", { steps: notRun.join(", "), count: notRun.length })}
              </>
            )}
            {inFlight && <> {t("orchestrations.run.stillRunning")}</>}
          </span>
        </div>
      )}

      <ol
        className="mb-3 grid gap-2"
        style={{
          gridTemplateColumns: `repeat(${String(Math.min(r.steps.length, 4))}, minmax(0, 1fr))`,
        }}
      >
        {r.steps.map((step) => {
          const plan = r.plan[step.step];
          const total = Object.values(step.counts).reduce((n, v) => n + v, 0);
          const ok = step.counts.ok ?? 0;
          const bad =
            (step.counts.failed ?? 0) +
            (step.counts.refused ?? 0) +
            (step.counts.timed_out ?? 0) +
            (step.counts.cancelled ?? 0);
          const busy = (step.counts.running ?? 0) + (step.counts.queued ?? 0);
          const pct = (n: number) => (total === 0 ? "0%" : `${String((100 * n) / total)}%`);
          return (
            <li
              key={step.step}
              className={`rounded-(--radius-panel) border px-3 py-2 ${STRIP[step.status]}`}
            >
              <div className="truncate text-[0.6875rem] tracking-wider text-ink-muted uppercase">
                {t("orchestrations.run.stepLabel", { n: step.step + 1 })} · {plan?.action}
              </div>
              <div className="flex items-center gap-2 font-medium">
                <RunStatusPill status={step.status} />
                <span className="text-data text-ink-muted tabular-nums">
                  {t("orchestrations.run.okOf", { ok, count: total })}
                </span>
              </div>
              <div
                className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-surface-sunken"
                aria-hidden="true"
              >
                <span className="bg-state-up" style={{ width: pct(ok) }} />
                <span className="bg-state-down" style={{ width: pct(bad) }} />
                <span className="bg-accent" style={{ width: pct(busy) }} />
              </div>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-col gap-2">
        {r.steps.map((step) => {
          const plan = r.plan[step.step];
          const expanded =
            open[step.step] ?? (step.step === r.current_step || step.status === "failed");
          const stepSeconds = elapsed(step.started, step.ended);
          return (
            <div key={step.step} className={CARD}>
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => {
                  setOpen({ ...open, [step.step]: !expanded });
                }}
                className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left"
              >
                <span aria-hidden="true" className="text-ink-muted">
                  {expanded ? "▾" : "▸"}
                </span>
                <span className="font-semibold">
                  {t("orchestrations.run.stepLabel", { n: step.step + 1 })} ·{" "}
                  {plan?.name === "" || plan?.name === undefined ? plan?.action : plan.name}
                </span>
                <span className="text-ink-muted">
                  {plan?.name === "" || plan?.name === undefined ? "" : `${plan.action} · `}
                  {plan === undefined ? "" : t(`orchestrations.step.paces.${plan.pace}`)}
                  {plan?.failure_threshold !== undefined &&
                    ` · ${t(`orchestrations.run.threshold.${plan.failure_threshold.unit}`, {
                      count: plan.failure_threshold.value,
                    })}`}
                </span>
                {COUNT_ORDER.flatMap((status) => {
                  const n = step.counts[status] ?? 0;
                  return n === 0 ? [] : [<RunStatusPill key={status} status={status} count={n} />];
                })}
                <span className="flex-1" />
                {stepSeconds !== undefined && (
                  <span className="text-ink-muted tabular-nums">
                    {formatDuration(stepSeconds, i18n.language)}
                  </span>
                )}
              </button>
              {step.acked_by !== undefined && step.acked_by !== "" && (
                <div className="border-t border-line px-3 py-2">
                  <p className="text-state-warn">
                    ◆ {t("orchestrations.run.acknowledgedBy", { by: step.acked_by })}{" "}
                    {step.acked_at !== null && step.acked_at !== undefined && (
                      <span className="text-ink-muted">
                        <DateTime value={step.acked_at} />
                      </span>
                    )}
                  </p>
                  <p className="whitespace-pre-wrap">{step.ack_comment}</p>
                </div>
              )}
              {expanded && <TargetTable targets={step.targets ?? []} onOpen={setShown} />}
            </div>
          );
        })}
      </div>

      {confirm === "again" && r.orchestration_id !== null && r.orchestration_id !== undefined && (
        <StartRunConfirmation
          orchestrationId={r.orchestration_id}
          onClose={() => {
            setConfirm(null);
          }}
        />
      )}
      {confirm === "continue" && (
        <ContinueRunConfirmation
          run={r}
          onClose={() => {
            setConfirm(null);
          }}
        />
      )}
      {confirm === "resume" && (
        <ResumeRunConfirmation
          run={r}
          onClose={() => {
            setConfirm(null);
          }}
        />
      )}
      {shown !== null && (
        <TargetDetails
          target={shown}
          run={r}
          onClose={() => {
            setShown(null);
          }}
        />
      )}
    </section>
  );
}

function TargetTable({
  targets,
  onOpen,
}: {
  targets: RunTarget[];
  onOpen: (target: RunTarget) => void;
}) {
  const { t, i18n } = useTranslation();
  return (
    <table className="w-full border-collapse border-t border-line text-data">
      <thead>
        <tr className="text-left text-ink-muted">
          <th className="px-3 py-1 font-medium">{t("orchestrations.run.target")}</th>
          <th className="px-3 py-1 font-medium">{t("orchestrations.runs.status")}</th>
          <th className="px-3 py-1 text-right font-medium">{t("orchestrations.run.ret")}</th>
          <th className="px-3 py-1 text-right font-medium">{t("orchestrations.runs.duration")}</th>
          <th className="w-full px-3 py-1 font-medium">{t("orchestrations.run.output")}</th>
        </tr>
      </thead>
      <tbody>
        {targets.map((target) => {
          const seconds = elapsed(target.started ?? target.queued, target.ended);
          const failed = ["failed", "refused", "timed_out", "cancelled"].includes(target.status);
          const output =
            target.message !== ""
              ? target.message
              : lastLine(failed ? target.stderr || target.stdout : target.stdout || target.stderr);
          return (
            <tr
              key={target.id}
              tabIndex={0}
              aria-haspopup="dialog"
              onClick={() => {
                onOpen(target);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpen(target);
                }
              }}
              className={`cursor-pointer border-t border-line/60 align-top hover:bg-surface-sunken/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${
                failed ? "bg-state-down-soft/40" : ""
              }`}
            >
              <td className="px-3 py-1 whitespace-nowrap">{target.label}</td>
              <td className="px-3 py-1">
                <RunStatusPill status={target.status} />
              </td>
              <td className="px-3 py-1 text-right font-mono tabular-nums">{target.ret ?? "—"}</td>
              <td className="px-3 py-1 text-right whitespace-nowrap tabular-nums">
                {seconds === undefined ? "—" : formatDuration(seconds, i18n.language)}
              </td>
              <td
                className={`max-w-0 truncate px-3 py-1 ${failed ? "text-state-down" : "text-ink-muted"} font-mono`}
              >
                {/* The agent colours its output: rendered as in the logs, not as escapes. */}
                <AnsiText text={output} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** The whole of a target: its command, dates, return code and both outputs. */
function TargetDetails({
  target,
  run,
  onClose,
}: {
  target: RunTarget;
  run: Run;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const plan = run.plan[target.step];
  const facts: [string, React.ReactNode][] = [
    [t("orchestrations.runs.status"), <RunStatusPill key="s" status={target.status} />],
    [t("orchestrations.run.action"), plan?.action ?? "—"],
    [t("orchestrations.run.queued"), target.queued ? <DateTime value={target.queued} /> : "—"],
    [t("orchestrations.run.ended"), target.ended ? <DateTime value={target.ended} /> : "—"],
    [t("orchestrations.run.ret"), target.ret ?? "—"],
  ];
  return (
    <Modal
      title={t("orchestrations.run.detailsTitle", { n: target.step + 1, target: target.label })}
      closeLabel={t("detail.close")}
      onClose={onClose}
    >
      <dl className="mb-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
        {facts.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-ink-muted">{label}</dt>
            <dd className="m-0">{value}</dd>
          </div>
        ))}
      </dl>
      {target.message !== "" && <p className="mb-2 text-state-down">■ {target.message}</p>}
      {target.command !== undefined && target.command !== "" && (
        <p className="mb-2 font-mono text-data text-ink-muted">{target.command}</p>
      )}
      {(["stdout", "stderr"] as const).map((key) =>
        target[key] === undefined || target[key] === "" ? null : (
          <div key={key} className="mb-2">
            <h3 className="mb-1 font-medium">{key}</h3>
            <OutputLines
              output={target[key] ?? ""}
              filename={`run-${String(run.id)}-target-${String(target.id)}-${key}`}
            />
          </div>
        ),
      )}
    </Modal>
  );
}
