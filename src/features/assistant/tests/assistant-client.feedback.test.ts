import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AssistantError,
  createAssistantClient,
  parseFeedback,
  type AssistantClient,
  type FeedbackInput,
} from "../assistant-client";

const route = "/api/assistant/conversations/conversation-1/turns/turn-1/feedback";
const answer = {
  id: "turn-1:4",
  turn_id: "turn-1",
  role: "assistant",
  text: "Answer",
  created_at: "2026-10-05T12:00:01Z",
};

describe("parseFeedback", () => {
  it("normalizes the order of the reasons and the expected text", () => {
    expect(
      parseFeedback({
        rating: "down",
        reasons: ["action_not_done", "not_answered"],
        expected: "  per OS\n ",
      }),
    ).toEqual({ rating: "down", reasons: ["not_answered", "action_not_done"], expected: "per OS" });
    expect(parseFeedback({ rating: "up" })).toEqual({ rating: "up", reasons: [], expected: "" });
  });

  it.each([
    null,
    {},
    { rating: "meh" },
    { rating: "up", reasons: ["not_answered"] },
    { rating: "down", reasons: ["unknown"] },
    { rating: "down", reasons: ["not_answered", "not_answered"] },
    { rating: "down", reasons: "not_answered" },
    { rating: "down", expected: "é".repeat(1001) },
    { rating: "down", expected: "bell\u0007" },
    { rating: "down", expected: 3 },
  ])("refuses %j", (value) => {
    expect(parseFeedback(value)).toBeNull();
  });

  it("takes an expected text of exactly 1000 characters, line breaks included", () => {
    expect(parseFeedback({ rating: "down", expected: "😀".repeat(1000) })).not.toBeNull();
    expect(parseFeedback({ rating: "down", expected: "one\n\ttwo" })).not.toBeNull();
  });
});

describe("the feedback of the client", () => {
  let client: AssistantClient;
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  beforeEach(() => {
    client = createAssistantClient();
    fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const requestAt = (index: number) => fetchMock.mock.calls[index]?.[0] as Request;

  it("puts the normalized feedback and gives the one stored", async () => {
    const stored = { rating: "down", reasons: ["missing_information"], expected: "per OS" };
    fetchMock.mockResolvedValueOnce(
      Response.json({
        feedback: stored,
        created_at: "2026-10-15T10:00:00Z",
        updated_at: "2026-10-15T10:00:00Z",
      }),
    );
    expect(
      await client.setFeedback("conversation-1", "turn-1", {
        rating: "down",
        reasons: ["missing_information"],
        expected: " per OS ",
      }),
    ).toEqual(stored);
    expect(new URL(requestAt(0).url).pathname).toBe(route);
    expect(requestAt(0).method).toBe("PUT");
    expect(requestAt(0).headers.get("Content-Type")).toBe("application/json");
    expect(await requestAt(0).json()).toEqual(stored);
  });

  it("refuses an invalid feedback or turn without any request", () => {
    expect(() =>
      client.setFeedback("conversation-1", "turn-1", {
        rating: "up",
        reasons: ["not_answered"],
      }),
    ).toThrow(AssistantError);
    expect(() => client.setFeedback("conversation-1", "../x", { rating: "up" })).toThrow(
      AssistantError,
    );
    expect(() => client.deleteFeedback("conversation-1", "")).toThrow(AssistantError);
    expect(() =>
      client.setFeedback("conversation-1", "turn-1", {
        rating: "maybe",
      } as unknown as FeedbackInput),
    ).toThrow(AssistantError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses an invalid stored feedback", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ feedback: { rating: "maybe" } }));
    await expect(
      client.setFeedback("conversation-1", "turn-1", { rating: "up" }),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  it.each([
    [400, "feedback_invalid"],
    [404, "feedback_gone"],
    [409, "feedback_limit"],
    [410, "http_error"],
  ])("explains the refusal %i by the code %s", async (status, code) => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: { code: "x", message: "secret upstream" } }, { status }),
    );
    await expect(
      client.setFeedback("conversation-1", "turn-1", { rating: "up" }),
    ).rejects.toMatchObject({ status, code });
  });

  it("keeps the codes of the relay on the feedback routes", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: { code: "assistant_disabled", message: "x" } }, { status: 404 }),
    );
    await expect(
      client.setFeedback("conversation-1", "turn-1", { rating: "up" }),
    ).rejects.toMatchObject({ code: "assistant_disabled" });
  });

  it("deletes the feedback and requires 204", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json({}));
    await expect(client.deleteFeedback("conversation-1", "turn-1")).resolves.toBeUndefined();
    expect(new URL(requestAt(0).url).pathname).toBe(route);
    expect(requestAt(0).method).toBe("DELETE");
    await expect(client.deleteFeedback("conversation-1", "turn-1")).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("keeps the feedback of assistant messages and refuses it elsewhere", async () => {
    const feedback = { rating: "down", reasons: ["not_answered"], expected: "" };
    fetchMock
      .mockResolvedValueOnce(
        Response.json({ messages: [{ ...answer, feedback }], next_cursor: "" }),
      )
      .mockResolvedValueOnce(
        Response.json({ messages: [{ ...answer, role: "user", feedback }], next_cursor: "" }),
      )
      .mockResolvedValueOnce(
        Response.json({ messages: [{ ...answer, feedback: { rating: "bad" } }], next_cursor: "" }),
      )
      .mockResolvedValueOnce(Response.json({ messages: [answer], next_cursor: "" }));
    expect((await client.getMessages("conversation-1")).messages[0]?.feedback).toEqual(feedback);
    await expect(client.getMessages("conversation-1")).rejects.toMatchObject({
      code: "invalid_response",
    });
    await expect(client.getMessages("conversation-1")).rejects.toMatchObject({
      code: "invalid_response",
    });
    expect((await client.getMessages("conversation-1")).messages[0]).not.toHaveProperty("feedback");
  });
});
