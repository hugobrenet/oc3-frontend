import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { Conversation } from "./assistant-client";

export const CONVERSATION_GROUPS = ["today", "yesterday", "week", "older"] as const;
export type ConversationGroup = (typeof CONVERSATION_GROUPS)[number];

/** The time of the last change of a conversation, NaN when it has none readable. */
const changedAt = (conversation: Conversation) =>
  Date.parse(conversation.updated_at ?? conversation.created_at ?? "");

/**
 * The conversations by the day of their last change, in the local time of `now`:
 * today, yesterday, the 7 days before, older. Each group is sorted from the most
 * recent; a conversation without a readable date goes to the older ones.
 */
export function groupConversations(
  conversations: Conversation[],
  now = new Date(),
): { key: ConversationGroup; items: Conversation[] }[] {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const week = new Date(today);
  week.setDate(today.getDate() - 7);
  const groups: Record<ConversationGroup, Conversation[]> = {
    today: [],
    yesterday: [],
    week: [],
    older: [],
  };
  for (const conversation of conversations) {
    const time = changedAt(conversation);
    const key: ConversationGroup = !Number.isFinite(time)
      ? "older"
      : time >= today.getTime()
        ? "today"
        : time >= yesterday.getTime()
          ? "yesterday"
          : time >= week.getTime()
            ? "week"
            : "older";
    groups[key].push(conversation);
  }
  const recentFirst = (left: Conversation, right: Conversation) =>
    (changedAt(right) || 0) - (changedAt(left) || 0);
  return CONVERSATION_GROUPS.filter((key) => groups[key].length > 0).map((key) => ({
    key,
    items: groups[key].sort(recentFirst),
  }));
}

/** Below the md breakpoint, where the conversations and the transcript cannot stand side by side. */
export const NARROW_QUERY = "(max-width: 767.98px)";

/** Whether the window is narrow, following its changes; wide where it cannot be told. */
function useNarrow(): boolean {
  return useSyncExternalStore(
    (listener) => {
      if (typeof window.matchMedia !== "function") return () => undefined;
      const media = window.matchMedia(NARROW_QUERY);
      media.addEventListener("change", listener);
      return () => {
        media.removeEventListener("change", listener);
      };
    },
    () => typeof window.matchMedia === "function" && window.matchMedia(NARROW_QUERY).matches,
  );
}

const OPEN_KEY = "oc3.assistant.conversations";

/** Folding the conversations is a display comfort, kept by the browser. */
function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) !== "closed";
  } catch {
    // Private browsing or storage refused: the panel opens, as by default.
    return true;
  }
}

/**
 * Whether the conversations panel is open, and what toggles it. A wide window
 * remembers it in local storage. A narrow one has it folded: by default, on
 * becoming so, and once a conversation is chosen (`fold`), a choice not
 * remembered.
 */
export function useConversationsOpen() {
  const narrow = useNarrow();
  const [open, setOpen] = useState(readOpen);
  const [narrowOpen, setNarrowOpen] = useState(false);
  useEffect(() => {
    if (narrow) setNarrowOpen(false);
  }, [narrow]);
  const toggle = useCallback(() => {
    if (narrow) {
      setNarrowOpen((previous) => !previous);
      return;
    }
    setOpen((previous) => {
      const next = !previous;
      try {
        localStorage.setItem(OPEN_KEY, next ? "open" : "closed");
      } catch {
        // Not remembered: without consequence for the page on display.
      }
      return next;
    });
  }, [narrow]);
  const fold = useCallback(() => {
    setNarrowOpen(false);
  }, []);
  return { open: narrow ? narrowOpen : open, toggle, fold };
}
