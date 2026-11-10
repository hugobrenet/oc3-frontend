import { useCallback, useEffect, useRef, useState } from "react";
import { EventType } from "@ag-ui/core";
import {
  AGENT_TOOLS,
  MAX_PROMPT_BYTES,
  type Args,
  type AssistantClient,
  type Confirmation,
  type Conversation,
  type Feedback,
  type FeedbackInput,
  type HeldMessage,
  type RunEvent,
  type RunResult,
  type RunSpan,
  type SnapshotMessage,
  type Step,
  type StoredMessage,
  type ToolResult,
} from "./assistant-client";

export type MessageStatus =
  "running" | "completed" | "awaiting_confirmation" | "stopped" | "failed";

/**
 * A message of the transcript. An answer of the agent is one message per turn: it
 * holds the AG-UI messages of the turn (`messageIds`), which tell the agent this
 * page is in phase, and the text message last streamed into it (`textId`).
 * `steps` are the calls of its tools; `runs` the runs of its turn, on the clock
 * of the agent; `liveSince` the time, on the clock of the page, the running one
 * started at, for its live timer.
 */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  turnId?: string;
  createdAt?: string;
  status: MessageStatus;
  steps: Step[];
  /** Steps the agent left out of the history, past its bound. */
  stepsOmitted: number;
  runs: RunSpan[];
  liveSince: number | null;
  usage: { totalTokens: number } | null;
  messageIds: string[];
  textId: string;
}

/** The call the conversation waits on, with the answer of the turn it belongs to, if shown. */
export type ChatConfirmation = Confirmation & {
  conversationId: string;
  assistantId: string | null;
};

/** The feedback of the user on a turn, as stored, and the request on its way. */
export interface Rating {
  feedback: Feedback | null;
  pending: boolean;
  error: unknown;
}

/** The operation running: one at a time, feedback aside. */
export type Pending =
  | ""
  | "loading"
  | "creating"
  | "resuming"
  | "history"
  | "renaming"
  | "deleting"
  | "turn"
  | "confirming"
  | "previewing";

/** What the page tells beside an error: a turn stopped, being stopped, a thread given in part. */
export type Notice = "" | "stopped" | "stopping" | "partial";

/** The message the user queued, for the conversation shown then (null: the one a send creates). */
export interface Queued {
  conversationId: string | null;
  text: string;
}

interface ChatState {
  conversations: Conversation[];
  conversation: Conversation | null;
  messages: ChatMessage[];
  resumed: boolean;
  /** The history of the conversation shown is read: a turn may start. */
  historyReady: boolean;
  /** The page of the history before the oldest shown, empty when there is none. */
  historyCursor: string;
  /** A snapshot left out the oldest turns, which selecting the conversation again reads. */
  partial: boolean;
  pending: Pending;
  /** The failure of the last operation, null without one. */
  error: unknown;
  notice: Notice;
  confirmation: ChatConfirmation | null;
  /** The feedback of the user per turn ID. */
  ratings: Record<string, Rating>;
}

const emptyState = (): ChatState => ({
  conversations: [],
  conversation: null,
  messages: [],
  resumed: false,
  historyReady: true,
  historyCursor: "",
  partial: false,
  pending: "",
  error: null,
  notice: "",
  confirmation: null,
  ratings: {},
});

/** The fields of the state that belong to the conversation shown, for none. */
const noConversation = {
  conversation: null,
  messages: [],
  resumed: false,
  historyReady: true,
  historyCursor: "",
  partial: false,
  confirmation: null,
  ratings: {},
} satisfies Partial<ChatState>;

const assistantMessage = (id: string, fields: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  role: "assistant",
  text: "",
  steps: [],
  stepsOmitted: 0,
  runs: [],
  liveSince: null,
  status: "running",
  usage: null,
  messageIds: [],
  textId: "",
  ...fields,
});

const userMessage = (id: string, text: string, fields: Partial<ChatMessage> = {}): ChatMessage =>
  assistantMessage(id, { role: "user", text, status: "completed", ...fields });

