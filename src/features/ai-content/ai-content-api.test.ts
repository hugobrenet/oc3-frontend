import { describe, expect, it } from "vitest";
import { readStats } from "./ai-content-api";

describe("readStats", () => {
  it("knows nothing without the reads, which only an AIManager gets", () => {
    expect(readStats(undefined)).toBeUndefined();
  });

  it("says a text no assistant read", () => {
    expect(readStats([])).toEqual({ count: 0, last: undefined });
  });

  it("adds the backends, and keeps the last read of all", () => {
    expect(
      readStats([
        { backend: "oc3", count: 3, last_read: "2026-11-10T09:00:00Z" },
        { backend: "om3", count: 2, last_read: "2026-11-10T11:30:00Z" },
      ]),
    ).toEqual({ count: 5, last: "2026-11-10T11:30:00Z" });
  });
});
