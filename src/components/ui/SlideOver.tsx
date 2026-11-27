import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { CloseIcon, PanelSideIcon } from "./icons";
import { usePanelSide } from "./panel-side";
import { DirtyFormsContext } from "./use-report-dirty";
import { RESIZE_VISIBLE, RESIZED_WIDTH, ROOM_BESIDE } from "./slide-over-layout";
import { useShortcut } from "@/lib/shortcuts";
import { panelOpened } from "./slide-over-open";
import { leaveWidth, takeOverWidth } from "./slide-over-resize";
import {
  contentFloor,
  DEFAULT_WIDTH,
  MIN_WIDTH,
  PANEL_MIN_WIDTH_ATTR,
  setPanelWidth,
  usePanelWidth,
  widthToFit,
} from "./slide-over-width";
import { MODAL_BACKDROP } from "./Modal";

/**
 * Side panel sliding in from an edge of the window: the right one, or the left one
 * when the shell says so (`PanelSideContext`), the panel then mirrored — its handle
 * on its right edge. The shell may also give the
 * button, in the header, that moves every panel to the other edge.
 *
 * Not modal: the table stays readable and usable while it is open. It stays mounted
 * at all times so that entering and leaving are animated; closed, `inert` takes it
 * out of the keyboard path and away from assistive technologies. The animation is
 * neutralised by the global prefers-reduced-motion rule.
 */
/**
 * What answers a click and therefore must not close the panel: controls and fields,
 * anything carrying a role or a keyboard shortcut, and tables, whose rows open their
 * own panel; and the dock of the assistant floating over the page
 * (`data-assistant-dock`), moved, sized or read, the record under it staying open.
 */
const INTERACTIVE =
  'a, button, input, select, textarea, label, summary, details, table, [role="dialog"], [role="button"], [role="menu"], [role="menuitem"], [role="tab"], [role="listbox"], [role="option"], [role="combobox"], [tabindex], [data-assistant-dock]';

/** Pixels an arrow key moves the left edge by. */
const KEY_STEP = 32;

/**
 * Wait before measuring whether the content fits: past the easing of the width
 * from the previous panel (`slide-over-resize.ts`), and once a burst of changes to
 * the content has settled.
 */
const FIT_DELAY_MS = 300;

/** Maximum widths, written out in full: Tailwind does not see names built at runtime. */
const SIZES = { default: "max-w-xl", wide: "max-w-3xl", wider: "max-w-4xl" } as const;

