import { createElement, StrictMode, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { AssistantError, type AssistantClient } from "../assistant-client";
import { errorText } from "../error-text";
import { useAssistantChat } from "../use-assistant-chat";
import { replayRun } from "./agui-fixtures";
import {
  aborted,
  completed,
  fakeClient,
  started,
  stored,
  text,
  toolResult,
  toolStart,
  type FakeClient,
} from "./fake-client";

const existing = { id: "existing", title: "Previous diagnostic" };
const created = { id: "new", title: "New diagnostic" };
const saved = [
  stored("turn-1:1", "user", "Old prompt"),
  stored("turn-1:2", "assistant", "Old answer", { createdAt: "2026-10-05T12:00:01Z" }),
];

type Options = Parameters<AssistantClient["run"]>[2];

let client: FakeClient;
beforeEach(() => {
  client = fakeClient([existing]);
  client.createConversation.mockResolvedValue(created);
});

const setup = async () => {
  const hook = renderHook(() => useAssistantChat(client));
  await waitFor(() => {
    expect(hook.result.current.pending).toBe("");
  });
  return hook;
};

/** A run that hangs until its signal stops it, after the events given. */
const hanging =
  (events: Parameters<NonNullable<NonNullable<Options>["onEvent"]>>[0][] = []) =>
  (_id: string, _input: unknown, options: Options) =>
    new Promise<never>((_resolve, reject) => {
      for (const event of events) options?.onEvent?.(event);
      options?.signal?.addEventListener(
        "abort",
        () => {
          reject(aborted());
        },
        { once: true },
      );
    });

describe("useAssistantChat", () => {
  it("lists the conversations only, by itself", async () => {
    const { result } = await setup();
    expect(result.current.conversations).toEqual([existing]);
    expect(client.createConversation).not.toHaveBeenCalled();
    expect(client.run).not.toHaveBeenCalled();
  });

  it("creates the first conversation only when a prompt is sent", async () => {
    const { result } = await setup();
    await act(async () => {
      await result.current.send("hello");
    });
    expect(client.createConversation).toHaveBeenCalledTimes(1);
    expect(client.run).toHaveBeenCalledWith(
      "new",
      { prompt: "hello", promptId: "prompt-1", held: [] },
      expect.objectContaining({ signal: expect.any(AbortSignal) as AbortSignal }),
    );
    expect(result.current.messages).toMatchObject([
      { id: "prompt-1", role: "user", text: "hello" },
      {
        role: "assistant",
        text: "Hello",
        status: "completed",
        turnId: "turn-9",
        messageIds: ["turn-9:2"],
      },
    ]);
    await act(async () => {
      await result.current.send("again");
    });
    expect(client.createConversation).toHaveBeenCalledTimes(1);
    expect(client.run).toHaveBeenCalledTimes(2);
    // The agent tells by the messages this page holds that it is in phase.
    expect(client.run.mock.calls[1]?.[1]).toEqual({
      prompt: "again",
      promptId: "prompt-2",
      held: [
        { id: "prompt-1", role: "user" },
        { id: "turn-9:2", role: "assistant" },
      ],
    });
  });

  it("starts a new conversation without asking the agent, the next prompt creating it", async () => {
    const { result } = await setup();
    await act(async () => {
      await result.current.send("hello");
    });
    act(() => {
      result.current.startConversation();
    });
    expect(result.current.conversation).toBeNull();
    expect(result.current.messages).toEqual([]);
    expect(client.createConversation).toHaveBeenCalledTimes(1);
    await act(async () => {
      await result.current.send("another");
    });
    expect(client.createConversation).toHaveBeenCalledTimes(2);
  });

  it("reads the title of the agent back after the first turn of an untitled conversation", async () => {
    client.createConversation.mockResolvedValue({ id: "untitled", title: "" });
    client.getConversation.mockResolvedValue({
      conversation: { id: "untitled", title: "Cluster health" },
      confirmation: null,
    });
    const { result } = await setup();
    await act(async () => {
      await result.current.send("cluster health?");
    });
    expect(client.getConversation).toHaveBeenCalledWith("untitled", expect.anything());
    expect(result.current.conversation?.title).toBe("Cluster health");
    expect(result.current.conversations[0]).toEqual({ id: "untitled", title: "Cluster health" });
  });

  it("keeps a successful turn when reading the title back fails", async () => {
    client.createConversation.mockResolvedValue({ id: "untitled", title: "" });
    client.getConversation.mockRejectedValue(new Error("unavailable"));
    const { result } = await setup();
    await act(async () => {
      await result.current.send("cluster health?");
    });
    expect(result.current.error).toBeNull();
    expect(result.current.messages.at(-1)).toMatchObject({
      role: "assistant",
      status: "completed",
    });
  });

  it("reads the saved messages before going on with the conversation", async () => {
    const { result } = await setup();
    await act(async () => {
      await result.current.resumeConversation("existing");
    });
    expect(result.current.resumed).toBe(true);
    expect(result.current.messages).toEqual([]);
    expect(client.getMessages).toHaveBeenCalledWith(
      "existing",
      expect.objectContaining({ signal: expect.any(AbortSignal) as AbortSignal }),
    );
    expect(client.run).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.send("continue");
    });
    expect(client.createConversation).not.toHaveBeenCalled();
    expect(client.run.mock.calls[0]?.[0]).toBe("existing");
  });

  it("does not erase the transcript when the conversation shown is selected", async () => {
    const { result } = await setup();
    await act(async () => {
      await result.current.send("hello");
    });
    client.getConversation.mockClear();
    await act(async () => {
      await result.current.resumeConversation("new");
    });
    expect(result.current.messages).toHaveLength(2);
    expect(client.getConversation).not.toHaveBeenCalled();
  });

  it("restores the saved text, then appends the stream without replacing the history", async () => {
    client.getMessages.mockResolvedValue({ messages: saved, nextCursor: "" });
    const { result } = await setup();
    await act(async () => {
      await result.current.resumeConversation("existing");
    });
    expect(result.current.messages).toMatchObject([
      { id: "turn-1:1", role: "user", text: "Old prompt", status: "completed" },
      { id: "turn-1:2", role: "assistant", text: "Old answer", status: "completed" },
    ]);
    await act(async () => {
      await result.current.send("continue");
    });
    expect(result.current.messages.map((message) => message.text)).toEqual([
      "Old prompt",
      "Old answer",
      "continue",
      "Hello",
    ]);
    expect(client.createConversation).not.toHaveBeenCalled();
    expect(client.run).toHaveBeenCalledTimes(1);
    expect(client.run.mock.calls[0]?.[1].held).toEqual([
      { id: "turn-1:1", role: "user" },
      { id: "turn-1:2", role: "assistant" },
    ]);
  });

  it("puts earlier messages before, drops the IDs it holds and keeps the streamed ones", async () => {
    client.getMessages
      .mockResolvedValueOnce({ messages: [saved[1]!], nextCursor: "1:2" })
      .mockResolvedValueOnce({ messages: saved, nextCursor: "" });
    const { result } = await setup();
    await act(async () => {
      await result.current.resumeConversation("existing");
    });
    await act(async () => {
      await result.current.send("continue");
    });
    await act(async () => {
      await result.current.loadOlderMessages();
    });
    expect(result.current.messages.map((message) => message.text)).toEqual([
      "Old prompt",
      "Old answer",
      "continue",
      "Hello",
    ]);
    expect(client.getMessages.mock.calls[1]?.[1]).toMatchObject({ before: "1:2" });
    expect(result.current.historyCursor).toBe("");
    await act(async () => {
      await result.current.loadOlderMessages();
    });
    expect(client.getMessages).toHaveBeenCalledTimes(2);
    expect(client.run).toHaveBeenCalledTimes(1);
  });

  it("sends nothing after a failed resume, until a resume asked again succeeds", async () => {
    client.getMessages
      .mockRejectedValueOnce(new AssistantError("http_error", 401))
      .mockResolvedValueOnce({ messages: saved, nextCursor: "" });
    const { result } = await setup();
    await act(async () => {
      await result.current.resumeConversation("existing");
    });
    expect(result.current.historyReady).toBe(false);
    await act(async () => {
      await result.current.send("must not send");
    });
    expect(client.run).not.toHaveBeenCalled();
    expect(client.createConversation).not.toHaveBeenCalled();
    expect(client.getMessages).toHaveBeenCalledTimes(1);
    await act(async () => {
      await result.current.resumeConversation("existing");
    });
    expect(result.current.historyReady).toBe(true);
    expect(result.current.messages).toHaveLength(2);
  });

  it("allows a new conversation after a failed history read", async () => {
    client.getMessages.mockRejectedValue(new AssistantError("http_error", 410));
    const { result } = await setup();
    await act(async () => {
      await result.current.resumeConversation("existing");
    });
    act(() => {
      result.current.startConversation();
    });
    expect(result.current.historyReady).toBe(true);
    expect(result.current.historyCursor).toBe("");
    expect(result.current.messages).toEqual([]);
    expect(client.run).not.toHaveBeenCalled();
  });

  it("keeps the transcript and the cursor after an error on an earlier page, without retry", async () => {
    client.getMessages
      .mockResolvedValueOnce({ messages: saved, nextCursor: "1:1" })
      .mockRejectedValueOnce(new AssistantError("http_error", 410));
    const { result } = await setup();
    await act(async () => {
      await result.current.resumeConversation("existing");
    });
    await act(async () => {
      await result.current.loadOlderMessages();
    });
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.historyCursor).toBe("1:1");
    expect(errorText(i18n.t, result.current.error)).toBe("This conversation has expired.");
    expect(client.getMessages).toHaveBeenCalledTimes(2);
  });

  it("stops a history read when the page is left, and drops what comes late", async () => {
    let options: { signal?: AbortSignal } | undefined;
    let resolve: (page: { messages: typeof saved; nextCursor: string }) => void = () => undefined;
    client.getMessages.mockImplementation((_id, value) => {
      options = value;
      return new Promise((done) => {
        resolve = done;
      });
    });
    const { result, unmount } = await setup();
    let pending: Promise<unknown> | undefined;
    await act(async () => {
      pending = result.current.resumeConversation("existing");
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(options).toBeDefined();
    });
    unmount();
    expect(options?.signal?.aborted).toBe(true);
    await act(async () => {
      resolve({ messages: saved, nextCursor: "" });
      await pending;
    });
    expect(client.run).not.toHaveBeenCalled();
  });

  it("streams the answers of a turn into one message, its tools and its tokens", async () => {
    client.run.mockImplementation(replayRun("text_and_tools"));
    const { result } = await setup();
    await act(async () => {
      await result.current.send("How many nodes?");
    });
    expect(result.current.messages[1]).toMatchObject({
      text: "Let me check the nodes.\n\nThere are two nodes: **n1** and **n2**.",
      status: "completed",
      turnId: "turn-1",
      usage: { totalTokens: 370 },
      messageIds: ["turn-1:2", "turn-1:4"],
      // search_tools, a tool of the agent itself, is a step too: it explains
      // a part of the time.
      steps: [
        { id: "call-0", tool: "search_tools", status: "completed", arguments: { query: "nodes" } },
        { id: "call-1", tool: "list_nodes", status: "completed", arguments: {} },
      ],
    });
  });

  it("completes a skill load, whose result carries no structured content", async () => {
    client.run.mockImplementation((_id, _input, options) => {
      options?.onEvent?.(started());
      for (const event of text("Following the procedure.")) options?.onEvent?.(event);
      options?.onEvent?.(toolStart("call-1", "load_skill"));
      options?.onEvent?.({
        type: "TOOL_CALL_END",
        toolCallId: "call-1",
        arguments: { skill: "node-maintenance" },
      } as never);
      options?.onEvent?.(
        toolResult("call-1", { structured: false, excerpt: "Skill node-maintenance, loaded" }),
      );
      return Promise.resolve(completed());
    });
    const { result } = await setup();
    await act(async () => {
      await result.current.send("Patch dev5n2");
    });
    expect(result.current.messages[1]?.steps).toMatchObject([
      {
        id: "call-1",
        tool: "load_skill",
        status: "completed",
        refusal: "",
        arguments: { skill: "node-maintenance" },
      },
    ]);
  });

  it("replaces the thread with the snapshot a page out of phase receives", async () => {
    client.getMessages.mockResolvedValue({ messages: saved, nextCursor: "1:1" });
    client.run.mockImplementation(replayRun("snapshot"));
    const { result } = await setup();
    await act(async () => {
      await result.current.resumeConversation("existing");
    });
    await act(async () => {
      await result.current.send("Any service?");
    });
    expect(result.current.messages).toMatchObject([
      { id: "u-1", role: "user", text: "How many nodes?" },
      {
        role: "assistant",
        text: "Two nodes.",
        status: "completed",
        turnId: "turn-1",
        messageIds: ["turn-1:2", "turn-1:4"],
        steps: [{ id: "call-1", tool: "list_nodes", status: "completed" }],
      },
      { id: "turn-2:1", role: "user", text: "Any service?" },
      { role: "assistant", text: "No service.", status: "completed", turnId: "turn-2" },
    ]);
    expect(result.current.messages).toHaveLength(4);
    // The snapshot holds the whole thread: there is no earlier page.
    expect(result.current.historyCursor).toBe("");
  });

  it("reads the conversation again when a snapshot left out its oldest turns", async () => {
    client.run.mockImplementation((_id, _input, options) => {
      options?.onEvent?.(started());
      options?.onEvent?.({
        type: "MESSAGES_SNAPSHOT",
        omittedTurns: 2,
        messages: [{ id: "turn-8:1", role: "user", content: "Later" }],
      } as never);
      for (const event of text("Hello")) options?.onEvent?.(event);
      return Promise.resolve(completed());
    });
    const { result } = await setup();
    await act(async () => {
      await result.current.send("hello");
    });
    expect(result.current.partial).toBe(true);
    expect(result.current.notice).toBe("partial");
    await act(async () => {
      await result.current.resumeConversation("new");
    });
    expect(client.getMessages).toHaveBeenCalledWith("new", expect.anything());
    expect(result.current.partial).toBe(false);
  });

  it("stops a turn, keeps what came, and never retries", async () => {
    let signal: AbortSignal | undefined;
    client.run.mockImplementation((id, input, options) => {
      signal = options?.signal;
      return hanging([...text("Partial"), toolStart("call-1", "list_nodes")])(id, input, options);
    });
    const { result } = await setup();
    let turn: Promise<unknown> | undefined;
    await act(async () => {
      turn = result.current.send("hello");
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(signal).toBeDefined();
    });
    await act(async () => {
      result.current.stop();
      await turn;
    });
    expect(signal?.aborted).toBe(true);
    expect(result.current.messages[1]).toMatchObject({
      text: "Partial",
      status: "stopped",
      steps: [{ status: "interrupted" }],
    });
    expect(result.current.notice).toBe("stopped");
    expect(client.run).toHaveBeenCalledTimes(1);
  });

  it("stops a turn when the page is left, and drops the events that come late", async () => {
    let options: Options;
    client.run.mockImplementation((id, input, value) => {
      options = value;
      return hanging(text("Old answer"))(id, input, value);
    });
    const { result, unmount } = await setup();
    let turn: Promise<unknown> | undefined;
    await act(async () => {
      turn = result.current.send("hello");
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(options).toBeDefined();
    });
    unmount();
    await act(async () => {
      options?.onEvent?.({
        type: "TEXT_MESSAGE_CONTENT",
        messageId: "turn-9:2",
        delta: "Late",
      } as never);
      await turn;
    });
    expect(options?.signal?.aborted).toBe(true);
    expect(client.run).toHaveBeenCalledTimes(1);
  });

  it("starts no turn when the page is left while the conversation is created", async () => {
    let resolve: (conversation: typeof created) => void = () => undefined;
    client.createConversation.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const { result, unmount } = await setup();
    let turn: Promise<unknown> | undefined;
    act(() => {
      turn = result.current.send("hello");
    });
    unmount();
    await act(async () => {
      resolve(created);
      await turn;
    });
    expect(client.run).not.toHaveBeenCalled();
  });

  it("refuses a second prompt while a turn runs", async () => {
    client.run.mockImplementation(hanging());
    const { result } = await setup();
    let turn: Promise<unknown> | undefined;
    await act(async () => {
      turn = result.current.send("hello");
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(client.run).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      await result.current.send("duplicate");
    });
    expect(client.run).toHaveBeenCalledTimes(1);
    await act(async () => {
      result.current.stop();
      await turn;
    });
  });

  it("keeps a failed answer without retrying, nor saying the error in its own words", async () => {
    client.run.mockImplementation((_id, _input, options) => {
      for (const event of text("Partial")) options?.onEvent?.(event);
      return Promise.reject(new Error("secret backend failure"));
    });
    const { result } = await setup();
    await act(async () => {
      await result.current.send("hello");
    });
    expect(errorText(i18n.t, result.current.error)).toBe(
      "The request to the assistant failed. It was not retried.",
    );
    expect(result.current.messages[1]).toMatchObject({ text: "Partial", status: "failed" });
    expect(client.run).toHaveBeenCalledTimes(1);
  });

  it("says a refusal of the relay, without retrying", async () => {
    client.listConversations.mockRejectedValue(
      new AssistantError("assistant_token_unavailable", 401),
    );
    const { result } = await setup();
    expect(errorText(i18n.t, result.current.error)).toBe(
      "Your single sign-on session no longer holds an access token: sign out and sign in again.",
    );
    expect(client.listConversations).toHaveBeenCalledTimes(1);
    expect(client.createConversation).not.toHaveBeenCalled();
  });

  it("keeps the prompt in sight when creating the conversation fails", async () => {
    client.createConversation.mockRejectedValue(new AssistantError("conversation_quota", 409));
    const { result } = await setup();
    await act(async () => {
      await result.current.send("Diagnose my estate");
    });
    expect(result.current.messages).toMatchObject([
      { role: "user", text: "Diagnose my estate" },
      { role: "assistant", status: "failed" },
    ]);
    expect(result.current.error).toMatchObject({ code: "conversation_quota" });
    expect(client.createConversation).toHaveBeenCalledTimes(1);
    expect(client.run).not.toHaveBeenCalled();
  });

  it("renames and deletes the conversation shown", async () => {
    const { result } = await setup();
    await act(async () => {
      await result.current.send("hello");
    });
    await act(async () => {
      await result.current.renameConversation("Renamed");
    });
    expect(result.current.conversation?.title).toBe("Renamed");
    expect(result.current.conversations[0]?.title).toBe("Renamed");
    await act(async () => {
      await result.current.deleteConversation();
    });
    expect(result.current.conversation).toBeNull();
    expect(result.current.conversations).toEqual([existing]);
    expect(result.current.messages).toEqual([]);
  });

  it("deletes every conversation of the user, list after list, the one shown with them", async () => {
    const { result } = await setup();
    await act(async () => {
      await result.current.send("hello");
    });
    client.listConversations
      .mockResolvedValueOnce([created, existing])
      .mockResolvedValueOnce([{ id: "third", title: "Third" }])
      .mockResolvedValueOnce([]);
    let deleted: number | undefined;
    await act(async () => {
      deleted = await result.current.deleteAllConversations();
    });
    expect(deleted).toBe(3);
    expect(client.deleteConversation.mock.calls.map(([id]) => id)).toEqual([
      "new",
      "existing",
      "third",
    ]);
    expect(result.current.conversations).toEqual([]);
    expect(result.current.conversation).toBeNull();
    expect(result.current.messages).toEqual([]);
  });

  it("keeps in the list what a failed deletion of all left", async () => {
    const { result } = await setup();
    client.listConversations.mockResolvedValueOnce([existing, { id: "third", title: "Third" }]);
    client.deleteConversation
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new AssistantError("http_error", 409));
    await act(async () => {
      await result.current.deleteAllConversations();
    });
    expect(result.current.error).toMatchObject({ status: 409 });
    expect(result.current.conversations.map((item) => item.id)).not.toContain("existing");
  });

  it("reads the list again without erasing the transcript", async () => {
    const { result } = await setup();
    await act(async () => {
      await result.current.send("hello");
    });
    client.listConversations.mockResolvedValue([{ ...created, title: "Hello diagnostic" }]);
    await act(async () => {
      await result.current.refreshConversations();
    });
    expect(result.current.conversation?.title).toBe("Hello diagnostic");
    expect(result.current.messages).toHaveLength(2);
  });

  it("never starts a turn by itself in StrictMode", async () => {
    const { result } = renderHook(() => useAssistantChat(client), {
      wrapper: ({ children }: { children: ReactNode }) => createElement(StrictMode, null, children),
    });
    await waitFor(() => {
      expect(result.current.pending).toBe("");
    });
    expect(result.current.conversations).toEqual([existing]);
    expect(client.createConversation).not.toHaveBeenCalled();
    expect(client.run).not.toHaveBeenCalled();
  });

  describe("the confirmation of an action", () => {
    const confirmation = {
      id: "confirmation-1",
      turnId: "turn-c",
      tool: { name: "update_object_config", title: "Update object config", destructive: true },
      arguments: { path: "web", yaml: "app#1:\n  start: /bin/true\n" },
      argumentTypes: { yaml: "application/yaml" },
      editable: true,
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "The path of the object." },
          yaml: {
            type: "string",
            contentMediaType: "application/yaml",
            description: "The configuration to apply.",
          },
          wait: { type: "boolean", description: "Wait until every live node has it." },
        },
        required: ["path", "yaml"],
        additionalProperties: false,
      },
      expiresAt: "2026-10-09T17:45:00Z",
    };
    const suspendTurn = () => client.run.mockImplementationOnce(replayRun("confirmation"));

    it("waits for a decision when a run ends on a confirmation", async () => {
      suspendTurn();
      const { result } = await setup();
      await act(async () => {
        await result.current.send("Start web with /bin/true");
      });
      expect(result.current.confirmation).toEqual({
        ...confirmation,
        conversationId: "new",
        assistantId: "local:1",
      });
      expect(result.current.messages.at(-1)).toMatchObject({
        status: "awaiting_confirmation",
        text: "I will apply this configuration.",
        turnId: "turn-c",
        usage: { totalTokens: 340 },
        steps: [{ id: "call-7", tool: "update_object_config", status: "pending" }],
      });
      await act(async () => {
        await result.current.send("another");
      });
      expect(client.run).toHaveBeenCalledTimes(1);
    });

    it.each([
      ["approve", "resume_approved", true, "Done: web starts with /bin/true.", "completed", 755],
      ["reject", "resume_rejected", false, "I did not apply it.", "rejected", 340],
    ] as const)(
      "answers %s with a resume and streams the rest of the turn",
      async (decision, name, approved, answer, status, tokens) => {
        suspendTurn();
        const { result } = await setup();
        await act(async () => {
          await result.current.send("Start web with /bin/true");
        });
        client.run.mockImplementationOnce(replayRun(name));
        await act(async () => {
          await result.current[decision]();
        });
        expect(client.run).toHaveBeenLastCalledWith(
          "new",
          {
            held: [
              { id: "prompt-1", role: "user" },
              { id: "turn-c:2", role: "assistant" },
            ],
            resume: { interruptId: "confirmation-1", approved },
          },
          expect.anything(),
        );
        expect(result.current.confirmation).toBeNull();
        expect(result.current.messages).toHaveLength(2);
        expect(result.current.messages.at(-1)).toMatchObject({
          status: "completed",
          text: `I will apply this configuration.\n\n${answer}`,
          turnId: "turn-c",
          usage: { totalTokens: tokens },
          steps: [{ id: "call-7", tool: "update_object_config", status }],
        });
      },
    );

    it("approves with the arguments the user edited, shown on the call", async () => {
      suspendTurn();
      const { result } = await setup();
      await act(async () => {
        await result.current.send("Start web with /bin/true");
      });
      const editedArgs = { path: "web", yaml: "app#1:\n  start: /bin/false\n" };
      client.run.mockImplementationOnce(replayRun("resume_edited"));
      await act(async () => {
        await result.current.approve(editedArgs);
      });
      expect(client.run.mock.calls[1]?.[1].resume).toEqual({
        interruptId: "confirmation-1",
        approved: true,
        editedArgs,
      });
      expect(result.current.messages.at(-1)).toMatchObject({
        status: "completed",
        steps: [{ id: "call-7", status: "completed", editedArgs }],
      });
    });

    it("asks the preview again for an edit, the call waiting again under a new confirmation", async () => {
      suspendTurn();
      const { result } = await setup();
      await act(async () => {
        await result.current.send("Start web with /bin/true");
      });
      client.run.mockImplementationOnce(replayRun("resume_preview"));
      const editedArgs = { path: "api", yaml: "app#1:\n  start: /bin/true\n" };
      await act(async () => {
        await result.current.previewAgain(editedArgs);
      });
      expect(client.run.mock.calls[1]?.[1].resume).toEqual({
        interruptId: "confirmation-1",
        preview: true,
        editedArgs,
        pending: { name: "update_object_config", arguments: confirmation.arguments },
      });
      expect(result.current.confirmation).toMatchObject({
        id: "confirmation-2",
        previewArguments: editedArgs,
        conversationId: "new",
        assistantId: "local:1",
      });
      expect(result.current.messages.at(-1)).toMatchObject({ status: "awaiting_confirmation" });
    });

    it("keeps the confirmation waiting when the agent refuses the edit", async () => {
      suspendTurn();
      const { result } = await setup();
      await act(async () => {
        await result.current.send("Start web with /bin/true");
      });
      client.run.mockImplementationOnce(replayRun("invalid_edited_arguments"));
      await act(async () => {
        await result.current.approve({ path: "web" });
      });
      expect(result.current.confirmation).toMatchObject({ id: "confirmation-1", editable: true });
      expect(result.current.error).toMatchObject({ code: "invalid_edited_arguments" });
      expect(result.current.messages.at(-1)).toMatchObject({
        status: "awaiting_confirmation",
        steps: [{ id: "call-7", status: "pending" }],
      });
    });

    it("sends no edit for a call that takes none", async () => {
      client.getConversation.mockResolvedValue({
        conversation: existing,
        confirmation: { ...confirmation, editable: false },
      });
      const { result } = await setup();
      await act(async () => {
        await result.current.resumeConversation("existing");
      });
      await act(async () => {
        await result.current.approve({ path: "db" });
      });
      expect(client.run).not.toHaveBeenCalled();
      expect(result.current.confirmation).toMatchObject({ id: "confirmation-1" });
    });

    it("shows the confirmation again after a reload, and the thread with it once answered", async () => {
      client.getConversation.mockResolvedValue({ conversation: existing, confirmation });
      client.getMessages.mockResolvedValue({
        messages: [
          stored("u-1", "user", "How many nodes?", { turnId: "turn-1" }),
          stored("turn-1:2", "assistant", "Two nodes."),
        ],
        nextCursor: "",
      });
      client.run.mockImplementationOnce(replayRun("resume_snapshot"));
      const { result } = await setup();
      await act(async () => {
        await result.current.resumeConversation("existing");
      });
      expect(result.current.confirmation).toMatchObject({
        id: "confirmation-1",
        conversationId: "existing",
        assistantId: null,
      });
      await act(async () => {
        await result.current.reject();
      });
      expect(client.run.mock.calls[0]?.[1]).toEqual({
        held: [
          { id: "u-1", role: "user" },
          { id: "turn-1:2", role: "assistant" },
        ],
        resume: { interruptId: "confirmation-1", approved: false },
      });
      expect(result.current.messages).toMatchObject([
        { id: "u-1", text: "How many nodes?" },
        { role: "assistant", text: "Two nodes.", turnId: "turn-1" },
        { id: "u-c", text: "Start web with /bin/true" },
        {
          role: "assistant",
          status: "completed",
          turnId: "turn-c",
          text: "I will apply this configuration.\n\nI did not apply it.",
          steps: [{ id: "call-7", tool: "update_object_config", status: "rejected" }],
        },
      ]);
      expect(result.current.messages).toHaveLength(4);
    });

    it("reports an expired confirmation and frees the conversation", async () => {
      suspendTurn();
      const { result } = await setup();
      await act(async () => {
        await result.current.send("Start web with /bin/true");
      });
      client.run.mockRejectedValueOnce(new AssistantError("confirmation_expired", 410));
      await act(async () => {
        await result.current.approve();
      });
      expect(result.current.confirmation).toBeNull();
      expect(errorText(i18n.t, result.current.error)).toBe(
        "The confirmation request expired. The action was not run.",
      );
      expect(result.current.messages.at(-1)).toMatchObject({
        status: "failed",
        steps: [{ id: "call-7", status: "interrupted" }],
      });
    });
  });

  describe("the queued message", () => {
    // A run that ends when the test says, normally or with an error.
    const deferredRun = () => {
      let resolve: () => void = () => undefined;
      let reject: (error: unknown) => void = () => undefined;
      const run = vi.fn<AssistantClient["run"]>((_id, _input, options) => {
        options?.onEvent?.(started());
        for (const event of text("Working on it", "turn-1:2")) options?.onEvent?.(event);
        return new Promise((ok, ko) => {
          resolve = () => {
            ok(completed("turn-1"));
          };
          reject = ko;
          options?.signal?.addEventListener(
            "abort",
            () => {
              ko(aborted());
            },
            { once: true },
          );
        });
      });
      return {
        run,
        end: () => {
          resolve();
        },
        fail: (error: unknown) => {
          reject(error);
        },
      };
    };
    const prompts = () =>
      client.run.mock.calls.map(([, input]) => ("prompt" in input ? input.prompt : undefined));

    it("goes once the turn ends normally, in its conversation, the thread up to date", async () => {
      const first = deferredRun();
      client.run.mockImplementationOnce(first.run);
      const { result } = await setup();
      let sent: Promise<unknown> | undefined;
      act(() => {
        sent = result.current.send("First");
      });
      await waitFor(() => {
        expect(result.current.conversation?.id).toBe("new");
      });
      act(() => {
        expect(result.current.queue("Second")).toBe(true);
      });
      expect(result.current.queued).toEqual({ conversationId: "new", text: "Second" });
      await act(async () => {
        first.end();
        await sent;
      });
      await waitFor(() => {
        expect(client.run).toHaveBeenCalledTimes(2);
      });
      expect(prompts()).toEqual(["First", "Second"]);
      const [id, input] = client.run.mock.calls[1] ?? [];
      expect(id).toBe("new");
      expect(input?.held?.map((message) => message.role)).toEqual(["user", "assistant"]);
      await waitFor(() => {
        expect(result.current.pending).toBe("");
      });
      expect(result.current.queued).toBeNull();
    });

    it.each([
      ["approval", "resume_approved", "approve"],
      ["rejection", "resume_rejected", "reject"],
    ] as const)(
      "waits for the decision on a confirmation, then goes after the %s",
      async (_, stream, decide) => {
        client.run
          .mockImplementationOnce(replayRun("confirmation"))
          .mockImplementationOnce(replayRun(stream));
        const { result } = await setup();
        let sent: Promise<unknown> | undefined;
        act(() => {
          sent = result.current.send("Start web with /bin/true");
          result.current.queue("Then check it");
        });
        await act(async () => {
          await sent;
        });
        expect(result.current.confirmation).not.toBeNull();
        expect(result.current.queued?.text).toBe("Then check it");
        expect(client.run).toHaveBeenCalledTimes(1);
        await act(async () => {
          await result.current[decide]();
        });
        await waitFor(() => {
          expect(client.run).toHaveBeenCalledTimes(3);
        });
        expect(prompts()[2]).toBe("Then check it");
      },
    );

    it("stays after a stop or a failure, and never goes alone", async () => {
      const first = deferredRun();
      client.run.mockImplementationOnce(first.run);
      const { result } = await setup();
      let sent: Promise<unknown> | undefined;
      act(() => {
        sent = result.current.send("First");
      });
      await waitFor(() => {
        expect(result.current.pending).toBe("turn");
      });
      act(() => {
        result.current.queue("Second");
        result.current.stop();
      });
      await act(async () => {
        await sent;
      });
      expect(result.current.queued?.text).toBe("Second");
      const second = deferredRun();
      client.run.mockImplementationOnce(second.run);
      act(() => {
        sent = result.current.send("Again");
      });
      await waitFor(() => {
        expect(result.current.pending).toBe("turn");
      });
      await act(async () => {
        second.fail(new AssistantError("http_error", 409));
        await sent;
      });
      await waitFor(() => {
        expect(result.current.pending).toBe("");
      });
      expect(result.current.queued?.text).toBe("Second");
      expect(prompts()).toEqual(["First", "Again"]);
    });

    it("keeps the last one queued only", async () => {
      const first = deferredRun();
      client.run.mockImplementationOnce(first.run);
      const { result } = await setup();
      let sent: Promise<unknown> | undefined;
      act(() => {
        sent = result.current.send("First");
      });
      await waitFor(() => {
        expect(result.current.pending).toBe("turn");
      });
      act(() => {
        result.current.queue("Second");
      });
      act(() => {
        result.current.queue("Second, rather");
      });
      await act(async () => {
        first.end();
        await sent;
      });
      await waitFor(() => {
        expect(client.run).toHaveBeenCalledTimes(2);
      });
      await waitFor(() => {
        expect(result.current.pending).toBe("");
      });
      expect(prompts()).toEqual(["First", "Second, rather"]);
    });

    it("goes with its conversation deleted", async () => {
      const { result } = await setup();
      await act(async () => {
        await result.current.send("hello");
      });
      act(() => {
        result.current.queue("Later");
      });
      await act(async () => {
        await result.current.deleteConversation();
      });
      expect(result.current.queued).toBeNull();
    });

    it("is given back when taken, and refuses an empty or too long text", async () => {
      const { result } = await setup();
      act(() => {
        result.current.queue("Kept");
      });
      let taken: string | null = null;
      act(() => {
        taken = result.current.takeQueued();
      });
      expect(taken).toBe("Kept");
      expect(result.current.queued).toBeNull();
      act(() => {
        expect(result.current.queue("   ")).toBe(false);
        expect(result.current.queue("é".repeat(16 * 1024 + 1))).toBe(false);
      });
      expect(result.current.queued).toBeNull();
    });
  });

  it("joins again a turn the pages of its history cut in two", async () => {
    const at = "2026-10-05T12:00:01Z";
    const last = stored("turn-1:4", "assistant", "Two nodes.", {
      createdAt: at,
      history: {
        steps: [],
        stepsOmitted: 0,
        runs: [{ startedAt: 1000, endedAt: 2000 }],
        usage: { totalTokens: 12 },
      },
    });
    client.getMessages
      .mockResolvedValueOnce({ messages: [last], nextCursor: "1:4" })
      .mockResolvedValueOnce({
        messages: [
          stored("turn-1:1", "user", "How many nodes?", { createdAt: at }),
          stored("turn-1:2", "assistant", "Let me check.", { createdAt: at }),
        ],
        nextCursor: "",
      });
    const { result } = await setup();
    await act(async () => {
      await result.current.resumeConversation("existing");
    });
    await act(async () => {
      await result.current.loadOlderMessages();
    });
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[1]).toMatchObject({
      id: "turn-1:4",
      text: "Let me check.\n\nTwo nodes.",
      messageIds: ["turn-1:2", "turn-1:4"],
      runs: [{ startedAt: 1000, endedAt: 2000 }],
      usage: { totalTokens: 12 },
    });
  });

  it("leaves out of an older page a message an answer joined holds", async () => {
    const check = stored("turn-1:2", "assistant", "Let me check.");
    client.getMessages
      .mockResolvedValueOnce({
        messages: [check, { ...check, id: "turn-1:4", text: "Two nodes." }],
        nextCursor: "1:2",
      })
      .mockResolvedValueOnce({
        messages: [stored("turn-1:1", "user", "How many nodes?"), check],
        nextCursor: "",
      });
    const { result } = await setup();
    await act(async () => {
      await result.current.resumeConversation("existing");
    });
    await act(async () => {
      await result.current.loadOlderMessages();
    });
    // turn-1:2 goes by the ID of the answer joined, turn-1:4, and is held.
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[1]).toMatchObject({
      text: "Let me check.\n\nTwo nodes.",
      messageIds: ["turn-1:2", "turn-1:4"],
    });
  });
});