/** A step of an answer, running until its result. */
export const newStep = (id: string, tool: string, fields: Partial<Step> = {}): Step => ({
  id,
  tool,
  arguments: null,
  startedAt: null,
  endedAt: null,
  status: "running",
  resultExcerpt: "",
  resultTruncated: false,
  refusal: "",
  ...fields,
});

/**
 * The status a result gives its step: isError, which the agent gives with every
 * result; a result cut by the agent or by the compaction of the history
 * succeeded. Without isError, from a snapshot of results stored before it or an
 * older agent, a result of an MCP tool without structured content is a refusal,
 * the tools of the agent giving none when they succeed.
 */
function resultStatus(tool: string, result: ToolResult): Step["status"] {
  if (result.rejected) return "rejected";
  if (result.isError === true) return "failed";
  if (result.isError === false || result.omitted || result.structured) return "completed";
  return AGENT_TOOLS.has(tool) ? "completed" : "failed";
}

/**
 * One message per turn, as the stream shows it: the assistant messages of a turn
 * the history gives one by one join, their texts as paragraphs, their AG-UI IDs
 * all held, the steps, runs and tokens of the last one.
 */
function mergeTurns(messages: ChatMessage[]): ChatMessage[] {
  const merged: ChatMessage[] = [];
  for (const message of messages) {
    const last = merged.at(-1);
    if (
      message.role === "assistant" &&
      last?.role === "assistant" &&
      last.turnId !== undefined &&
      last.turnId === message.turnId
    ) {
      merged[merged.length - 1] = {
        ...message,
        text: [last.text, message.text].filter((text) => text !== "").join("\n\n"),
        messageIds: [...last.messageIds, ...message.messageIds],
        steps: message.steps.length > 0 ? message.steps : last.steps,
        stepsOmitted: message.stepsOmitted || last.stepsOmitted,
        runs: message.runs.length > 0 ? message.runs : last.runs,
        usage: message.usage ?? last.usage,
      };
      continue;
    }
    merged.push(message);
  }
  return merged;
}

/** The stored messages as the transcript shows them, the call a user edited with its edit. */
function historyMessages(messages: StoredMessage[]): ChatMessage[] {
  return mergeTurns(
    messages.map(({ id, turnId, role, text, createdAt, history }) =>
      role === "assistant"
        ? assistantMessage(id, {
            turnId,
            text,
            createdAt,
            status: "completed",
            messageIds: [id],
            textId: id,
            steps: (history?.steps ?? []).map((step) => ({
              ...step,
              arguments: step.editedArgs ?? step.arguments,
            })),
            stepsOmitted: history?.stepsOmitted ?? 0,
            runs: history?.runs ?? [],
            usage: history?.usage ?? null,
          })
        : userMessage(id, text, { turnId, createdAt }),
    ),
  );
}

/** The feedback the agent returned with the messages, per turn, keeping what the user changed since. */
function historyRatings(
  messages: StoredMessage[],
  ratings: Record<string, Rating> = {},
): Record<string, Rating> {
  const result = { ...ratings };
  for (const message of messages)
    if (message.feedback !== undefined && result[message.turnId] === undefined)
      result[message.turnId] = { feedback: message.feedback, pending: false, error: null };
  return result;
}

/** The messages this page holds, by their AG-UI IDs, for the agent to tell whether it is in phase. */
const heldMessages = (messages: ChatMessage[]): HeldMessage[] =>
  messages.flatMap((message): HeldMessage[] =>
    message.role === "user"
      ? [{ id: message.id, role: "user" }]
      : message.messageIds.map((id) => ({ id, role: "assistant" })),
  );

/** The turn a message of the agent belongs to: it goes by `<turn ID>:<sequence>`. */
const turnOf = (id: string) => /^([A-Za-z0-9_.~-]{1,128}):[1-9]\d{0,18}$/.exec(id)?.[1];

/** The message, named after an AG-UI message of its turn. */
const holding = (message: ChatMessage, id: string): ChatMessage =>
  id === "" || message.messageIds.includes(id)
    ? message
    : {
        ...message,
        messageIds: [...message.messageIds, id],
        turnId: message.turnId ?? turnOf(id),
      };

/** The call a resumed run gives the result of first: its name, and the arguments the user edited. */
interface Resumed {
  name: string;
  editedArgs?: Args;
}

