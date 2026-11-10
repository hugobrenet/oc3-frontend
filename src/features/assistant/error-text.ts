import type { TFunction } from "i18next";
import { AssistantError } from "./assistant-client";

/**
 * The codes the page explains in words of its own (`assistant.errors.codes`):
 * those of the relay, of the agent the page knows, and of this client. Any other
 * refusal is said by its status, and anything else as a failure: never in the
 * words of the agent or of an exception, which may hold what the user must not
 * see.
 */
const EXPLAINED = new Set([
  "assistant_disabled",
  "assistant_token_unavailable",
  "assistant_forbidden",
  "assistant_unreachable",
  "network_error",
  "invalid_response",
  "stream_interrupted",
  "stream_limit",
  "request_timeout",
  "tool_name_conflict",
  "tool_call_limit",
  "turn_failed",
  "agent_outdated",
  "conversation_quota",
  "conversation_limit",
  "confirmation_not_pending",
  "confirmation_expired",
  "invalid_edited_arguments",
  "invalid_title",
  "feedback_invalid",
  "feedback_gone",
  "feedback_limit",
  "tools_unavailable",
  "tools_unlisted",
]);

/** The statuses said when the code of a refusal is not one the page explains. */
const STATUSES = new Set([401, 403, 404, 409, 410, 413, 429, 503]);

/** The failure of a request to the assistant, in the language of the page. */
export function errorText(t: TFunction, error: unknown): string {
  if (error instanceof AssistantError) {
    if (EXPLAINED.has(error.code)) return t(`assistant.errors.codes.${error.code}`);
    if (error.status !== null && STATUSES.has(error.status))
      return t(`assistant.errors.status.${String(error.status)}`);
    if (error.status !== null) return t("assistant.errors.refused");
  }
  return t("assistant.errors.unknown");
}
