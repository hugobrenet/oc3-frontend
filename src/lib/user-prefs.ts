import {
  applyDateFormat,
  cachedDateFormat,
  isDateFormatChoice,
  isHourCycleChoice,
  type DateFormatChoice,
  type DateFormatPrefs,
  type HourCycleChoice,
} from "./date-format";
import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "./api/client";
import { problemText } from "./api/problem";
import { FILTER_KEY_PREFIX, filterKey, type ColumnFilters } from "./column-filters";
import { DEFAULT_LIMIT, PAGE_SIZES, type ListSearch, type ResolvedListSearch } from "./list-search";
import { useTabViewPrefs, type TabViewPrefs } from "./tab-view-prefs";
import {
  applyPalette,
  applyTheme,
  cachedPalette,
  cachedTheme,
  isPalette,
  isTheme,
  watchSystemTheme,
  type Palette,
  type Theme,
} from "./theme";
import {
  applyLanguage,
  cachedLanguage,
  isLanguageChoice,
  watchBrowserLanguage,
  type LanguageChoice,
} from "./language";

/**
 * User preferences, as the historical collector keeps them in the `prefs` column of
 * `user_prefs`: a free JSON object, stored as it is by `POST /users/self/prefs`. The
 * visible columns of a view live under `tables.<view>.visible_columns`, as in
 * `init/static/js/osvc/tables/table.js`, so that an account finds its columns again
 * from one interface to the other. The sort sits next to them, under
 * `tables.<view>.sort`: the old interface did not keep it, so that key is unknown to
 * it and without effect there. Column filters follow under
 * `tables.<view>.column_filters`, in the apicollector syntax: the old interface keeps
 * its own, in another syntax, under `filters`, and each ignores the other's. The
 * number of rows per page is kept under `tables.<view>.perpage`, the key of the old
 * interface, which both therefore share.
 *
 * The rest of the object — the old column filters, live mode, hidden menu entries —
 * belongs to the old interface: it is read back and stored again untouched.
 */
/** The defaults of a view, kept with the account: what new tabs open the list with. */
export interface ViewPrefs {
  visible_columns?: string[];
  /** Sort keys, prefixed with `-` for descending order, as in the URL. */
  sort?: string[];
  /** Column filters, prop → apicollector expression, as in the URL. */
  column_filters?: ColumnFilters;
  /**
   * Rows per page. The old interface may have written it as a string, or a size
   * this one does not offer: such a value is ignored.
   */
  perpage?: number | string;
}

/** A saved page size, when it is one the lists offer. */
function savedLimit(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : value;
  return PAGE_SIZES.find((size) => size === n);
}

export interface UserPrefs {
  tables?: Record<string, ViewPrefs | undefined>;
  /** Chosen light or dark mode; absent means "system". */
  theme?: string;
  /** Chosen colour palette; absent means "standard". */
  palette?: string;
  /**
   * Chosen language of the interface, "en" or "fr"; absent means the browser's
   * ("system"), which is never stored. The old interface has no such choice.
   */
  language?: string;
  /**
   * The side menu: the keys of the collapsed sections. Absent, every section is
   * expanded. The old interface does not fold its menu, so the key is ours alone.
   */
  nav?: { collapsed?: string[]; view?: string };
  /**
   * The records the user bookmarked, oldest first, each named by its kind and its
   * id. The old interface has no bookmarks: the key is ours alone.
   */
  bookmarks?: Bookmark[];
  /**
   * The request forms the user starred, and those they submitted last, newest
   * first, by form id. The old interface has neither: the key is ours alone.
   */
  requests?: { favorites?: number[]; recent?: number[] };
  /**
   * How the panel history groups its records: "kind" by kind of object; absent, by
   * how long ago they were shown. Not under `history`, an obsolete key once holding
   * the history itself. The old interface has no panel history.
   */
  historyGrouping?: string;
  /**
   * The edge of the window the detail panels open against: "left"; absent, the
   * right one. The old interface has no such choice.
   */
  panelSide?: string;
  /**
   * How dates read: a convention of `DATE_FORMATS` (`src/lib/date-format.ts`);
   * absent, the browser's regional settings. The old interface has no such choice.
   */
  dateFormat?: string;
  /** The clock of the times, "h23" or "h12"; absent, the one of the date format. */
  hourCycle?: string;
  [key: string]: unknown;
}

