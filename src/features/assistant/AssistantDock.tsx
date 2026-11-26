import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import { useStickToBottom } from "./use-stick-to-bottom";
import { useMatchRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  ChevronDownIcon,
  CloseIcon,
  ExternalLinkIcon,
  GripIcon,
  PlusIcon,
  SparklesIcon,
} from "@/components/ui/icons";
import { typing, useShortcut } from "@/lib/shortcuts";
import { Answer, UserMessage } from "./Assistant";
import {
  useAssistantActivity,
  useAssistantDock,
  useSharedAssistantChat,
  type AssistantDock as Dock,
} from "./assistant-chat";
import { useAssistantStatus } from "./assistant-status";
import { Composer } from "./Composer";
import { ConfirmationCard } from "./ConfirmationCard";
import { useToolDocs } from "./use-tool-docs";
import { Modal } from "@/components/ui/Modal";
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
 * The dock of the assistant: the chat over the page on display, asked about what
 * the page shows (`interface-context.ts`) without leaving it, or opened by
 * "Analyze with the assistant" on an alert or a failed action. It shows the
 * conversation of the page of the assistant, from the same chat: "Expand" goes to
 * that page, the conversation and the message typed kept.
 *
 * It opens from a small button of the top bar, beside the user
 * (`AssistantDockButton`), or with the key a. Hidden on the page of the
 * assistant, which shows the chat already, and to a user who cannot use the
 * assistant.
 */
export function AssistantDock() {
  const dock = useAssistantDock();
  const shared = useSharedAssistantChat();
  const matchRoute = useMatchRoute();
  const onPage = matchRoute({ to: "/ai" }) !== false;
  const status = useAssistantStatus();
  // Once the dock folds, however it does (Escape, Fold, its button, the key a),
  // the focus goes back to what opened it (`origin`): the link, or what had the
  // focus when the key a opened it, such as a row. Not when the user put the focus
  // elsewhere meanwhile; never to the button of the top bar, not ringed for it.
  const wasOpen = useRef(false);
  useEffect(() => {
    const open = dock?.state === "open";
    if (wasOpen.current && !open) {
      const target = dock?.origin() ?? null;
      const active = document.activeElement;
      const left =
        active === null ||
        active === document.body ||
        active.closest("[data-assistant-dock-button]") !== null;
      if (target !== null && left) target.focus();
    }
    wasOpen.current = open;
  }, [dock]);

  if (dock === null || shared === null || onPage) return null;
  if (status.data?.available !== true) return null;
  if (dock.state === "folded") return <ActivityNotice onOpen={dock.open} />;
  return <DockPanel dock={dock} onFold={dock.fold} />;
}

/** What the assistant does meanwhile, the most pressing first. */
function activityState(activity: ReturnType<typeof useAssistantActivity>) {
  if (activity === null) return null;
  if (activity.waiting) return "waiting";
  if (activity.answering) return "answering";
  if (activity.ended) return activity.failed ? "failed" : "ended";
  return null;
}

/**
 * What the folded dock tells once a turn ended out of sight, or an action began
 * to wait there for the decision of the user (`activity.notice`): a notice where
 * the dock opens, moved with it, which opens it on the answer or the action, or
 * goes, closed by its button or Escape, the focus then on the button of the
 * dock. A view shows the chat, and it goes by itself; the menu and the button of
 * the dock still tell it until the chat is seen. It takes no focus; its words
 * are told by a region always there, to be announced.
 */
