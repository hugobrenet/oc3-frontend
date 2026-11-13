import { useEffect, useRef } from "react";
import { useLocation, useSearch } from "@tanstack/react-router";
import { TrailBar } from "@/components/ui/TrailBar";
import { currentIndex, parseTrail } from "@/lib/peek-trail";
import { useBookmarksPref } from "@/lib/user-prefs";

/** Lists whose selected row is a record that can be bookmarked. */
const ROUTE_KINDS: Record<string, string> = {
  "/nodes": "node",
  "/clusters": "cluster",
  "/services": "service",
  "/instances": "instance",
  "/apps": "app",
  "/groups": "group",
  "/users": "user",
  "/tags": "tag",
  "/disks": "disk",
  "/networks": "network",
  "/metrics": "metric",
  "/charts": "chart",
  "/reports": "report",
};

/**
 * The bookmarks at the foot of the application, whatever the view: kept in sight
 * while the page scrolls, it marks the record on display, the one opened over the
 * view (`peek`) or else the selected row of a list.
 */
export function BookmarksBar() {
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const { pathname } = useLocation();
  const bookmarks = useBookmarksPref();
  const peeked = parseTrail(search.peek);
  const shown = peeked[currentIndex(peeked, search.peekat)];
  const rowKind = ROUTE_KINDS[pathname];
  const current =
    shown !== undefined
      ? `${shown.kind}:${shown.id}`
      : rowKind !== undefined && typeof search.sel === "string" && search.sel !== ""
        ? `${rowKind}:${search.sel}`
        : undefined;
  // Its height, for what floats at the foot of the window, such as the dock of
  // the assistant, to stand over it: none while there is no bookmark.
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = bar.current;
    const root = document.documentElement;
    if (element === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      root.style.setProperty("--bookmarks-bar-height", `${String(element.offsetHeight)}px`);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--bookmarks-bar-height");
    };
  }, []);
  return (
    <div ref={bar} className="sticky bottom-0">
      <TrailBar current={current} onClear={bookmarks.clear} />
    </div>
  );
}