/** A bookmarked record: the kind of object and its id. */
export interface Bookmark {
  kind: string;
  id: string;
}

export const PREFS_KEY = ["user", "self", "prefs"];

function asPrefs(value: unknown): UserPrefs {
  return typeof value === "object" && value !== null ? (value as UserPrefs) : {};
}

async function fetchPrefs(): Promise<UserPrefs> {
  const { data, error } = await api.GET("/users/{user_id}/prefs", {
    params: { path: { user_id: "self" } },
  });
  if (error !== undefined) throw new Error(problemText(error));
  return asPrefs(data.data);
}

/** Current preferences, loaded once and shared by every view. */
export function useUserPrefs() {
  return useQuery({ queryKey: PREFS_KEY, queryFn: fetchPrefs, staleTime: 5 * 60 * 1000 });
}

/** The settings of a list: what the URL may leave out, filled in from the defaults. */
export interface ViewSettings {
  cols?: string[];
  sort?: string[];
  filters?: ColumnFilters;
  limit?: number;
}

/** Whether two settings of a list are the same, an empty one being no setting. */
function sameSetting(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) =>
    v === null ||
    v === undefined ||
    (Array.isArray(v) && v.length === 0) ||
    (typeof v === "object" && Object.keys(v).length === 0)
      ? undefined
      : JSON.stringify(v);
  return norm(a) === norm(b);
}

/**
 * Columns, sort, filters and page size of a list, and what it takes to change them.
 *
 * A change applies to this browser tab only (`useTabViewPrefs`): two tabs may show
 * the same list their own way. The account keeps the user's defaults, under
 * `tables.<view>`, which a tab follows for whatever it did not change, and which
 * change only when the user saves a tab's settings as their default
 * (`saveAsDefault`), new tabs then opening with them.
 *
 * The URL keeps priority: a shared link shows its columns, its sort and its filters,
 * not those of whoever opens it. These settings therefore only serve when the URL
 * carries none.
 */
export function useViewPrefs(view: string) {
  const queryClient = useQueryClient();
  const prefs = useUserPrefs();
  const tab = useTabViewPrefs(view);
  const entry = prefs.data?.tables?.[view];
  const defaults: ViewSettings = {
    cols: entry?.visible_columns,
    sort: entry?.sort,
    filters: entry?.column_filters,
    limit: savedLimit(entry?.perpage),
  };
  const own = tab.entry;
  // A setting changed in the tab overrides the default, null meaning the built-in.
  const pick = <K extends keyof ViewSettings>(key: K): ViewSettings[K] =>
    own !== undefined && key in own ? ((own[key] ?? undefined) as ViewSettings[K]) : defaults[key];
  const customized =
    own !== undefined &&
    (Object.keys(own) as (keyof ViewSettings)[]).some(
      (key) => !sameSetting(pick(key), defaults[key]),
    );

  return {
    cols: pick("cols"),
    sort: pick("sort"),
    filters: pick("filters"),
    limit: pick("limit"),
    /** The account's defaults, which new tabs open with. */
    defaults,
    /** Whether the settings of this tab differ from the defaults. */
    customized,
    /**
     * Records in the tab what a list update changes of its columns, sort, filters
     * and page size, the other states staying in the URL only.
     */
    saveSearch: (next: Partial<ResolvedListSearch>) => {
      const patch: TabViewPrefs = {};
      if ("cols" in next) patch.cols = next.cols?.length ? next.cols : null;
      if ("sort" in next) patch.sort = next.sort?.length ? next.sort : null;
      if ("filters" in next)
        patch.filters = next.filters && Object.keys(next.filters).length > 0 ? next.filters : null;
      // The default page size is no setting.
      if ("limit" in next) patch.limit = next.limit === DEFAULT_LIMIT ? null : (next.limit ?? null);
      if (Object.keys(patch).length > 0) tab.set(patch);
    },
    /**
     * Saves settings, those the tab shows, as the user's defaults, then lets the tab
     * follow them. Empty settings and the default page size are not saved.
     */
    saveAsDefault: async (settings: ViewSettings): Promise<void> => {
      const saved: ViewPrefs = {};
      if (settings.cols?.length) saved.visible_columns = settings.cols;
      if (settings.sort?.length) saved.sort = settings.sort;
      if (settings.filters && Object.keys(settings.filters).length > 0)
        saved.column_filters = settings.filters;
      if (settings.limit !== undefined && settings.limit !== DEFAULT_LIMIT)
        saved.perpage = settings.limit;
      await savePrefs(queryClient, (current) => {
        const tables = { ...current.tables };
        // What the old interface keeps under the view, its filters say, stays.
        const rest: ViewPrefs = { ...tables[view] };
        delete rest.visible_columns;
        delete rest.sort;
        delete rest.column_filters;
        delete rest.perpage;
        const next = { ...rest, ...saved };
        if (Object.keys(next).length === 0) delete tables[view];
        else tables[view] = next;
        return { ...current, tables };
      });
      tab.clear();
    },
    /** Forgets the settings of the tab: it follows the defaults again. */
    restoreDefault: () => {
      tab.clear();
    },
  };
}

