import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { EventType } from "@ag-ui/core";
import { AssistantError, type Feedback } from "../assistant-client";
import { useAssistantChat } from "../use-assistant-chat";
import { aborted, completed, fakeClient, stored, type FakeClient } from "./fake-client";

const existing = { id: "existing", title: "Previous diagnostic" };
const down: Feedback = { rating: "down", reasons: ["missing_information"], expected: "per OS" };
const saved = [
  stored("turn-1:1", "user", "Old prompt"),
  stored("turn-1:4", "assistant", "Old answer", { feedback: down }),
];

describe("the feedback of useAssistantChat", () => {
  let client: FakeClient;
  beforeEach(() => {
    client = fakeClient([existing]);
    client.getMessages.mockResolvedValue({ messages: saved, nextCursor: "" });
    client.run.mockImplementation((_id, _input, options) => {
      options?.onEvent?.({ type: EventType.TEXT_MESSAGE_START, messageId: "turn-live:2" });
      options?.onEvent?.({
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: "turn-live:2",
        delta: "Hello",
      });
      return Promise.resolve(completed("turn-live"));
    });
  });
  const setup = async () => {
    const hook = renderHook(() => useAssistantChat(client));
    await waitFor(() => {
      expect(hook.result.current.pending).toBe("");
    });
    return hook;
  };

  it("restores the saved feedback per turn, apart from the messages", async () => {
    const { result } = await setup();
    await act(async () => {
      await result.current.resumeConversation("existing");
    });
    expect(result.current.ratings["turn-1"]).toEqual({
      feedback: down,
      pending: false,
      error: null,
    });
    expect(result.current.messages[1]).not.toHaveProperty("feedback");
    expect(result.current.messages[1]?.turnId).toBe("turn-1");
  });

  it("rates a streamed answer with the turn of its end, beside the turns", async () => {
    const { result } = await setup();
    await act(async () => {
      await result.current.send("hello");
    });
    expect(result.current.messages[1]).toMatchObject({
      role: "assistant",
      status: "completed",
      turnId: "turn-live",
    });
    await act(async () => {
      expect(await result.current.rate("turn-live", { rating: "up" })).toBe(true);
    });
    expect(client.setFeedback).toHaveBeenCalledWith(
      "new",
      "turn-live",
      { rating: "up" },
      expect.any(Object),
    );
    expect(result.current.ratings["turn-live"]?.feedback).toEqual({
      rating: "up",
      reasons: [],
      expected: "",
    });
    expect(result.current.pending).toBe("");

    await act(async () => {
      expect(await result.current.unrate("turn-live")).toBe(true);
    });
    expect(client.deleteFeedback).toHaveBeenCalledWith("new", "turn-live", expect.any(Object));
    expect(result.current.ratings["turn-live"]?.feedback).toBeNull();
  });

  it("keeps the previous feedback and holds the error when saving fails", async () => {
    const { result } = await setup();
    await act(async () => {
      await result.current.resumeConversation("existing");
    });
    const refusal = new AssistantError("feedback_gone", 404);
    client.setFeedback.mockRejectedValueOnce(refusal);
    await act(async () => {
      expect(await result.current.rate("turn-1", { rating: "up" })).toBe(false);
    });
    expect(result.current.ratings["turn-1"]).toEqual({
      feedback: down,
      pending: false,
      error: refusal,
    });
  });

  it("rates nothing without a conversation, and drops a late result once the page is left", async () => {
    const { result, unmount } = await setup();
    await act(async () => {
      expect(await result.current.rate("turn-1", { rating: "up" })).toBe(false);
    });
    expect(client.setFeedback).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.resumeConversation("existing");
    });
    let signal: AbortSignal | undefined;
    client.setFeedback.mockImplementationOnce((_id, _turn, _feedback, options) => {
      signal = options?.signal;
      return new Promise((_ok, fail) => {
        signal?.addEventListener("abort", () => {
          fail(aborted());
        });
      });
    });
    let rated: Promise<boolean> | undefined;
    act(() => {
      rated = result.current.rate("turn-1", { rating: "up" });
    });
    expect(result.current.ratings["turn-1"]?.pending).toBe(true);
    unmount();
    expect(signal?.aborted).toBe(true);
    expect(await rated).toBe(false);
  });
});
