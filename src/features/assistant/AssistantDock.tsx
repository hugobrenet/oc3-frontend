import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
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
import { cn } from "@/lib/utils";

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
  // The notice the user closed: the next one shows.
  const [closed, setClosed] = useState<typeof notice>(null);
  if (closed !== null && notice !== closed) setClosed(null);
  const shown = notice !== null && notice !== closed ? notice : null;
  const close = () => {
    setClosed(notice);
    document.querySelector<HTMLElement>("[data-assistant-dock-button]")?.focus();
  };
  const style = shown !== null && wide ? noticePlace() : PLACE;
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

/**
 * Where the user moved the open dock in the window and the size they gave it: its
 * distances to the right of the window and above the bookmarks at its foot, its
 * width and its height, in pixels, null where it keeps its own. What the user
 * chose, kept as it is: a smaller window holds the dock within it for as long, and
 * gives it back after.
 */
const DOCK_GEOMETRY_KEY = "oc3.assistant.dock.geometry";
/** Where an older version kept the dock moved along the bottom: its distance to the right. */
const DOCK_RIGHT_KEY = "oc3.assistant.dock.right";
/** The margin of the dock to the edges of the window, as `right-4` and `PLACE`. */
const DOCK_MARGIN = 16;
/**
 * What the dock leaves above it, the top bar, as its height
 * `calc(100dvh - 7rem - var(--bookmarks-bar-height))` does, over the bookmarks.
 */
const DOCK_TOP = 96;
/** Its own width, `w-[26rem]`, and height, `h-[min(36rem,…)]`, in rem: they follow the font. */
const DOCK_WIDTH_REM = 26;
const DOCK_HEIGHT_REM = 36;
/** The smallest it is made. */
const DOCK_MIN_WIDTH = 320;
const DOCK_MIN_HEIGHT = 320;
/** Closer to an edge of the window than this, moved, it goes against it. */
const DOCK_SNAP = 24;
/** Less than this, a pointer pressed and released is a click: nothing moves. */
const DOCK_DRAG_THRESHOLD = 4;
/** The width of the notice of the folded dock, as `w-[24rem]`, and about its height. */
const NOTICE_WIDTH = 384;
const NOTICE_HEIGHT = 96;
/** A step of the arrows of the keyboard moving the dock, or sizing it. */
const DOCK_STEP = 32;
/** A window wide enough for the dock to move, as Tailwind's sm: narrower, it takes the width. */
const WIDE_QUERY = "(min-width: 40rem)";

interface Geometry {
  right: number | null;
  bottom: number | null;
  width: number | null;
  height: number | null;
}
type Shown = { [Key in keyof Geometry]: number };
interface Size {
  width: number;
  height: number;
}
type Side = "left" | "right" | "top" | "bottom";
type DragKind = "move" | readonly Side[];

const NO_GEOMETRY: Geometry = { right: null, bottom: null, width: null, height: null };

const length = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;

/** The geometry the browser keeps, that of an older version read as it. */
function readDockGeometry(): Geometry {
  try {
    const kept: unknown = JSON.parse(localStorage.getItem(DOCK_GEOMETRY_KEY) ?? "null");
    if (kept !== null && typeof kept === "object" && !Array.isArray(kept)) {
      const { right, bottom, width, height } = kept as Record<string, unknown>;
      return {
        right: length(right),
        bottom: length(bottom),
        width: length(width),
        height: length(height),
      };
    }
    const right = Number(localStorage.getItem(DOCK_RIGHT_KEY));
    return { ...NO_GEOMETRY, right: Number.isFinite(right) && right > DOCK_MARGIN ? right : null };
  } catch {
    return NO_GEOMETRY;
  }
}

function storeDockGeometry(geometry: Geometry) {
  try {
    localStorage.removeItem(DOCK_RIGHT_KEY);
    if (Object.values(geometry).every((value) => value === null))
      localStorage.removeItem(DOCK_GEOMETRY_KEY);
    else localStorage.setItem(DOCK_GEOMETRY_KEY, JSON.stringify(geometry));
  } catch {
    // Kept for this page only.
  }
}

/**
 * The height of the bookmarks at the foot of the page, which `BookmarksBar` keeps
 * in the style of the root element: read there, not computed again.
 */