/** What `useViewPrefs` gives a list. */
export type ViewPrefsControl = ReturnType<typeof useViewPrefs>;

/**
 * Keys this interface once saved with the account and no longer reads: the panel
 * history, now kept by the browser tab (`record-history.ts`), and whether its rail
 * was folded. Each save drops them from the stored preferences.
 */
const OBSOLETE_KEYS = ["history", "historyCollapsed"];

function withoutObsolete(prefs: UserPrefs): UserPrefs {
  if (!OBSOLETE_KEYS.some((key) => key in prefs)) return prefs;
  const kept = { ...prefs };
  for (const key of OBSOLETE_KEYS) delete kept[key];
  return kept;
}

/** The last save started: the next one waits for it (`savePrefs`). */
let saving: Promise<void> = Promise.resolve();

/**
 * Applies a change to the preferences object and saves it.
 *
 * The object is read back before being written again: the server replaces the whole
 * of it, and another tab may have saved its own preferences in the meantime.
 *
 * The saves of this tab run one after another, each reading what the one before
 * wrote: two saves started together, by two hooks say, read the same state, and
 * the second write dropped the change of the first. A save that fails does not
 * stop the next ones.
 */
export function savePrefs(
  queryClient: QueryClient,
  change: (current: UserPrefs) => UserPrefs,
): Promise<void> {
  const run = saving.then(() => writePrefs(queryClient, change));
  saving = run.catch(() => undefined);
  return run;
}

async function writePrefs(
  queryClient: QueryClient,
  change: (current: UserPrefs) => UserPrefs,
): Promise<void> {
  const next = withoutObsolete(change(await fetchPrefs()));
  const { error } = await api.POST("/users/{user_id}/prefs", {
    params: { path: { user_id: "self" } },
    body: { data: next },
  });
  if (error !== undefined) throw new Error(problemText(error));
  queryClient.setQueryData(PREFS_KEY, next);
}

/**
 * Completes the URL state of a view with its preferences, before resolving it: the
 * URL wins, preferences only fill in what it does not carry.
 */
export function withSavedSearch(
  search: ListSearch,
  saved: { cols?: string[]; sort?: string[]; filters?: ColumnFilters; limit?: number },
): ListSearch {
  // Filters go as a whole: a link filtering on one column does not inherit the
  // saved filters of the others.
  const urlFilters = Object.keys(search).some((key) => key.startsWith(FILTER_KEY_PREFIX));
  const savedFilters = urlFilters
    ? {}
    : Object.fromEntries(
        Object.entries(saved.filters ?? {}).map(([prop, expr]) => [filterKey(prop), expr]),
      );
  return {
    ...savedFilters,
    ...search,
    cols: search.cols ?? saved.cols?.join(","),
    sort: search.sort ?? saved.sort?.join(","),
    limit: search.limit ?? saved.limit,
  };
}

