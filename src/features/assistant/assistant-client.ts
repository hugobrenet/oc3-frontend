import { EventType } from "@ag-ui/core";
import { EventSchema } from "@ag-ui/core/schemas";
import type { components } from "@/lib/api/schema";
import { api, apiGetDynamic } from "@/lib/api/client";

/**
 * The client of the AI agent, through the relay of oc3 (`/api/assistant/...`):
 * the collector calls the agent with the access token of the user's session, so
 * that nothing here holds a token, a cluster or the address of the agent.
 *
 * Whatever comes back, from the agent or the model, is checked as strictly as
 * the agent bounds it, and only the fields the page shows are kept: an answer
 * out of its bounds is an error of the protocol, never shown in part. Errors
 * carry a stable code the page puts in words; the message of the agent is
 * never shown, as it may hold what the user must not see.
 */

/** The bound of a prompt, as the agent takes it. */
export const MAX_PROMPT_BYTES = 32 * 1024;
const MAX_STREAM_BYTES = 16 * 1024 * 1024;
const MAX_TITLE_CHARACTERS = 80;
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_HISTORY_MESSAGES = 100;
/** The version of AG-UI this client speaks, which the agent checks. */
const AGUI_PROTOCOL_VERSION = "1.0";

/**
 * The tools of the agent itself, which the steps show apart: their results carry
 * no structured content when they succeed, unlike the tools of the MCP. The set
 * holds those of every backend of the agent; search_code is the om3 one's only.
 */
export const AGENT_TOOLS = new Set([
  "search_tools",
  "search_docs",
  "search_code",
  "read_resource",
  "load_skill",
]);

export type FeedbackReason = components["schemas"]["AssistantFeedbackReason"];

/** The reasons of a negative feedback, in the order the agent keeps them. */
export const FEEDBACK_REASONS: readonly FeedbackReason[] = [
  "not_answered",
  "missing_information",
  "incorrect_or_outdated",
  "hard_to_understand",
  "action_not_done",
];
export const MAX_FEEDBACK_EXPECTED_CHARACTERS = 1000;

/**
 * A failure of the assistant, by a code the page explains: one of the relay or
 * of the agent it knows, one of this client, or `http_error` with the status for
 * any other refusal. The message is the code: the agent's own is never kept.
 */
export class AssistantError extends Error {
  constructor(
    readonly code: string,
    readonly status: number | null = null,
  ) {
    super(code);
    this.name = "AssistantError";
  }
}

const protocolError = () => new AssistantError("invalid_response");

function checkAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new DOMException("Request canceled.", "AbortError");
}

const isAbort = (error: unknown) => error instanceof DOMException && error.name === "AbortError";

// --- Values --------------------------------------------------------------------

/** The arguments of a tool call, a JSON object. */
export type Args = Record<string, unknown>;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length <= max;
const isOptionalText = (value: unknown, max: number) => value === undefined || isText(value, max);
/** Whether a text holds a control character other than those `allowed` (tab, line feed…). */
const hasControl = (text: string, allowed = "") =>
  Array.from(text).some((char) => {
    const code = char.codePointAt(0) ?? 0;
    return (code < 0x20 || code === 0x7f) && !allowed.includes(char);
  });
const isLabel = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 128 && !hasControl(value);
const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const MAX_INT64 = 9223372036854775807n;

const conversationIdPattern = /^[A-Za-z0-9_-]{1,128}$/;
const turnIdPattern = /^[A-Za-z0-9_.~-]{1,128}$/;
const confirmationIdPattern = /^[A-Za-z0-9_.~-]{1,128}$/;
const toolNamePattern = /^[A-Za-z0-9_.-]{1,128}$/;
// The IDs of the messages and tool calls of a run: printable ASCII, no spaces.
const eventIdPattern = /^[\x21-\x7e]{1,256}$/;
// The ID this client gives a prompt, which the agent keeps: at most 128
// printable ASCII bytes without spaces.
const promptIdPattern = /^[\x21-\x7e]{1,128}$/;
const isEventId = (value: unknown): value is string =>
  typeof value === "string" && eventIdPattern.test(value);
const isToolName = (value: unknown): value is string =>
  typeof value === "string" && toolNamePattern.test(value);

function checkConversationId(id: unknown): string {
  if (typeof id !== "string" || !conversationIdPattern.test(id))
    throw new AssistantError("invalid_conversation");
  return id;
}

const validHistoryCursor = (cursor: unknown): cursor is string =>
  typeof cursor === "string" &&
  /^[1-9]\d{0,18}:[1-9]\d{0,18}$/.test(cursor) &&
  cursor.split(":").every((part) => BigInt(part) <= MAX_INT64);

const olderCursor = (cursor: string, before: string) => {
  const [turn = 0n, message = 0n] = cursor.split(":").map(BigInt);
  const [beforeTurn = 0n, beforeMessage = 0n] = before.split(":").map(BigInt);
  return turn < beforeTurn || (turn === beforeTurn && message < beforeMessage);
};

/** A stored message goes by `<turn ID>:<sequence>`. */
function storedMessageId(id: string, turnId: string): boolean {
  if (!id.startsWith(`${turnId}:`)) return false;
  const sequence = id.slice(turnId.length + 1);
  return /^[1-9]\d{0,18}$/.test(sequence) && BigInt(sequence) <= MAX_INT64;
}

// --- Conversations ---------------------------------------------------------------

/** A conversation, as the list and the page show it. */
export interface Conversation {
  id: string;
  /** Empty until the agent titles it after its first turn, or a rename. */
  title: string;
  created_at?: string;
  updated_at?: string;
}

function parseConversation(value: unknown): Conversation {
  if (
    !isPlainObject(value) ||
    typeof value.id !== "string" ||
    (value.title !== undefined && typeof value.title !== "string")
  )
    throw protocolError();
  return {
    id: value.id,
    title: value.title ?? "",
    ...(typeof value.created_at === "string" ? { created_at: value.created_at } : {}),
    ...(typeof value.updated_at === "string" ? { updated_at: value.updated_at } : {}),
  };
}

// --- Feedback ------------------------------------------------------------------

export interface Feedback {
  rating: "up" | "down";
  reasons: FeedbackReason[];
  expected: string;
}

/** What the user gives: the reasons and the expectation go with a negative rating. */
export interface FeedbackInput {
  rating: "up" | "down";
  reasons?: FeedbackReason[];
  expected?: string;
}

/**
 * A feedback, checked and normalized as the agent accepts and returns it: its
 * reasons in the agent's order, what the user expected trimmed and within its
 * bound in Unicode characters; null when it does not hold.
 */
export function parseFeedback(value: unknown): Feedback | null {
  if (
    !isPlainObject(value) ||
    (value.rating !== "up" && value.rating !== "down") ||
    (value.reasons !== undefined && !Array.isArray(value.reasons)) ||
    (value.expected !== undefined && typeof value.expected !== "string")
  )
    return null;
  const reasons: unknown[] = value.reasons ?? [];
  if (
    (value.rating === "up" && reasons.length > 0) ||
    reasons.some((reason) => !FEEDBACK_REASONS.includes(reason as FeedbackReason)) ||
    new Set(reasons).size !== reasons.length
  )
    return null;
  const expected = (value.expected ?? "").trim();
  if (
    Array.from(expected).length > MAX_FEEDBACK_EXPECTED_CHARACTERS ||
    hasControl(expected, "\t\n")
  )
    return null;
  return {
    rating: value.rating,
    reasons: FEEDBACK_REASONS.filter((reason) => reasons.includes(reason)),
    expected,
  };
}

