import { describe, expect, it } from "vitest";
import {
  checkSchedule,
  emptySchedule,
  scheduleDraftOf,
  scheduleInputOf,
  type AISchedule,
} from "./ai-schedules-api";

const zones = ["Europe/Paris", "America/New_York"];

describe("checkSchedule", () => {
  const valid = { ...emptySchedule("Europe/Paris"), name: "morning", channels: [1] };

  it("accepts a schedule on weekdays at 08:00", () => {
    expect(checkSchedule(valid, zones)).toEqual([]);
    expect(checkSchedule({ ...valid, timezone: "UTC" }, zones)).toEqual([]);
  });

  it("names each problem", () => {
    expect(
      checkSchedule(
        {
          ...valid,
          name: "-Morning",
          days: [],
          at: "8:00",
          timezone: "Paris",
          channels: [],
          prompt: "x".repeat(4001),
        },
        zones,
      ),
    ).toEqual(["name", "prompt", "days", "at", "timezone", "channelsNone"]);
    expect(
      checkSchedule({ ...valid, channels: Array.from({ length: 11 }, (_, i) => i) }, zones),
    ).toEqual(["channelsMany"]);
  });

  it("takes any time zone when the browser lists none", () => {
    expect(checkSchedule({ ...valid, timezone: "Mars/Olympus" }, [])).toEqual([]);
  });
});

describe("scheduleInputOf", () => {
  it("orders the days and trims the name and the zone", () => {
    const input = scheduleInputOf("morning-check", {
      ...emptySchedule("Europe/Paris"),
      name: " morning ",
      timezone: " Europe/Paris ",
      days: ["fri", "mon"],
      channels: [2],
    });
    expect(input).toMatchObject({
      name: "morning",
      skill: "morning-check",
      days: ["mon", "fri"],
      timezone: "Europe/Paris",
      send_failures: true,
      enabled: true,
    });
  });

  it("gives back a saved schedule as it is", () => {
    const saved: AISchedule = {
      id: 1,
      name: "morning",
      skill: "morning-check",
      prompt: "in French",
      days: ["mon"],
      at: "07:30",
      timezone: "Europe/Paris",
      channels: [3],
      send_failures: false,
      enabled: false,
      created: "2026-11-12T10:00:00Z",
      updated: "2026-11-12T10:00:00Z",
      updated_by: "a@example.com",
    };
    expect(scheduleInputOf("morning-check", scheduleDraftOf(saved))).toEqual({
      name: "morning",
      skill: "morning-check",
      prompt: "in French",
      days: ["mon"],
      at: "07:30",
      timezone: "Europe/Paris",
      channels: [3],
      send_failures: false,
      enabled: false,
    });
  });
});
