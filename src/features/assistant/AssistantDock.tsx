import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { useMatchRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ChevronDownIcon, ExternalLinkIcon, PlusIcon, SparklesIcon } from "@/components/ui/icons";
import { Answer, UserMessage } from "./Assistant";
import {
  useAssistantActivity,
  useAssistantDock,
  useSharedAssistantChat,
  type AssistantDock as Dock,
} from "./assistant-chat";
import { useAssistantStatus } from "./assistant-status";
import { Composer } from "./Composer";
import { errorText } from "./error-text";
import { dateTimeFormat } from "@/lib/date-format";

const ICON_BUTTON =
  "flex h-7 w-7 shrink-0 items-center justify-center rounded-(--radius-control) text-ink-muted hover:bg-surface-sunken hover:text-ink disabled:opacity-60";
const SMALL_BUTTON =
  "h-7 rounded-(--radius-control) border border-line px-2 text-ink hover:bg-surface-sunken disabled:opacity-60";

/**
 * Over the bookmarks at the foot of the page, which publish their height, and
 * at the bottom right of the window; the whole width on a small screen.
 */
const PLACE = { bottom: "calc(var(--bookmarks-bar-height, 0px) + 1rem)" };

/**
 * The dock of the assistant: the chat over the page on display, opened by
 * "Analyze with the assistant" on a record, without leaving it. It shows the
 * conversation of the page of the assistant, from the same chat: "Expand" goes
 * to that page, the conversation and the message typed kept.
 *
 * Folded, it is a button at the bottom right of every page, a quick way to ask
 * without going to the page of the assistant, which tells what the assistant
 * does meanwhile, as the menu does. Hidden on the page of the assistant, which
 * shows the chat already, and to a user who cannot use the assistant.
 */
export function AssistantDock() {
  const dock = useAssistantDock();
  const shared = useSharedAssistantChat();
  const matchRoute = useMatchRoute();
  const onPage = matchRoute({ to: "/ai" }) !== false;
  // The element the focus goes to once the dock is folded: the one that opened
  // it, else the button of the folded dock.
  const refocus = useRef<HTMLElement | "button" | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (dock?.state !== "folded" || refocus.current === null) return;
    const target = refocus.current === "button" ? button.current : refocus.current;
    refocus.current = null;
    target?.focus();
  }, [dock?.state]);

  // Folded, the dock reads the status of the assistant only, cached a few
  // minutes: nothing of the chat until it opens.
  if (dock === null || shared === null || onPage) return null;
  return (
    <ShownDock
      dock={dock}
      buttonRef={button}
      onFold={() => {
        refocus.current = dock.origin() ?? "button";
        dock.fold();
      }}
    />
  );
}

/** The dock open or folded, to a user who can use the assistant only. */
function ShownDock({
  dock,
  buttonRef,
  onFold,
}: {
  dock: Dock;
  buttonRef: RefObject<HTMLButtonElement | null>;
  onFold: () => void;
}) {
  const status = useAssistantStatus();
  if (status.data?.available !== true) return null;
  if (dock.state === "folded") return <FoldedDock dock={dock} buttonRef={buttonRef} />;
  return <DockPanel dock={dock} onFold={onFold} />;
}

/** The folded dock: a button, with what the assistant does meanwhile. */
function FoldedDock({
  dock,
  buttonRef,
}: {
  dock: Dock;
  buttonRef: RefObject<HTMLButtonElement | null>;
}) {
  const { t } = useTranslation();
  const activity = useAssistantActivity();
  const state =
    activity === null
      ? null
      : activity.waiting
        ? "waiting"
        : activity.answering
          ? "answering"
          : activity.ended
            ? "ended"
            : null;
  const label =
    state === null
      ? t("assistant.dock.open")
      : `${t("assistant.dock.open")} · ${t(`assistant.activity.${state}`)}`;
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={label}
      title={label}
      onClick={dock.open}
      style={PLACE}
      className="fixed right-4 z-(--z-dock) flex h-12 w-12 items-center justify-center rounded-full border border-line bg-surface-raised text-accent shadow-lg hover:bg-surface-sunken"
    >
      <SparklesIcon className="h-5 w-5" />
      {state !== null && (
        <span
          aria-hidden="true"
          data-testid="dock-activity"
          className={`absolute top-1 right-1 h-2.5 w-2.5 rounded-full ${
            state === "waiting"
              ? "bg-state-warn"
              : state === "answering"
                ? "animate-pulse bg-accent"
                : "bg-accent"
          }`}
        />
      )}
    </button>
  );
}