function bookmarksHeight(): number {
  const value = parseFloat(
    document.documentElement.style.getPropertyValue("--bookmarks-bar-height"),
  );
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** The width the dock is placed in: the window but its scroll bar, as `right` counts. */
const roomWidth = () => document.documentElement.clientWidth || window.innerWidth;
/** The height the dock is placed in: the window but the bookmarks, which it stays above. */
const roomHeight = () => window.innerHeight - bookmarksHeight();

/** The size of a rem, as the browser sets the font. */
function remPixels(): number {
  const size = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(size) && size > 0 ? size : 16;
}

/**
 * The size the dock takes of its own in a room `height` high, above the bookmarks,
 * as its classes give it.
 */
function ownSize(height: number): Size {
  const rem = remPixels();
  return {
    width: DOCK_WIDTH_REM * rem,
    height: Math.min(DOCK_HEIGHT_REM * rem, height - DOCK_TOP - DOCK_MARGIN),
  };
}

/**
 * The room of the dock, a snapshot of its own: the window, less the bookmarks at
 * its foot, which the dock stays above. The dock follows it, the window resized or
 * the bookmarks of another height.
 */
function subscribeRoom(onChange: () => void) {
  window.addEventListener("resize", onChange);
  const bookmarks = new MutationObserver(onChange);
  bookmarks.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
  return () => {
    window.removeEventListener("resize", onChange);
    bookmarks.disconnect();
  };
}
const room = () => `${String(roomWidth())}x${String(roomHeight())}`;

/**
 * Where the dock shows in a room of `width` by `height`, above the bookmarks: what
 * the user chose, held within it, its own values for those they did not choose.
 */
function shownGeometry(geometry: Geometry, width: number, height: number, own: Size): Shown {
  const shownWidth = Math.min(
    Math.max(DOCK_MIN_WIDTH, width - 2 * DOCK_MARGIN),
    Math.max(DOCK_MIN_WIDTH, geometry.width ?? own.width),
  );
  const shownHeight = Math.min(
    Math.max(DOCK_MIN_HEIGHT, height - DOCK_TOP - DOCK_MARGIN),
    Math.max(DOCK_MIN_HEIGHT, geometry.height ?? own.height),
  );
  return {
    right: Math.max(
      DOCK_MARGIN,
      Math.min(geometry.right ?? DOCK_MARGIN, width - shownWidth - DOCK_MARGIN),
    ),
    bottom: Math.max(
      DOCK_MARGIN,
      Math.min(geometry.bottom ?? DOCK_MARGIN, height - shownHeight - DOCK_TOP),
    ),
    width: shownWidth,
    height: shownHeight,
  };
}

/** A distance moved close to an edge of the window, against it. */
function snap(value: number, far: number): number {
  if (value - DOCK_MARGIN < DOCK_SNAP) return DOCK_MARGIN;
  if (far - value < DOCK_SNAP) return far;
  return value;
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

/** Its bottom, above the bookmarks at the foot of the page. */
const above = (bottom: number) => `calc(var(--bookmarks-bar-height, 0px) + ${String(bottom)}px)`;

/** Where the notice of the folded dock shows: where the dock opens, its bottom right. */
function noticePlace(): CSSProperties {
  const geometry = readDockGeometry();
  const width = roomWidth();
  const height = roomHeight();
  const opens = shownGeometry(geometry, width, height, ownSize(height));
  const right =
    geometry.right !== null ? Math.min(opens.right, width - NOTICE_WIDTH - DOCK_MARGIN) : null;
  const bottom =
    geometry.bottom !== null ? Math.min(opens.bottom, height - NOTICE_HEIGHT - DOCK_TOP) : null;
  return {
    ...PLACE,
    ...(right !== null && right > DOCK_MARGIN ? { right } : {}),
    ...(bottom !== null && bottom > DOCK_MARGIN ? { bottom: above(bottom) } : {}),
  };
}

/**
 * The open dock moved anywhere in the window and sized, not to hide what the page
 * shows there: moved by its title bar or its handle, dragged, against an edge of
 * the window once close to it, never over the top bar nor the bookmarks; sized by
 * each of its edges and corners, the opposite ones staying; with the keyboard on
 * its handle, the arrows moving it, with Shift sizing it by its left and top edges,
 * Home putting it back. Its title bar double clicked puts it back too. Remembered by
 * the browser; held within the window. On a narrow window the dock takes its
 * width: it stays.
 */
function useDockGeometry() {
  const wide = useWide();
  const [chosen, setChosen] = useState(readDockGeometry);
  // Where it is while dragged, put once the pointer is released.
  const [dragged, setDragged] = useState<Shown | null>(null);
  // The drag going on: where it started, and where it was last followed, for an
  // end that carries no position.
  const drag = useRef<{
    kind: DragKind;
    pointerId: number;
    x: number;
    y: number;
    start: Shown;
    last: Shown | null;
  } | null>(null);
  const [width = 0, height = 0] = useSyncExternalStore(subscribeRoom, room).split("x").map(Number);
  const own = ownSize(height);
  const shown = dragged ?? shownGeometry(chosen, width, height, own);

  /** What the user chose from where the dock is put: its own values null again. */
  const chosenOf = (next: Shown): Geometry => ({
    right: next.right > DOCK_MARGIN ? next.right : null,
    bottom: next.bottom > DOCK_MARGIN ? next.bottom : null,
    width: Math.abs(next.width - own.width) < 1 ? null : next.width,
    height: Math.abs(next.height - own.height) < 1 ? null : next.height,
  });
  const place = (next: Geometry) => {
    setChosen(next);
    storeDockGeometry(next);
  };
  // An older version's place, read: kept under the key of this one.
  useEffect(() => {
    try {
      if (localStorage.getItem(DOCK_RIGHT_KEY) !== null) storeDockGeometry(chosen);
    } catch {
      // Read again next time.
    }
    // On opening only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** What a drag of `kind` from `start` gives, the pointer moved by dx, dy. */
  const follow = (kind: DragKind, start: Shown, dx: number, dy: number): Shown => {
    if (kind === "move") {
      const farRight = width - start.width - DOCK_MARGIN;
      const farBottom = height - start.height - DOCK_TOP;
      return {
        ...start,
        right: Math.max(DOCK_MARGIN, Math.min(snap(start.right - dx, farRight), farRight)),
        bottom: Math.max(DOCK_MARGIN, Math.min(snap(start.bottom - dy, farBottom), farBottom)),
      };
    }
    // Sized by an edge, the opposite one stays: no larger than the window leaves
    // on the side of the edge, no smaller than its smallest size.
    const next = { ...start };
    if (kind.includes("left"))
      next.width = Math.min(
        width - start.right - DOCK_MARGIN,
        Math.max(DOCK_MIN_WIDTH, start.width - dx),
      );
    if (kind.includes("right")) {
      next.right = Math.max(
        DOCK_MARGIN,
        Math.min(start.right - dx, start.right + start.width - DOCK_MIN_WIDTH),
      );
      next.width = start.width + start.right - next.right;
    }
    if (kind.includes("top"))
      next.height = Math.min(
        height - start.bottom - DOCK_TOP,
        Math.max(DOCK_MIN_HEIGHT, start.height - dy),
      );
    if (kind.includes("bottom")) {
      next.bottom = Math.max(
        DOCK_MARGIN,
        Math.min(start.bottom - dy, start.bottom + start.height - DOCK_MIN_HEIGHT),
      );
      next.height = start.height + start.bottom - next.bottom;
    }
    return next;
  };

  /**
   * The drag ends: put where it was dragged, a plain click changing nothing. Only
   * a release tells where; a drag cancelled or a capture lost ends where it was
   * last followed.
   */
  const end = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (current === null || current.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.type !== "lostpointercapture")
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (current.last === null) return;
    setDragged(null);
    place(
      chosenOf(
        event.type === "pointerup"
          ? follow(
              current.kind,
              current.start,
              event.clientX - current.x,
              event.clientY - current.y,
            )
          : current.last,
      ),
    );
  };
  /** The handlers of an element dragged as `kind`: the title bar moving, an edge sizing. */
  const dragHandlers = (kind: DragKind) => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0 || drag.current !== null) return;
      const target = event.target instanceof Element ? event.target : null;
      if (kind === "move" && target?.closest("button:not([data-dock-handle])")) return;
      // No text selected in the page under the pointer while dragging; the handle
      // pressed takes the focus all the same, for its arrows.
      event.preventDefault();
      target?.closest<HTMLElement>("[data-dock-handle]")?.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture?.(event.pointerId);
      drag.current = {
        kind,
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        start: shown,
        last: null,
      };
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const current = drag.current;
      if (current === null || current.pointerId !== event.pointerId) return;
      const dx = event.clientX - current.x;
      const dy = event.clientY - current.y;
      if (
        current.last === null &&
        Math.abs(dx) < DOCK_DRAG_THRESHOLD &&
        Math.abs(dy) < DOCK_DRAG_THRESHOLD
      )
        return;
      current.last = follow(current.kind, current.start, dx, dy);
      setDragged(current.last);
    },
    onPointerUp: end,
    onPointerCancel: end,
    onLostPointerCapture: end,
  });

  const reset = () => {
    place(NO_GEOMETRY);
  };
  const onDoubleClick = (event: MouseEvent<HTMLElement>) => {
    if (event.target instanceof Element && event.target.closest("button:not([data-dock-handle])"))
      return;
    reset();
  };
  const steps: Record<string, readonly [number, number]> = {
    ArrowLeft: [DOCK_STEP, 0],
    ArrowRight: [-DOCK_STEP, 0],
    ArrowUp: [0, DOCK_STEP],
    ArrowDown: [0, -DOCK_STEP],
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    // With another modifier than Shift, the keys are the browser's, such as Alt+Left.
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Home") {
      reset();
      event.preventDefault();
      return;
    }
    const step = steps[event.key];
    if (step === undefined) return;
    const [x, y] = step;
    place(
      chosenOf(
        event.shiftKey ? follow(["left", "top"], shown, -x, -y) : follow("move", shown, -x, -y),
      ),
    );
    event.preventDefault();
  };

  let style: CSSProperties = PLACE;
  if (wide && dragged !== null)
    style = {
      right: shown.right,
      bottom: above(shown.bottom),
      width: shown.width,
      height: shown.height,
    };
  else if (wide) {
    // Its own values left to its classes: the height follows the window.
    style = {
      ...PLACE,
      ...(chosen.right !== null ? { right: shown.right } : {}),
      ...(chosen.bottom !== null ? { bottom: above(shown.bottom) } : {}),
      ...(chosen.width !== null ? { width: shown.width } : {}),
      ...(chosen.height !== null ? { height: shown.height } : {}),
    };
  }
  return {
    movable: wide,
    dragging: dragged !== null,
    style,
    bar: { ...dragHandlers("move"), onDoubleClick },
    edge: dragHandlers,
    onKeyDown,
  };
}