// --- Steps -----------------------------------------------------------------------

export type StepStatus =
  "running" | "pending" | "completed" | "failed" | "rejected" | "interrupted";

/**
 * A step of an answer: one call of a tool, as the stream gives it and the agent
 * serves it with the history. `startedAt` and `endedAt` are milliseconds of the
 * clock of the agent; `resultExcerpt` the start of its result, `refusal` the text
 * of a refusal of the tool.
 */
export interface Step {
  id: string;
  tool: string;
  /** The arguments of the call; null for arguments that do not read, or left out. */
  arguments: Args | null;
  startedAt: number | null;
  endedAt: number | null;
  status: StepStatus;
  resultExcerpt: string;
  resultTruncated: boolean;
  refusal: string;
  /** The agent kept the call without its arguments, too large for the history. */
  argumentsOmitted?: boolean;
  /** The arguments the user edited before approving the call, which it ran with. */
  editedArgs?: Args;
}

/** A run of a turn, on the clock of the agent. */
export interface RunSpan {
  startedAt: number | null;
  endedAt: number | null;
}

/** What the agent serves with the last answer of a turn: its steps, runs and tokens. */
export interface TurnHistory {
  steps: Step[];
  stepsOmitted: number;
  runs: RunSpan[];
  usage: { totalTokens: number } | null;
}

const STORED_STEP_STATUSES: StepStatus[] = ["completed", "failed", "rejected", "interrupted"];
const MAX_HISTORY_STEPS = 64;
/** The part of the result of a step this client keeps, bounded at reading. */
export const RESULT_EXCERPT_CHARACTERS = 4096;
const MAX_REFUSAL_CHARACTERS = 16384;
const isStamp = (value: unknown) =>
  value === undefined || (Number.isSafeInteger(value) && (value as number) > 0);

function parseHistory(message: Record<string, unknown>): TurnHistory | null {
  const { steps, steps_omitted: omitted, runs, usage } = message;
  if (steps === undefined && omitted === undefined && runs === undefined && usage === undefined)
    return null;
  if (
    (steps !== undefined && (!Array.isArray(steps) || steps.length > MAX_HISTORY_STEPS)) ||
    (omitted !== undefined && (!Number.isSafeInteger(omitted) || (omitted as number) < 0)) ||
    (runs !== undefined && (!Array.isArray(runs) || runs.length > 32)) ||
    (usage !== undefined &&
      (!isPlainObject(usage) ||
        !Number.isSafeInteger(usage.total_tokens) ||
        (usage.total_tokens as number) < 0))
  )
    throw protocolError();
  const ids = new Set<string>();
  const parsedSteps = ((steps ?? []) as unknown[]).map((step): Step => {
    if (
      !isPlainObject(step) ||
      !isEventId(step.id) ||
      ids.has(step.id) ||
      !isToolName(step.tool) ||
      !(step.arguments === null || isPlainObject(step.arguments)) ||
      (step.arguments_omitted !== undefined && typeof step.arguments_omitted !== "boolean") ||
      !isStamp(step.started_at) ||
      !isStamp(step.ended_at) ||
      !STORED_STEP_STATUSES.includes(step.status as StepStatus) ||
      !isText(step.result_excerpt, RESULT_EXCERPT_CHARACTERS) ||
      typeof step.result_truncated !== "boolean" ||
      !isText(step.refusal, MAX_REFUSAL_CHARACTERS) ||
      (step.edited_arguments !== undefined && !isPlainObject(step.edited_arguments))
    )
      throw protocolError();
    ids.add(step.id);
    return {
      id: step.id,
      tool: step.tool,
      arguments: step.arguments,
      startedAt: (step.started_at as number | undefined) ?? null,
      endedAt: (step.ended_at as number | undefined) ?? null,
      status: step.status as StepStatus,
      resultExcerpt: step.result_excerpt,
      resultTruncated: step.result_truncated,
      refusal: step.refusal,
      ...(step.arguments_omitted === true ? { argumentsOmitted: true } : {}),
      ...(isPlainObject(step.edited_arguments) ? { editedArgs: step.edited_arguments } : {}),
    };
  });
  const parsedRuns = ((runs ?? []) as unknown[]).map((run): RunSpan => {
    if (
      !isPlainObject(run) ||
      run.started_at === undefined ||
      !isStamp(run.started_at) ||
      !isStamp(run.ended_at)
    )
      throw protocolError();
    return {
      startedAt: run.started_at as number,
      endedAt: (run.ended_at as number | undefined) ?? null,
    };
  });
  return {
    steps: parsedSteps,
    stepsOmitted: (omitted as number | undefined) ?? 0,
    runs: parsedRuns,
    usage: isPlainObject(usage) ? { totalTokens: usage.total_tokens as number } : null,
  };
}

// --- Messages ------------------------------------------------------------------

/** A stored message, as the history gives it. */
export interface StoredMessage {
  id: string;
  turnId: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  /** Only an assistant message carries the feedback of its turn. */
  feedback?: Feedback;
  /** Only the last assistant message of a turn carries its steps. */
  history?: TurnHistory;
}

export interface MessagePage {
  /** In chronological order. */
  messages: StoredMessage[];
  /** Given as `before` to read the page before; empty when there is none. */
  nextCursor: string;
}

function parseMessagePage(page: unknown, limit: number, before: string): MessagePage {
  if (
    !isPlainObject(page) ||
    !Array.isArray(page.messages) ||
    page.messages.length > limit ||
    typeof page.next_cursor !== "string" ||
    (page.next_cursor !== "" &&
      (page.messages.length === 0 ||
        !validHistoryCursor(page.next_cursor) ||
        (before !== "" && !olderCursor(page.next_cursor, before))))
  )
    throw protocolError();
  const ids = new Set<string>();
  const messages = (page.messages as unknown[]).map((message): StoredMessage => {
    if (
      !isPlainObject(message) ||
      typeof message.turn_id !== "string" ||
      !turnIdPattern.test(message.turn_id) ||
      typeof message.id !== "string" ||
      // A prompt goes by the ID this client gave it, when the agent kept it.
      !(
        storedMessageId(message.id, message.turn_id) ||
        (message.role === "user" && promptIdPattern.test(message.id))
      ) ||
      ids.has(message.id) ||
      (message.role !== "user" && message.role !== "assistant") ||
      typeof message.text !== "string" ||
      typeof message.created_at !== "string" ||
      message.created_at.length > 64 ||
      !Number.isFinite(Date.parse(message.created_at))
    )
      throw protocolError();
    const feedback = message.feedback === undefined ? undefined : parseFeedback(message.feedback);
    if (feedback === null || (feedback !== undefined && message.role !== "assistant"))
      throw protocolError();
    const history = parseHistory(message);
    if (history !== null && message.role !== "assistant") throw protocolError();
    ids.add(message.id);
    return {
      id: message.id,
      turnId: message.turn_id,
      role: message.role,
      text: message.text,
      createdAt: message.created_at,
      ...(feedback !== undefined ? { feedback } : {}),
      ...(history !== null ? { history } : {}),
    };
  });
  // The steps go with the last assistant message of their turn.
  messages.forEach((message, index) => {
    if (
      message.history !== undefined &&
      messages
        .slice(index + 1)
        .some((later) => later.role === "assistant" && later.turnId === message.turnId)
    )
      throw protocolError();
  });
  return { messages, nextCursor: page.next_cursor };
}

// --- Tools ---------------------------------------------------------------------

