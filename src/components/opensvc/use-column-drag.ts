import { useRef, useState, type MouseEvent, type PointerEvent } from "react";

/** Where a dragged column would go: before or after another one. */
export interface ColumnDropTarget {
  prop: string;
  after: boolean;
}

/** A column being dragged, and where it would land if dropped now. */
export interface ColumnDragState {
  prop: string;
  target?: ColumnDropTarget;
}

/** The distance, in pixels, a press must travel before it becomes a drag. */
const DRAG_THRESHOLD = 5;

/** The attribute naming the column of a draggable element. */
const DRAG_ATTRIBUTE = "data-column-drag";

/**
 * Moving columns by dragging them, the headers of a table along "x", the lines of
 * the column picker along "y".
 *
 * Pointer events rather than the HTML drag and drop: Firefox starts no drag from a
 * `<button>`, and a sortable header is mostly its sort button. A press becomes a
 * drag only past a few pixels, so that a click keeps sorting, or ticking; the click
 * ending a drag is swallowed. The elements a column may be dropped on are the
 * siblings of the dragged one carrying the same attribute.
 */
export function useColumnDrag(onMove: (prop: string, target: ColumnDropTarget) => void) {
  const [drag, setDrag] = useState<ColumnDragState | null>(null);
  const press = useRef<{
    prop: string;
    axis: "x" | "y";
    x: number;
    y: number;
    pointerId: number;
    scope: HTMLElement | null;
    dragging: boolean;
    target?: ColumnDropTarget;
  } | null>(null);
  const swallowClick = useRef(false);

  function reset() {
    press.current = null;
    setDrag(null);
  }

  /** What makes an element the drag handle, and a drop target, of a column. */
  function handlers(prop: string, axis: "x" | "y") {
    return {
      [DRAG_ATTRIBUTE]: prop,
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        swallowClick.current = false;
        if (event.button !== 0 || !event.isPrimary) return;
        // React bubbles the events of a portal, the popover of a column filter, to
        // the header holding it: they are not presses on the header.
        if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
        press.current = {
          prop,
          axis,
          x: event.clientX,
          y: event.clientY,
          pointerId: event.pointerId,
          scope: event.currentTarget.parentElement,
          dragging: false,
        };
      },
      onPointerMove: (event: PointerEvent<HTMLElement>) => {
        const current = press.current;
        if (current === null || current.pointerId !== event.pointerId) return;
        if (!current.dragging) {
          const distance = Math.hypot(event.clientX - current.x, event.clientY - current.y);
          if (distance < DRAG_THRESHOLD) return;
          current.dragging = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          window.getSelection()?.removeAllRanges();
        }
        const over = document
          .elementFromPoint(event.clientX, event.clientY)
          ?.closest<HTMLElement>(`[${DRAG_ATTRIBUTE}]`);
        const targetProp = over?.getAttribute(DRAG_ATTRIBUTE);
        let target: ColumnDropTarget | undefined;
        if (
          over !== null &&
          over !== undefined &&
          targetProp !== null &&
          targetProp !== undefined &&
          targetProp !== current.prop &&
          over.parentElement === current.scope
        ) {
          const box = over.getBoundingClientRect();
          const after =
            current.axis === "x"
              ? event.clientX > box.left + box.width / 2
              : event.clientY > box.top + box.height / 2;
          target = { prop: targetProp, after };
        }
        current.target = target;
        setDrag((previous) =>
          previous?.prop === current.prop &&
          previous.target?.prop === target?.prop &&
          previous.target?.after === target?.after
            ? previous
            : { prop: current.prop, target },
        );
      },
      onPointerUp: (event: PointerEvent<HTMLElement>) => {
        const current = press.current;
        if (current === null || current.pointerId !== event.pointerId) return;
        if (current.dragging) {
          swallowClick.current = true;
          if (current.target !== undefined) onMove(current.prop, current.target);
        }
        reset();
      },
      onPointerCancel: reset,
      onLostPointerCapture: (event: PointerEvent<HTMLElement>) => {
        if (press.current?.pointerId === event.pointerId && press.current.dragging) reset();
      },
      // The click ending a drag would sort the column, or tick it.
      onClickCapture: (event: MouseEvent<HTMLElement>) => {
        if (!swallowClick.current) return;
        swallowClick.current = false;
        event.preventDefault();
        event.stopPropagation();
      },
    };
  }

  return { drag, handlers };
}

/**
 * The order of the visible columns once `prop` is moved before or after another
 * one, or by `step` places; `undefined` when it does not change.
 */
export function movedColumns(
  shown: string[],
  prop: string,
  to: ColumnDropTarget | { step: number },
): string[] | undefined {
  const from = shown.indexOf(prop);
  if (from < 0) return undefined;
  const rest = shown.filter((entry) => entry !== prop);
  let index: number;
  if ("step" in to) {
    index = from + to.step;
  } else {
    const at = rest.indexOf(to.prop);
    if (at < 0) return undefined;
    index = to.after ? at + 1 : at;
  }
  if (index < 0 || index > rest.length || index === from) return undefined;
  rest.splice(index, 0, prop);
  return rest;
}