/** The edges and corners that size the dock, the sides each moves, and where they lie. */
const DOCK_EDGES: readonly { edge: string; sides: readonly Side[]; className: string }[] = [
  { edge: "left", sides: ["left"], className: "top-3.5 bottom-3.5 left-0 w-2 cursor-ew-resize" },
  { edge: "right", sides: ["right"], className: "top-3.5 right-0 bottom-3.5 w-2 cursor-ew-resize" },
  { edge: "top", sides: ["top"], className: "top-0 right-3.5 left-3.5 h-1.5 cursor-ns-resize" },
  {
    edge: "bottom",
    sides: ["bottom"],
    className: "right-3.5 bottom-0 left-3.5 h-1.5 cursor-ns-resize",
  },
  {
    edge: "top-left",
    sides: ["left", "top"],
    className: "top-0 left-0 h-3.5 w-3.5 cursor-nwse-resize",
  },
  {
    edge: "top-right",
    sides: ["right", "top"],
    className: "top-0 right-0 h-3.5 w-3.5 cursor-nesw-resize",
  },
  {
    edge: "bottom-left",
    sides: ["left", "bottom"],
    className: "bottom-0 left-0 h-2 w-2 cursor-nesw-resize",
  },
  {
    edge: "bottom-right",
    sides: ["right", "bottom"],
    className: "right-0 bottom-0 h-2 w-2 cursor-nwse-resize",
  },
];

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
  const placement = useDockGeometry();
  const moveHelpId = useId();
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
      data-assistant-dock=""
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      style={placement.style}
      className={cn(
        "fixed right-4 z-(--z-dock) flex h-[min(36rem,calc(100dvh_-_7rem_-_var(--bookmarks-bar-height,0px)))] w-[26rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-(--radius-panel) border border-line bg-surface-raised shadow-xl max-sm:right-2 max-sm:left-2 max-sm:w-auto max-sm:max-w-none",
        placement.dragging && "select-none",
      )}
    >
      {/* Each edge and each corner size it, the opposite ones staying. */}
      {placement.movable &&
        DOCK_EDGES.map(({ edge, sides, className }) => (
          <div
            key={edge}
            aria-hidden="true"
            data-dock-edge={edge}
            {...placement.edge(sides)}
            className={cn("absolute z-10 touch-none", className)}
          />
        ))}
      <div
        {...(placement.movable ? placement.bar : {})}
        className={cn(
          "flex items-center gap-1 border-b border-line px-2 py-1.5",
          placement.movable && "cursor-grab touch-none pl-3.5",
          placement.dragging && "cursor-grabbing",
        )}
      >
        {placement.movable && (
          <>
            <button
              type="button"
              data-dock-handle=""
              aria-label={t("assistant.dock.move")}
              aria-describedby={moveHelpId}
              title={t("assistant.dock.moveHelp")}
              onKeyDown={placement.onKeyDown}
              className={`${ICON_BUTTON} w-5 cursor-grab active:cursor-grabbing`}
            >
              <GripIcon className="h-3.5 w-3.5" />
            </button>
            <span id={moveHelpId} hidden>
              {t("assistant.dock.moveHelp")}
            </span>
          </>
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