/** A tool the assistant may call, as the agent documents it. */
export interface ToolDoc {
  name: string;
  title: string;
  summary: string;
  /** Plain text from the MCP, as the model reads it, never markup. */
  description: string;
  /** The description of each argument, by name. */
  arguments: Record<string, string>;
  readOnly: boolean;
  needsConfirmation: boolean;
}

const MAX_TOOLS = 512;
const MAX_TOOL_ARGUMENTS = 64;

function parseTools(result: unknown): ToolDoc[] {
  if (!isPlainObject(result) || !Array.isArray(result.tools) || result.tools.length > MAX_TOOLS)
    throw protocolError();
  const names = new Set<string>();
  return (result.tools as unknown[]).map((tool): ToolDoc => {
    if (
      !isPlainObject(tool) ||
      !isToolName(tool.name) ||
      names.has(tool.name) ||
      !isText(tool.title, 256) ||
      !isText(tool.summary, 600) ||
      !isOptionalText(tool.description, 8192) ||
      !(
        tool.arguments === undefined ||
        (isPlainObject(tool.arguments) &&
          Object.keys(tool.arguments).length <= MAX_TOOL_ARGUMENTS &&
          Object.entries(tool.arguments).every(
            ([name, text]) => isLabel(name) && isText(text, 2048),
          ))
      ) ||
      typeof tool.read_only !== "boolean" ||
      typeof tool.needs_confirmation !== "boolean"
    )
      throw protocolError();
    names.add(tool.name);
    return {
      name: tool.name,
      title: tool.title === "" ? tool.name : tool.title,
      summary: tool.summary,
      description: (tool.description as string | undefined) ?? "",
      arguments: { ...((tool.arguments as Record<string, string> | undefined) ?? {}) },
      readOnly: tool.read_only,
      needsConfirmation: tool.needs_confirmation,
    };
  });
}

// --- Confirmations -------------------------------------------------------------

/** One change a call would make to a configuration, as the MCP tells it. */
export interface PreviewChange {
  key: string;
  scope: string;
  op: string;
  value?: string;
  before?: string;
  after?: string;
  /** The value after is the MCP's computation, not the daemon's word. */
  computed: boolean;
  note: string;
  noteKeys: string[];
}

/**
 * What a call would do, as the MCP tells it before the user confirms it: a
 * sentence, the keys it changes, the sections it deletes, the file it writes.
 * Its texts come from the MCP, its values from the model and the daemon:
 * untrusted, shown as text only.
 */
export interface Preview {
  summary: { text: string; key: string; params: Record<string, string> };
  changes: PreviewChange[];
  deleted: { section: string; keys: string[]; secretsOmitted: number }[];
  content?: { mediaType: string; text: string; truncated: boolean };
  readAt: string;
  warnings: string[];
  secretsOmitted: number;
}

/** A tool call waiting for the decision of the user, the fields its card shows. */
export interface Confirmation {
  id: string;
  turnId: string;
  tool: { name: string; title: string; destructive: boolean };
  /** The exact arguments of the call that runs if approved, never the model's text. */
  arguments: Args;
  /** The media types of text arguments, by name, such as application/yaml. */
  argumentTypes: Record<string, string>;
  /** The user may edit the arguments, in a form built from `inputSchema`. */
  editable: boolean;
  inputSchema?: Args;
  expiresAt: string;
  preview?: Preview;
  /** Why the preview could not be told. */
  previewError?: string;
  /** The edited arguments the preview is of, after a preview asked again. */
  previewArguments?: Args;
}

const MAX_CONFIRMATION_ARGUMENTS_BYTES = 256 * 1024;
const MAX_INPUT_SCHEMA_BYTES = 64 * 1024;
const MAX_ARGUMENT_TYPES = 32;
const MAX_PREVIEW_BYTES = 256 * 1024;
const MAX_PREVIEW_ERROR_CHARACTERS = 2048;
const PREVIEW_OPS = ["=", "+=", "-=", "|=", "^=", "insert", "unset"];
const previewKeyPattern = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * The media types of text arguments, as the input schema of the tool declares
 * them: the card shows an argument by its type, not by guessing.
 */
function parseArgumentTypes(value: unknown): Record<string, string> {
  if (value === undefined || value === null) return {};
  if (!isPlainObject(value)) throw protocolError();
  const entries = Object.entries(value);
  if (
    entries.length > MAX_ARGUMENT_TYPES ||
    entries.some(([name, type]) => !isLabel(name) || !isLabel(type))
  )
    throw protocolError();
  return Object.fromEntries(entries) as Record<string, string>;
}

/** The input schema of a call the user may edit: an object schema, within its bound. */
function parseInputSchema(value: unknown): Args {
  if (!isPlainObject(value) || value.type !== "object" || jsonBytes(value) > MAX_INPUT_SCHEMA_BYTES)
    throw protocolError();
  return value;
}

/** The preview of a confirmation, its fields checked and nothing else kept; null when it does not hold. */
export function parsePreview(value: unknown): Preview | null {
  if (!isPlainObject(value) || jsonBytes(value) > MAX_PREVIEW_BYTES) return null;
  const {
    summary,
    changes = [],
    deleted = [],
    content,
    read_at: readAt,
    warnings = [],
    secrets_omitted: secrets = 0,
  } = value;
  if (
    !isPlainObject(summary) ||
    !isText(summary.text, 2048) ||
    !isText(summary.key, 64) ||
    !previewKeyPattern.test(summary.key) ||
    (summary.params !== undefined && !isPlainObject(summary.params)) ||
    Object.values(summary.params ?? {}).some((param) => !isText(param, 1024)) ||
    !Array.isArray(changes) ||
    changes.length > 200 ||
    changes.some(
      (change: unknown) =>
        !isPlainObject(change) ||
        !isText(change.key, 512) ||
        !PREVIEW_OPS.includes(change.op as string) ||
        !isOptionalText(change.scope, 256) ||
        !isOptionalText(change.value, 8192) ||
        !isOptionalText(change.before, 8192) ||
        !isOptionalText(change.after, 16384) ||
        typeof change.after_computed_by_mcp !== "boolean" ||
        !isOptionalText(change.note, 1024) ||
        (change.note_keys !== undefined &&
          (!Array.isArray(change.note_keys) ||
            change.note_keys.length > 10 ||
            change.note_keys.some(
              (key: unknown) => typeof key !== "string" || !previewKeyPattern.test(key),
            ))),
    ) ||
    !Array.isArray(deleted) ||
    deleted.length > 100 ||
    deleted.some(
      (section: unknown) =>
        !isPlainObject(section) ||
        !isText(section.section, 256) ||
        !Array.isArray(section.keys) ||
        section.keys.length > 1000 ||
        section.keys.some((key: unknown) => !isText(key, 512)) ||
        (section.secrets_omitted !== undefined &&
          (!Number.isSafeInteger(section.secrets_omitted) ||
            (section.secrets_omitted as number) < 0)),
    ) ||
    (content !== undefined &&
      (!isPlainObject(content) ||
        !isText(content.media_type, 128) ||
        typeof content.text !== "string")) ||
    (readAt !== undefined && (!isText(readAt, 64) || !Number.isFinite(Date.parse(readAt)))) ||
    !Array.isArray(warnings) ||
    warnings.length > 20 ||
    warnings.some((warning: unknown) => !isText(warning, 1024)) ||
    !Number.isSafeInteger(secrets) ||
    (secrets as number) < 0
  )
    return null;
  const checkedChanges = changes as Record<string, unknown>[];
  const checkedDeleted = deleted as Record<string, unknown>[];
  return {
    summary: {
      text: summary.text,
      key: summary.key,
      params: { ...((summary.params as Record<string, string> | undefined) ?? {}) },
    },
    changes: checkedChanges.map((change) => ({
      key: change.key as string,
      scope: (change.scope as string | undefined) ?? "",
      op: change.op as string,
      ...(change.value !== undefined ? { value: change.value as string } : {}),
      ...(change.before !== undefined ? { before: change.before as string } : {}),
      ...(change.after !== undefined ? { after: change.after as string } : {}),
      computed: change.after_computed_by_mcp as boolean,
      note: (change.note as string | undefined) ?? "",
      noteKeys: [...((change.note_keys as string[] | undefined) ?? [])],
    })),
    deleted: checkedDeleted.map((section) => ({
      section: section.section as string,
      keys: [...(section.keys as string[])],
      secretsOmitted: (section.secrets_omitted as number | undefined) ?? 0,
    })),
    ...(isPlainObject(content)
      ? {
          content: {
            mediaType: content.media_type as string,
            text: content.text as string,
            truncated: content.truncated === true,
          },
        }
      : {}),
    readAt: (readAt as string | undefined) ?? "",
    warnings: [...(warnings as string[])],
    secretsOmitted: secrets as number,
  };
}

