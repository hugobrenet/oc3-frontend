import { useQuery } from "@tanstack/react-query";
import type { components } from "@/lib/api/schema";
import { api } from "@/lib/api/client";
import { problemText } from "@/lib/api/problem";

export type AISchedule = components["schemas"]["AISchedule"];
export type AIScheduleInput = components["schemas"]["AIScheduleInput"];
export type AIScheduleRun = components["schemas"]["AIScheduleRun"];
export type AIScheduleDay = components["schemas"]["AIScheduleDay"];

export const SCHEDULE_DAYS: AIScheduleDay[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export const SCHEDULE_LIMITS = { name: 64, prompt: 4000, channels: 10 };

export const aiSchedulesKey = (skill: string) => ["ai-schedules", skill];
export const aiScheduleRunsKey = (id: number) => ["ai-schedules", "runs", id];

/** The schedules of a skill, by name. */
export function useAISchedules(skill: string | undefined) {
  return useQuery({
    queryKey: aiSchedulesKey(skill ?? ""),
    enabled: skill !== undefined,
    queryFn: async () => {
      const { data, error } = await api.GET("/ai/schedules", {
        params: { query: { skill: skill ?? "" } },
      });
      if (error !== undefined) throw new Error(problemText(error));
      return data.data;
    },
  });
}

const pending = (runs: AIScheduleRun[] | undefined) =>
  runs?.some((r) => r.state === "queued" || r.state === "running") ?? false;

/** The latest runs of a schedule, followed while one waits or runs. */
export function useAIScheduleRuns(id: number | undefined) {
  return useQuery({
    queryKey: aiScheduleRunsKey(id ?? 0),
    enabled: id !== undefined,
    refetchInterval: (query) => (pending(query.state.data) ? 5000 : false),
    queryFn: async () => {
      const { data, error } = await api.GET("/ai/schedules/{schedule_id}/runs", {
        params: { path: { schedule_id: id ?? 0 }, query: { limit: 10 } },
      });
      if (error !== undefined) throw new Error(problemText(error));
      return data.data;
    },
  });
}

/** Creates a schedule, id absent, or replaces one. */
export async function saveAISchedule(
  id: number | undefined,
  body: AIScheduleInput,
): Promise<AISchedule> {
  const { data, error } =
    id === undefined
      ? await api.POST("/ai/schedules", { body })
      : await api.PUT("/ai/schedules/{schedule_id}", {
          params: { path: { schedule_id: id } },
          body,
        });
  if (error !== undefined) throw new Error(problemText(error));
  return data;
}

export async function deleteAISchedule(id: number): Promise<void> {
  const { error } = await api.DELETE("/ai/schedules/{schedule_id}", {
    params: { path: { schedule_id: id } },
  });
  if (error !== undefined) throw new Error(problemText(error));
}

/** Queues a run of the schedule at once. */
export async function runAISchedule(id: number): Promise<AIScheduleRun> {
  const { data, error } = await api.POST("/ai/schedules/{schedule_id}/runs", {
    params: { path: { schedule_id: id } },
  });
  if (error !== undefined) throw new Error(problemText(error));
  return data;
}

/** A schedule as the form edits it. */
export interface ScheduleDraft {
  name: string;
  prompt: string;
  days: AIScheduleDay[];
  at: string;
  timezone: string;
  channels: number[];
  sendFailures: boolean;
  enabled: boolean;
}

/** The time zone of the browser, the default of a new schedule. */
export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** The time zones the browser knows, to pick one; empty when it lists none. */
export function knownTimezones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [];
  }
}

export function emptySchedule(timezone = browserTimezone()): ScheduleDraft {
  return {
    name: "",
    prompt: "",
    days: ["mon", "tue", "wed", "thu", "fri"],
    at: "08:00",
    timezone,
    channels: [],
    sendFailures: true,
    enabled: true,
  };
}

export function scheduleDraftOf(s: AISchedule): ScheduleDraft {
  return {
    name: s.name,
    prompt: s.prompt,
    days: [...s.days],
    at: s.at,
    timezone: s.timezone,
    channels: [...s.channels],
    sendFailures: s.send_failures,
    enabled: s.enabled,
  };
}

export function scheduleInputOf(skill: string, d: ScheduleDraft): AIScheduleInput {
  return {
    name: d.name.trim(),
    skill,
    prompt: d.prompt,
    days: SCHEDULE_DAYS.filter((day) => d.days.includes(day)),
    at: d.at,
    timezone: d.timezone.trim(),
    channels: d.channels,
    send_failures: d.sendFailures,
    enabled: d.enabled,
  };
}

export type ScheduleProblem =
  "name" | "prompt" | "days" | "at" | "timezone" | "channelsNone" | "channelsMany";

const NAME = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;
const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

/** The problems of a draft, the API checking again (the skill, the channels). */
export function checkSchedule(d: ScheduleDraft, timezones = knownTimezones()): ScheduleProblem[] {
  const problems: ScheduleProblem[] = [];
  if (!NAME.test(d.name.trim())) problems.push("name");
  if ([...d.prompt].length > SCHEDULE_LIMITS.prompt) problems.push("prompt");
  if (d.days.length === 0) problems.push("days");
  if (!TIME.test(d.at)) problems.push("at");
  const zone = d.timezone.trim();
  if (zone === "" || (timezones.length > 0 && zone !== "UTC" && !timezones.includes(zone)))
    problems.push("timezone");
  if (d.channels.length === 0) problems.push("channelsNone");
  if (d.channels.length > SCHEDULE_LIMITS.channels) problems.push("channelsMany");
  return problems;
}
