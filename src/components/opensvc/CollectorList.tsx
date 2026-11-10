import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type OnChangeFn,
  type PaginationState,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { useTranslation } from "react-i18next";
import { useLocation } from "@tanstack/react-router";
import {
  CloseIcon,
  ColumnsIcon,
  DownloadIcon,
  FilterIcon,
  GripIcon,
  ResetIcon,
  SearchIcon,
  SlidersIcon,
} from "@/components/ui/icons";
import type { ListPage } from "@/lib/api/page";
import { download, toCsv, toXlsx, type ExportFormat } from "@/lib/export/table";
import { ColumnFamilyIcon, type ColumnFamily } from "./ColumnFamily";
import { invertFilter, isInverted, withFilter, type ColumnFilters } from "@/lib/column-filters";
import type { ValueStats } from "@/lib/api/value-stats";
import { ColumnFilterPopover } from "./ColumnFilterPopover";
import { TransientNotice, type NoticeTone } from "@/components/ui/TransientNotice";
import type { FiltersetSource } from "@/lib/filterset-entries";
import { SaveAsFilterset } from "./SaveAsFilterset";
import { nextNoticeId } from "@/components/ui/use-auto-dismiss";
import { describeFilter, isFilterable } from "./list-filter-describe";
import {
  DEFAULT_LIMIT,
  PAGE_SIZES,
  visibleProps,
  type ResolvedListSearch,
} from "@/lib/list-search";
import type { ViewPrefsControl } from "@/lib/user-prefs";
import { readProp } from "@/lib/row";
import { labelMatches, normalizeSearch } from "@/lib/label-search";
import { FlashCell, FlashScope } from "./Flash";
import { useFitColumns, useFitColumnsEnabled } from "@/components/ui/use-fit-columns";
import { movedColumns, useColumnDrag, type ColumnDropTarget } from "./use-column-drag";

export interface ListColumn<T> {
  /** Name of the apicollector prop: used for sorting and for picking the requested columns. */
  prop: string;
  labelKey: string;
  numeric?: boolean;
  /** Subject of the column, to place it at a glance in the picker. */
  family: ColumnFamily;
  /**
   * False for a column apicollector cannot sort, for instance a joined prop: `orderby`
   * only accepts the columns of the main table.
   */
  sortable?: boolean;
  /**
   * How the column is filtered, in a list that offers filters: a text field by
   * default, a list of values for a column holding a known set, or nothing.
   */
  filter?: ColumnFilterSpec;
  /**
   * How a value of the column reads in its distribution when no option names it:
   * a size in MiB as "1 GiB", say. The filter keeps the value itself.
   */
  formatValue?: (value: string, locale: string) => string;
  render: (row: T, locale: string) => ReactNode;
}

export type ColumnFilterSpec =
  { kind: "text" } | { kind: "enum"; options: ColumnFilterOption[] } | { kind: "none" };

/**
 * Value offered by an enumerated filter. `labelKey` names it for the summary and for
 * assistive technologies; without it, the value is its own label, as for statuses
 * whose code is what the cells show.
 */
export interface ColumnFilterOption {
  value: string;
  labelKey?: string;
  /** Rendering in the list, as the cells show the value. */
  render?: ReactNode;
}

/** Rows asked of the server at a time while exporting. */
const EXPORT_CHUNK = 1000;
/** Rows an export stops at: beyond, the browser would hold too much in memory. */
const EXPORT_MAX = 200_000;

const PAGE_BUTTON = "h-7 rounded-(--radius-control) border border-line px-2 disabled:opacity-40";

/** Metadata carried by each TanStack column, beyond what it knows itself. */
interface ColumnMeta<T> {
  column: ListColumn<T>;
}

/** The URL `sort` ("-mem_bytes,nodename") to the TanStack sorting state. */
function toSortingState(sort: string[]): SortingState {
  return sort.map((key) =>
    key.startsWith("-") ? { id: key.slice(1), desc: true } : { id: key, desc: false },
  );
}

/** And back. */
function fromSortingState(sorting: SortingState): string[] {
  return sorting.map((entry) => (entry.desc ? `-${entry.id}` : entry.id));
}

/** TanStack passes either a value or an updater function. */
function resolveUpdater<S>(updater: S | ((old: S) => S), current: S): S {
  return typeof updater === "function" ? (updater as (old: S) => S)(current) : updater;
}

/**
 * Table of a collector list, built on TanStack Table.
 *
 * Sorting, pagination and column visibility are in "manual" mode: apicollector sorts
 * and paginates, the table only carries the state. That state lives in the URL, so
 * every change goes through `onChange` rather than through a state internal to the
 * table.
 *
 * Column filters are server-side too, through apicollector's `filter` parameter: a
 * filter on a paginated list must apply to every page, not to the rows on display.
 * They live in `search.filters` rather than in TanStack's `columnFilters`, which
 * would only restate the same state. A filter on a hidden column stays active: the
 * bar above the table lists every active filter, hidden columns included, with a
 * way to clear each.
 *
 * The page count comes from the total the API returns with each page (`total`): it
 * gives the first and last page buttons and the page number. Without it, from an
 * older API, the count stays unknown and the extra row asked of the server says
 * whether a next page exists (`hasMore`).
 */