/** Mode and palette in effect: the account's once known, the local cache until then. */
function currentAppearance(prefs: ReturnType<typeof useUserPrefs>): {
  theme: Theme;
  palette: Palette;
} {
  const storedTheme = prefs.data?.theme;
  const storedPalette = prefs.data?.palette;
  return {
    theme: isTheme(storedTheme) ? storedTheme : prefs.isSuccess ? "system" : cachedTheme(),
    palette: isPalette(storedPalette)
      ? storedPalette
      : prefs.isSuccess
        ? "standard"
        : cachedPalette(),
  };
}

/**
 * Applies the account's mode and palette, for as long as someone is signed in.
 *
 * Called once by the application shell, not by the profile page: the choice made on
 * another machine must apply as soon as the preferences arrive, whatever the first
 * page opened. Until then, the local cache applied at startup (`src/main.tsx`) holds.
 */
export function useAppearance(): void {
  const prefs = useUserPrefs();
  const { theme, palette } = currentAppearance(prefs);
  const language = currentLanguage(prefs);
  useEffect(() => {
    applyLanguage(language);
  }, [language]);
  // The browser's language may change during the session, while it is the one used.
  const currentChoice = useRef(language);
  useEffect(() => {
    currentChoice.current = language;
  }, [language]);
  useEffect(() => watchBrowserLanguage(() => currentChoice.current), []);

  const dates = currentDateFormatPrefs(prefs);
  useEffect(() => {
    applyDateFormat({ format: dates.format, hourCycle: dates.hourCycle });
  }, [dates.format, dates.hourCycle]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  useEffect(() => {
    applyPalette(palette);
  }, [palette]);

  // The system theme may change during the session, from a sleeping screen or an hour.
  const current = useRef(theme);
  useEffect(() => {
    current.current = theme;
  }, [theme]);
  useEffect(() => watchSystemTheme(() => current.current), []);
}

/**
 * One appearance choice, as the profile page edits it: its value, and a setter that
 * applies it at once and saves it. If the save fails, the stored value is applied
 * again, so that the screen does not show a choice the account does not hold.
 */
function useAppearanceChoice<K extends "theme" | "palette", V extends Theme | Palette>(
  key: K,
  value: V,
  apply: (value: V) => void,
) {
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: async (next: V) => {
      apply(next);
      await savePrefs(queryClient, (currentPrefs) => ({ ...currentPrefs, [key]: next }));
    },
    onError: () => {
      apply(value);
    },
  });
  return {
    // The choice being saved shows at once, rather than when the server confirms it.
    value: save.isPending ? save.variables : value,
    set: (next: V) => {
      save.mutate(next);
    },
    isSaving: save.isPending,
    errorMessage: save.isError ? save.error.message : null,
  };
}

/** Light or dark mode chosen by the account. */
export function useThemePref() {
  const { theme } = currentAppearance(useUserPrefs());
  return useAppearanceChoice("theme", theme, applyTheme);
}

/** Colour palette chosen by the account: standard, high contrast or colour-blind friendly. */
export function usePalettePref() {
  const { palette } = currentAppearance(useUserPrefs());
  return useAppearanceChoice("palette", palette, applyPalette);
}

/** Language in effect: the account's once known, the local cache until then. */
function currentLanguage(prefs: ReturnType<typeof useUserPrefs>): LanguageChoice {
  const stored = prefs.data?.language;
  if (isLanguageChoice(stored) && stored !== "system") return stored;
  return prefs.isSuccess ? "system" : cachedLanguage();
}

/**
 * Language chosen by the account, as the profile page edits it, in the shape of the
 * appearance choices. "system" is not stored: choosing it removes `language` from
 * the preferences, the browser's language then applying as before any choice.
 */
