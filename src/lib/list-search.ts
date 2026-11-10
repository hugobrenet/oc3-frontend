import {
  FILTER_KEY_PREFIX,
  filterKey,
  filtersFromSearch,
  type ColumnFilters,
} from "./column-filters";

/**
 * URL state shared by the "collector list" views: sort, pagination, filterset,
 * column filters, visible columns and selected row. The "definition of done" grid asks for these
 * states to be shareable by link alone.
 *
 * Two shapes coexist on purpose:
 *
 * - `ListSearch` is what travels through the URL. Scalars only: the router
 *   serialises any non-primitive value as JSON, which would give links such as
 *   `?sort=%5B%22-mem_bytes%22%5D`. Lists are therefore written in plain text,
 *   separated by commas.
 * - `ResolvedListSearch` is what the components handle, with real lists.
 *
 * `parseListSearch` and `toSearchParams` convert at both boundaries.
 */
export interface ListSearch {
  /** Sort keys separated by commas, prefixed with - for descending order. */
  sort?: string;
  offset?: number;
  limit?: number;
  /** Id of the row whose detail panel is open. */
  sel?: string;
  /** Props of the visible columns; absent means the view's default columns. */
  cols?: string;
  /**
   * Tab open in the detail panel. In the URL so that a link, a reload or the Back
   * button reopen the same tab.
   */
  tab?: string;
  /**
   * Object from another view looked at without leaving this one, as `kind:id`: a
   * badge in a cell opens its record in place of the row panel. In the URL like the
   * rest, so that a link reopens it.
   */
  peek?: string;
  /** Tab open in that panel, when the object looked at has any. */
  peektab?: string;
  /**
   * Category shown by a tab made of several lists, such as the differences
   * between the nodes of a service. Reset when the panel or its tab changes.
   */
  diff?: string;
  /** Position in `peek` of the record on display; the last one when absent. */
  peekat?: number;
  /**
   * Column filters, one key per filtered prop: `f.nodename=~^dev`. Flat keys rather
   * than one object, which the router would serialise as JSON.
   */
  [key: `f.${string}`]: string | undefined;
}

export interface ResolvedListSearch {
  sort: string[];
  offset: number;
  limit: number;
  sel?: string;
  cols?: string[];
  tab?: string;
  peek?: string;
  peektab?: string;
  peekat?: number;
  diff?: string;
  /** Active column filters, prop → apicollector expression. */
  filters: ColumnFilters;
}

export const PAGE_SIZES = [25, 50, 100] as const;

export const DEFAULT_LIMIT = 50;

function toPositiveInt(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return Math.floor(parsed);
}

/**
 * The router reads a bare `?sel=14598355`, typed or pasted, as a number: kept as
 * its string, as the links of the application quote it.
 */
function toNonEmptyString(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * Accepts "a,b" as well as a real array: a link shared before this state moved to
 * strings still carries an array serialised as JSON, which the router hands back as
 * it is.
 */
function toCommaList(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    const items = value.filter((item): item is string => typeof item === "string" && item !== "");
    return items.length === 0 ? undefined : items.join(",");
  }
  return toNonEmptyString(value);
}

export function parseListSearch(raw: Record<string, unknown>): ListSearch {
  const limit = toPositiveInt(raw.limit);
  return {
    ...toFilterParams(filtersFromSearch(raw)),
    sort: toCommaList(raw.sort),
    offset: toPositiveInt(raw.offset),
    limit: PAGE_SIZES.some((size) => size === limit) ? limit : undefined,
    sel: toNonEmptyString(raw.sel),
    cols: toCommaList(raw.cols),
    tab: toNonEmptyString(raw.tab),
    peek: toNonEmptyString(raw.peek),
    peektab: toNonEmptyString(raw.peektab),
    diff: toNonEmptyString(raw.diff),
    peekat: toPositiveInt(raw.peekat),
  };
}