/**
 * The preview fields of a confirmation: what the call would do, why it could not
 * be told, and the edited arguments it is of. A preview that does not hold leaves
 * the confirmation standing, its arguments shown.
 */
function previewFields(
  preview: unknown,
  error: unknown,
  previewArguments: unknown,
): Pick<Confirmation, "preview" | "previewError" | "previewArguments"> {
  const fields: Pick<Confirmation, "preview" | "previewError" | "previewArguments"> = {};
  if (preview !== undefined && preview !== null) {
    const parsed = parsePreview(preview);
    if (parsed !== null) fields.preview = parsed;
    else fields.previewError = "The preview of the agent is invalid.";
  }
  if (fields.previewError === undefined && typeof error === "string" && error !== "")
    fields.previewError = error.slice(0, MAX_PREVIEW_ERROR_CHARACTERS);
  if (
    isPlainObject(previewArguments) &&
    jsonBytes(previewArguments) <= MAX_CONFIRMATION_ARGUMENTS_BYTES
  )
    fields.previewArguments = previewArguments;
  return fields;
}

/**
 * A tool call waiting for the decision of the user, as the agent gives it with
 * the conversation (`pending_confirmation`): the card shows these fields only.
 */
export function parseConfirmation(value: unknown): Confirmation {
  if (
    !isPlainObject(value) ||
    typeof value.id !== "string" ||
    !confirmationIdPattern.test(value.id) ||
    typeof value.turn_id !== "string" ||
    !confirmationIdPattern.test(value.turn_id) ||
    !isPlainObject(value.tool) ||
    !isToolName(value.tool.name) ||
    !isText(value.tool.title, 256) ||
    typeof value.tool.destructive !== "boolean" ||
    !isPlainObject(value.arguments) ||
    jsonBytes(value.arguments) > MAX_CONFIRMATION_ARGUMENTS_BYTES ||
    !isText(value.expires_at, 64) ||
    !Number.isFinite(Date.parse(value.expires_at)) ||
    (value.editable !== undefined && typeof value.editable !== "boolean")
  )
    throw protocolError();
  // A call the user may edit carries the input schema of its tool.
  const editable = value.editable === true;
  return {
    id: value.id,
    turnId: value.turn_id,
    tool: {
      name: value.tool.name,
      title: value.tool.title === "" ? value.tool.name : value.tool.title,
      destructive: value.tool.destructive,
    },
    arguments: value.arguments,
    argumentTypes: parseArgumentTypes(value.argument_types),
    editable,
    ...(editable ? { inputSchema: parseInputSchema(value.input_schema) } : {}),
    expiresAt: value.expires_at,
    ...previewFields(value.preview, value.preview_error, value.preview_arguments),
  };
}

// --- Runs ----------------------------------------------------------------------

/**
 * What the result of a tool call says: rejected by the user, isError as the agent
 * gives it with every result, whether it holds a structured content, whether the
 * agent cut it (omitted, past 64 KiB) or the compaction of the history did (a
 * large result that succeeded, an error never being compacted), an excerpt of its
 * text and the text of a refusal.
 */
export interface ToolResult {
  rejected: boolean;
  isError?: boolean;
  structured: boolean;
  omitted: boolean;
  refusal: string;
  excerpt: string;
  truncated: boolean;
}

/** A message of the thread a snapshot gives, the fields the page shows. */
export type SnapshotMessage =
  | { id: string; role: "user"; content: string }
  | {
      id: string;
      role: "assistant";
      content: string;
      toolCalls: { id: string; name: string; arguments: Args | null }[];
    }
  | ({ id: string; role: "tool"; toolCallId: string } & ToolResult);

/** An AG-UI event of a run, as the page reads it. */
export type RunEvent =
  | { type: EventType.RUN_STARTED; at: number | null }
  | { type: EventType.MESSAGES_SNAPSHOT; messages: SnapshotMessage[]; omittedTurns: number }
  | { type: EventType.TEXT_MESSAGE_START; messageId: string }
  | { type: EventType.TEXT_MESSAGE_CONTENT; messageId: string; delta: string }
  | {
      type: EventType.TOOL_CALL_START;
      toolCallId: string;
      toolCallName: string;
      parentMessageId: string;
      at: number | null;
    }
  | { type: EventType.TOOL_CALL_END; toolCallId: string; arguments: Args | null }
  | ({ type: EventType.TOOL_CALL_RESULT; toolCallId: string; at: number | null } & ToolResult);

/** How a run ends: a completed turn, or a call waiting for the decision of the user. */
export type RunResult = {
  type: EventType.RUN_FINISHED;
  turnId: string;
  /** The tokens of the run, the sum of its usage; null when it reports none. */
  tokens: number | null;
  startedAt: number | null;
  endedAt: number | null;
} & ({ outcome: "success" } | { outcome: "interrupt"; confirmation: Confirmation });

/** A tool call of the run, its arguments as streamed: null past the bound of a confirmation. */
interface RunCall {
  name: string;
  arguments: string | null;
  ended: boolean;
}

/** The state of the stream of a run, checked against the order of the protocol. */
interface RunState {
  threadId: string;
  runId: string;
  started: boolean;
  startedAt: number | null;
  /** The ID of the text message open, empty between messages. */
  text: string;
  /** The text open is the assistant's, shown as its answer. */
  shown: boolean;
  calls: Map<string, RunCall>;
  /** The call a resumed run asks the preview of again, which the stream does not start. */
  resumed?: RunCall;
  finished: RunResult | null;
}

/** The text of a content: a string, or the text parts of a list joined by line breaks. */
function contentText(content: unknown): string {
  if (content === undefined || content === null) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) throw protocolError();
  return content
    .filter(
      (part): part is { type: "text"; text: string } =>
        isPlainObject(part) && part.type === "text" && typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("\n");
}