type ResultEvent = Extract<RunEvent, { type: EventType.TOOL_CALL_RESULT }>;

/** Applies one event of a run to the answer it streams. */
function applyRunEvent(message: ChatMessage, event: RunEvent, resumed?: Resumed): ChatMessage {
  switch (event.type) {
    case EventType.TEXT_MESSAGE_START:
      return holding(message, event.messageId);
    case EventType.TEXT_MESSAGE_CONTENT: {
      // The answers of the model in a turn read as paragraphs of one message.
      const separate = message.text !== "" && message.textId !== event.messageId;
      return {
        ...message,
        text: message.text + (separate ? "\n\n" : "") + event.delta,
        textId: event.messageId,
      };
    }
    case EventType.RUN_STARTED:
      return {
        ...message,
        runs: [...message.runs, { startedAt: event.at, endedAt: null }],
        liveSince: Date.now(),
      };
    case EventType.TOOL_CALL_START: {
      const next = holding(message, event.parentMessageId);
      return {
        ...next,
        steps: [
          ...next.steps,
          newStep(event.toolCallId, event.toolCallName, { startedAt: event.at }),
        ],
      };
    }
    case EventType.TOOL_CALL_END:
      return {
        ...message,
        steps: message.steps.map((step) =>
          step.id === event.toolCallId ? { ...step, arguments: event.arguments } : step,
        ),
      };
    case EventType.TOOL_CALL_RESULT:
      return applyResult(message, event, resumed);
    default:
      return message;
  }
}

function applyResult(message: ChatMessage, event: ResultEvent, resumed?: Resumed): ChatMessage {
  const runStart = message.runs.at(-1)?.startedAt ?? null;
  // The stream gave the call as the model proposed it: it ran with the
  // arguments the user edited.
  const edited = resumed?.editedArgs;
  const finish = (step: Step): Step => {
    const status = resultStatus(step.tool, event);
    return {
      ...step,
      status,
      // A call the user confirmed runs in the run that resumes it.
      startedAt: step.status === "pending" ? (runStart ?? step.startedAt) : step.startedAt,
      // A call the user rejected did not run: it has no end.
      endedAt: status === "rejected" ? null : (event.at ?? step.endedAt),
      resultExcerpt: event.excerpt,
      resultTruncated: event.truncated,
      refusal: status === "failed" ? event.refusal : "",
      ...(edited !== undefined ? { arguments: edited, editedArgs: edited } : {}),
    };
  };
  if (message.steps.some((step) => step.id === event.toolCallId))
    return {
      ...message,
      steps: message.steps.map((step) => (step.id === event.toolCallId ? finish(step) : step)),
    };
  return resumed !== undefined
    ? {
        ...message,
        steps: [
          ...message.steps,
          finish(
            newStep(event.toolCallId, resumed.name, { startedAt: runStart, status: "pending" }),
          ),
        ],
      }
    : message;
}

/**
 * Ends the answer with the result of its run: a completed turn, named for its
 * feedback, or a call waiting for a decision. A turn resumed after a confirmation
 * counts the tokens of all its runs.
 */
function finishRun(message: ChatMessage, result: RunResult): ChatMessage {
  const usage =
    result.tokens === null
      ? message.usage
      : { totalTokens: (message.usage?.totalTokens ?? 0) + result.tokens };
  // The run ends on the clock of the agent; the live timer stops.
  const last = message.runs.at(-1);
  const runs =
    last === undefined
      ? message.runs
      : [
          ...message.runs.slice(0, -1),
          { startedAt: last.startedAt ?? result.startedAt, endedAt: result.endedAt },
        ];
  // The call a run ends on waits for the decision of the user.
  return result.outcome === "interrupt"
    ? {
        ...message,
        status: "awaiting_confirmation",
        usage,
        runs,
        liveSince: null,
        turnId: message.turnId ?? result.turnId,
        steps: message.steps.map((step) =>
          step.status === "running" ? { ...step, status: "pending" } : step,
        ),
      }
    : {
        ...message,
        status: "completed",
        usage,
        runs,
        liveSince: null,
        turnId: result.turnId !== "" ? result.turnId : message.turnId,
      };
}