export function SlideOver({
  open,
  title,
  onClose,
  closeLabel,
  leading,
  subheader,
  size = "default",
  closeOnOutsideClick = true,
  actions,
  heading,
  reopenable = false,
  resizeLabel,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  closeLabel: string;
  /** Visual placed before the title, for example the object kind icon. */
  leading?: ReactNode;
  /** Strip fixed under the title, outside the scroll: tabs, for instance. */
  subheader?: ReactNode;
  /**
   * Width of the drawer: "wide" for content made of lists rather than properties,
   * "wider" for a drawer whose tab bar lists many kinds of related data.
   */
  size?: "default" | "wide" | "wider";
  /**
   * Whether a click beside the drawer closes it. A drawer holding a form closes on
   * it unless the form holds an entry not saved yet, which the click would drop:
   * the drawer passes `!unsaved`, or the form, deeper, tells it with
   * `useReportDirty`. Creating or editing, an untouched form closes like the others.
   */
  closeOnOutsideClick?: boolean;
  /** Buttons of the header, before the close button: the bookmark button, say. */
  actions?: ReactNode;
  /**
   * Content of the header in place of `leading` and the plain title, when the title
   * says more than a name. It must hold the panel's heading; `title` still names
   * the dialog.
   */
  heading?: ReactNode;
  /**
   * A record panel, which the "p" key reopens (`PanelAnchor`) and puts away: a form
   * being filled is not closed by a stray key.
   */
  reopenable?: boolean;
  /**
   * Name of the handle on the inner edge — the left one of a panel on the right —
   * which makes the panel resizable: dragged
   * with the mouse, or moved with the arrow keys once focused; a double-click, or
   * Enter, gives the default width back. The handle is the left edge of the whole
   * panel. It does not get narrower than its content
   * allows without a horizontal scrollbar (`contentFloor`). The width is kept for every panel of the
   * same `size` (`slide-over-width.ts`). Without a name, no handle.
   */
  resizeLabel?: string;
  children: ReactNode;
}) {
  const { side, switchSide, switchLabel } = usePanelSide();
  const left = side === "left";
  const panel = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const mounted = useRef(false);
  const chosen = usePanelWidth(size);
  // The width the content of the record on display asked for, when wider than the
  // width chosen or the default one: not kept, and forgotten with the record.
  const record = `${String(open)}:${title}`;
  const [fit, setFit] = useState<{ record: string; width: number } | null>(null);
  const fitted = fit?.record === record ? fit.width : undefined;
  const width = fitted === undefined ? chosen : Math.max(chosen ?? DEFAULT_WIDTH[size], fitted);
  // While the edge is dragged: the narrowest the content allows, measured once as
  // the drag starts.
  const dragFloor = useRef<number | null>(null);
  // The forms of the panel holding an entry not saved yet (`useReportDirty`): a
  // click beside the panel would drop it, so it does not close it.
  const [dirtyForms, setDirtyForms] = useState<ReadonlySet<symbol>>(() => new Set());
  const reportDirty = useCallback((form: symbol, dirty: boolean) => {
    setDirtyForms((previous) => {
      if (previous.has(form) === dirty) return previous;
      const next = new Set(previous);
      if (dirty) next.add(form);
      else next.delete(form);
      return next;
    });
  }, []);
  const closesOnOutsideClick = closeOnOutsideClick && dirtyForms.size === 0;

  /** The edge follows the pointer: the panel is anchored to its edge of the window. */
  function onHandlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragFloor.current === null) return;
    const reach = left ? event.clientX : window.innerWidth - event.clientX;
    setPanelWidth(size, reach, false, dragFloor.current);
  }

  function onHandlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    // No text selection in the page under the pointer while dragging.
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragFloor.current = main.current === null ? MIN_WIDTH : contentFloor(main.current);
    takeOverFit();
  }

  function onHandlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragFloor.current === null) return;
    dragFloor.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    // Kept only if the pointer moved: a plain click on the edge changes nothing.
    if (chosen !== undefined) setPanelWidth(size, chosen);
  }

  /**
   * The user takes the width in hand: the one the content asked for becomes the
   * width chosen, from which the edge moves, and no longer holds the panel open.
   */
  function takeOverFit() {
    if (fitted === undefined || width === undefined) return;
    setPanelWidth(size, width, false);
    setFit(null);
  }

  function onHandleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      setFit(null);
      setPanelWidth(size, undefined);
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const element = main.current;
    if (element === null) return;
    const current = element.getBoundingClientRect().width;
    // The arrow pointing away from the panel's edge of the window widens it.
    const widens = event.key === (left ? "ArrowRight" : "ArrowLeft");
    setPanelWidth(size, current + (widens ? KEY_STEP : -KEY_STEP), true, contentFloor(element));
    setFit(null);
  }

  // Widens the panel when its content does not fit: a width chosen on a
  // record with little to show would otherwise squeeze the next one. Measured once
  // the panel has settled, then each time its content changes — data arriving,
  // another tab. The panel only grows while the same record is on display: it does
  // not shrink back under a tab with less to show.
  useEffect(() => {
    const zone = main.current;
    if (!open || resizeLabel === undefined || zone === null) return;
    let timer: number | undefined;
    const measure = () => {
      const needed = widthToFit(zone);
      if (needed === null) return;
      setFit((previous) =>
        previous?.record === record && previous.width >= needed
          ? previous
          : { record, width: needed },
      );
    };
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(measure, FIT_DELAY_MS);
    };
    schedule();
    const observer = new MutationObserver(schedule);
    // The widths an element declares (`PANEL_MIN_WIDTH_ATTR`) as well as the content.
    observer.observe(zone, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [PANEL_MIN_WIDTH_ATTR],
    });
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [open, record, resizeLabel]);

  // A panel mounted open in place of another of a different width eases from that
  // width to its own (`slide-over-resize.ts`); a panel that closes leaves its width.
  useLayoutEffect(() => {
    const element = panel.current;
    const onMount = !mounted.current;
    mounted.current = true;
    if (!open || element === null) return;
    if (onMount) takeOverWidth(element);
    return () => {
      leaveWidth(element);
    };
  }, [open]);

  // "p" opens the record panel from the keyboard (`PanelAnchor`) and puts it away again.
  useShortcut("p", () => {
    if (!open || !reopenable) return false;
    onClose();
    return true;
  });

  // Counted among the open panels, for what only shows when none is.
  useEffect(() => (open ? panelOpened() : undefined), [open]);

  useEffect(() => {
    if (open) {
      // Remembers the triggering element to give it the focus back on closing.
      opener.current = document.activeElement;
      panel.current?.focus();
      return;
    }
    if (opener.current instanceof HTMLElement && document.contains(opener.current)) {
      opener.current.focus();
      opener.current = null;
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  // Clicking beside it closes, as one puts down a record just read. Only inert
  // backgrounds count: a click on a control or on a list row does what it says, and
  // closing on top of that would feel like having missed the target.
  useEffect(() => {
    if (!open || !closesOnOutsideClick) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (panel.current?.contains(target) === true) return;
      if (target.closest(INTERACTIVE) !== null) return;
      // The backdrop of a modal opened from the panel closes the modal only.
      if (target.closest(MODAL_BACKDROP) !== null) return;
      // An entry in progress in the panel — an attribute being edited — counts as a
      // form: it is not cleared by a click beside it.
      const focused = document.activeElement;
      if (
        focused instanceof HTMLElement &&
        panel.current?.contains(focused) === true &&
        focused.matches("input, select, textarea")
      )
        return;
      onClose();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, onClose, closesOnOutsideClick]);

  return (
    <div
      ref={panel}
      role="dialog"
      aria-label={title}
      aria-modal="false"
      tabIndex={-1}
      inert={!open}
      style={
        width === undefined
          ? undefined
          : ({ "--panel-width": `${String(width)}px` } as CSSProperties)
      }
      // As wide as its content, within the window; below the top bar on screen
      // (`--app-top`, kept by the shell), the whole height without one. It takes
      // the focus on opening, for the keyboard to go on in it, without the ring:
      // the panel showing is what tells it, the controls in it keep theirs.
      className={`fixed top-[var(--app-top,0px)] bottom-0 z-10 flex max-w-full border-line bg-surface-raised shadow-lg transition-transform duration-200 ease-out outline-none ${
        left ? "left-0 border-r" : "right-0 border-l"
      } ${open ? "translate-x-0" : left ? "-translate-x-full" : "translate-x-full"}`}
    >
      <div
        ref={main}
        className={`flex w-screen min-w-0 ${SIZES[size]} ${
          width === undefined ? "" : RESIZED_WIDTH[size]
        } flex-col`}
      >
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          {heading ?? (
            <>
              {leading}
              <h2 className="truncate text-title font-semibold">{title}</h2>
            </>
          )}
          <div className="ml-auto flex items-center gap-2">{actions}</div>
          {switchSide !== undefined && switchLabel !== undefined && (
            // Where the panel leaves room beside it: a narrower window fills with it.
            <button
              type="button"
              onClick={switchSide}
              title={switchLabel}
              className={`h-7 w-7 items-center justify-center rounded-(--radius-control) border border-line text-ink-muted hover:text-ink ${ROOM_BESIDE[size]}`}
            >
              <PanelSideIcon side={left ? "right" : "left"} />
              <span className="sr-only">{switchLabel}</span>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            title={closeLabel}
            className="flex h-7 w-7 items-center justify-center rounded-(--radius-control) border border-line text-ink-muted hover:text-ink"
          >
            <CloseIcon />
            <span className="sr-only">{closeLabel}</span>
          </button>
        </div>
        {subheader}
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <DirtyFormsContext.Provider value={reportDirty}>{children}</DirtyFormsContext.Provider>
        </div>
      </div>
      {open && resizeLabel !== undefined && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={resizeLabel}
          aria-valuenow={width ?? DEFAULT_WIDTH[size]}
          aria-valuemin={MIN_WIDTH}
          title={resizeLabel}
          tabIndex={0}
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          onPointerCancel={onHandlePointerUp}
          onDoubleClick={() => {
            setFit(null);
            setPanelWidth(size, undefined);
          }}
          onKeyDown={onHandleKeyDown}
          className={`absolute inset-y-0 z-10 w-2 cursor-col-resize ${
            left ? "right-0 translate-x-1/2" : "left-0 -translate-x-1/2"
          } touch-none outline-none hover:bg-accent/40 focus-visible:bg-accent/40 active:bg-accent/60 ${RESIZE_VISIBLE[size]}`}
        />
      )}
    </div>
  );
}
