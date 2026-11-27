import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventType } from "@ag-ui/core";
import { AssistantError, type Capabilities, type Feedback } from "../assistant-client";
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
  const setup = async ({ feedback = true } = {}) => {
    const hook = renderHook(() => useAssistantChat(client));
    await waitFor(() => {
      expect(hook.result.current.pending).toBe("");
    });
    if (feedback)
      await waitFor(() => {
        expect(hook.result.current.feedbackEnabled).toBe(true);
      });
    return hook;
  };
  const resumed = async (result: { current: ReturnType<typeof useAssistantChat> }) => {
    await act(async () => {
      await result.current.resumeConversation("existing");
    });
  };

  it("takes the feedback only once the agent says it does", async () => {
    let resolve: ((capabilities: Capabilities) => void) | undefined;
    client.getCapabilities.mockImplementationOnce(() => new Promise((ok) => (resolve = ok)));
    const { result } = await setup({ feedback: false });
    await resumed(result);
    expect(result.current.feedbackEnabled).toBe(false);
    await act(async () => {
      expect(await result.current.rate("turn-1", { rating: "up" })).toBe(false);
    });
    expect(client.setFeedback).not.toHaveBeenCalled();
    // The read under way is not started again by the action of the user.
    expect(client.getCapabilities).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve?.({ feedback: true, models: false, skills: false });
    });
    expect(result.current.feedbackEnabled).toBe(true);
  });

  it.each([
    [
      "turned off",
      () =>
        client.getCapabilities.mockResolvedValue({ feedback: false, models: false, skills: false }),
    ],
    [
      "unreadable",
      () => client.getCapabilities.mockRejectedValue(new AssistantError("network_error")),
    ],
  ])("neither offers nor sends the feedback when the capabilities are %s", async (_name, mock) => {
    mock();
    const { result } = await setup({ feedback: false });
    await waitFor(() => {
      expect(client.getCapabilities).toHaveBeenCalled();
    });
    await resumed(result);
    expect(result.current.feedbackEnabled).toBe(false);
    await act(async () => {
      expect(await result.current.rate("turn-1", { rating: "up" })).toBe(false);
      expect(await result.current.unrate("turn-1")).toBe(false);
    });
    expect(client.setFeedback).not.toHaveBeenCalled();
    expect(client.deleteFeedback).not.toHaveBeenCalled();
  });

  it("reads again, with the next action of the user, the capabilities it could not read", async () => {
    client.getCapabilities.mockRejectedValueOnce(new AssistantError("http_error", 503));
    const { result } = await setup({ feedback: false });
    await waitFor(() => {
      expect(client.getCapabilities).toHaveBeenCalledTimes(1);
    });
    expect(result.current.feedbackEnabled).toBe(false);
    await resumed(result);
    await waitFor(() => {
      expect(result.current.feedbackEnabled).toBe(true);
    });
    expect(client.getCapabilities).toHaveBeenCalledTimes(2);
    // Known, they are not read again.
    await act(async () => {
      await result.current.send("hello");
    });
    expect(client.getCapabilities).toHaveBeenCalledTimes(2);
  });

  it("reads again with send, and starts no second read while one is under way", async () => {
    client.getCapabilities.mockRejectedValueOnce(new AssistantError("http_error", 503));
    let resolve: ((capabilities: Capabilities) => void) | undefined;
    client.getCapabilities.mockImplementationOnce(() => new Promise((ok) => (resolve = ok)));
    const { result } = await setup({ feedback: false });
    await waitFor(() => {
      expect(client.getCapabilities).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      await result.current.send("hello");
    });
    await waitFor(() => {
      expect(client.getCapabilities).toHaveBeenCalledTimes(2);
    });
    // Another action while the second read is under way does not start a third.
    await act(async () => {
      await result.current.send("again");
    });
    await resumed(result);
    expect(client.getCapabilities).toHaveBeenCalledTimes(2);
    await act(async () => {
      resolve?.({ feedback: true, models: false, skills: false });
    });
    expect(result.current.feedbackEnabled).toBe(true);
  });

  it("offers no feedback once the chat is no longer enabled", async () => {
    const { result, rerender } = renderHook(({ enabled }) => useAssistantChat(client, enabled), {
      initialProps: { enabled: true },
    });
    await waitFor(() => {
      expect(result.current.feedbackEnabled).toBe(true);
    });
    rerender({ enabled: false });
    expect(result.current.feedbackEnabled).toBe(false);
  });

  it("reads the capabilities of another identity", async () => {
    const { result, rerender } = renderHook(
      ({ identity }) => useAssistantChat(client, true, identity),
      { initialProps: { identity: "alice" } },
    );
    await waitFor(() => {
      expect(result.current.feedbackEnabled).toBe(true);
    });
    let resolve: ((capabilities: Capabilities) => void) | undefined;
    client.getCapabilities.mockImplementationOnce(() => new Promise((ok) => (resolve = ok)));
    rerender({ identity: "bob" });
    expect(result.current.feedbackEnabled).toBe(false);
    await waitFor(() => {
      expect(client.getCapabilities).toHaveBeenCalledTimes(2);
    });
    await act(async () => {
      resolve?.({ feedback: true, models: false, skills: false });
    });
    expect(result.current.feedbackEnabled).toBe(true);
  });

  it("takes the feedback off when the agent refuses it as turned off", async () => {
    const { result } = await setup();
    await resumed(result);
    client.setFeedback.mockRejectedValueOnce(new AssistantError("feedback_disabled", 403));
    await act(async () => {
      expect(await result.current.rate("turn-1", { rating: "up" })).toBe(false);
    });
    expect(result.current.ratings["turn-1"]?.error).toMatchObject({ code: "feedback_disabled" });
    expect(result.current.feedbackEnabled).toBe(false);
  });

  it("drops the late capabilities of a previous identity", async () => {
    let resolve: ((capabilities: Capabilities) => void) | undefined;
    let signal: AbortSignal | undefined;
    client.getCapabilities.mockImplementationOnce((options) => {
      signal = options?.signal;
      return new Promise((ok) => (resolve = ok));
    });
    const { result, rerender } = renderHook(
      ({ identity }) => useAssistantChat(client, true, identity),
      { initialProps: { identity: "alice" } },
    );
    client.getCapabilities.mockResolvedValue({ feedback: false, models: false, skills: false });
    rerender({ identity: "bob" });
    await waitFor(() => {
      expect(client.getCapabilities).toHaveBeenCalledTimes(2);
    });
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      resolve?.({ feedback: true, models: false, skills: false });
    });
    expect(result.current.feedbackEnabled).toBe(false);
    // The late answer does not replace those of the new identity, which are
    // not read again.
    await act(async () => new Promise((done) => setTimeout(done, 20)));
    expect(client.getCapabilities).toHaveBeenCalledTimes(2);
  });

  it("reads the capabilities of another client", async () => {
    const { result, rerender } = renderHook(({ chatClient }) => useAssistantChat(chatClient), {
      initialProps: { chatClient: client },
    });
    await waitFor(() => {
      expect(result.current.feedbackEnabled).toBe(true);
    });
    let resolve: ((capabilities: Capabilities) => void) | undefined;
    const other = {
      ...client,
      getCapabilities: vi.fn(() => new Promise<Capabilities>((ok) => (resolve = ok))),
    };
    rerender({ chatClient: other });
    expect(result.current.feedbackEnabled).toBe(false);
    await waitFor(() => {
      expect(other.getCapabilities).toHaveBeenCalled();
    });
    await act(async () => {
      resolve?.({ feedback: true, models: false, skills: false });
    });
    expect(result.current.feedbackEnabled).toBe(true);
  });

  it("reads no capabilities while the chat is not enabled", async () => {
    const { result } = renderHook(() => useAssistantChat(client, false));
    await act(async () => new Promise((done) => setTimeout(done, 20)));
    expect(client.getCapabilities).not.toHaveBeenCalled();
    expect(result.current.feedbackEnabled).toBe(false);
  });

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