/** The thread of a snapshot: the prompts, and one answer per turn with its texts and tool calls. */
function snapshotThread(messages: SnapshotMessage[]): ChatMessage[] {
  const thread: ChatMessage[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      thread.push(userMessage(message.id, message.content));
      continue;
    }
    if (message.role === "tool") {
      // The last answer that called it: ES2022 has no findLastIndex.
      let index = thread.length - 1;
      while (
        index >= 0 &&
        !(
          thread[index]?.role === "assistant" &&
          thread[index]?.steps.some((step) => step.id === message.toolCallId)
        )
      )
        index--;
      const item = thread[index];
      if (item !== undefined)
        thread[index] = applyResult(item, {
          ...message,
          type: EventType.TOOL_CALL_RESULT,
          at: null,
        });
      continue;
    }
    const turnId = turnOf(message.id);
    const last = thread.at(-1);
    const answer =
      last?.role === "assistant" && turnId !== undefined && last.turnId === turnId
        ? last
        : assistantMessage(message.id, { status: "completed", turnId });
    if (answer !== last) thread.push(answer);
    let next = holding(answer, message.id);
    if (message.content !== "")
      next = applyRunEvent(next, {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: message.id,
        delta: message.content,
      });
    // A call without its result is the one the turn waits on.
    next = {
      ...next,
      steps: [
        ...next.steps,
        ...message.toolCalls.map((call) =>
          newStep(call.id, call.name, { arguments: call.arguments, status: "pending" }),
        ),
      ],
    };
    thread[thread.length - 1] = next;
  }
  return thread;
}

type Snapshot = Extract<RunEvent, { type: EventType.MESSAGES_SNAPSHOT }>;

/**
 * Shows the thread a snapshot gives a page out of phase, such as after another
 * tab ran turns: it replaces the messages, the answer the run streams following
 * it, or going on with the answer so far of the turn it resumes. The ratings are
 * kept by turn.
 */
function applySnapshot(previous: ChatState, snapshot: Snapshot, answerId: string): ChatState {
  const thread = snapshotThread(snapshot.messages);
  const running = previous.messages.find((message) => message.id === answerId);
  const last = thread.at(-1);
  const messages =
    running?.turnId !== undefined && last?.role === "assistant" && last.turnId === running.turnId
      ? [
          ...thread.slice(0, -1),
          { ...last, id: running.id, status: running.status, usage: running.usage },
        ]
      : [...thread, ...(running !== undefined ? [running] : [])];
  return {
    ...previous,
    messages,
    historyCursor: "",
    partial: snapshot.omittedTurns > 0,
    notice: snapshot.omittedTurns > 0 ? "partial" : previous.notice,
  };
}

interface Operation {
  controller: AbortController;
  epoch: number;
}

type Update = (change: (previous: ChatState) => ChatState) => void;

/**
 * The conversations of the user with the assistant, the one shown, and the turn
 * running. Only the list is read by itself: a conversation starts, and a turn
 * runs, on an action of the user only. One operation runs at a time; leaving the
 * page stops it, and what it gives late is dropped.
 *
 * A message the user sends while a turn runs, or while a call waits for a
 * decision, is queued: one at most, in memory only, sent once a run of its
 * conversation ends normally, never after a stop, a failure, or on a
 * confirmation.
 */