/** The open dock: the conversation, the action waiting, the message box. */
function DockPanel({ dock, onFold }: { dock: Dock; onFold: () => void }) {
  const { t } = useTranslation();
  const shared = useSharedAssistantChat();
  if (shared === null) throw new Error("DockPanel needs an AssistantChatProvider");
  const { chat, attach } = shared;
  const navigate = useNavigate();
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  // The dialog of the composer replacing the message queued tells the error.
  const [replacing, setReplacing] = useState(false);
  const busy = chat.pending !== "";
  const answering = chat.pending === "turn" || chat.pending === "confirming";
  const time = dateTimeFormat({ hour: "2-digit", minute: "2-digit" });

  // The dock on display: the turns that end now are read, not left unread.
  useEffect(() => attach(), [attach]);

  // Opened, the focus goes into the dock, off the page under it. With a question,
  // the composer gives it to the message box once the question is in it. Without
  // one, the message box takes it when open, else the title of the dock while
  // the chat is read, then the box once it opens, unless the user moved it.
  // Open as the composer has it: no operation but a turn, the history read.
  const boxOpen = chat.historyReady && (chat.pending === "" || answering);
  const focusBox = useRef(false);
  useEffect(() => {
    if (shared.prompt !== null) return;
    if (boxOpen) {
      composer.current?.focus();
      return;
    }
    heading.current?.focus();
    focusBox.current = true;
    // On opening only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!focusBox.current || !boxOpen) return;
    focusBox.current = false;
    if (document.activeElement === heading.current) composer.current?.focus();
  }, [boxOpen]);

  // The latest message stays in sight.
  useLayoutEffect(() => {
    const element = log.current;
    if (element !== null) element.scrollTop = element.scrollHeight;
  }, [chat.messages]);

  // To the page of the assistant: a move, not an end. The dock folds, and its
  // button is there again on the other pages.
  function expand() {
    void navigate({ to: "/ai" });
    dock.fold();
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Escape") return;
    // The panel under the dock listens for Escape too: it stays open.
    event.stopPropagation();
    onFold();
  }

  const title =
    chat.conversation !== null && chat.conversation.title !== ""
      ? chat.conversation.title
      : t("assistant.title");

  return (
    <aside
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      style={PLACE}
      className="fixed right-4 z-(--z-dock) flex h-[min(36rem,calc(100dvh-7rem))] w-[26rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-(--radius-panel) border border-line bg-surface-raised shadow-xl max-sm:right-2 max-sm:left-2 max-sm:w-auto max-sm:max-w-none"
    >
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        <SparklesIcon className="h-4 w-4 shrink-0 text-accent" />
        <h2
          id={titleId}
          ref={heading}
          tabIndex={-1}
          className="min-w-0 flex-1 truncate font-semibold outline-none"
        >
          {title}
        </h2>
        <button
          type="button"
          aria-label={t("assistant.conversations.new")}
          title={t("assistant.conversations.new")}
          disabled={busy}
          onClick={chat.startConversation}
          className={ICON_BUTTON}
        >
          <PlusIcon className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label={t("assistant.dock.expand")}
          title={t("assistant.dock.expand")}
          onClick={expand}
          className={ICON_BUTTON}
        >
          <ExternalLinkIcon className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label={t("assistant.dock.fold")}
          title={t("assistant.dock.fold")}
          onClick={onFold}
          className={ICON_BUTTON}
        >
          <ChevronDownIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      <div
        ref={log}
        role="log"
        aria-label={t("assistant.transcript.log")}
        aria-live="polite"
        aria-relevant="additions text"
        aria-busy={answering}
        className="relative min-h-0 flex-1 overflow-y-auto"
      >
        {!chat.historyReady || chat.pending === "resuming" ? (
          <p className="p-3 text-ink-muted">{t("assistant.transcript.loadingSaved")}</p>
        ) : chat.messages.length === 0 ? (
          <p className="p-3 text-ink-muted">{t("assistant.dock.empty")}</p>
        ) : (
          <ol className="flex flex-col gap-3 px-3 py-3">
            {chat.messages.map((message, index) => {
              if (message.role === "user")
                return <UserMessage key={message.id} message={message} time={time} />;
              const next = chat.messages[index + 1];
              const rateable =
                message.status === "completed" &&
                message.turnId !== undefined &&
                !(next?.role === "assistant" && next.turnId === message.turnId);
              return <Answer key={message.id} message={message} chat={chat} rateable={rateable} />;
            })}
          </ol>
        )}
      </div>

      {/* The action waiting, named only: approving it takes the card of the page,
          with its arguments, its preview and its changes. It may be rejected here. */}
      {chat.confirmation !== null && (
        <div
          role="group"
          aria-label={t("assistant.dock.waitingLabel")}
          className="mx-2 mb-2 flex flex-col gap-2 rounded-(--radius-control) border border-state-warn bg-state-warn-soft p-2"
        >
          <p>
            {t("assistant.dock.waiting", {
              action: chat.confirmation.tool.title || chat.confirmation.tool.name,
            })}
            {chat.confirmation.tool.destructive && (
              <span className="ml-1 font-medium text-state-down">
                {t("assistant.dock.destructive")}
              </span>
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={expand} className={SMALL_BUTTON}>
              {t("assistant.dock.detail")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void chat.reject();
              }}
              className={SMALL_BUTTON}
            >
              {t("assistant.confirm.reject")}
            </button>
          </div>
        </div>
      )}
      {chat.error !== null && !replacing && (
        <p role="alert" className="mx-2 mb-2 text-state-down">
          ■ {errorText(t, chat.error)}
        </p>
      )}
      {chat.notice !== "" && (
        <p role="status" className="mx-2 mb-2 text-ink-muted">
          {t(`assistant.notice.${chat.notice}`)}
        </p>
      )}
      <Composer inputRef={composer} compact onReplacingChange={setReplacing} />
    </aside>
  );
}