function parseToolResult(content: unknown): ToolResult {
  const text = contentText(content);
  let payload: unknown = null;
  try {
    payload = JSON.parse(text);
  } catch {
    // A result that is no JSON is an excerpt only.
  }
  const object = isPlainObject(payload) ? payload : null;
  const rejected = object?.rejected === true;
  const isError = typeof object?.isError === "boolean" ? object.isError : undefined;
  const structured = object?.structuredContent !== undefined && object.structuredContent !== null;
  const omitted =
    object?.omitted === true ||
    (object?._history_compaction !== undefined && object._history_compaction !== null);
  let refusal = "";
  if (
    object !== null &&
    !rejected &&
    !omitted &&
    (isError === true || (isError === undefined && !structured))
  )
    refusal = (Array.isArray(object.content) ? contentText(object.content) : "").slice(
      0,
      MAX_REFUSAL_CHARACTERS,
    );
  return {
    rejected,
    ...(isError !== undefined ? { isError } : {}),
    structured,
    omitted,
    refusal,
    excerpt: text.slice(0, RESULT_EXCERPT_CHARACTERS),
    truncated: text.length > RESULT_EXCERPT_CHARACTERS,
  };
}

/** The time of an event, in milliseconds of the clock of the agent; null without one. */
const stampOf = (timestamp: number | undefined) =>
  timestamp !== undefined && Number.isSafeInteger(timestamp) && timestamp > 0 ? timestamp : null;

/** The arguments of a call as the steps show them: an object, or null when they do not read. */
function stepArguments(text: string): Args | null {
  if (text === "") return {};
  try {
    const value: unknown = JSON.parse(text);
    return isPlainObject(value) ? value : null;
  } catch {
    return null;
  }
}

/** The arguments of a call to confirm, the JSON its TOOL_CALL_ARGS streamed. */
function confirmedArguments(text: string | null): unknown {
  if (text === null) throw protocolError();
  try {
    return JSON.parse(text === "" ? "{}" : text);
  } catch {
    throw protocolError();
  }
}

/** The tokens of a run, the sum of its usage entries; null when it reports none. */
function runTokens(usage: { totalTokens?: number }[] | undefined): number | null {
  if (usage === undefined) return null;
  let total = 0;
  for (const entry of usage) {
    if (entry.totalTokens === undefined) throw protocolError();
    total += entry.totalTokens;
  }
  return usage.length > 0 ? total : null;
}

function parseSnapshot(
  event: Extract<ReturnType<typeof EventSchema.parse>, { type: EventType.MESSAGES_SNAPSHOT }>,
): RunEvent {
  const messages: SnapshotMessage[] = [];
  for (const message of event.messages) {
    if (!isEventId(message.id)) throw protocolError();
    if (message.role === "user") {
      messages.push({ id: message.id, role: "user", content: contentText(message.content) });
    } else if (message.role === "assistant") {
      const toolCalls = (message.toolCalls ?? []).map((call) => {
        if (!isEventId(call.id) || !isToolName(call.function.name)) throw protocolError();
        return {
          id: call.id,
          name: call.function.name,
          arguments: stepArguments(call.function.arguments),
        };
      });
      messages.push({
        id: message.id,
        role: "assistant",
        content: contentText(message.content),
        toolCalls,
      });
    } else if (message.role === "tool") {
      if (!isEventId(message.toolCallId)) throw protocolError();
      messages.push({
        id: message.id,
        role: "tool",
        toolCallId: message.toolCallId,
        ...parseToolResult(message.content),
      });
    }
    // Messages of other roles hold nothing the page shows.
  }
  const truncated = event.metadata?.["opensvc.truncated"];
  const omitted = isPlainObject(truncated) ? truncated.omittedTurns : undefined;
  return {
    type: EventType.MESSAGES_SNAPSHOT,
    messages,
    omittedTurns:
      Number.isSafeInteger(omitted) && (omitted as number) > 0 ? (omitted as number) : 0,
  };
}

/** The run error codes the page explains; any other is a failure of the turn. */
const RUN_ERROR_CODES = new Set(["request_timeout", "tool_name_conflict", "tool_call_limit"]);

type AguiEvent = ReturnType<typeof EventSchema.parse>;

/** How a run ends: a completed turn, or a tool call waiting for the decision of the user. */
function finishRun(
  event: Extract<AguiEvent, { type: EventType.RUN_FINISHED }>,
  run: RunState,
): RunResult {
  if (event.threadId !== run.threadId || event.runId !== run.runId || run.text !== "")
    throw protocolError();
  const tokens = runTokens(event.usage);
  const times = { tokens, startedAt: run.startedAt, endedAt: stampOf(event.timestamp) };
  const outcome = event.outcome;
  if (outcome === undefined || outcome.type === "success") {
    // This page offers no tool of its own: no call can wait on it.
    if ((outcome?.pendingToolCallIds ?? []).length > 0) throw protocolError();
    const result: unknown = event.result;
    const turnId = isPlainObject(result) ? result.turnId : undefined;
    if (turnId !== undefined && (typeof turnId !== "string" || !turnIdPattern.test(turnId)))
      throw protocolError();
    return { type: EventType.RUN_FINISHED, outcome: "success", turnId: turnId ?? "", ...times };
  }
  if (outcome.type !== "interrupt" || outcome.interrupts.length !== 1) throw protocolError();
  const interrupt = outcome.interrupts[0];
  // A preview asked again ends on the call the run resumed, which the stream
  // does not start again.
  const call =
    (interrupt?.toolCallId !== undefined ? run.calls.get(interrupt.toolCallId) : undefined) ??
    run.resumed;
  if (interrupt?.reason !== "tool_call" || call === undefined) throw protocolError();
  const metadata = interrupt.metadata ?? {};
  // The input schema of an editable call is the editedArgs of the response the
  // interrupt takes.
  const editable = metadata.editable === true;
  const response = interrupt.responseSchema;
  const properties = isPlainObject(response?.properties) ? response.properties : undefined;
  const confirmation = parseConfirmation({
    id: interrupt.id,
    turn_id: metadata.turnId,
    tool: metadata.tool,
    arguments: confirmedArguments(call.arguments),
    argument_types: metadata.argumentTypes,
    editable,
    input_schema: editable ? properties?.editedArgs : undefined,
    expires_at: interrupt.expiresAt,
    preview: metadata.preview,
    preview_error: metadata.previewError,
    preview_arguments: metadata.previewArguments,
  });
  if (confirmation.tool.name !== call.name) throw protocolError();
  return {
    type: EventType.RUN_FINISHED,
    outcome: "interrupt",
    turnId: confirmation.turnId,
    confirmation,
    ...times,
  };
}

const KNOWN_EVENT_TYPES = new Set<string>(Object.values(EventType));

/**
 * One AG-UI event of a run, checked against the schema of AG-UI, then against the
 * order of the protocol: RUN_STARTED of this run first, a text message opened
 * before its content and closed after it, then one terminal event and nothing
 * after it. It gives the event as the page reads it, or null for one it does not
 * show: a type AG-UI added since, CUSTOM notes for the developer, the events the
 * agent does not send.
 */
