import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AssistantError,
  MAX_SKILLS,
  createAssistantClient,
  isSkillName,
  parseSkills,
  type AssistantClient,
  type RunEvent,
  type RunInput,
} from "../assistant-client";
import { GOLDEN_THREAD, goldenResponse } from "./agui-fixtures";

const morning = { name: "morning-check", description: "Check the collector in the morning." };
const maintenance = { name: "node-maintenance", description: "Reboot a node." };

describe("parseSkills", () => {
  it("reads the skills, in the order of the agent", () => {
    expect(parseSkills({ skills: [morning, { ...maintenance, extra: 1 }] })).toEqual([
      morning,
      maintenance,
    ]);
    expect(parseSkills({ skills: [] })).toEqual([]);
  });

  it.each([
    ["no object", null],
    ["no list", { skills: {} }],
    [
      "too many",
      {
        skills: Array.from({ length: MAX_SKILLS + 1 }, (_, i) => ({
          name: `s${String(i)}`,
          description: "",
        })),
      },
    ],
    ["a repeated name", { skills: [morning, { ...maintenance, name: "morning-check" }] }],
    ["a name not shaped as one", { skills: [{ ...morning, name: "Morning Check" }] }],
    ["a long description", { skills: [{ ...morning, description: "é".repeat(151) }] }],
    ["no description", { skills: [{ name: "morning-check" }] }],
  ])("refuses %s", (_name, value) => {
    expect(() => parseSkills(value)).toThrow(AssistantError);
  });

  it("takes the names the agent takes", () => {
    expect(["a", "node-maintenance", "x".repeat(64)].every(isSkillName)).toBe(true);
    expect(
      ["", "-a", "a-", "A", "a_b", "a b", "/etc", "x".repeat(65), 7, null].some(isSkillName),
    ).toBe(false);
  });
});

describe("the skills of the client", () => {
  let client: AssistantClient;
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  beforeEach(() => {
    client = createAssistantClient({ newId: () => "run-1" });
    fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const requestAt = (index: number) => fetchMock.mock.calls[index]?.[0] as Request;
  const sent = async () => (await requestAt(0).clone().json()) as Record<string, unknown>;

  it("lists the skills of the agent through the relay", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ skills: [morning, maintenance] }));
    await expect(client.listSkills()).resolves.toEqual([morning, maintenance]);
    expect(new URL(requestAt(0).url).pathname).toBe("/api/assistant/skills");
    expect(requestAt(0).method).toBe("GET");
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: { code: "skills_unavailable", message: "raw" } }, { status: 502 }),
    );
    await expect(client.listSkills()).rejects.toMatchObject({
      code: "skills_unavailable",
      status: 502,
    });
    // A collector that relays no list, told from an assistant not configured.
    fetchMock.mockResolvedValueOnce(Response.json({}, { status: 404 }));
    await expect(client.listSkills()).rejects.toMatchObject({ code: "skills_unlisted" });
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: { code: "assistant_disabled", message: "x" } }, { status: 404 }),
    );
    await expect(client.listSkills()).rejects.toMatchObject({ code: "assistant_disabled" });
  });

  it("sends the skill of a new prompt in the forwarded properties, with its model", async () => {
    fetchMock.mockResolvedValueOnce(goldenResponse("skill_asked"));
    await client.run(GOLDEN_THREAD, {
      prompt: "/morning-check",
      promptId: "u-s",
      model: "luna",
      skill: "morning-check",
    });
    const body = await sent();
    expect(body.forwardedProps).toEqual({ model: "luna", skill: "morning-check" });
    expect((body.messages as unknown[]).at(-1)).toEqual({
      id: "u-s",
      role: "user",
      content: "/morning-check",
    });
  });

  it("sends no skill with the answer to a confirmation", async () => {
    fetchMock.mockResolvedValueOnce(goldenResponse("resume_rejected"));
    // A skill given with it, as a careless caller would: never sent with a resume.
    const input = {
      resume: { interruptId: "confirmation-1", approved: false },
      skill: "morning-check",
    } as unknown as RunInput;
    await client.run(GOLDEN_THREAD, input).catch(() => undefined);
    expect((await sent()).forwardedProps).toEqual({});
  });

  it("refuses a skill not shaped as one without any request", () => {
    for (const skill of ["", "Morning", "/morning-check", "x".repeat(65)])
      expect(() => client.run(GOLDEN_THREAD, { prompt: "hi", promptId: "u-1", skill })).toThrow(
        AssistantError,
      );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("replays the load of the skill asked as a step, and tells a skill unavailable by its code", async () => {
    const events: RunEvent[] = [];
    fetchMock.mockResolvedValueOnce(goldenResponse("skill_asked"));
    await client.run(
      GOLDEN_THREAD,
      { prompt: "/morning-check", promptId: "u-s", skill: "morning-check" },
      {
        onEvent: (event) => {
          events.push(event);
        },
      },
    );
    expect(events.find((event) => event.type === "TOOL_CALL_START")).toMatchObject({
      toolCallName: "load_skill",
      parentMessageId: "turn-s:2",
    });
    expect(events.find((event) => event.type === "TOOL_CALL_RESULT")).not.toMatchObject({
      isError: true,
    });
    fetchMock.mockResolvedValueOnce(goldenResponse("skill_unavailable"));
    const failed: RunEvent[] = [];
    await expect(
      client.run(
        GOLDEN_THREAD,
        { prompt: "/morning-check", promptId: "u-u", skill: "morning-check" },
        {
          onEvent: (event) => {
            failed.push(event);
          },
        },
      ),
    ).rejects.toMatchObject({ code: "skill_unavailable" });
    // Its step an error result.
    expect(failed.find((event) => event.type === "TOOL_CALL_RESULT")).toMatchObject({
      isError: true,
    });
  });

  it("tells a name the agent refused by its code", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: { code: "invalid_skill", message: "raw" } }, { status: 400 }),
    );
    await expect(
      client.run(GOLDEN_THREAD, { prompt: "hi", promptId: "u-1", skill: "morning-check" }),
    ).rejects.toMatchObject({ code: "invalid_skill", status: 400 });
  });

  it("reads the skill a prompt asked in the history, on the message of the user only", async () => {
    const page = (fields: {
      user?: Record<string, unknown>;
      answer?: Record<string, unknown>;
    }) => ({
      messages: [
        {
          id: "turn-1:1",
          turn_id: "turn-1",
          role: "user",
          text: "on n1",
          created_at: "2026-10-05T12:00:00Z",
          ...fields.user,
        },
        {
          id: "turn-1:2",
          turn_id: "turn-1",
          role: "assistant",
          text: "Done.",
          created_at: "2026-10-05T12:00:01Z",
          ...fields.answer,
        },
      ],
      next_cursor: "",
    });
    fetchMock.mockResolvedValueOnce(Response.json(page({ user: { skill: "node-maintenance" } })));
    const { messages } = await client.getMessages("conversation-1");
    expect(messages[0]?.skill).toBe("node-maintenance");
    expect(messages[1]).not.toHaveProperty("skill");
    for (const fields of [
      { user: { skill: "Node Maintenance" } },
      { user: { skill: 7 } },
      { answer: { skill: "node-maintenance" } },
    ]) {
      fetchMock.mockResolvedValueOnce(Response.json(page(fields)));
      await expect(client.getMessages("conversation-1")).rejects.toMatchObject({
        code: "invalid_response",
      });
    }
  });
});