export function useLanguagePref() {
  const queryClient = useQueryClient();
  const language = currentLanguage(useUserPrefs());
  const save = useMutation({
    mutationFn: async (next: LanguageChoice) => {
      applyLanguage(next);
      await savePrefs(queryClient, (currentPrefs) => {
        const rest = { ...currentPrefs };
        delete rest.language;
        return next === "system" ? rest : { ...rest, language: next };
      });
    },
    onError: () => {
      applyLanguage(language);
    },
  });
  return {
    // The choice being saved shows at once, rather than when the server confirms it.
    value: save.isPending ? save.variables : language,
    set: (next: LanguageChoice) => {
      save.mutate(next);
    },
    isSaving: save.isPending,
    errorMessage: save.isError ? save.error.message : null,
  };
}

/** The date format of the account, or the local cache until its preferences arrive. */
function currentDateFormatPrefs(prefs: ReturnType<typeof useUserPrefs>): DateFormatPrefs {
  if (!prefs.isSuccess) return cachedDateFormat();
  const { dateFormat, hourCycle } = prefs.data;
  return {
    format: isDateFormatChoice(dateFormat) ? dateFormat : "system",
    hourCycle: isHourCycleChoice(hourCycle) ? hourCycle : "auto",
  };
}

/**
 * The date format and the clock chosen by the account, as the profile page edits
 * them, each in the shape of the appearance choices. The defaults are not stored:
 * choosing one removes its key.
 */
export function useDateFormatPref() {
  const queryClient = useQueryClient();
  const stored = currentDateFormatPrefs(useUserPrefs());
  const save = useMutation({
    mutationFn: async (next: DateFormatPrefs) => {
      applyDateFormat(next);
      await savePrefs(queryClient, (currentPrefs) => {
        const rest = { ...currentPrefs };
        delete rest.dateFormat;
        delete rest.hourCycle;
        return {
          ...rest,
          ...(next.format === "system" ? {} : { dateFormat: next.format }),
          ...(next.hourCycle === "auto" ? {} : { hourCycle: next.hourCycle }),
        };
      });
    },
    onError: () => {
      applyDateFormat(stored);
    },
  });
  // The choice being saved shows at once, rather than when the server confirms it.
  const value = save.isPending ? save.variables : stored;
  const common = {
    isSaving: save.isPending,
    errorMessage: save.isError ? save.error.message : null,
  };
  return {
    format: {
      ...common,
      value: value.format,
      set: (format: DateFormatChoice) => {
        save.mutate({ ...value, format });
      },
    },
    hourCycle: {
      ...common,
      value: value.hourCycle,
      set: (hourCycle: HourCycleChoice) => {
        save.mutate({ ...value, hourCycle });
      },
    },
  };
}

/**
 * Forgets the columns, the sort, the column filters and the page size saved for
 * every view.
 *
 * Only those keys are removed: the old interface keeps its column filters and the
 * folded state of its sections in the same object, and those are not ours to clear.
 * The page size (`perpage`) is shared with it: forgetting it brings both interfaces
 * back to their default. A view left with nothing disappears from `tables`.
 */
export function useResetViewPrefs() {
  const queryClient = useQueryClient();
  const reset = useMutation({
    mutationFn: async () =>
      savePrefs(queryClient, (current) => {
        const tables: Record<string, ViewPrefs | undefined> = {};
        for (const [view, entry] of Object.entries(current.tables ?? {})) {
          const rest = { ...entry };
          delete rest.visible_columns;
          delete rest.sort;
          delete rest.column_filters;
          delete rest.perpage;
          if (Object.keys(rest).length > 0) tables[view] = rest;
        }
        return { ...current, tables };
      }),
  });
  return {
    reset: () => {
      reset.mutate();
    },
    isPending: reset.isPending,
    isDone: reset.isSuccess,
    /** When the reset that succeeded was asked: tells one report from the next. */
    doneAt: reset.isSuccess ? reset.submittedAt : null,
    errorMessage: reset.isError ? reset.error.message : null,
  };
}

/** True when at least one view has saved columns, sort, filters or page size. */
export function hasSavedViewPrefs(prefs: UserPrefs | undefined): boolean {
  return Object.values(prefs?.tables ?? {}).some(
    (entry) =>
      entry?.visible_columns !== undefined ||
      entry?.sort !== undefined ||
      entry?.column_filters !== undefined ||
      entry?.perpage !== undefined,
  );
}

