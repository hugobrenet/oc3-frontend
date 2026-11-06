import { vi } from "vitest";
import { EventType } from "@ag-ui/core";
import type {
  AssistantClient,
  Conversation,
  RunEvent,
  RunResult,
  StoredMessage,
  ToolResult,
} from "../assistant-client";

/**
 * A client of the agent whose every method is a mock, for the tests of the hook
 * and of the page: by default, a user with one conversation, empty, and a run
 * that answers "Hello".
 */
export function fakeClient(conversations: Conversation[] = []) {
  let ids = 0;
  const client = {
    listConversations: vi.fn<AssistantClient["listConversations"]>(() =>
      Promise.resolve(conversations),
    ),
    createConversation: vi.fn<AssistantClient["createConversation"]>(() =>
      Promise.resolve({ id: "new", title: "New diagnostic" }),
    ),
    getConversation: vi.fn<AssistantClient["getConversation"]>((id) =>
      Promise.resolve({
        conversation: conversations.find((item) => item.id === id) ?? { id, title: "" },
        confirmation: null,
      }),
    ),
    getMessages: vi.fn<AssistantClient["getMessages"]>(() =>
      Promise.resolve({ messages: [], nextCursor: "" }),
    ),
    renameConversation: vi.fn<AssistantClient["renameConversation"]>((id, title) =>
      Promise.resolve({ id, title }),
    ),
    deleteConversation: vi.fn<AssistantClient["deleteConversation"]>(() => Promise.resolve()),
    listTools: vi.fn<AssistantClient["listTools"]>(() => Promise.resolve([])),
    newId: vi.fn<AssistantClient["newId"]>(() => `prompt-${String(++ids)}`),
    run: vi.fn<AssistantClient["run"]>((_id, _input, options) => {
      options?.onEvent?.(started());
      for (const event of text("Hello")) options?.onEvent?.(event);
      return Promise.resolve(completed());
    }),
    setFeedback: vi.fn<AssistantClient["setFeedback"]>((_id, _turnId, feedback) =>
      Promise.resolve({ reasons: [], expected: "", ...feedback }),
    ),
    deleteFeedback: vi.fn<AssistantClient["deleteFeedback"]>(() => Promise.resolve()),
  };
  return client satisfies AssistantClient;
}

export type FakeClient = ReturnType<typeof fakeClient>;

/** The events of a run as the client gives them. */
export const started = (at: number | null = null): RunEvent => ({
  type: EventType.RUN_STARTED,
  at,
});

export const text = (delta: string, messageId = "turn-9:2"): RunEvent[] => [
  { type: EventType.TEXT_MESSAGE_START, messageId },
  { type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta },
];

export const toolStart = (
  toolCallId: string,
  toolCallName: string,
  fields: { parentMessageId?: string; at?: number | null } = {},
): RunEvent => ({
  type: EventType.TOOL_CALL_START,
  toolCallId,
  toolCallName,
  parentMessageId: fields.parentMessageId ?? "turn-9:2",
  at: fields.at ?? null,
});

export const toolResult = (toolCallId: string, fields: Partial<ToolResult> = {}): RunEvent => ({
  type: EventType.TOOL_CALL_RESULT,
  toolCallId,
  at: null,
  rejected: false,
  structured: true,
  omitted: false,
  refusal: "",
  excerpt: "",
  truncated: false,
  ...fields,
});

export const completed = (turnId = "turn-9", tokens: number | null = null): RunResult => ({
  type: EventType.RUN_FINISHED,
  outcome: "success",
  turnId,
  tokens,
  startedAt: null,
  endedAt: null,
});

export const aborted = () => new DOMException("Canceled", "AbortError");

/** A stored message, as the client gives it. */
export const stored = (
  id: string,
  role: "user" | "assistant",
  text: string,
  fields: Partial<StoredMessage> = {},
): StoredMessage => ({
  id,
  turnId: id.split(":")[0] ?? id,
  role,
  text,
  createdAt: "2026-10-05T12:00:00Z",
  ...fields,
});