export function CollectorList<T>({
  columns,
  defaultCols,
  rows,
  rowId,
  search,
  onChange,
  isPending,
  isFetching,
  errorMessage,
  hasMore,
  total,
  onSelectionChange,
  rowLead,
  selectAllMatching,
  exportPage,
  filterable = false,
  unselect,
  reselect,
  valueStats,
  filtersetSource,
  onRowOpen,
  viewPrefs,
}: {
  columns: ListColumn<T>[];
  /** Props shown as long as the user has not chosen their columns. */
  defaultCols: string[];
  rows: T[];
  rowId: (row: T) => string | undefined;
  search: ResolvedListSearch;
  onChange: (next: Partial<ResolvedListSearch>) => void;
  isPending: boolean;
  isFetching: boolean;
  errorMessage: string | null;
  hasMore: boolean;
  /** Rows of the list without pagination, when the API tells it. */
  total?: number;
  /**
   * Ticked rows, on every change. The selection is kept here and survives a page
   * change: `getRowId` keeps it indexed by row id, not by position.
   */
  onSelectionChange?: (ids: string[]) => void;
  /**
   * Mark placed at the head of a row, whatever the columns on display: the freezing
   * of an object, for instance, which hiding its column must not hide.
   */
  rowLead?: (row: T) => ReactNode;
  /**
   * Ids of every row of the current selection, following pages included. Only the
   * view knows how to query its endpoint; it returns here the same selection without
   * pagination. Without this function, the header checkbox only ticks the page on
   * display.
   */
  selectAllMatching?: () => Promise<string[]>;
  /**
   * Reads a page of the list with the sort and the filters of the moment, and the
   * columns asked: what the view itself reads, at another offset and with other
   * columns. With it, the list offers to export every row of the selection — not
   * only the page on display — with every column, as a CSV file or an XLSX workbook.
   */
  exportPage?: (page: { offset: number; limit: number; cols: string[] }) => Promise<ListPage<T>>;
  /**
   * Offers a filter row under the headers. Only for views whose endpoint accepts
   * `filter` and whose page forwards `search.filters` to it.
   */
  filterable?: boolean;
  /**
   * Rows to untick, each time a new array is given: those an action deleted, which
   * the selection must not keep acting on.
   */
  unselect?: readonly string[];
  /**
   * The rows to tick in place of the selection, each time a new array is given:
   * the selection narrowed from its comparison, for instance.
   */
  reselect?: readonly string[];
  /**
   * Counts the values of a column over the selection, with the filters given in
   * place of those of the moment: the view knows its endpoint. With it, the filter
   * of each column offers the distribution of its values (see ColumnValues).
   */
  valueStats?: (prop: string, filters: ColumnFilters) => Promise<ValueStats>;
  /**
   * How the columns map onto the tables of a filterset: with it, the filter bar
   * offers to save the active filters as a filterset (see SaveAsFilterset).
   */
  filtersetSource?: FiltersetSource;
  /**
   * What a row opens, in place of the detail panel of `search.sel`: a page of its
   * own, say. The row then announces no dialog.
   */
  onRowOpen?: (row: T) => void;
  /**
   * The settings of the list in this tab and the user's defaults (`useViewPrefs`):
   * with it, the toolbar offers to save the tab's columns, sort, filters and page
   * size as the defaults, or to go back to them.
   */
  viewPrefs?: ViewPrefsControl;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const [columnFilter, setColumnFilter] = useState("");
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  // True when the selection covers every page and not just the page on display.
  const [allMatching, setAllMatching] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const picker = useRef<HTMLDetailsElement>(null);
  const pickerSearch = useRef<HTMLInputElement>(null);
  const exportMenu = useRef<HTMLDetailsElement>(null);
  const { pathname } = useLocation();
  // Whether the export takes the hidden columns too; off, those on display only.
  const [exportHidden, setExportHidden] = useState(false);
  // Rows read so far by the export under way, or null when none is.
  const [exported, setExported] = useState<number | null>(null);
  // The report of the last export, numbered, never twice: a new one starts its time again.
  const [exportNotice, setExportNoticeState] = useState<{
    id: number;
    tone: NoticeTone;
    text: string;
  } | null>(null);
  function setExportNotice(next: { tone: NoticeTone; text: string } | null) {
    setExportNoticeState(next === null ? null : { ...next, id: nextNoticeId() });
  }
  const viewMenu = useRef<HTMLDetailsElement>(null);
  const [savingDefault, setSavingDefault] = useState(false);
  // The report of the last save of the defaults, numbered as the export's.
  const [viewNotice, setViewNoticeState] = useState<{
    id: number;
    tone: NoticeTone;
    text: string;
  } | null>(null);
  function setViewNotice(next: { tone: NoticeTone; text: string } | null) {
    setViewNoticeState(next === null ? null : { ...next, id: nextNoticeId() });
  }

  /** Saves the columns, sort, filters and page size shown as the user's defaults. */
  async function saveAsDefault() {
    if (viewPrefs === undefined) return;
    setSavingDefault(true);
    try {
      await viewPrefs.saveAsDefault({
        cols: search.cols,
        sort: search.sort,
        filters: search.filters,
        limit: search.limit,
      });
      setViewNotice({ tone: "success", text: t("list.view.saved") });
      if (viewMenu.current !== null) viewMenu.current.open = false;
    } catch (error) {
      setViewNotice({
        tone: "error",
        text: t("list.view.saveFailed", {
          message: error instanceof Error ? error.message : String(error),
        }),
      });
    } finally {
      setSavingDefault(false);
    }
  }

  /** Shows the user's defaults again, the settings of the tab forgotten. */
  function restoreDefault() {
    if (viewPrefs === undefined) return;
    const { defaults } = viewPrefs;
    onChange({
      cols: defaults.cols,
      sort: defaults.sort,
      filters: defaults.filters ?? {},
      limit: defaults.limit ?? DEFAULT_LIMIT,
    });
    // After the change, which the tab records: the tab follows the defaults again.
    viewPrefs.restoreDefault();
    if (viewMenu.current !== null) viewMenu.current.open = false;
  }

  /**
   * Escape closes the column picker and gives the focus back to its button.
   *
   * `<details>` does not do it by itself. The listener sits on the `<details>` rather
   * than on the document: the key only acts when the focus is in the menu, and
   * propagation is stopped so that the side panel, which listens for Escape at the
   * document level, does not close at the same time.
   */
  function onPickerKeyDown(event: KeyboardEvent<HTMLDetailsElement>) {
    const element = event.currentTarget;
    if (event.key !== "Escape" || !element.open) return;
    event.stopPropagation();
    element.open = false;
    element.querySelector<HTMLElement>("summary")?.focus();
  }

  /**
   * A click outside an open menu of the toolbar — columns, export, view — closes
   * it, as the other menus close; the click then does what it does anywhere else.
   * `<details>` stays open by itself.
   */
  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      for (const element of [picker.current, exportMenu.current, viewMenu.current]) {
        if (element === null || !element.open) continue;
        if (event.target instanceof Node && element.contains(event.target)) continue;
        element.open = false;
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  const allProps = useMemo(() => columns.map((column) => column.prop), [columns]);
  // At least one page, even for an empty list.
  const pageCount = total === undefined ? undefined : Math.max(1, Math.ceil(total / search.limit));
  const shown = visibleProps(search.cols, defaultCols, allProps);

  // The columns asked that the width holds, from the first: those after them are
  // hidden, not unticked, and come back when the window widens. The columns
  // asked stay what the picker, the saved view and the export know.
  const [fitEnabled, setFitEnabled] = useFitColumnsEnabled();
  const shownKey = shown.join("\u0000");
  const fitContent = useMemo(() => ({ rows, shownKey }), [rows, shownKey]);
  const fit = useFitColumns(shown.length, fitContent, fitEnabled);
  const fitted = new Set(shown.slice(0, fit.shown));
  const hiddenForWidth = shown.slice(fit.shown);

  const columnDefs = useMemo<ColumnDef<T>[]>(
    () =>
      columns.map((column) => ({
        id: column.prop,
        // Without an accessor, TanStack files the column as "display" and
        // `getCanSort()` answers false: the header would no longer sort anything. The
        // value is not used for sorting — the server takes care of that — but it makes
        // the column a data column.
        accessorFn: (row) => readProp(row, column.prop),
        header: () => t(column.labelKey),
        cell: (context) => column.render(context.row.original, locale),
        enableSorting: column.sortable !== false,
        meta: { column } satisfies ColumnMeta<T>,
      })),
    [columns, t, locale],
  );

  const sorting = useMemo(() => toSortingState(search.sort), [search.sort]);
  const columnVisibility = useMemo(
    () => Object.fromEntries(allProps.map((prop) => [prop, shown.includes(prop)])),
    [allProps, shown],
  );
  // The visible columns in their order, then the hidden ones in the order of the
  // view: the headers, the cells and the picker follow it.
  const columnOrder = useMemo(
    () => [...shown, ...allProps.filter((prop) => !shown.includes(prop))],
    [allProps, shown],
  );
  const pagination = useMemo<PaginationState>(
    () => ({ pageIndex: Math.floor(search.offset / search.limit), pageSize: search.limit }),
    [search.offset, search.limit],
  );

  const onSortingChange: OnChangeFn<SortingState> = (updater) => {
    onChange({ sort: fromSortingState(resolveUpdater(updater, sorting)), offset: 0 });
  };

  const onPaginationChange: OnChangeFn<PaginationState> = (updater) => {
    const next = resolveUpdater(updater, pagination);
    // The page size only when it changes: the view saves it to the account, which
    // turning a page must not do.
    onChange(
      next.pageSize === pagination.pageSize
        ? { offset: next.pageIndex * next.pageSize }
        : { offset: next.pageIndex * next.pageSize, limit: next.pageSize },
    );
  };

  const onRowSelectionChange: OnChangeFn<RowSelectionState> = (updater) => {
    const next = resolveUpdater(updater, rowSelection);
    setRowSelection(next);
    setAllMatching(false);
    // Telling without going through an effect: the view receives the selection the
    // moment it changes, with no risk of looping on the identity of the callback.
    onSelectionChange?.(Object.keys(next).filter((id) => next[id]));
  };

  useEffect(() => {
    if (unselect === undefined || unselect.length === 0) return;
    onRowSelectionChange((previous) => {
      const next = { ...previous };
      for (const id of unselect) delete next[id];
      return next;
    });
    // Only a new array unticks: the callbacks change identity on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unselect]);

  useEffect(() => {
    if (reselect === undefined) return;
    onRowSelectionChange(() => Object.fromEntries(reselect.map((id) => [id, true])));
    // Only a new array ticks: the callbacks change identity on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reselect]);

  // The row last ticked or unticked: where a Shift+Click range starts.
  const anchor = useRef<string | null>(null);

  /**
   * Ticks or unticks a row. With Shift held, every row from the one last ticked
   * to this one takes the same state, as in a file manager: a contiguous range of
   * the page on display. Without an anchor on this page, only the row changes.
   */
  function tick(id: string, checked: boolean, native: Event) {
    const rows = table.getRowModel().rows;
    const to = rows.findIndex((row) => row.id === id);
    const from = rows.findIndex((row) => row.id === anchor.current);
    const range =
      native instanceof MouseEvent && native.shiftKey && from !== -1 && to !== -1 && from !== to;
    const touched = range
      ? rows.slice(Math.min(from, to), Math.max(from, to) + 1)
      : rows.slice(to, to + 1);
    onRowSelectionChange((previous) => {
      const next = { ...previous };
      for (const row of touched) {
        if (!row.getCanSelect()) continue;
        if (checked) next[row.id] = true;
        else delete next[row.id];
      }
      return next;
    });
    anchor.current = id;
  }

  /** Ticks every row of the selection, following pages included. */
  async function selectEverything() {
    if (selectAllMatching === undefined) return;
    setSelectingAll(true);
    setSelectionError(null);
    try {
      const ids = await selectAllMatching();
      const next = Object.fromEntries(ids.map((id) => [id, true]));
      setRowSelection(next);
      setAllMatching(true);
      onSelectionChange?.(ids);
    } catch (error) {
      setSelectionError(error instanceof Error ? error.message : String(error));
    } finally {
      setSelectingAll(false);
    }
  }

  /** Sets or clears the filter of a column; the population changes, as with a filterset. */
  function setFilter(prop: string, expr: string | undefined) {
    table.resetRowSelection();
    onChange({ filters: withFilter(search.filters, prop, expr), offset: 0 });
  }

  // Every active filter, those of hidden columns included, and those a hand-made link
  // puts on a prop the view does not know: the API refuses them, and the bar is where
  // they can be cleared.
  const activeFilters = Object.entries(search.filters).map(([prop, expr]) => ({
    prop,
    expr,
    column: columns.find((column) => column.prop === prop),
  }));

  /**
   * Exports the whole selection — every page, with the sort and the filters of the
   * moment — with every column the view offers: those on display first, in their
   * order, then the hidden ones in the order of the column picker. The values are
   * those of the API, not their rendering: see `lib/export/table.ts`.
   */
  async function runExport(format: ExportFormat) {
    if (exportPage === undefined || exported !== null) return;
    if (exportMenu.current !== null) exportMenu.current.open = false;
    setExportNotice(null);
    setExported(0);
    try {
      // The columns on display, in their order; the hidden ones after them on demand.
      const exportedProps = exportHidden
        ? [...shown, ...allProps.filter((prop) => !shown.includes(prop))]
        : shown;
      const all: T[] = [];
      let truncated = false;
      for (let offset = 0; ; offset += EXPORT_CHUNK) {
        const page = await exportPage({ offset, limit: EXPORT_CHUNK, cols: exportedProps });
        all.push(...page.rows);
        setExported(all.length);
        if (!page.hasMore || page.rows.length === 0) break;
        if (all.length >= EXPORT_MAX) {
          truncated = true;
          break;
        }
      }
      const exportedColumns = exportedProps.flatMap((prop) => {
        const column = columns.find((candidate) => candidate.prop === prop);
        return column === undefined ? [] : [column];
      });
      const content = {
        headers: exportedColumns.map((column) => t(column.labelKey)),
        rows: all.map((row) =>
          exportedColumns.map((column) => (row as Record<string, unknown>)[column.prop]),
        ),
      };
      // Named after the view and the moment: nodes-20260930-1712.xlsx.
      const view = pathname.replace(/^\/+|\/+$/g, "").replaceAll("/", "-") || "export";
      const now = new Date();
      const two = (n: number) => String(n).padStart(2, "0");
      const stamp = `${String(now.getFullYear())}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}`;
      const blob = format === "csv" ? toCsv(content) : await toXlsx(content, view);
      download(blob, `${view}-${stamp}.${format}`);
      setExportNotice({
        // Cut short: the user did not get every row, which deserves the time of a warning.
        tone: truncated ? "warning" : "success",
        text: truncated
          ? t("list.export.truncated", { count: all.length })
          : t("list.export.done", { count: all.length }),
      });
    } catch (error) {
      setExportNotice({
        tone: "error",
        text: t("list.export.error", {
          message: error instanceof Error ? error.message : String(error),
        }),
      });
    } finally {
      setExported(null);
    }
  }

  const onColumnVisibilityChange: OnChangeFn<VisibilityState> = (updater) => {
    const next = resolveUpdater(updater, columnVisibility);
    // The columns kept stay where the user put them, a column ticked comes last.
    const kept = [
      ...shown.filter((prop) => next[prop] !== false),
      ...allProps.filter((prop) => !shown.includes(prop) && next[prop] === true),
    ];
    if (kept.length === 0) return; // the last visible column cannot be unticked
    // Hiding a column also removes its sort key: the header is the only indication of
    // the sort, and an invisible key would have no way left of being cancelled.
    const sortable = columns
      .filter((column) => column.sortable !== false && kept.includes(column.prop))
      .map((column) => column.prop);
    const sort = search.sort.filter((key) => sortable.includes(key.replace(/^-/, "")));
    onChange({
      cols: kept,
      sort: sort.length === 0 ? undefined : sort,
      offset: 0,
    });
  };

  // The element that had the focus when a column moved from the keyboard: the move
  // may take it out of the document an instant, it gets the focus back.
  const refocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const element = refocus.current;
    refocus.current = null;
    if (element !== null && element.isConnected && document.activeElement !== element) {
      element.focus();
    }
  }, [shownKey]);

  /** Moves a visible column, the others keeping their order. */
  function moveColumn(prop: string, to: ColumnDropTarget | { step: number }) {
    const cols = movedColumns(shown, prop, to);
    if (cols === undefined) return;
    // The rows stay the same: no offset change, no scroll.
    onChange({ cols });
  }
  const columnDrag = useColumnDrag(moveColumn);

  /** The look of a column being dragged, or of the one it would land beside. */
  function dragLook(prop: string, axis: "x" | "y"): string {
    const drag = columnDrag.drag;
    if (drag === null) return "";
    if (drag.prop === prop) return "opacity-50 cursor-grabbing";
    if (drag.target?.prop !== prop) return "";
    if (axis === "x") {
      return drag.target.after
        ? "shadow-[inset_-2px_0_0_0_var(--color-accent)]"
        : "shadow-[inset_2px_0_0_0_var(--color-accent)]";
    }
    return drag.target.after
      ? "shadow-[inset_0_-2px_0_0_var(--color-accent)]"
      : "shadow-[inset_0_2px_0_0_var(--color-accent)]";
  }

  // The page, sort, filters, filterset and columns on display, for the flashes.
  const viewSubject = JSON.stringify([
    search.sort,
    search.offset,
    search.limit,
    search.cols,
    search.filters,
  ]);

  // True once the list has shown its rows: a row mounted afterwards is one the
  // collector gained, not the first display.
  const shownOnce = useRef(false);
  useEffect(() => {
    if (!isPending) shownOnce.current = true;
  }, [isPending]);

  const table = useReactTable({
    data: rows,
    columns: columnDefs,
    state: { sorting, columnVisibility, columnOrder, pagination, rowSelection },
    getRowId: (row, index) => rowId(row) ?? String(index),
    getCoreRowModel: getCoreRowModel(),
    // The server sorts and paginates; the table only reflects the state.
    manualSorting: true,
    manualPagination: true,
    // By default TanStack starts descending on columns whose first value is a number:
    // the first click would not have the same meaning from one column to the next. We
    // keep the order from before the migration, ascending then descending.
    sortDescFirst: false,
    // Unknown (-1) when the API gives no total.
    pageCount: pageCount ?? -1,
    enableRowSelection: true,
    onSortingChange,
    onPaginationChange,
    onColumnVisibilityChange,
    onRowSelectionChange,
  });

  const from = rows.length === 0 ? 0 : search.offset + 1;
  const to = search.offset + rows.length;
  const pageIndex = Math.floor(search.offset / search.limit);
  const lastOffset = pageCount === undefined ? undefined : (pageCount - 1) * search.limit;
  const onLastPage = pageCount === undefined ? !hasMore : pageIndex >= pageCount - 1;
  const format = (n: number) => n.toLocaleString(locale);

  // A link, or rows deleted meanwhile, may point past the end of the list: go to
  // its last page rather than show an empty one.
  useEffect(() => {
    if (isFetching || total === undefined || total === 0 || lastOffset === undefined) return;
    if (search.offset > lastOffset) onChange({ offset: lastOffset });
  }, [isFetching, total, lastOffset, search.offset, onChange]);
  // A column is found by its name in English or in French, without case nor accents.
  const needle = normalizeSearch(columnFilter.trim());
  const pickerColumns = table
    .getAllLeafColumns()
    .filter((column) => labelMatches(i18n, getMeta(column.columnDef).column.labelKey, needle));
  const sortableSomewhere = columns.some((column) => column.sortable !== false);
  const selectedCount = Object.values(rowSelection).filter(Boolean).length;
  const pageFullySelected = rows.length > 0 && table.getIsAllPageRowsSelected();
  // Offering to extend the selection only makes sense while pages remain to cover.
  const canSelectEverything =
    selectAllMatching !== undefined && pageFullySelected && !allMatching && hasMore;

  /**
   * The header checkbox walks through three states: the page, then the whole
   * selection while pages remain, then nothing.
   */
  function onToggleAll() {
    if (!pageFullySelected) {
      table.toggleAllPageRowsSelected(true);
    } else if (canSelectEverything) {
      void selectEverything();
    } else {
      table.resetRowSelection();
    }
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1 text-ink-muted" htmlFor="list-page-size">
          {t("list.perPage")}
          <select
            id="list-page-size"
            value={search.limit}
            onChange={(event) => {
              table.setPageSize(Number(event.target.value));
            }}
            className="h-7 rounded-(--radius-control) border border-line bg-surface px-1 text-ink"
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>

        <details
          ref={picker}
          onKeyDown={onPickerKeyDown}
          // Opened, the menu is for finding a column: the search field takes the focus.
          onToggle={(event) => {
            if (event.currentTarget.open) pickerSearch.current?.focus();
          }}
          className="relative"
        >
          <summary className="flex h-7 cursor-pointer list-none items-center gap-1.5 rounded-(--radius-control) border border-line px-2 text-ink-muted hover:text-ink">
            <ColumnsIcon />
            {t("list.columns", { shown: shown.length, total: columns.length })}
          </summary>
          <div className="absolute z-20 mt-1 w-72 rounded-(--radius-panel) border border-line bg-surface-raised p-2 shadow-lg">
            {/* A view may offer dozens of columns: without a filter, the list
                becomes impractical. */}
            <div className="mb-2 flex h-7 items-center gap-1.5 rounded-(--radius-control) border border-line bg-surface px-2 text-ink-muted">
              <SearchIcon />
              <input
                ref={pickerSearch}
                type="search"
                value={columnFilter}
                onChange={(event) => {
                  setColumnFilter(event.target.value);
                }}
                placeholder={t("list.filterColumns")}
                aria-label={t("list.filterColumns")}
                className="w-full bg-transparent text-ink outline-none placeholder:text-ink-muted"
              />
            </div>
            <ul className="max-h-80 overflow-y-auto">
              {pickerColumns.map((column) => {
                const meta = getMeta(column.columnDef).column;
                const checked = column.getIsVisible();
                // A visible column moves by dragging, or by Alt+Up/Down on its box.
                return (
                  <li
                    key={column.id}
                    {...(checked ? columnDrag.handlers(meta.prop, "y") : {})}
                    className={`flex items-center gap-1 rounded-(--radius-control) select-none ${checked ? dragLook(meta.prop, "y") : ""}`}
                  >
                    <span
                      aria-hidden="true"
                      className={`w-3 shrink-0 ${checked ? "cursor-grab text-ink-muted" : "invisible"}`}
                    >
                      <GripIcon className="h-3 w-3" />
                    </span>
                    <label className="flex min-w-0 grow items-center gap-2 py-0.5">
                      <input
                        type="checkbox"
                        checked={checked}
                        // The last visible column cannot be unticked.
                        disabled={checked && shown.length === 1}
                        onChange={column.getToggleVisibilityHandler()}
                        aria-keyshortcuts={checked ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
                        onKeyDown={(event) => {
                          if (!checked || !event.altKey) return;
                          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                          event.preventDefault();
                          refocus.current = event.currentTarget;
                          moveColumn(meta.prop, { step: event.key === "ArrowUp" ? -1 : 1 });
                        }}
                      />
                      <ColumnFamilyIcon family={meta.family} />
                      {t(meta.labelKey)}
                      {checked && !fitted.has(meta.prop) && (
                        <span className="text-ink-muted">{t("list.fit.hiddenMark")}</span>
                      )}
                      {search.filters[meta.prop] !== undefined && (
                        <span title={t("list.filters.active")} className="ml-auto text-accent">
                          <FilterIcon className="h-3 w-3" />
                          <span className="sr-only">{t("list.filters.active")}</span>
                        </span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-ink-muted">{t("list.reorderHint")}</p>
            <button
              type="button"
              onClick={() => {
                onChange({ cols: undefined });
              }}
              className="mt-2 flex h-7 w-full items-center justify-center gap-1.5 rounded-(--radius-control) border border-line px-2 text-ink-muted hover:text-ink"
            >
              <ResetIcon />
              {t("list.resetColumns")}
            </button>
          </div>
        </details>

        {hiddenForWidth.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setFitEnabled(false);
            }}
            title={t("list.fit.hiddenTitle", {
              columns: hiddenForWidth
                .map((prop) => {
                  const column = columns.find((entry) => entry.prop === prop);
                  return column === undefined ? prop : t(column.labelKey);
                })
                .join(", "),
            })}
            className="flex h-7 items-center gap-1.5 rounded-(--radius-control) border border-line px-2 text-ink-muted hover:text-ink"
          >
            <ColumnsIcon />
            {t("list.fit.hidden", { count: hiddenForWidth.length })}
          </button>
        )}
        {fit.wouldHide && (
          <button
            type="button"
            onClick={() => {
              setFitEnabled(true);
            }}
            className="flex h-7 items-center gap-1.5 rounded-(--radius-control) border border-line px-2 text-ink-muted hover:text-ink"
          >
            <ColumnsIcon />
            {t("list.fit.enable")}
          </button>
        )}

        {exportPage !== undefined && (
          <details ref={exportMenu} onKeyDown={onPickerKeyDown} className="relative">
            <summary
              aria-busy={exported !== null}
              className="flex h-7 cursor-pointer list-none items-center gap-1.5 rounded-(--radius-control) border border-line px-2 text-ink-muted hover:text-ink"
            >
              <DownloadIcon />
              {exported === null
                ? t("list.export.label")
                : t("list.export.running", { count: exported })}
            </summary>
            <div className="absolute z-20 mt-1 w-64 rounded-(--radius-panel) border border-line bg-surface-raised p-1 shadow-lg">
              <label
                className={`mb-1 flex items-center gap-2 border-b border-line px-2 py-1.5 ${
                  allProps.length === shown.length ? "text-ink-muted" : "cursor-pointer"
                }`}
              >
                <input
                  type="checkbox"
                  checked={exportHidden && allProps.length > shown.length}
                  disabled={exported !== null || allProps.length === shown.length}
                  onChange={(event) => {
                    setExportHidden(event.target.checked);
                  }}
                />
                {t("list.export.withHidden", { count: allProps.length - shown.length })}
              </label>
              {(["xlsx", "csv"] as const).map((format) => (
                <button
                  key={format}
                  type="button"
                  disabled={exported !== null}
                  onClick={() => {
                    void runExport(format);
                  }}
                  className="flex w-full items-center rounded-(--radius-control) px-2 py-1 text-left hover:bg-surface-sunken disabled:opacity-40"
                >
                  {t(`list.export.formats.${format}`)}
                </button>
              ))}
              <p className="border-t border-line px-2 pt-1.5 pb-1 text-data text-ink-muted">
                {t("list.export.hint")}
              </p>
            </div>
          </details>
        )}

        {viewPrefs !== undefined && (
          <details ref={viewMenu} onKeyDown={onPickerKeyDown} className="relative">
            <summary className="flex h-7 cursor-pointer list-none items-center gap-1.5 rounded-(--radius-control) border border-line px-2 text-ink-muted hover:text-ink">
              <SlidersIcon />
              {t("list.view.label")}
              {viewPrefs.customized && (
                // A mark and a word: the view of this tab is its own.
                <span className="text-accent">
                  <span aria-hidden="true">●</span> {t("list.view.modified")}
                </span>
              )}
            </summary>
            <div className="absolute z-20 mt-1 w-80 rounded-(--radius-panel) border border-line bg-surface-raised p-1 shadow-lg">
              <p className="px-2 py-1.5 text-ink-muted">
                {viewPrefs.customized ? t("list.view.customized") : t("list.view.asDefault")}
              </p>
              <button
                type="button"
                disabled={savingDefault}
                onClick={() => {
                  void saveAsDefault();
                }}
                className="flex w-full items-center rounded-(--radius-control) px-2 py-1 text-left hover:bg-surface-sunken disabled:opacity-40"
              >
                {savingDefault ? t("list.view.saving") : t("list.view.save")}
              </button>
              <button
                type="button"
                disabled={!viewPrefs.customized}
                onClick={restoreDefault}
                className="flex w-full items-center rounded-(--radius-control) px-2 py-1 text-left hover:bg-surface-sunken disabled:opacity-40"
              >
                {t("list.view.restore")}
              </button>
              <p className="border-t border-line px-2 pt-1.5 pb-1 text-data text-ink-muted">
                {t("list.view.hint")}
              </p>
            </div>
          </details>
        )}

        {selectedCount > 0 && (
          <span className="flex items-center gap-2 text-ink">
            {/* In red: rows are ticked, and an action would apply to them. */}
            <span className="font-medium text-state-down">
              {allMatching
                ? t("list.selectedEverywhere", { count: selectedCount })
                : t("list.selected", { count: selectedCount })}
            </span>
            {canSelectEverything && (
              // A second click on the header checkbox does the same, but nothing
              // announces it: this button makes the extension visible.
              <button
                type="button"
                disabled={selectingAll}
                onClick={() => {
                  void selectEverything();
                }}
                className="h-7 rounded-(--radius-control) border border-line px-2 text-ink-muted hover:text-ink disabled:opacity-60"
              >
                {selectingAll ? t("list.selectingEverything") : t("list.selectEverything")}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                table.resetRowSelection();
              }}
              className="h-7 rounded-(--radius-control) border border-line px-2 text-ink-muted hover:text-ink"
            >
              {t("list.clearSelection")}
            </button>
          </span>
        )}

        <span aria-live="polite" className="ml-auto text-ink-muted">
          {isFetching
            ? t("list.loading")
            : total === undefined
              ? t("list.range", { from: format(from), to: format(to) })
              : t("list.rangeOf", { from: format(from), to: format(to), total: format(total) })}
        </span>
        <nav aria-label={t("list.pagination")} className="flex items-center gap-1">
          <button
            type="button"
            disabled={search.offset === 0}
            onClick={() => {
              onChange({ offset: 0 });
            }}
            className={PAGE_BUTTON}
          >
            {t("list.first")}
          </button>
          <button
            type="button"
            disabled={!table.getCanPreviousPage()}
            onClick={() => {
              table.previousPage();
            }}
            className={PAGE_BUTTON}
          >
            {t("list.previous")}
          </button>
          <span className="px-1 text-ink-muted" aria-current="page">
            {pageCount === undefined
              ? t("list.pageUnknown", { page: format(pageIndex + 1) })
              : t("list.page", { page: format(pageIndex + 1), pages: format(pageCount) })}
          </span>
          <button
            type="button"
            // Without a total, it is the extra row asked of the server that says
            // whether a page remains, not the table.
            disabled={onLastPage}
            onClick={() => {
              table.nextPage();
            }}
            className={PAGE_BUTTON}
          >
            {t("list.next")}
          </button>
          <button
            type="button"
            disabled={lastOffset === undefined || onLastPage}
            title={lastOffset === undefined ? t("list.lastUnknown") : undefined}
            onClick={() => {
              if (lastOffset !== undefined) onChange({ offset: lastOffset });
            }}
            className={PAGE_BUTTON}
          >
            {t("list.last")}
          </button>
        </nav>
      </div>

      {activeFilters.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1 text-ink-muted">
            <FilterIcon className="h-3.5 w-3.5" />
            {t("list.filters.title")}
          </span>
          <ul className="contents">
            {activeFilters.map(({ prop, expr, column }) => {
              const hidden = !shown.includes(prop);
              const label = column === undefined ? prop : t(column.labelKey);
              return (
                <li
                  key={prop}
                  className={`flex h-6 items-center gap-1 rounded-(--radius-control) border bg-surface-raised pl-1.5 ${
                    hidden ? "border-dashed border-line-strong" : "border-line"
                  }`}
                >
                  {column === undefined ? (
                    <>
                      <span className="text-ink-muted">{label}</span>
                      <code className="text-data text-ink">{expr}</code>
                    </>
                  ) : (
                    // The chip opens the filter of its column, header shown or not.
                    <ColumnFilterPopover
                      column={column}
                      filters={search.filters}
                      onChange={(next) => {
                        setFilter(prop, next);
                      }}
                      valueStats={valueStats}
                      scope={[pathname]}
                      triggerClassName="flex h-full items-center gap-1 hover:text-ink"
                      trigger={
                        <>
                          <ColumnFamilyIcon family={column.family} />
                          <span className="text-ink-muted">{label}</span>
                          {isInverted(expr) && (
                            <span className="font-medium text-ink">{t("list.filters.not")}</span>
                          )}
                          {column.filter?.kind === "enum" ? (
                            <span className="text-ink">{describeFilter(column, expr, t)}</span>
                          ) : (
                            <code className="text-data text-ink">
                              {describeFilter(column, expr, t)}
                            </code>
                          )}
                        </>
                      }
                    />
                  )}
                  {hidden && (
                    <span className="text-ink-muted italic">
                      {column === undefined ? t("list.filters.unknown") : t("list.filters.hidden")}
                    </span>
                  )}
                  <button
                    type="button"
                    aria-pressed={isInverted(expr)}
                    onClick={() => {
                      setFilter(prop, invertFilter(expr));
                    }}
                    aria-label={t("list.filters.invertOne", { column: label })}
                    title={t("list.filters.invertOne", { column: label })}
                    className="flex h-full items-center border-l border-line px-1 font-mono text-ink-muted hover:text-ink aria-pressed:bg-accent-soft aria-pressed:text-ink"
                  >
                    ≠
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFilter(prop, undefined);
                    }}
                    aria-label={t("list.filters.clearOne", { column: label })}
                    title={t("list.filters.clearOne", { column: label })}
                    className="flex h-full items-center px-1 text-ink-muted hover:text-ink"
                  >
                    <CloseIcon className="h-3 w-3" />
                  </button>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            onClick={() => {
              table.resetRowSelection();
              onChange({ filters: {}, offset: 0 });
            }}
            className="flex h-6 items-center gap-1 rounded-(--radius-control) border border-line px-2 text-ink-muted hover:text-ink"
          >
            <ResetIcon className="h-3.5 w-3.5" />
            {t("list.filters.clearAll", { count: activeFilters.length })}
          </button>
          {filtersetSource !== undefined && (
            <SaveAsFilterset
              filters={search.filters}
              source={filtersetSource}
              describe={(prop, expr) => {
                const column = columns.find((entry) => entry.prop === prop);
                if (column === undefined) return `${prop} ${expr}`;
                const not = isInverted(expr) ? `${t("list.filters.not")} ` : "";
                return `${t(column.labelKey)} ${not}${describeFilter(column, expr, t)}`;
              }}
            />
          )}
        </div>
      )}

      {viewNotice !== null && (
        <TransientNotice
          id={viewNotice.id}
          tone={viewNotice.tone}
          text={viewNotice.text}
          dismissLabel={t("list.export.dismiss")}
          onDismiss={() => {
            setViewNotice(null);
          }}
        />
      )}
      {exportNotice !== null && (
        <TransientNotice
          id={exportNotice.id}
          tone={exportNotice.tone}
          text={exportNotice.text}
          dismissLabel={t("list.export.dismiss")}
          onDismiss={() => {
            setExportNotice(null);
          }}
        />
      )}
      {selectionError !== null && (
        <p role="alert" className="mb-2 text-state-down">
          ■ {selectionError}
        </p>
      )}

      {sortableSomewhere && <p className="mb-2 text-ink-muted">{t("list.sortHint")}</p>}

      {errorMessage !== null && (
        <p role="alert" className="text-state-down">
          ■ {t("list.error", { message: errorMessage })}
        </p>
      )}

      {isPending && <p className="text-ink-muted">{t("list.loading")}</p>}

      {!filterable && !isPending && errorMessage === null && rows.length === 0 && (
        <p className="text-ink-muted">{t("list.empty")}</p>
      )}

      {/* A filterable list keeps its table when nothing matches: the filter row is
          where the filter that emptied it gets changed. */}
      {(rows.length > 0 || (filterable && !isPending)) && (
        <div
          ref={fit.containerRef}
          className="overflow-x-auto rounded-(--radius-panel) border border-line bg-surface-raised"
        >
          {/* What the list shows: changing it brings other rows, which are not updates. */}
          <FlashScope subject={viewSubject}>
            <table ref={fit.tableRef} className="w-full border-collapse text-data">
              <thead>
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr
                    key={headerGroup.id}
                    className="border-b border-line text-left text-ink-muted"
                  >
                    <th scope="col" className="w-8 px-2">
                      <input
                        type="checkbox"
                        checked={table.getIsAllPageRowsSelected()}
                        ref={(element) => {
                          if (element !== null) {
                            element.indeterminate = table.getIsSomePageRowsSelected();
                          }
                        }}
                        aria-label={
                          canSelectEverything ? t("list.selectEverything") : t("list.selectAll")
                        }
                        title={
                          canSelectEverything ? t("list.selectEverything") : t("list.selectAll")
                        }
                        onChange={onToggleAll}
                      />
                    </th>
                    {headerGroup.headers
                      .filter((header) => fitted.has(header.column.id))
                      .map((header) => {
                        const meta = getMeta(header.column.columnDef).column;
                        const sorted = header.column.getIsSorted();
                        const label = flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        );
                        // The funnel of the column's filter, beside its label: it opens
                        // the filter's popover, and a click on it does not sort.
                        const filter =
                          filterable && isFilterable(meta) ? (
                            <ColumnFilterPopover
                              column={meta}
                              filters={search.filters}
                              onChange={(expr) => {
                                setFilter(meta.prop, expr);
                              }}
                              valueStats={valueStats}
                              scope={[pathname]}
                            />
                          ) : null;
                        if (!header.column.getCanSort()) {
                          return (
                            <th
                              key={header.id}
                              scope="col"
                              {...columnDrag.handlers(meta.prop, "x")}
                              title={t("list.dragHeader")}
                              className={`px-2 py-1.5 font-medium select-none ${meta.numeric === true ? "text-right" : ""} ${dragLook(meta.prop, "x")}`}
                            >
                              <span
                                className={`flex items-center gap-1 ${meta.numeric === true ? "justify-end" : ""}`}
                              >
                                {label}
                                {filter}
                              </span>
                            </th>
                          );
                        }
                        return (
                          <th
                            key={header.id}
                            scope="col"
                            aria-sort={
                              sorted === false
                                ? "none"
                                : sorted === "asc"
                                  ? "ascending"
                                  : "descending"
                            }
                            {...columnDrag.handlers(meta.prop, "x")}
                            title={t("list.dragHeader")}
                            className={`select-none ${meta.numeric === true ? "text-right" : ""} ${dragLook(meta.prop, "x")}`}
                          >
                            <span
                              className={`flex items-center gap-0.5 pr-1 ${meta.numeric === true ? "justify-end" : ""}`}
                            >
                              <button
                                type="button"
                                onClick={header.column.getToggleSortingHandler()}
                                className={`py-1.5 pl-2 font-medium hover:text-ink ${filter === null ? "w-full pr-2 text-left" : "text-left"}`}
                              >
                                {label}
                                {sorted !== false && (
                                  <span aria-hidden="true">
                                    {sorted === "asc" ? " ▲" : " ▼"}
                                    {sorting.length > 1 && header.column.getSortIndex() + 1}
                                  </span>
                                )}
                              </button>
                              {filter}
                            </span>
                          </th>
                        );
                      })}
                  </tr>
                ))}
              </thead>
              <tbody>
                {rows.length === 0 && errorMessage === null && (
                  <tr>
                    <td colSpan={fitted.size + 1} className="px-2 py-3 text-ink-muted">
                      {activeFilters.length > 0 ? t("list.filters.noMatch") : t("list.empty")}
                    </td>
                  </tr>
                )}
                {table.getRowModel().rows.map((row) => {
                  const id = rowId(row.original);
                  const selected = id !== undefined && id === search.sel;
                  const openRow = () => {
                    if (onRowOpen === undefined) onChange({ sel: id });
                    else onRowOpen(row.original);
                  };
                  return (
                    <tr
                      key={row.id}
                      // The row carries the opening of the panel, by click as by keyboard:
                      // a cell may hold its own buttons, and a button inside a button
                      // would be neither valid nor usable from the keyboard.
                      tabIndex={0}
                      aria-haspopup={onRowOpen === undefined ? "dialog" : undefined}
                      onClick={(event) => {
                        // A link in a cell keeps its own destination.
                        if (event.target instanceof Element && event.target.closest("a") !== null)
                          return;
                        openRow();
                      }}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return;
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        openRow();
                      }}
                      aria-current={selected ? "true" : undefined}
                      className={`h-(--row-height) cursor-pointer border-b border-line last:border-b-0 hover:bg-surface-sunken focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--focus-ring) ${
                        selected ? "bg-accent-soft" : ""
                      }`}
                    >
                      <td
                        className="w-8 px-2"
                        // Ticking must not open the detail panel.
                        onClick={(event) => {
                          event.stopPropagation();
                        }}
                        // Shift+Click extends a selection of rows, not of text.
                        onMouseDown={(event) => {
                          if (event.shiftKey) event.preventDefault();
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={row.getIsSelected()}
                          disabled={!row.getCanSelect()}
                          aria-label={t("list.selectRow")}
                          title={t("list.selectRangeHint")}
                          onChange={(event) => {
                            tick(row.id, event.target.checked, event.nativeEvent);
                          }}
                        />
                      </td>
                      {row
                        .getVisibleCells()
                        .filter((cell) => fitted.has(cell.column.id))
                        .map((cell, index) => {
                          const meta = getMeta(cell.column.columnDef).column;
                          const content = flexRender(cell.column.columnDef.cell, cell.getContext());
                          // The raw value stands for the cell: a live update changing it
                          // flashes the cell, and a row it brings flashes whole.
                          const signature = signatureOf(cell.getValue());
                          return index === 0 ? (
                            <FlashCell
                              key={cell.id}
                              header
                              signature={signature}
                              appear={shownOnce.current}
                              className="px-2 text-left font-medium"
                            >
                              <span className="inline-flex items-center gap-1.5">
                                {/* A slot as wide as the mark on every row, filled or
                                  not: the content of a frozen row lines up with
                                  the others instead of moving by the mark. */}
                                {rowLead !== undefined && (
                                  <span className="inline-flex w-3.5 shrink-0 justify-center">
                                    {rowLead(row.original)}
                                  </span>
                                )}
                                {content}
                              </span>
                            </FlashCell>
                          ) : (
                            <FlashCell
                              key={cell.id}
                              signature={signature}
                              className={meta.numeric === true ? "px-2 text-right" : "px-2"}
                            >
                              {content}
                            </FlashCell>
                          );
                        })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </FlashScope>
        </div>
      )}
    </>
  );
}

/** A value as a string, to tell whether it changed from one render to the next. */
function signatureOf(value: unknown): string {
  return typeof value === "string" ? value : (JSON.stringify(value) ?? "");
}

/** Reads the metadata of a column, which TanStack types as `unknown`. */
function getMeta<T>(columnDef: ColumnDef<T>): ColumnMeta<T> {
  return columnDef.meta as ColumnMeta<T>;
}