/** The sections of the side menu collapsed by the account. */
function collapsedSections(prefs: UserPrefs | undefined): string[] {
  const collapsed = prefs?.nav?.collapsed;
  return Array.isArray(collapsed) ? collapsed.filter((key) => typeof key === "string") : [];
}

/**
 * Which sections of the side menu are collapsed, and the toggle of one. The change
 * shows at once and is saved in the background; if the save fails, the stored
 * state is read again.
 */
export function useNavCollapsedPref() {
  const queryClient = useQueryClient();
  const prefs = useUserPrefs();
  const collapsed = collapsedSections(prefs.data);
  const save = useMutation({
    mutationFn: async (next: string[]) => {
      queryClient.setQueryData<UserPrefs>(PREFS_KEY, (current) => ({
        ...current,
        nav: { ...current?.nav, collapsed: next },
      }));
      await savePrefs(queryClient, (current) => ({
        ...current,
        nav: { ...current.nav, collapsed: next },
      }));
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: PREFS_KEY });
    },
  });
  return {
    isCollapsed: (key: string) => collapsed.includes(key),
    toggle: (key: string) => {
      save.mutate(
        collapsed.includes(key) ? collapsed.filter((k) => k !== key) : [...collapsed, key],
      );
    },
  };
}

/**
 * The menu the side menu shows, operator or admin, kept for the account; operator
 * until one is chosen. The change shows at once and is saved behind it.
 */
export function useNavViewPref() {
  const queryClient = useQueryClient();
  const prefs = useUserPrefs();
  const stored = prefs.data?.nav?.view;
  const view: "operator" | "admin" = stored === "admin" ? "admin" : "operator";
  const save = useMutation({
    mutationFn: async (next: "operator" | "admin") => {
      queryClient.setQueryData<UserPrefs>(PREFS_KEY, (current) => ({
        ...current,
        nav: { ...current?.nav, view: next },
      }));
      await savePrefs(queryClient, (current) => ({
        ...current,
        nav: { ...current.nav, view: next },
      }));
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: PREFS_KEY });
    },
  });
  return {
    view,
    /** Whether the stored choice is read: until then, `view` is the default. */
    ready: prefs.data !== undefined || prefs.isError,
    setView: (next: "operator" | "admin") => {
      if (next !== view) save.mutate(next);
    },
  };
}

/** Beyond this many records, adding one drops the oldest. */
const BOOKMARKS_SIZE = 50;

function storedBookmarks(prefs: UserPrefs | undefined): Bookmark[] {
  const entries = prefs?.bookmarks;
  return Array.isArray(entries)
    ? entries.filter(
        (e): e is Bookmark =>
          typeof e === "object" &&
          e !== null &&
          typeof (e as Bookmark).kind === "string" &&
          typeof (e as Bookmark).id === "string",
      )
    : [];
}

/**
 * The bookmarked records, oldest first, and what adds, removes or clears them. Only
 * an explicit request bookmarks a record. Saved with the account, so that the
 * bookmarks follow the user from view to view and from one session to the next; a
 * change shows at once and is saved in the background, the stored bookmarks read
 * again if the save fails.
 */
export function useBookmarksPref() {
  const queryClient = useQueryClient();
  const prefs = useUserPrefs();
  const entries = storedBookmarks(prefs.data);
  const save = useMutation({
    mutationFn: async (next: Bookmark[]) => {
      queryClient.setQueryData<UserPrefs>(PREFS_KEY, (current) => ({
        ...current,
        bookmarks: next,
      }));
      await savePrefs(queryClient, (current) => ({ ...current, bookmarks: next }));
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: PREFS_KEY });
    },
  });
  const same = (a: Bookmark, kind: string, id: string) => a.kind === kind && a.id === id;
  return {
    entries,
    has: (kind: string, id: string) => entries.some((e) => same(e, kind, id)),
    add: (kind: string, id: string) => {
      if (entries.some((e) => same(e, kind, id))) return;
      save.mutate([...entries, { kind, id }].slice(-BOOKMARKS_SIZE));
    },
    remove: (kind: string, id: string) => {
      save.mutate(entries.filter((e) => !same(e, kind, id)));
    },
    clear: () => {
      save.mutate([]);
    },
  };
}