export function ActivityNotice({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation();
  const notice = useAssistantActivity()?.notice ?? null;
  const wide = useWide();
  const right = readDockRight();
  // The notice the user closed: the next one shows.
  const [closed, setClosed] = useState<typeof notice>(null);
  if (closed !== null && notice !== closed) setClosed(null);
  const shown = notice !== null && notice !== closed ? notice : null;
  const close = () => {
    setClosed(notice);
    document.querySelector<HTMLElement>("[data-assistant-dock-button]")?.focus();
  };
  // Where the dock was moved, kept within a window narrower since.
  const kept =
    right === null ? null : Math.min(right, window.innerWidth - NOTICE_WIDTH - DOCK_MARGIN);
  const style: CSSProperties =
    wide && kept !== null && kept > DOCK_MARGIN ? { ...PLACE, right: kept } : PLACE;
  // The dock opens from its button: the notice that opened it goes with it.
  const open = () => {
    document.querySelector<HTMLElement>("[data-assistant-dock-button]")?.focus();
    onOpen();
  };
  return (
    <>
      <p role="status" className="sr-only">
        {shown !== null ? t(`assistant.endNotice.${shown}`) : ""}
      </p>
      {shown !== null && (
        <div
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.stopPropagation();
            close();
          }}
          style={style}
          className={`fixed right-4 z-(--z-dock) flex w-[24rem] max-w-[calc(100vw-2rem)] items-start gap-2 rounded-(--radius-panel) border bg-surface-raised p-3 shadow-xl max-sm:right-2 ${
            shown === "waiting"
              ? "border-state-warn"
              : shown === "failed"
                ? "border-state-down"
                : "border-line"
          }`}
        >
          <SparklesIcon className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
            <p aria-hidden="true">{t(`assistant.endNotice.${shown}`)}</p>
            <button type="button" onClick={open} className={SMALL_BUTTON}>
              {t(shown === "waiting" ? "assistant.endNotice.seeAction" : "assistant.endNotice.see")}
            </button>
          </div>
          <button
            type="button"
            aria-label={t("assistant.endNotice.dismiss")}
            title={t("assistant.endNotice.dismiss")}
            onClick={close}
            className={ICON_BUTTON}
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </>
  );
}

/**
 * The button of the dock in the top bar, beside the user: it opens the dock, or
 * folds it, and tells what the assistant does meanwhile. None where oc3 names no
 * agent; greyed where the dock is not, its title saying why: on the page of the
 * assistant, or while the user cannot use it, such as after a password sign-in.
 * The key a does what it does, as p for the detail panel, while it can.
 */
export function AssistantDockButton() {
  const { t } = useTranslation();
  const dock = useAssistantDock();
  const shared = useSharedAssistantChat();
  const matchRoute = useMatchRoute();
  const onPage = matchRoute({ to: "/ai" }) !== false;
  const status = useAssistantStatus();
  const state = activityState(useAssistantActivity());
  const usable = dock !== null && shared !== null && status.data?.available === true && !onPage;
  const open = usable && dock.state === "open";
  // Where the button cannot act, the key is left to the others.
  useShortcut("a", () => {
    if (!usable) return false;
    if (open) dock.fold();
    else dock.open();
    return true;
  });
  if (dock === null || shared === null || status.data?.enabled !== true) return null;
  const action = t(open ? "assistant.dock.foldAssistant" : "assistant.dock.open");
  const label = !usable
    ? t(onPage ? "assistant.dock.onPage" : "assistant.dock.unavailable")
    : state === null
      ? action
      : `${action} · ${t(`assistant.activity.${state}`)}`;
  return (
    <button
      type="button"
      data-assistant-dock-button=""
      aria-label={label}
      aria-expanded={open}
      title={label}
      disabled={!usable}
      onClick={open ? dock.fold : dock.open}
      className={`relative flex h-7 w-7 items-center justify-center rounded-(--radius-control) text-accent ${
        usable ? "hover:bg-surface-sunken" : "cursor-default opacity-70"
      } ${open ? "bg-surface-sunken" : ""}`}
    >
      <SparklesIcon className="h-4 w-4" />
      {usable && state !== null && (
        <span
          aria-hidden="true"
          data-testid="dock-activity"
          className={`absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface-raised ${
            state === "waiting"
              ? "bg-state-warn"
              : state === "failed"
                ? "bg-state-down"
                : state === "answering"
                  ? "animate-pulse bg-accent"
                  : "bg-accent"
          }`}
        />
      )}
    </button>
  );
}

/** Where the user moved the open dock: its distance to the right of the window, in pixels. */
const DOCK_RIGHT_KEY = "oc3.assistant.dock.right";
/** The margin of the dock to the edges of the window, as `right-4`. */
const DOCK_MARGIN = 16;
/** The width of the notice of the folded dock, as `w-[24rem]`. */
const NOTICE_WIDTH = 384;
/** A step of the arrows of the keyboard moving the dock. */
const DOCK_STEP = 32;
/** A window wide enough for the dock to move, as Tailwind's sm: narrower, it takes the width. */
const WIDE_QUERY = "(min-width: 40rem)";

function readDockRight(): number | null {
  try {
    const value = Number(localStorage.getItem(DOCK_RIGHT_KEY));
    return Number.isFinite(value) && value > DOCK_MARGIN ? value : null;
  } catch {
    return null;
  }
}

function storeDockRight(value: number | null) {
  try {
    if (value === null) localStorage.removeItem(DOCK_RIGHT_KEY);
    else localStorage.setItem(DOCK_RIGHT_KEY, String(value));
  } catch {
    // Kept for this page only.
  }
}

function subscribeWide(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const list = window.matchMedia(WIDE_QUERY);
  list.addEventListener("change", onChange);
  return () => {
    list.removeEventListener("change", onChange);
  };
}

const isWide = () =>
  typeof window.matchMedia === "function" && window.matchMedia(WIDE_QUERY).matches;

function useWide(): boolean {
  return useSyncExternalStore(subscribeWide, isWide);
}

/**
 * The open dock moved along the bottom of the window, to the left or back, not to
 * hide what the page shows there: by its handle, dragged, or with the arrows of
 * the keyboard, Home taking it back to the right. Remembered by the browser; held
 * within the window. On a narrow window the dock takes its width: it stays.
 */
function useDockPlace(panel: RefObject<HTMLElement | null>) {
  const wide = useWide();
  const [right, setRight] = useState(readDockRight);
  const clamp = useCallback(
    (value: number) => {
      const width = panel.current?.offsetWidth ?? 0;
      return Math.max(DOCK_MARGIN, Math.min(value, window.innerWidth - width - DOCK_MARGIN));
    },
    [panel],
  );
  const place = useCallback(
    (value: number | null) => {
      const next = value === null ? null : clamp(value);
      const kept = next !== null && next > DOCK_MARGIN ? next : null;
      setRight(kept);
      storeDockRight(kept);
    },
    [clamp],
  );
  // A window made narrower keeps the dock in it, and remembers where: before the
  // dock is painted, so that it never shows out of the window. A narrow window,
  // where the dock takes its width, keeps the place it had on a wide one.
  const current = useRef(right);
  current.current = right;
  useLayoutEffect(() => {
    const keep = () => {
      if (!isWide() || current.current === null) return;
      const next = clamp(current.current);
      const kept = next > DOCK_MARGIN ? next : null;
      if (kept === current.current) return;
      current.current = kept;
      setRight(kept);
      storeDockRight(kept);
    };
    keep();
    window.addEventListener("resize", keep);
    return () => {
      window.removeEventListener("resize", keep);
    };
  }, [clamp]);

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const startX = event.clientX;
    const start = right ?? DOCK_MARGIN;
    const at = (clientX: number) => start - (clientX - startX);
    handle.setPointerCapture?.(event.pointerId);
    // Where the pointer was last: a capture lost without a release, such as to
    // another window, ends the move there.
    let lastX = startX;
    const move = (next: globalThis.PointerEvent) => {
      lastX = next.clientX;
      setRight(clamp(at(lastX)));
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", release);
      handle.removeEventListener("pointercancel", end);
      handle.removeEventListener("lostpointercapture", end);
      place(at(lastX));
    };
    const release = (last: globalThis.PointerEvent) => {
      lastX = last.clientX;
      end();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", release);
    handle.addEventListener("pointercancel", end);
    handle.addEventListener("lostpointercapture", end);
  }
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const from = right ?? DOCK_MARGIN;
    if (event.key === "ArrowLeft") place(from + DOCK_STEP);
    else if (event.key === "ArrowRight") place(from - DOCK_STEP);
    else if (event.key === "Home") place(null);
    else return;
    event.preventDefault();
  }
  const style: CSSProperties = wide && right !== null ? { ...PLACE, right } : PLACE;
  return { movable: wide, style, onPointerDown, onKeyDown };
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
  const panel = useRef<HTMLElement>(null);
  const placement = useDockPlace(panel);
  // The action waiting, decided in a window over the page with the card of the
  // page of the assistant: its arguments, its preview, its form. The page stays
  // in sight, such as a list whose rows the action changes.
  const [deciding, setDeciding] = useState(false);
  const toolDocs = useToolDocs(shared.client, deciding && chat.confirmation !== null);
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

  // The latest message in sight while the user reads it, not once they went up.
  const onLogScroll = useStickToBottom(log, {
    messages: chat.messages,
    conversationId: chat.conversation?.id ?? null,
  });

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

  // Escape with the focus on the page folds the dock too, once nothing above it
  // takes the key: an open panel or dialog closes first, such as the one of the
  // Designer; the left-hand menu, a menu, a list or a field keep it.
  const fold = useRef(onFold);
  fold.current = onFold;
  useEffect(() => {
    function onPageKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target instanceof Element ? event.target : null;
      if (panel.current?.contains(target) === true || typing(target)) return;
      // The left-hand menu takes Escape to give the focus back to the page.
      if (target?.closest('#app-sidebar, [role="menu"], [role="listbox"], details[open]')) return;
      if (
        document.querySelector(
          '[aria-modal="true"], [role="dialog"]:not([inert]), [role="alertdialog"]:not([inert])',
        ) !== null
      )
        return;
      fold.current();
    }
    document.addEventListener("keydown", onPageKeyDown);
    return () => {
      document.removeEventListener("keydown", onPageKeyDown);
    };
  }, []);

  const title =
    chat.conversation !== null && chat.conversation.title !== ""
      ? chat.conversation.title
      : t("assistant.title");

  return (
    <aside
      ref={panel}
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      style={placement.style}
      className="fixed right-4 z-(--z-dock) flex h-[min(36rem,calc(100dvh-7rem))] w-[26rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-(--radius-panel) border border-line bg-surface-raised shadow-xl max-sm:right-2 max-sm:left-2 max-sm:w-auto max-sm:max-w-none"
    >
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        {placement.movable && (
          <button
            type="button"
            aria-label={t("assistant.dock.move")}
            title={t("assistant.dock.move")}
            onPointerDown={placement.onPointerDown}
            onKeyDown={placement.onKeyDown}
            className={`${ICON_BUTTON} -ml-1 w-5 cursor-grab touch-none active:cursor-grabbing`}
          >
            <GripIcon className="h-3.5 w-3.5" />
          </button>
        )}
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
        onScroll={onLogScroll}
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

      {/* The action waiting, named here: approving it takes the card of the page,
          with its arguments, its preview and its changes, in a window over the
          page, which stays in sight. It may be rejected here. */}
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
            <button
              type="button"
              onClick={() => {
                setDeciding(true);
              }}
              className={SMALL_BUTTON}
            >
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
      {deciding && chat.confirmation !== null && (
        <Modal
          title={t("assistant.dock.decideTitle", {
            action: chat.confirmation.tool.title || chat.confirmation.tool.name,
          })}
          closeLabel={t("detail.close")}
          onClose={() => {
            setDeciding(false);
          }}
        >
          <ConfirmationCard
            // A new confirmation, such as a preview asked again, takes a card of its own.
            key={chat.confirmation.id}
            confirmation={chat.confirmation}
            doc={toolDocs?.get(chat.confirmation.tool.name)}
            busy={busy}
            previewing={chat.pending === "previewing"}
            queued={chat.queued !== null}
            onApprove={(editedArgs) => {
              void chat.approve(editedArgs);
            }}
            onReject={() => {
              void chat.reject();
            }}
            onPreview={(editedArgs) => {
              void chat.previewAgain(editedArgs);
            }}
          />
        </Modal>
      )}
    </aside>
  );
}