function parseRunEvent(raw: unknown, run: RunState): RunEvent | RunResult | null {
  if (!isPlainObject(raw) || typeof raw.type !== "string" || run.finished !== null)
    throw protocolError();
  if (!run.started && raw.type !== EventType.RUN_STARTED) throw protocolError();
  if (!KNOWN_EVENT_TYPES.has(raw.type)) return null;
  const parsed = EventSchema.safeParse(raw);
  if (!parsed.success) throw protocolError();
  const event = parsed.data;
  switch (event.type) {
    case EventType.RUN_STARTED:
      if (run.started || event.threadId !== run.threadId || event.runId !== run.runId)
        throw protocolError();
      run.started = true;
      run.startedAt = stampOf(event.timestamp);
      return { type: EventType.RUN_STARTED, at: run.startedAt };
    case EventType.MESSAGES_SNAPSHOT:
      return parseSnapshot(event);
    case EventType.TEXT_MESSAGE_START:
      if (run.text !== "" || !isEventId(event.messageId)) throw protocolError();
      run.text = event.messageId;
      // A text of another role than the assistant, which the agent does not
      // send, is not shown as its answer.
      run.shown = event.role === undefined || event.role === "assistant";
      return run.shown ? { type: EventType.TEXT_MESSAGE_START, messageId: event.messageId } : null;
    case EventType.TEXT_MESSAGE_CONTENT:
      if (run.text === "" || event.messageId !== run.text) throw protocolError();
      return run.shown
        ? { type: EventType.TEXT_MESSAGE_CONTENT, messageId: event.messageId, delta: event.delta }
        : null;
    case EventType.TEXT_MESSAGE_END:
      if (run.text === "" || event.messageId !== run.text) throw protocolError();
      run.text = "";
      return null;
    case EventType.TOOL_CALL_START:
      if (
        !isEventId(event.toolCallId) ||
        run.calls.has(event.toolCallId) ||
        !isToolName(event.toolCallName) ||
        (event.parentMessageId !== undefined && !isEventId(event.parentMessageId))
      )
        throw protocolError();
      run.calls.set(event.toolCallId, { name: event.toolCallName, arguments: "", ended: false });
      return {
        type: EventType.TOOL_CALL_START,
        toolCallId: event.toolCallId,
        toolCallName: event.toolCallName,
        parentMessageId: event.parentMessageId ?? "",
        at: stampOf(event.timestamp),
      };
    case EventType.TOOL_CALL_ARGS: {
      const call = run.calls.get(event.toolCallId);
      if (call === undefined || call.ended) throw protocolError();
      // Arguments beyond the bound of a confirmation are not kept: such a call
      // cannot be confirmed.
      if (call.arguments !== null)
        call.arguments =
          call.arguments.length + event.delta.length > MAX_CONFIRMATION_ARGUMENTS_BYTES
            ? null
            : call.arguments + event.delta;
      return null;
    }
    case EventType.TOOL_CALL_END: {
      const call = run.calls.get(event.toolCallId);
      if (call === undefined || call.ended) throw protocolError();
      call.ended = true;
      return {
        type: EventType.TOOL_CALL_END,
        toolCallId: event.toolCallId,
        arguments: call.arguments === null ? null : stepArguments(call.arguments),
      };
    }
    case EventType.TOOL_CALL_RESULT:
      if (!isEventId(event.toolCallId)) throw protocolError();
      return {
        type: EventType.TOOL_CALL_RESULT,
        toolCallId: event.toolCallId,
        at: stampOf(event.timestamp),
        ...parseToolResult(event.content),
      };
    case EventType.RUN_FINISHED:
      run.finished = finishRun(event, run);
      return run.finished;
    case EventType.RUN_ERROR:
      // The message of the agent is never shown, as it may hold what the user
      // must not see: a known code is explained, any other is a failed turn.
      throw new AssistantError(
        event.code !== undefined && RUN_ERROR_CODES.has(event.code) ? event.code : "turn_failed",
      );
    default:
      return null;
  }
}

const mediaType = (response: Response) =>
  response.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase();

/**
 * Reads the AG-UI stream of a run to its end, one JSON event per data block: the
 * terminal event is the result of the run, given once the stream is over. Event
 * names, IDs and retries, which a relay may add, are ignored, as SSE has a
 * consumer do; so are the `: keepalive` comments of an idle stream.
 */