/** Forms kept in the recent list of the request catalog. */
const RECENT_FORMS_SIZE = 8;

function formIds(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((v): v is number => Number.isInteger(v)) : [];
}

/**
 * The favorite and recently submitted request forms, and what changes them. Saved
 * with the account, as the bookmarks: a change shows at once and is saved in the
 * background, the stored lists read again if the save fails. A submission adds
 * its form at the head of the recent list, which keeps the last
 * `RECENT_FORMS_SIZE`.
 */
export function useRequestFormsPref() {
  const queryClient = useQueryClient();
  const prefs = useUserPrefs();
  const favorites = formIds(prefs.data?.requests?.favorites);
  const recent = formIds(prefs.data?.requests?.recent);
  const save = useMutation({
    mutationFn: async (
      change: (current: { favorites: number[]; recent: number[] }) => {
        favorites: number[];
        recent: number[];
      },
    ) => {
      const apply = (current: UserPrefs | undefined): UserPrefs => ({
        ...current,
        requests: change({
          favorites: formIds(current?.requests?.favorites),
          recent: formIds(current?.requests?.recent),
        }),
      });
      queryClient.setQueryData<UserPrefs>(PREFS_KEY, apply);
      await savePrefs(queryClient, apply);
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: PREFS_KEY });
    },
  });
  return {
    favorites,
    recent,
    // Read, or given up: a failed read leaves the lists empty rather than waiting.
    isLoaded: !prefs.isPending,
    isFavorite: (id: number) => favorites.includes(id),
    toggleFavorite: (id: number) => {
      save.mutate((current) => ({
        ...current,
        favorites: current.favorites.includes(id)
          ? current.favorites.filter((f) => f !== id)
          : [...current.favorites, id],
      }));
    },
    addRecent: (id: number) => {
      save.mutate((current) => ({
        ...current,
        recent: [id, ...current.recent.filter((r) => r !== id)].slice(0, RECENT_FORMS_SIZE),
      }));
    },
  };
}

/** How the panel history groups its records: by time, the default, or by kind. */
export type HistoryGrouping = "time" | "kind";

/**
 * The grouping of the panel history, saved with the account; "time", the default,
 * is not stored.
 */
export function useHistoryGrouping() {
  const queryClient = useQueryClient();
  const prefs = useUserPrefs();
  const stored: HistoryGrouping = prefs.data?.historyGrouping === "kind" ? "kind" : "time";
  const save = useMutation({
    mutationFn: (next: HistoryGrouping) =>
      savePrefs(queryClient, (current) => {
        const rest = { ...current };
        delete rest.historyGrouping;
        return next === "kind" ? { ...rest, historyGrouping: next } : rest;
      }),
  });
  return {
    // The choice being saved shows at once, rather than when the server confirms it.
    value: save.isPending ? save.variables : stored,
    set: (next: HistoryGrouping) => {
      save.mutate(next);
    },
  };
}

/** The edges of the window the detail panels can stand against, the default first. */
export const PANEL_SIDES = ["right", "left"] as const;
export type PanelSideChoice = (typeof PANEL_SIDES)[number];

/**
 * The edge the detail panels and their history open against, saved with the
 * account; "right", the default, is not stored.
 */
export function usePanelSidePref() {
  const queryClient = useQueryClient();
  const prefs = useUserPrefs();
  const stored: PanelSideChoice = prefs.data?.panelSide === "left" ? "left" : "right";
  const save = useMutation({
    mutationFn: (next: PanelSideChoice) =>
      savePrefs(queryClient, (current) => {
        const rest = { ...current };
        delete rest.panelSide;
        return next === "left" ? { ...rest, panelSide: next } : rest;
      }),
  });
  return {
    // The choice being saved shows at once, rather than when the server confirms it.
    value: save.isPending ? save.variables : stored,
    set: (next: PanelSideChoice) => {
      save.mutate(next);
    },
    isSaving: save.isPending,
    errorMessage: save.isError ? save.error.message : null,
  };
}
