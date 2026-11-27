import { defaultParseSearch } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import type { AssistantClient } from "./assistant-client";
import {
  AssistantActivityContext,
  AssistantChatContext,
  AssistantDockContext,
  type DockState,
} from "./assistant-chat";
import { useAssistantChat } from "./use-assistant-chat";
import { checkedRows } from "./checked-rows";
import { listFilters } from "./list-filters";
import { sessionFilterset } from "./session-filterset";
import { interfaceContext } from "./interface-context";
import { useTabNotice } from "./use-tab-notice";

/**
 * What the page under the dock shows, read when a prompt is sent or queued, with
 * the filters of its list and the rows ticked there and the clock of the user: the clock only on the page of
 * the assistant, nothing being under the conversation there. From the address of
 * the window, which the router keeps, with no base path, parsed as the router
 * parses it.
 */
const pageContext = () =>
  interfaceContext(window.location.pathname, defaultParseSearch(window.location.search), {
    now: new Date(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    listFilters: listFilters(),
    checked: checkedRows(),
    sessionFilterset: sessionFilterset(),
  });

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
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [ended, setEnded] = useState(false);
  // The turn that ended so failed: its answer is incomplete.
  const [endedFailed, setEndedFailed] = useState(false);
  // An action began to wait for the decision of the user while no view showed
  // the chat: one seen waiting is not told again.
  const [waitedUnseen, setWaitedUnseen] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftSkill, setDraftSkill] = useState<string | null>(null);
  const [skillGone, setSkillGone] = useState<string | null>(null);
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
    setEndedFailed(false);
    setWaitedUnseen(false);
    setDraft("");
    setDraftSkill(null);
    setSkillGone(null);
    setPrompt(null);
    setPromptDropped(false);
    setDock("folded");
  }
  const chat = useAssistantChat(client, enabled, identity, pageContext);

  const attach = useCallback(() => {
    viewers.current++;
    setViewing(true);
    setEnabled(true);
    setEnded(false);
    setWaitedUnseen(false);
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
    const skill = chat.queued?.skill ?? null;
    setDraft(chat.takeQueued() ?? "");
    setDraftSkill(skill);
    // The conversation shown only: the queue is read when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationKey, chat.pending, chat.historyReady]);

  // A turn that ends while no view shows it, answered, stopped or failed, is to
  // be seen: the folded dock counts as not shown. The identity it ran for is
  // kept: one stopped by another identity is not the new one's to see. The tab
  // hidden meanwhile says it in its title, the view shown or not.
  const tab = useTabNotice(t);
  const turnError = useRef(chat.error);
  turnError.current = chat.error;
  const waitingNow = useRef(waiting);
  waitingNow.current = waiting;
  const viewingNow = useRef(viewing);
  viewingNow.current = viewing;
  // The identity a turn began for, kept until it ends: the chat of another one
  // is reset a render later, its turn stopping then.
  const answeringFor = useRef<string | null>(null);
  useEffect(() => {
    // A turn runs again, such as a message queued: what the title and the
    // dock told is over, the end of this one to be told in turn.
    if (answering) {
      answeringFor.current ??= identity;
      setEnded(false);
      setEndedFailed(false);
      tab.clear();
      return;
    }
    const endedHere = answeringFor.current === identity;
    answeringFor.current = null;
    if (!endedHere) return;
    // Failed when the chat tells an error: an answer stopped tells none.
    const failedTurn = turnError.current !== null;
    if (!viewing) {
      setEnded(true);
      setEndedFailed(failedTurn);
    }
    // A turn that ends on an action waiting tells that rather.
    if (!waitingNow.current) tab.tell(failedTurn ? "failed" : "ended");
  }, [answering, viewing, identity, tab]);

  // An action that begins to wait, told once while it waits.
  const waitTold = useRef(false);
  useEffect(() => {
    if (!waiting) {
      waitTold.current = false;
      setWaitedUnseen(false);
      tab.clear("waiting");
      return;
    }
    if (waitTold.current) return;
    waitTold.current = true;
    if (!viewingNow.current) setWaitedUnseen(true);
    tab.tell("waiting");
  }, [waiting, identity, tab]);

  // Another identity: the title told nothing of it.
  useEffect(
    () => () => {
      tab.clear();
    },
    [identity, tab],
  );

  // What the menu and the folded dock show while no view shows the chat: in one,
  // the chat says so.
  const activity = useMemo(
    () => ({
      answering: answering && !viewing,
      ended: ended && !viewing,
      failed: ended && endedFailed && !viewing,
      waiting: waiting && !viewing,
      notice: viewing
        ? null
        : waiting && waitedUnseen
          ? ("waiting" as const)
          : ended
            ? endedFailed
              ? ("failed" as const)
              : ("ended" as const)
            : null,
    }),
    [answering, ended, endedFailed, viewing, waiting, waitedUnseen],
  );

  const dockControls = useMemo(
    () => ({
      state: dock,
      openWith: (text: string, from?: HTMLElement | null) => {
        origin.current = from ?? null;
        ask(text);
        setDock("open");
      },
      // Opened by its button or its key: the focus goes back, once it folds, to
      // what had it, such as a row of a list; not to the button, nor to the page.
      open: () => {
        const active = document.activeElement;
        origin.current =
          active instanceof HTMLElement &&
          active !== document.body &&
          active.closest("[data-assistant-dock-button]") === null
            ? active
            : null;
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
        client,
        attach,
        draft,
        setDraft,
        draftSkill,
        setDraftSkill,
        skillGone,
        setSkillGone,
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
