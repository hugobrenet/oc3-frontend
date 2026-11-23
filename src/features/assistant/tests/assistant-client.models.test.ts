import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AssistantError,
  MAX_MODELS,
  createAssistantClient,
  parseModels,
  type AssistantClient,
} from "../assistant-client";
import { GOLDEN_THREAD, goldenResponse } from "./agui-fixtures";

const haiku = { id: "default", label: "Claude Haiku", default: true, ready: true };
const luna = { id: "luna", label: "GPT Luna", default: false, ready: true };

describe("parseModels", () => {
  it("reads the models, the default first", () => {
    expect(parseModels({ models: [haiku, { ...luna, extra: 1 }] })).toEqual([haiku, luna]);
    expect(parseModels({ models: [haiku] })).toEqual([haiku]);
  });

  it.each([
    ["no object", null],
    ["no list", { models: {} }],
    ["an empty list", { models: [] }],
    [
      "too many",
      {
        models: Array.from({ length: MAX_MODELS + 1 }, (_, i) => ({
          ...luna,
          id: `m${String(i)}`,
          default: i === 0,
        })),
      },
    ],
    ["a repeated ID", { models: [haiku, { ...luna, id: "default" }] }],
    ["an empty ID", { models: [haiku, { ...luna, id: "" }] }],
    ["a long ID", { models: [haiku, { ...luna, id: "x".repeat(65) }] }],
    ["an empty label", { models: [haiku, { ...luna, label: " " }] }],
    ["a long label", { models: [haiku, { ...luna, label: "é".repeat(65) }] }],
    ["no default", { models: [{ ...haiku, default: false }, luna] }],
    ["two defaults", { models: [haiku, { ...luna, default: true }] }],
    ["a ready string", { models: [haiku, { ...luna, ready: "true" }] }],
  ])("refuses %s", (_name, value) => {
    expect(() => parseModels(value)).toThrow(AssistantError);
  });
});

describe("the models of the client", () => {
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

  it("lists the models of the agent through the relay", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ models: [haiku, luna] }));
    await expect(client.listModels()).resolves.toEqual([haiku, luna]);
    expect(new URL(requestAt(0).url).pathname).toBe("/api/assistant/models");
    expect(requestAt(0).method).toBe("GET");
    fetchMock.mockResolvedValueOnce(Response.json({ models: [] }));
    await expect(client.listModels()).rejects.toMatchObject({ code: "invalid_response" });
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: { code: "assistant_unreachable", message: "x" } }, { status: 502 }),
    );
    await expect(client.listModels()).rejects.toMatchObject({
      code: "assistant_unreachable",
      status: 502,
    });
    // A collector that relays no list, told from an assistant not configured.
    fetchMock.mockResolvedValueOnce(Response.json({}, { status: 404 }));
    await expect(client.listModels()).rejects.toMatchObject({ code: "models_unlisted" });
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: { code: "assistant_disabled", message: "x" } }, { status: 404 }),
    );
    await expect(client.listModels()).rejects.toMatchObject({ code: "assistant_disabled" });
  });

  it("sends the model of a new prompt in the forwarded properties", async () => {
    fetchMock.mockResolvedValueOnce(goldenResponse("text_and_tools"));
    await client.run(GOLDEN_THREAD, { prompt: "How many nodes?", promptId: "u-1", model: "luna" });
    expect((await sent()).forwardedProps).toEqual({ model: "luna" });
  });

  it("sends no model when none is chosen", async () => {
    fetchMock.mockResolvedValueOnce(goldenResponse("text_and_tools"));
    await client.run(GOLDEN_THREAD, { prompt: "How many nodes?", promptId: "u-1" });
    expect((await sent()).forwardedProps).toEqual({});
  });

  it("refuses an invalid model without any request", () => {
    for (const model of ["", "x".repeat(65)])
      expect(() => client.run(GOLDEN_THREAD, { prompt: "hi", promptId: "u-1", model })).toThrow(
        AssistantError,
      );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("tells a model the agent no longer offers by its code", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: { code: "model_unknown", message: "raw" } }, { status: 400 }),
    );
    await expect(
      client.run(GOLDEN_THREAD, { prompt: "hi", promptId: "u-1", model: "gone" }),
    ).rejects.toMatchObject({ code: "model_unknown", status: 400 });
  });

  it("reads the model of a turn on its last answer of the history", async () => {
    const page = (extra: Record<string, unknown>) => ({
      messages: [
        {
          id: "turn-1:1",
          turn_id: "turn-1",
          role: "user",
          text: "Q",
          created_at: "2026-10-05T12:00:00Z",
        },
        {
          id: "turn-1:2",
          turn_id: "turn-1",
          role: "assistant",
          text: "A",
          created_at: "2026-10-05T12:00:01Z",
          ...extra,
        },
      ],
      next_cursor: "",
    });
    fetchMock.mockResolvedValueOnce(Response.json(page({ model_id: "luna" })));
    const { messages } = await client.getMessages("conversation-1");
    expect(messages[1]?.modelId).toBe("luna");
    expect(messages[0]).not.toHaveProperty("modelId");
    fetchMock.mockResolvedValueOnce(Response.json(page({ model_id: 7 })));
    await expect(client.getMessages("conversation-1")).rejects.toMatchObject({
      code: "invalid_response",
    });
  });
});
