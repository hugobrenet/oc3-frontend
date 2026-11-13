import { createContext, useContext } from "react";
import type { AssistantChat } from "./use-assistant-chat";

/** What the assistant does while no view shows it; all false while one does. */
export interface AssistantActivity {
  /** A turn runs: the model answers, or an approved action runs. */
  answering: boolean;
  /** A turn ended while no view showed it, answered, stopped or failed. */
  ended: boolean;
  /** An action waits for the decision of the user. */
  waiting: boolean;
}

export interface SharedChat {
  chat: AssistantChat;
  /** Called by a view while it shows the chat; gives back its release. */
  attach: () => () => void;
  /**
   * What the user types in the message box, held here rather than by a view: it
   * goes with the conversation from the dock to the page.
   */
  draft: string;
  setDraft: (draft: string) => void;
  /**
   * A question to open the chat with (`ask`), until the view on display puts it
   * in the message box of a new conversation (`takePrompt`).
   */
  prompt: string | null;
  ask: (prompt: string) => void;
  takePrompt: () => void;
  /** The last question asked was dropped: a turn ran, or an action waited. */
  promptDropped: boolean;
  clearPromptDropped: () => void;
}

/** The chat of the assistant the application holds (AssistantChatProvider). */
export const AssistantChatContext = createContext<SharedChat | null>(null);

/**
 * What the assistant does, apart from its chat: the menu reads it, and renders
 * when it changes only, not at every piece of an answer streamed.
 */
export const AssistantActivityContext = createContext<AssistantActivity | null>(null);

/** The states of the dock: open, or folded to its button, always there. */
export type DockState = "open" | "folded";

/**
 * The dock of the assistant, the chat over the current page. Its callbacks are
 * stable: the links that open it do not render at every piece of an answer.
 */
export interface AssistantDock {
  state: DockState;
  /**
   * Asks the question, then opens the dock on it; `origin`, the element that
   * opened it, gets the focus back when the dock is folded.
   */
  openWith: (prompt: string, origin?: HTMLElement | null) => void;
  open: () => void;
  fold: () => void;
  /** The element the focus goes back to when the dock is folded, if still there. */
  origin: () => HTMLElement | null;
}

export const AssistantDockContext = createContext<AssistantDock | null>(null);

/** The chat the application holds, or null outside of a provider. */
export function useSharedAssistantChat(): SharedChat | null {
  return useContext(AssistantChatContext);
}

/** What the assistant does, for the menu; null outside of a provider. */
export function useAssistantActivity(): AssistantActivity | null {
  return useContext(AssistantActivityContext);
}

/** The dock of the assistant, or null outside of a provider. */
export function useAssistantDock(): AssistantDock | null {
  return useContext(AssistantDockContext);
}