async function readRun(
  body: ReadableStream<Uint8Array> | null | undefined,
  response: Response,
  signal: AbortSignal | undefined,
  onEvent: ((event: RunEvent) => void) | undefined,
  run: RunState,
): Promise<RunResult> {
  if (mediaType(response) !== "text/event-stream" || body === null || body === undefined) {
    await body?.cancel().catch(() => undefined);
    throw protocolError();
  }
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let data: string[] = [];
  let streamBytes = 0;
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener("abort", cancel, { once: true });
  const consumeLine = (line: string) => {
    if (line === "") {
      if (data.length === 0) return;
      let event: unknown;
      try {
        event = JSON.parse(data.join("\n"));
      } catch {
        throw protocolError();
      }
      data = [];
      const parsed = parseRunEvent(event, run);
      // The terminal event is the result of the run, once its stream is over.
      if (parsed === null || parsed.type === EventType.RUN_FINISHED) return;
      checkAborted(signal);
      onEvent?.(parsed);
      checkAborted(signal);
      return;
    }
    if (line.startsWith(":")) return;
    const separator = line.indexOf(":");
    const field = separator < 0 ? line : line.slice(0, separator);
    if (field !== "data") return;
    const value = separator < 0 ? "" : line.slice(separator + 1);
    data.push(value.startsWith(" ") ? value.slice(1) : value);
  };
  try {
    for (;;) {
      checkAborted(signal);
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch {
        checkAborted(signal);
        throw new AssistantError("stream_interrupted");
      }
      checkAborted(signal);
      const { value, done } = chunk;
      streamBytes += value?.byteLength ?? 0;
      if (streamBytes > MAX_STREAM_BYTES) throw new AssistantError("stream_limit");
      try {
        buffer += decoder.decode(value, { stream: !done });
      } catch {
        throw protocolError();
      }
      // An end-of-chunk CR is kept: the next chunk may start with its LF.
      let offset = 0;
      for (let index = 0; index < buffer.length; index++) {
        const char = buffer[index];
        if (char !== "\n" && char !== "\r") continue;
        if (char === "\r" && index === buffer.length - 1 && !done) break;
        consumeLine(buffer.slice(offset, index));
        if (char === "\r" && buffer[index + 1] === "\n") index++;
        offset = index + 1;
      }
      buffer = buffer.slice(offset);
      if (done) {
        if (run.finished !== null) return run.finished;
        throw new AssistantError("stream_interrupted");
      }
    }
  } finally {
    signal?.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

// --- Requests ------------------------------------------------------------------

/** The code of a JSON error of the relay or the agent, `{"error": {"code"}}`; empty otherwise. */
function errorCode(body: unknown): string {
  const code = isPlainObject(body) && isPlainObject(body.error) ? body.error.code : undefined;
  return typeof code === "string" && /^[a-z_]{1,64}$/.test(code) ? code : "";
}

/**
 * The codes of the relay the page explains on any route: the assistant not
 * configured, no access token for the user, not while impersonating, the agent
 * out of reach.
 */
const RELAY_CODES = new Set([
  "assistant_disabled",
  "assistant_token_unavailable",
  "assistant_forbidden",
  "assistant_unreachable",
]);

/** The code a refusal takes, from its status and the code of its body; undefined for `http_error`. */
type Refusal = (status: number, code: string) => string | undefined;

const refuse: Refusal = (_status, code) => (RELAY_CODES.has(code) ? code : undefined);

/** A creation says the quota of the user, or the limit of the agent, which is not the user's doing. */
const refuseCreation: Refusal = (status, code) =>
  code === "conversation_quota" || code === "conversation_limit" ? code : refuse(status, code);

/**
 * The refusals of a run: the answers to a confirmation by their code, and the
 * 404 of an agent that serves no runs, told from a conversation not found.
 */
const refuseRun: Refusal = (status, code) => {
  if (
    code === "invalid_edited_arguments" ||
    code === "confirmation_not_pending" ||
    code === "confirmation_expired"
  )
    return code;
  if (status === 404 && code !== "conversation_not_found" && !RELAY_CODES.has(code))
    return "agent_outdated";
  return refuse(status, code);
};

/** The refusals of a feedback, by their status, past those of the relay. */
const FEEDBACK_REFUSALS: Record<number, string> = {
  400: "feedback_invalid",
  404: "feedback_gone",
  409: "feedback_limit",
};
const refuseFeedback: Refusal = (status, code) => refuse(status, code) ?? FEEDBACK_REFUSALS[status];

/** The refusals of the list of the tools: a route the relay lacks lists none. */
const refuseTools: Refusal = (status, code) => {
  if (status === 502 && code === "tools_unavailable") return code;
  if (status === 404 && code !== "assistant_disabled") return "tools_unlisted";
  return refuse(status, code);
};

interface Sent {
  body: ReadableStream<Uint8Array> | null | undefined;
  response: Response;
}

/**
 * Sends a request of the typed client and gives its response, its body unread:
 * a refusal is thrown with the code `refusal` gives it, a failure to reach the
 * collector as `network_error`. An aborted request throws an AbortError.
 */
async function send(
  signal: AbortSignal | undefined,
  request: () => Promise<{ data?: unknown; error?: unknown; response: Response }>,
  refusal: Refusal = refuse,
): Promise<Sent> {
  checkAborted(signal);
  let result: { data?: unknown; error?: unknown; response: Response };
  try {
    result = await request();
  } catch (error) {
    checkAborted(signal);
    if (isAbort(error)) throw error;
    throw new AssistantError("network_error");
  }
  checkAborted(signal);
  const { response } = result;
  if (!response.ok) {
    const code = errorCode(result.error);
    throw new AssistantError(refusal(response.status, code) ?? "http_error", response.status);
  }
  return { body: result.data as ReadableStream<Uint8Array> | null | undefined, response };
}

/** Reads a JSON body within `max` bytes, in UTF-8; anything else is an error of the protocol. */
async function readJson(sent: Sent, signal: AbortSignal | undefined, max = MAX_JSON_BYTES) {
  const { body, response } = sent;
  if (mediaType(response) !== "application/json" || body === null || body === undefined) {
    await body?.cancel().catch(() => undefined);
    throw protocolError();
  }
  const reader = body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    const bytes = new Uint8Array(max);
    let size = 0;
    for (;;) {
      checkAborted(signal);
      const { done, value } = await reader.read();
      checkAborted(signal);
      if (done) break;
      if (size + value.byteLength > max) throw protocolError();
      bytes.set(value, size);
      size += value.byteLength;
    }
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size)),
    ) as unknown;
  } catch {
    checkAborted(signal);
    throw protocolError();
  } finally {
    signal?.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** An empty answer, 204, is required: any body is an error of the protocol, closed unread. */
async function expectEmpty({ body, response }: Sent): Promise<void> {
  if (response.status !== 204) {
    await body?.cancel().catch(() => undefined);
    throw protocolError();
  }
}

/** An ID of 128 random bits. `crypto.randomUUID` needs a secure context, which a page over plain HTTP is not. */
const randomId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

/** A message this client holds, by its AG-UI ID, for the agent to tell whether it is in phase. */
export interface HeldMessage {
  id: string;
  role: "user" | "assistant";
}

/**
 * The input of a run: a new prompt, with the ID this client gives it; the answer
 * to the confirmation the conversation waits on, edited arguments going with an
 * approval only; or the preview of that call asked again for edited arguments,
 * nothing running. `held` are the messages this client holds.
 */
export type RunInput = { held?: HeldMessage[] } & (
  | { prompt: string; promptId: string; resume?: undefined }
  | { resume: { interruptId: string; approved: boolean; editedArgs?: Args; preview?: undefined } }
  | {
      resume: {
        interruptId: string;
        preview: true;
        editedArgs: Args;
        /** The call waiting, which the stream of the run does not start again. */
        pending: { name: string; arguments: Args };
      };
    }
);

export interface RunOptions {
  signal?: AbortSignal;
  onEvent?: (event: RunEvent) => void;
}

type ResumeEntry = { interruptId: string; status: "resolved"; payload: Record<string, unknown> };

/** The resume of a run, checked before any request. */
function resumeOf(resume: Extract<RunInput, { resume: object }>["resume"]): ResumeEntry[] {
  if (resume.preview === true) {
    if (
      !confirmationIdPattern.test(resume.interruptId) ||
      !isPlainObject(resume.editedArgs) ||
      jsonBytes(resume.editedArgs) > MAX_CONFIRMATION_ARGUMENTS_BYTES ||
      !isToolName(resume.pending.name) ||
      !isPlainObject(resume.pending.arguments)
    )
      throw new AssistantError("invalid_confirmation");
    return [
      {
        interruptId: resume.interruptId,
        status: "resolved",
        payload: { action: "preview", editedArgs: resume.editedArgs },
      },
    ];
  }
  if (
    typeof resume.interruptId !== "string" ||
    !confirmationIdPattern.test(resume.interruptId) ||
    typeof resume.approved !== "boolean" ||
    // Edited arguments, a full replacement of those of the call, go with an
    // approval only.
    (resume.editedArgs !== undefined &&
      (!resume.approved ||
        !isPlainObject(resume.editedArgs) ||
        jsonBytes(resume.editedArgs) > MAX_CONFIRMATION_ARGUMENTS_BYTES))
  )
    throw new AssistantError("invalid_confirmation");
  return [
    {
      interruptId: resume.interruptId,
      status: "resolved",
      payload: {
        approved: resume.approved,
        ...(resume.editedArgs !== undefined ? { editedArgs: resume.editedArgs } : {}),
      },
    },
  ];
}

/** What the page asks of the agent. Inputs out of their bounds throw before any request. */
export interface AssistantClient {
  listConversations(options?: { signal?: AbortSignal }): Promise<Conversation[]>;
  createConversation(options?: { signal?: AbortSignal }): Promise<Conversation>;
  /** A conversation, and the tool call it waits on, if any. */
  getConversation(
    id: string,
    options?: { signal?: AbortSignal },
  ): Promise<{ conversation: Conversation; confirmation: Confirmation | null }>;
  getMessages(
    id: string,
    options?: { limit?: number; before?: string; signal?: AbortSignal },
  ): Promise<MessagePage>;
  renameConversation(
    id: string,
    title: string,
    options?: { signal?: AbortSignal },
  ): Promise<Conversation>;
  deleteConversation(id: string, options?: { signal?: AbortSignal }): Promise<void>;
  /** The tools the assistant may call for the user. */
  listTools(options?: { signal?: AbortSignal }): Promise<ToolDoc[]>;
  /** The ID this client gives a prompt. */
  newId(): string;
  /** Runs the agent on a conversation, in AG-UI; resolves with its RUN_FINISHED. */
  run(id: string, input: RunInput, options?: RunOptions): Promise<RunResult>;
  /** Gives or replaces the feedback of the user on a completed turn; gives the one stored. */
  setFeedback(
    id: string,
    turnId: string,
    feedback: FeedbackInput,
    options?: { signal?: AbortSignal },
  ): Promise<Feedback>;
  deleteFeedback(id: string, turnId: string, options?: { signal?: AbortSignal }): Promise<void>;
}

/** The client of the agent, through the relay. `newId` names the runs and prompts, for the tests. */
export function createAssistantClient({
  newId = randomId,
}: { newId?: () => string } = {}): AssistantClient {
  const conversationParams = (id: string) => ({
    params: { path: { conversation_id: checkConversationId(id) } },
  });

  const conversationOf = async (sent: Sent, signal: AbortSignal | undefined) => {
    const result = await readJson(sent, signal);
    if (!isPlainObject(result)) throw protocolError();
    return parseConversation(result.conversation);
  };

  return {
    newId,

    listConversations: async ({ signal } = {}) => {
      const sent = await send(signal, () =>
        api.GET("/assistant/conversations", { parseAs: "stream", signal }),
      );
      const result = await readJson(sent, signal);
      if (!isPlainObject(result) || !Array.isArray(result.conversations)) throw protocolError();
      return (result.conversations as unknown[]).map(parseConversation);
    },

    createConversation: async ({ signal } = {}) =>
      conversationOf(
        await send(
          signal,
          () => api.POST("/assistant/conversations", { parseAs: "stream", signal }),
          refuseCreation,
        ),
        signal,
      ),

    getConversation: (id, { signal } = {}) => {
      const params = conversationParams(id);
      return (async () => {
        const sent = await send(signal, () =>
          api.GET("/assistant/conversations/{conversation_id}", {
            ...params,
            parseAs: "stream",
            signal,
          }),
        );
        const result = await readJson(sent, signal);
        if (!isPlainObject(result)) throw protocolError();
        return {
          conversation: parseConversation(result.conversation),
          confirmation:
            result.pending_confirmation === undefined
              ? null
              : parseConfirmation(result.pending_confirmation),
        };
      })();
    },

    getMessages: (id, { limit = 50, before = "", signal } = {}) => {
      const params = conversationParams(id);
      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > MAX_HISTORY_MESSAGES ||
        (before !== "" && !validHistoryCursor(before))
      )
        throw new AssistantError("invalid_history_query");
      return (async () => {
        const sent = await send(signal, () =>
          api.GET("/assistant/conversations/{conversation_id}/messages", {
            params: {
              path: params.params.path,
              query: { limit, ...(before !== "" ? { before } : {}) },
            },
            parseAs: "stream",
            signal,
          }),
        );
        return parseMessagePage(await readJson(sent, signal), limit, before);
      })();
    },

    renameConversation: (id, title, { signal } = {}) => {
      const params = conversationParams(id);
      // The agent's normalization, counting Unicode code points, not UTF-16 units.
      const normalized =
        typeof title === "string"
          ? title
              .replace(/[\p{Cc}\p{Cf}]/gu, " ")
              .trim()
              .replace(/\s+/gu, " ")
          : "";
      if (normalized === "" || Array.from(normalized).length > MAX_TITLE_CHARACTERS)
        throw new AssistantError("invalid_title");
      return (async () =>
        conversationOf(
          await send(signal, () =>
            api.PATCH("/assistant/conversations/{conversation_id}", {
              ...params,
              body: { title: normalized },
              parseAs: "stream",
              signal,
            }),
          ),
          signal,
        ))();
    },

    deleteConversation: (id, { signal } = {}) => {
      const params = conversationParams(id);
      return (async () =>
        expectEmpty(
          await send(signal, () =>
            api.DELETE("/assistant/conversations/{conversation_id}", {
              ...params,
              parseAs: "stream",
              signal,
            }),
          ),
        ))();
    },

    // The relay serves no list of the tools yet: the route is read as any
    // dynamic path, with the credentials of the typed client, a 404 saying the
    // agent lists none.
    listTools: async ({ signal } = {}) => {
      checkAborted(signal);
      let answer: { status: number; body: unknown };
      try {
        answer = await apiGetDynamic("/assistant/tools", {}, signal);
      } catch (error) {
        checkAborted(signal);
        if (isAbort(error)) throw error;
        throw new AssistantError("network_error");
      }
      checkAborted(signal);
      if (answer.status !== 200) {
        throw new AssistantError(
          refuseTools(answer.status, errorCode(answer.body)) ?? "http_error",
          answer.status,
        );
      }
      return parseTools(answer.body);
    },

    run: (id, input, { signal, onEvent } = {}) => {
      const params = conversationParams(id);
      const held = input.held ?? [];
      if (
        !Array.isArray(held) ||
        held.some(
          (message) =>
            !isEventId(message.id) || (message.role !== "user" && message.role !== "assistant"),
        )
      )
        throw new AssistantError("invalid_run");
      const messages: { id: string; role: string; content?: string }[] = held.map(
        ({ id: messageId, role }) => ({ id: messageId, role }),
      );
      let resume: ResumeEntry[] | undefined;
      if (input.resume === undefined) {
        if (
          typeof input.prompt !== "string" ||
          input.prompt.trim() === "" ||
          new TextEncoder().encode(input.prompt).length > MAX_PROMPT_BYTES
        )
          throw new AssistantError("invalid_prompt");
        if (typeof input.promptId !== "string" || !promptIdPattern.test(input.promptId))
          throw new AssistantError("invalid_run");
        messages.push({ id: input.promptId, role: "user", content: input.prompt });
      } else {
        resume = resumeOf(input.resume);
      }
      const runId = newId();
      const body = {
        threadId: id,
        runId,
        protocolVersion: AGUI_PROTOCOL_VERSION,
        messages,
        tools: [],
        context: [],
        state: {},
        forwardedProps: {},
        ...(resume !== undefined ? { resume } : {}),
      };
      const run: RunState = {
        threadId: id,
        runId,
        started: false,
        startedAt: null,
        text: "",
        shown: false,
        calls: new Map(),
        finished: null,
        ...(input.resume?.preview === true
          ? {
              resumed: {
                name: input.resume.pending.name,
                arguments: JSON.stringify(input.resume.pending.arguments),
                ended: true,
              },
            }
          : {}),
      };
      return (async () => {
        const sent = await send(
          signal,
          () =>
            api.POST("/assistant/conversations/{conversation_id}/runs", {
              ...params,
              // The schema of the relay knows the plain decision only: the agent
              // takes the edited arguments and the preview asked again too.
              body: body as components["schemas"]["AssistantRunInput"],
              headers: { Accept: "text/event-stream" },
              parseAs: "stream",
              signal,
            }),
          refuseRun,
        );
        return readRun(sent.body, sent.response, signal, onEvent, run);
      })();
    },

    setFeedback: (id, turnId, feedback, { signal } = {}) => {
      const params = conversationParams(id);
      const normalized = parseFeedback(feedback);
      if (typeof turnId !== "string" || !turnIdPattern.test(turnId) || normalized === null)
        throw new AssistantError("invalid_feedback");
      return (async () => {
        const sent = await send(
          signal,
          () =>
            api.PUT("/assistant/conversations/{conversation_id}/turns/{turn_id}/feedback", {
              params: { path: { ...params.params.path, turn_id: turnId } },
              body: normalized,
              parseAs: "stream",
              signal,
            }),
          refuseFeedback,
        );
        const result = await readJson(sent, signal);
        const stored = isPlainObject(result) ? parseFeedback(result.feedback) : null;
        if (stored === null) throw protocolError();
        return stored;
      })();
    },

    deleteFeedback: (id, turnId, { signal } = {}) => {
      const params = conversationParams(id);
      if (typeof turnId !== "string" || !turnIdPattern.test(turnId))
        throw new AssistantError("invalid_feedback");
      return (async () =>
        expectEmpty(
          await send(
            signal,
            () =>
              api.DELETE("/assistant/conversations/{conversation_id}/turns/{turn_id}/feedback", {
                params: { path: { ...params.params.path, turn_id: turnId } },
                parseAs: "stream",
                signal,
              }),
            refuseFeedback,
          ),
        ))();
    },
  };
}

/** The client the page uses. */
export const assistantClient = createAssistantClient();
