import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AssistantClient } from "./assistant-client";
import {
  AssistantActivityContext,
  AssistantChatContext,
  AssistantDockContext,
  type DockState,
} from "./assistant-chat";
import { useAssistantChat } from "./use-assistant-chat";

/**
 * Holds the chat of the assistant for the whole application, rather than for its
 * page: a turn goes on while the user looks at another page, its answer or the
 * action it waits a decision on found when the user comes back. Closing the tab
 * or reloading still ends it.
 *
 * Two views show it: the page of the assistant, and the dock over the other
 * pages. What they share lives here: the message typed, the question another
 * page opened the chat with, and the state of the dock, folded at first.
 *
 * Nothing is read until a view opens once (`attach`). Another identity, by a
 * sign-in or an impersonation, starts the chat afresh, the turn of the former
 * one stopped, and waits for a view to open again: the provider is not
 * remounted, nor what it holds, the menu and the page on display.
 */
export function AssistantChatProvider({
  client,
  identity = "",
  children,
}: {
  client: AssistantClient;
  /** Who the chat is for: the user, and the user impersonated, if any. */
  identity?: string;
  children: ReactNode;
}) {
  const [enabled, setEnabled] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [ended, setEnded] = useState(false);
  const [draft, setDraft] = useState("");
  const [prompt, setPrompt] = useState<string | null>(null);
  const [promptDropped, setPromptDropped] = useState(false);
  const [dock, setDock] = useState<DockState>("folded");
  const viewers = useRef(0);
  const origin = useRef<HTMLElement | null>(null);

  // Another identity: not enabled until a view opens again, nothing ended, typed
  // or asked for it, the dock folded. Set during the render, so that the chat
  // does not read for it meanwhile.
  const [shownIdentity, setShownIdentity] = useState(identity);
  if (shownIdentity !== identity) {
    setShownIdentity(identity);
    setEnabled(viewers.current > 0);
    setEnded(false);
    setDraft("");
    setPrompt(null);
    setPromptDropped(false);
    setDock("folded");
  }
  const chat = useAssistantChat(client, enabled, identity);

  const attach = useCallback(() => {
    viewers.current++;
    setViewing(true);
    setEnabled(true);
    setEnded(false);
    return () => {
      viewers.current--;
      if (viewers.current === 0) setViewing(false);
    };
  }, []);

  const answering = chat.pending === "turn" || chat.pending === "confirming";
  const waiting = chat.confirmation !== null;

  // A question asked while a turn runs, or an action waits, is dropped, and the
  // view says so, rather than replace later, at the end of the turn, what the
  // user reads or types. Else it waits for the view on display.
  const blocked = useRef(false);
  blocked.current = answering || waiting;
  const ask = useCallback((text: string) => {
    if (blocked.current) {
      setPrompt(null);
      setPromptDropped(true);
      return;
    }
    setPrompt(text);
    setPromptDropped(false);
  }, []);
  const takePrompt = useCallback(() => {
    setPrompt(null);
  }, []);
  const clearPromptDropped = useCallback(() => {
    setPromptDropped(false);
  }, []);

  // Another conversation on display: the message box starts from the message
  // queued, given back, or empty. The conversation the first turn creates is the
  // one on display: what the user types meanwhile stays. One being resumed passes
  // through none, its history not read: only the one it goes to counts. At the
  // commit, before any click on what the view shows.
  const shownConversation = useRef<string | null>(null);
  const conversationKey = chat.conversation?.id ?? "";
  useLayoutEffect(() => {
    if (!chat.historyReady) return;
    const previous = shownConversation.current;
    if (previous === conversationKey) return;
    shownConversation.current = conversationKey;
    if (chat.pending === "turn" && previous === "") return;
    setDraft(chat.takeQueued() ?? "");
    // The conversation shown only: the queue is read when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationKey, chat.pending, chat.historyReady]);

  // A turn that ends while no view shows it, answered, stopped or failed, is to
  // be seen: the folded dock counts as not shown.
  const wasAnswering = useRef(false);
  useEffect(() => {
    if (wasAnswering.current && !answering && !viewing) setEnded(true);
    wasAnswering.current = answering;
  }, [answering, viewing]);

  // What the menu and the folded dock show while no view shows the chat: in one,
  // the chat says so.
  const activity = useMemo(
    () => ({
      answering: answering && !viewing,
      ended: ended && !viewing,
      waiting: waiting && !viewing,
    }),
    [answering, ended, viewing, waiting],
  );

  const dockControls = useMemo(
    () => ({
      state: dock,
      openWith: (text: string, from?: HTMLElement | null) => {
        origin.current = from ?? null;
        ask(text);
        setDock("open");
      },
      open: () => {
        setDock("open");
      },
      fold: () => {
        setDock("folded");
      },
      origin: () => (origin.current?.isConnected === true ? origin.current : null),
    }),
    [dock, ask],
  );

  return (
    <AssistantChatContext.Provider
      value={{
        chat,
        attach,
        draft,
        setDraft,
        prompt,
        ask,
        takePrompt,
        promptDropped,
        clearPromptDropped,
      }}
    >
      <AssistantActivityContext.Provider value={activity}>
        <AssistantDockContext.Provider value={dockControls}>
          {children}
        </AssistantDockContext.Provider>
      </AssistantActivityContext.Provider>
    </AssistantChatContext.Provider>
  );
}