export function resolveListSearch(search: ListSearch, defaultSort: string[]): ResolvedListSearch {
  return {
    sort: search.sort?.split(",") ?? defaultSort,
    offset: search.offset ?? 0,
    limit: search.limit ?? DEFAULT_LIMIT,
    sel: search.sel,
    cols: search.cols?.split(","),
    tab: search.tab,
    peek: search.peek,
    peektab: search.peektab,
    diff: search.diff,
    peekat: search.peekat,
    filters: filtersFromSearch(search),
  };
}

/** Filters as URL keys. */
function toFilterParams(filters: ColumnFilters): Partial<ListSearch> {
  return Object.fromEntries(
    Object.entries(filters).map(([prop, expr]) => [filterKey(prop), expr]),
  ) as Partial<ListSearch>;
}

/**
 * Translates an update coming from a component into the URL shape. An absent key
 * leaves the previous value; a key set to `undefined` clears it. Default values are
 * cleared rather than written, so that the URL carries only what departs from the
 * base view.
 */
export function toSearchParams(next: Partial<ResolvedListSearch>): Partial<ListSearch> {
  const out: Partial<ListSearch> = {};
  if ("sort" in next)
    out.sort = next.sort === undefined || next.sort.length === 0 ? undefined : next.sort.join(",");
  if ("cols" in next)
    out.cols = next.cols === undefined || next.cols.length === 0 ? undefined : next.cols.join(",");
  if ("offset" in next) out.offset = next.offset === 0 ? undefined : next.offset;
  if ("limit" in next) out.limit = next.limit === DEFAULT_LIMIT ? undefined : next.limit;
  // One drawer at a time: opening a row panel closes the record a badge had opened,
  // just as the badge closes the row panel.
  if ("sel" in next) {
    out.sel = next.sel;
    out.peek = undefined;
    out.peektab = undefined;
    out.peekat = undefined;
    out.diff = undefined;
  }
  if ("tab" in next) {
    out.tab = next.tab;
    out.diff = undefined;
  }
  if ("peek" in next) out.peek = next.peek;
  if ("peektab" in next) out.peektab = next.peektab;
  if ("peekat" in next) out.peekat = next.peekat;
  if ("diff" in next) out.diff = next.diff;
  if (next.filters !== undefined) Object.assign(out, toFilterParams(next.filters));
  return out;
}

/**
 * The URL state after an update: `toSearchParams` applied over the previous state.
 *
 * Filters are replaced as a whole: a filter absent from the update is dropped from
 * the URL, which a plain merge would leave behind.
 */
export function mergeSearch(previous: ListSearch, next: Partial<ResolvedListSearch>): ListSearch {
  const base: ListSearch = { ...previous };
  if ("filters" in next) {
    for (const key of Object.keys(base)) {
      if (key.startsWith(FILTER_KEY_PREFIX)) delete base[key as `f.${string}`];
    }
  }
  return { ...base, ...toSearchParams(next) };
}

/**
 * Visible columns, in the order of the selection: the user may have moved them.
 *
 * Without a selection in the URL, these are the view's default columns and not all
 * of them: a view may offer dozens without imposing them. Props unknown to an old or
 * hand-made URL are ignored, as are repeated ones, and an empty selection falls back
 * to the default columns, a table without a column having nothing to show.
 */
export function visibleProps(
  cols: string[] | undefined,
  defaultCols: string[],
  allProps: string[],
): string[] {
  if (cols === undefined) return defaultCols;
  const known = new Set(allProps);
  const kept = [...new Set(cols)].filter((prop) => known.has(prop));
  return kept.length === 0 ? defaultCols : kept;
}

/**
 * States that do not replace the rows on display: open detail panel, its tab,
 * visible columns.
 */
const IN_PLACE_KEYS = new Set<keyof ResolvedListSearch>(["sel", "tab", "cols", "peek", "peektab"]);

/**
 * Should the page scroll back to the top after this URL update?
 *
 * The router does it by default on every navigation. That is wanted when the page,
 * the sort or the filterset change the rows on display, but not when opening the
 * detail of a row reached by scrolling: the list would jump under the panel and the
 * place would be lost on closing it.
 */
export function resetsScroll(next: Partial<ResolvedListSearch>): boolean {
  return Object.keys(next).some((key) => !IN_PLACE_KEYS.has(key as keyof ResolvedListSearch));
}