export function useAssistantChat(client: AssistantClient) {
  const [state, setState] = useState(emptyState);
  // The queued message, and its copy read after an await.
  const [queued, setQueuedState] = useState<Queued | null>(null);
  const queuedRef = useRef<Queued | null>(null);
  const setQueued = useCallback((value: Queued | null) => {
    queuedRef.current = value;
    setQueuedState(value);
  }, []);
  // The conversation whose run just ended normally, which releases the queue.
  const [release, setRelease] = useState<{ conversationId: string } | null>(null);
  const epoch = useRef(0);
  const active = useRef<Operation | null>(null);
  const nextId = useRef(0);
  // Feedback requests run beside the turns, and stop with the page.
  const feedbackRequests = useRef(new Set<AbortController>());

  const perform = useCallback(
    async <T>(
      kind: Pending,
      action: (context: { signal: AbortSignal; update: Update }) => Promise<T>,
    ): Promise<T | undefined> => {
      if (active.current !== null) return undefined;
      const operation: Operation = { controller: new AbortController(), epoch: epoch.current };
      active.current = operation;
      const current = () => operation.epoch === epoch.current && active.current === operation;
      const update: Update = (change) => {
        if (current() && !operation.controller.signal.aborted) setState(change);
      };
      setState((previous) => ({ ...previous, pending: kind, error: null, notice: "" }));
      try {
        const result = await action({ signal: operation.controller.signal, update });
        return current() && !operation.controller.signal.aborted ? result : undefined;
      } catch (error) {
        if (current()) {
          const stopped =
            operation.controller.signal.aborted ||
            (error instanceof DOMException && error.name === "AbortError");
          setState((previous) => ({
            ...previous,
            error: stopped ? null : error,
            notice: stopped ? "stopped" : "",
            messages: previous.messages.map((message) =>
              message.status !== "running"
                ? message
                : {
                    ...message,
                    status: stopped ? "stopped" : "failed",
                    liveSince: null,
                    steps: message.steps.map((step) =>
                      step.status === "running" || step.status === "pending"
                        ? { ...step, status: "interrupted" }
                        : step,
                    ),
                  },
            ),
          }));
        }
        return undefined;
      } finally {
        if (current()) {
          active.current = null;
          setState((previous) => ({ ...previous, pending: "" }));
        }
      }
    },
    [],
  );

  const refreshConversations = useCallback(
    () =>
      perform("loading", async ({ signal, update }) => {
        const conversations = await client.listConversations({ signal });
        update((previous) => ({
          ...previous,
          conversations,
          conversation:
            conversations.find((item) => item.id === previous.conversation?.id) ??
            previous.conversation,
        }));
      }),
    [client, perform],
  );

  // Mounted, the list is read; left, the operation and the feedback requests
  // stop, and what they give late is dropped, the epoch having moved on.
  useEffect(() => {
    const counter = epoch;
    counter.current++;
    void refreshConversations();
    const requests = feedbackRequests.current;
    return () => {
      counter.current++;
      active.current?.controller.abort();
      active.current = null;
      for (const controller of requests) controller.abort();
      requests.clear();
    };
  }, [refreshConversations]);

  /**
   * Shows no conversation: the next prompt starts one, so that no conversation
   * is kept without a turn. Nothing goes to the agent until then.
   */
  const startConversation = () => {
    if (active.current !== null) return;
    setState((previous) => ({ ...previous, ...noConversation, error: null, notice: "" }));
  };

  const resumeConversation = (id: string) => {
    if (state.conversation?.id === id && !state.partial) return undefined;
    return perform("resuming", async ({ signal, update }) => {
      update((previous) => ({ ...previous, ...noConversation, historyReady: false }));
      const { conversation, confirmation } = await client.getConversation(id, { signal });
      if (signal.aborted) return undefined;
      const page = await client.getMessages(id, { signal });
      update((previous) => ({
        ...previous,
        conversation,
        messages: historyMessages(page.messages),
        ratings: historyRatings(page.messages),
        resumed: true,
        historyReady: true,
        historyCursor: page.nextCursor,
        // A confirmation left waiting is shown again after a reload.
        confirmation:
          confirmation !== null
            ? { ...confirmation, conversationId: conversation.id, assistantId: null }
            : null,
      }));
      return conversation;
    });
  };

  const loadOlderMessages = () => {
    const conversation = state.conversation;
    if (conversation === null || !state.historyReady || state.historyCursor === "")
      return undefined;
    const before = state.historyCursor;
    return perform("history", async ({ signal, update }) => {
      const page = await client.getMessages(conversation.id, { before, signal });
      update((previous) => {
        // Every AG-UI ID held: an answer merged goes by its last one.
        const ids = new Set(heldMessages(previous.messages).map((message) => message.id));
        return {
          ...previous,
          // A turn the pages cut in two joins again.
          messages: mergeTurns([
            ...historyMessages(page.messages.filter((message) => !ids.has(message.id))),
            ...previous.messages,
          ]),
          historyCursor: page.nextCursor,
          ratings: historyRatings(page.messages, previous.ratings),
        };
      });
      return true;
    });
  };

  const renameConversation = (title: string) => {
    const shown = state.conversation;
    if (shown === null) return undefined;
    return perform("renaming", async ({ signal, update }) => {
      const conversation = await client.renameConversation(shown.id, title, { signal });
      update((previous) => ({
        ...previous,
        conversation:
          previous.conversation?.id === conversation.id ? conversation : previous.conversation,
        conversations: previous.conversations.map((item) =>
          item.id === conversation.id ? conversation : item,
        ),
      }));
      return conversation;
    });
  };

  /** Deletes a conversation, the one shown by default; another leaves the one shown as it is. */
  const deleteConversation = (id = state.conversation?.id) => {
    if (id === undefined) return undefined;
    return perform("deleting", async ({ signal, update }) => {
      await client.deleteConversation(id, { signal });
      // A message queued for it goes with it.
      if (queuedRef.current?.conversationId === id) setQueued(null);
      update((previous) => ({
        ...previous,
        ...(previous.conversation?.id === id ? noConversation : {}),
        conversations: previous.conversations.filter((item) => item.id !== id),
      }));
      return true;
    });
  };

  /**
   * Deletes every conversation of the user, as the list gives them, page after
   * page: the agent deletes one at a time. Those deleted leave the list as they
   * go, so a failure midway shows what is left.
   */
  const deleteAllConversations = () =>
    perform("deleting", async ({ signal, update }) => {
      const deleted = new Set<string>();
      const forget = () =>
        update((previous) => ({
          ...previous,
          ...(previous.conversation !== null && deleted.has(previous.conversation.id)
            ? noConversation
            : {}),
          conversations: previous.conversations.filter((item) => !deleted.has(item.id)),
        }));
      try {
        // A bound on the pages: a list that does not shrink stops.
        for (let page = 0; page < 100; page += 1) {
          const conversations = (await client.listConversations({ signal })).filter(
            (item) => !deleted.has(item.id),
          );
          if (conversations.length === 0) break;
          for (const item of conversations) {
            await client.deleteConversation(item.id, { signal });
            deleted.add(item.id);
            if (queuedRef.current?.conversationId === item.id) setQueued(null);
          }
          forget();
        }
      } finally {
        forget();
      }
      return deleted.size;
    });

  /** Gives, replaces (feedback) or withdraws (null) the feedback of the user on a turn of the conversation shown. */
  const rateTurn = async (turnId: string, feedback: FeedbackInput | null): Promise<boolean> => {
    const conversationId = state.conversation?.id;
    if (conversationId === undefined || state.ratings[turnId]?.pending === true) return false;
    const requestEpoch = epoch.current;
    const controller = new AbortController();
    feedbackRequests.current.add(controller);
    const setRating = (change: (rating: Rating | undefined) => Rating) => {
      setState((previous) =>
        previous.conversation?.id === conversationId && epoch.current === requestEpoch
          ? {
              ...previous,
              ratings: { ...previous.ratings, [turnId]: change(previous.ratings[turnId]) },
            }
          : previous,
      );
    };
    setRating((rating) => ({ feedback: rating?.feedback ?? null, pending: true, error: null }));
    try {
      const stored =
        feedback === null
          ? (await client.deleteFeedback(conversationId, turnId, { signal: controller.signal }),
            null)
          : await client.setFeedback(conversationId, turnId, feedback, {
              signal: controller.signal,
            });
      setRating(() => ({ feedback: stored, pending: false, error: null }));
      return true;
    } catch (error) {
      if (
        !controller.signal.aborted &&
        !(error instanceof DOMException && error.name === "AbortError")
      )
        setRating((rating) => ({ feedback: rating?.feedback ?? null, pending: false, error }));
      return false;
    } finally {
      feedbackRequests.current.delete(controller);
    }
  };

  /**
   * Streams the events of a run into the answer it belongs to; a snapshot
   * replaces the thread first. `resumed` applies to the first result of a
   * resumed run, the one of the confirmed call.
   */
  const runEvents = (answerId: string, update: Update, resumed?: Resumed) => {
    let pending = resumed;
    return (event: RunEvent) => {
      const call = event.type === EventType.TOOL_CALL_RESULT ? pending : undefined;
      if (call !== undefined) pending = undefined;
      update((previous) =>
        event.type === EventType.MESSAGES_SNAPSHOT
          ? applySnapshot(previous, event, answerId)
          : {
              ...previous,
              messages: previous.messages.map((message) =>
                message.id === answerId ? applyRunEvent(message, event, call) : message,
              ),
            },
      );
    };
  };

  /** Ends the answer with the result of its run, and shows the call it waits on. */
  const finish = (result: RunResult, conversationId: string, answerId: string, update: Update) => {
    update((previous) => ({
      ...previous,
      messages: previous.messages.map((message) =>
        message.id === answerId ? finishRun(message, result) : message,
      ),
      confirmation:
        result.outcome === "interrupt"
          ? { ...result.confirmation, conversationId, assistantId: answerId }
          : previous.confirmation,
    }));
  };

  /**
   * Answers the call the conversation waits on with a run that resumes it,
   * streamed into the answer of its turn, or a new one after a reload.
   * `editedArgs`, with an approval of an editable call, are the arguments the
   * user edited, a full replacement of those of the call.
   */
  const decide = (approved: boolean, editedArgs?: Args) => {
    const confirmation = state.confirmation;
    if (
      confirmation === null ||
      (editedArgs !== undefined && (!approved || !confirmation.editable))
    )
      return undefined;
    const held = heldMessages(state.messages);
    let ended: string | null = null;
    const existing = confirmation.assistantId;
    const exists = existing !== null && state.messages.some((message) => message.id === existing);
    return perform("confirming", async ({ signal, update }) => {
      const answerId = exists && existing !== null ? existing : `local:${String(++nextId.current)}`;
      update((previous) => ({
        ...previous,
        confirmation: null,
        messages: exists
          ? previous.messages.map((message) =>
              message.id === answerId ? { ...message, status: "running" } : message,
            )
          : [...previous.messages, assistantMessage(answerId, { turnId: confirmation.turnId })],
      }));
      let result: RunResult;
      try {
        result = await client.run(
          confirmation.conversationId,
          {
            held,
            resume: {
              interruptId: confirmation.id,
              approved,
              ...(editedArgs !== undefined ? { editedArgs } : {}),
            },
          },
          {
            signal,
            onEvent: runEvents(answerId, update, {
              name: confirmation.tool.name,
              ...(editedArgs !== undefined ? { editedArgs } : {}),
            }),
          },
        );
      } catch (error) {
        // The agent refused the edit: the action still waits, for the user to
        // correct the form.
        if (error instanceof Error && "code" in error && error.code === "invalid_edited_arguments")
          update((previous) => ({
            ...previous,
            confirmation,
            messages: exists
              ? previous.messages.map((message) =>
                  message.id === answerId
                    ? { ...message, status: "awaiting_confirmation" }
                    : message,
                )
              : previous.messages.filter((message) => message.id !== answerId),
          }));
        throw error;
      }
      finish(result, confirmation.conversationId, answerId, update);
      if (result.outcome === "success") ended = confirmation.conversationId;
      return true;
    }).then((outcome) => {
      if (outcome === true && ended !== null) setRelease({ conversationId: ended });
      return outcome;
    });
  };

  const send = (prompt: string) => {
    if (!state.historyReady || state.confirmation !== null || prompt.trim() === "")
      return undefined;
    const current = state.conversation;
    const held = current !== null ? heldMessages(state.messages) : [];
    let ended: string | null = null;
    return perform("turn", async ({ signal, update }) => {
      // The prompt goes by the ID this page gives it, which the agent keeps.
      const promptId = client.newId();
      const answerId = `local:${String(++nextId.current)}`;
      // The prompt stays in sight, even when creating the conversation fails.
      update((previous) => ({
        ...previous,
        messages: [
          ...previous.messages,
          userMessage(promptId, prompt, { createdAt: new Date().toISOString() }),
          assistantMessage(answerId),
        ],
      }));
      let conversation = current;
      if (conversation === null) {
        const created = await client.createConversation({ signal });
        conversation = created;
        update((previous) => ({
          ...previous,
          conversation: created,
          conversations: [created, ...previous.conversations],
          resumed: false,
        }));
      }
      if (signal.aborted) return undefined;
      const result = await client.run(
        conversation.id,
        { prompt, promptId, held },
        { signal, onEvent: runEvents(answerId, update) },
      );
      finish(result, conversation.id, answerId, update);
      if (result.outcome === "interrupt") return true;
      ended = conversation.id;
      // The agent titles a conversation after its first completed turn: read it
      // back, so that the list does not keep an untitled entry.
      if (conversation.title === "" && !signal.aborted) {
        try {
          const titled = (await client.getConversation(conversation.id, { signal })).conversation;
          update((previous) => ({
            ...previous,
            conversation: previous.conversation?.id === titled.id ? titled : previous.conversation,
            conversations: previous.conversations.map((item) =>
              item.id === titled.id ? titled : item,
            ),
          }));
        } catch {
          // The title is cosmetic: the turn itself succeeded.
        }
      }
      return true;
    }).then((outcome) => {
      if (outcome === true && ended !== null) setRelease({ conversationId: ended });
      return outcome;
    });
  };

  /** Queues a message, its text the user's as typed; false for one empty or too long. */
  const queue = (text: string) => {
    if (text.trim() === "" || new TextEncoder().encode(text).length > MAX_PROMPT_BYTES)
      return false;
    setQueued({ conversationId: state.conversation?.id ?? null, text });
    return true;
  };
  const unqueue = () => {
    setQueued(null);
  };
  /** Takes the queued text back, such as into the message box: it leaves the queue. */
  const takeQueued = () => {
    const text = queuedRef.current?.text ?? null;
    setQueued(null);
    return text;
  };

  // Once the run that released it is over and rendered, the queued message
  // goes, from a state up to date, if it belongs to that conversation and nothing
  // else waits. Should another operation start before this effect runs, the
  // release waits for it, and the message goes once it is over.
  useEffect(() => {
    if (release === null || state.pending !== "" || active.current !== null) return;
    setRelease(null);
    const item = queuedRef.current;
    const conversationId = state.conversation?.id;
    if (item === null || state.confirmation !== null || conversationId !== release.conversationId)
      return;
    if (item.conversationId !== null && item.conversationId !== conversationId) return;
    setQueued(null);
    void send(item.text);
    // The release and the end of the operation only: send reads the state of
    // this render, which is up to date then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [release, state.pending]);

  /**
   * Asks what the call waiting would do with the arguments the user edited:
   * nothing runs, and the call waits again under a new confirmation, whose
   * preview is of the edit. A refused edit leaves the confirmation as it was.
   */
  const previewAgain = (editedArgs: Args) => {
    const confirmation = state.confirmation;
    if (confirmation === null || !confirmation.editable) return undefined;
    const held = heldMessages(state.messages);
    return perform("previewing", async ({ signal, update }) => {
      const result = await client.run(
        confirmation.conversationId,
        {
          held,
          resume: {
            interruptId: confirmation.id,
            preview: true,
            editedArgs,
            pending: { name: confirmation.tool.name, arguments: confirmation.arguments },
          },
        },
        { signal, onEvent: () => undefined },
      );
      if (result.outcome !== "interrupt") return true;
      update((previous) => ({
        ...previous,
        confirmation: {
          ...result.confirmation,
          conversationId: confirmation.conversationId,
          assistantId: confirmation.assistantId,
        },
      }));
      return true;
    });
  };

  const stop = () => {
    if (active.current === null) return;
    active.current.controller.abort();
    setState((previous) => ({ ...previous, notice: "stopping" }));
  };

  return {
    ...state,
    queued,
    startConversation,
    resumeConversation,
    renameConversation,
    deleteConversation,
    deleteAllConversations,
    refreshConversations,
    loadOlderMessages,
    send,
    stop,
    approve: (editedArgs?: Args) => decide(true, editedArgs),
    reject: () => decide(false),
    previewAgain,
    queue,
    unqueue,
    takeQueued,
    rate: (turnId: string, feedback: FeedbackInput) => rateTurn(turnId, feedback),
    unrate: (turnId: string) => rateTurn(turnId, null),
  };
}

export type AssistantChat = ReturnType<typeof useAssistantChat>;
