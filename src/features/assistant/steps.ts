import type { i18n as I18n, TFunction } from "i18next";
import type { RunSpan, Step } from "./assistant-client";

/**
 * A duration in milliseconds, as the steps say it: 5 ms, 1.2 s, 12 s, 1 min 05 s.
 * A read of the MCP takes a few milliseconds: below a second, the milliseconds,
 * or every step would read 0 s.
 */
export function formatDuration(ms: number, language: string): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return `${new Intl.NumberFormat(language).format(Math.round(ms))} ms`;
  if (ms < 60000) {
    const seconds = new Intl.NumberFormat(language, {
      maximumFractionDigits: ms < 10000 ? 1 : 0,
    }).format(ms / 1000);
    return `${seconds} s`;
  }
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${String(minutes)} min ${String(seconds).padStart(2, "0")} s`;
}

/** A live timer, mm:ss. */
export function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

/** The duration of a step, null while it has no start or no end. */
export function stepDuration(step: Step): number | null {
  return step.startedAt !== null && step.endedAt !== null && step.endedAt >= step.startedAt
    ? step.endedAt - step.startedAt
    : null;
}

/** The duration of an answer: its runs, on the clock of the agent, the waits for a decision left out. */
export function answerDuration(runs: RunSpan[]): number {
  return runs.reduce(
    (total, run) =>
      run.startedAt !== null && run.endedAt !== null && run.endedAt >= run.startedAt
        ? total + run.endedAt - run.startedAt
        : total,
    0,
  );
}

/** An argument as a sentence names it: a string, a number, or a list of strings joined. */
export function paramOf(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string"))
    return value.join(", ");
  return undefined;
}

/** The name of a tool made readable: list_nodes, "List nodes". */
const readableName = (tool: string) => {
  const words = tool.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/**
 * The sentence of a step: its own (`assistant.steps.tool.<tool>`), filled with
 * its arguments as text, never read as placeholders; the name of its tool made
 * readable when it has none, or when an argument it names is missing.
 */
export function stepSentence(step: Step, t: TFunction, i18n: I18n): string {
  const name = `assistant.steps.tool.${step.tool}`;
  if (i18n.exists(name)) {
    const language = i18n.resolvedLanguage ?? i18n.language;
    const template = String(
      (i18n.getResource(language, "translation", name) as unknown) ??
        (i18n.getResource("en", "translation", name) as unknown) ??
        "",
    );
    const named = [...template.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1] ?? "");
    const params = Object.fromEntries(
      named.map((param) => [param, paramOf(step.arguments?.[param])]),
    );
    if (named.every((param) => params[param] !== undefined)) return t(name, params);
  }
  return readableName(step.tool);
}
