import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api/client";
import { toPage } from "@/lib/api/page";
import { problemText } from "@/lib/api/problem";
import { CollectorList, type ListColumn } from "@/components/opensvc/CollectorList";
import { ObjectIcon } from "@/components/opensvc/ObjectIcon";
import { DateTime } from "@/components/ui/DateTime";
import {
  resolveListSearch,
  resetsScroll,
  mergeSearch,
  visibleProps,
  type ResolvedListSearch,
} from "@/lib/list-search";
import { filterQuery, filtersKey, type ColumnFilters } from "@/lib/column-filters";
import { STATS_LIMIT, toValueStats, type ValueStats } from "@/lib/api/value-stats";
import { useViewPrefs, withSavedSearch } from "@/lib/user-prefs";
import { ArrayDetailPanel } from "./ArrayDetailPanel";
import type { ArrayRow } from "./use-arrays";

/** By name, as the historical table. */
const DEFAULT_SORT = ["array_name"];

const ARRAY_PROPS = [
  "array_name",
  "array_model",
  "array_firmware",
  "array_cache",
  "array_level",
  "array_comment",
  "array_updated",
  "id",
] as const satisfies readonly (keyof ArrayRow)[];

type ArrayProp = (typeof ARRAY_PROPS)[number];

const DEFAULT_COLS: string[] = [
  "array_name",
  "array_model",
  "array_firmware",
  "array_cache",
  "array_comment",
  "array_updated",
];

const NUMERIC_PROPS: ArrayProp[] = ["array_cache", "array_level", "id"];

const COLUMNS: ListColumn<ArrayRow>[] = ARRAY_PROPS.map((prop) => ({
  prop,
  labelKey: `arrays.fields.${prop}`,
  numeric: NUMERIC_PROPS.includes(prop),
  family: prop === "array_updated" ? "time" : "disk",
  render: (row: ArrayRow) => {
    const value = row[prop];
    if (prop === "array_updated" && typeof value === "string") return <DateTime value={value} />;
    return value;
  },
}));

const ALL_PROPS: string[] = [...ARRAY_PROPS];

function queryProps(cols: string[] | undefined): string {
  return [...new Set(["id", "array_name", ...visibleProps(cols, DEFAULT_COLS, ALL_PROPS)])].join(
    ",",
  );
}

async function arrayStats(prop: string, filters: ColumnFilters): Promise<ValueStats> {
  const query = { props: prop, stats: "1", limit: STATS_LIMIT, filter: filterQuery(filters) };
  const response = await api.GET("/arrays", { params: { query } });
  if (response.error !== undefined) throw new Error(problemText(response.error));
  return toValueStats(response.data.data, response.data.meta, prop);
}

async function fetchArrays(search: ResolvedListSearch) {
  const { data, error } = await api.GET("/arrays", {
    params: {
      query: {
        props: queryProps(search.cols),
        orderby: search.sort.join(","),
        offset: search.offset,
        limit: search.limit + 1,
        filter: filterQuery(search.filters),
      },
    },
  });
  if (error !== undefined) throw new Error(problemText(error));
  const all: ArrayRow[] = Array.isArray(data.data) ? data.data : [];
  return toPage(all, data.meta, search.limit);
}

function useArrays(search: ResolvedListSearch) {
  return useQuery({
    queryKey: [
      "arrays",
      search.sort,
      search.offset,
      search.limit,
      search.cols,
      filtersKey(search.filters),
    ],
    placeholderData: keepPreviousData,
    queryFn: () => fetchArrays(search),
  });
}

/**
 * The storage arrays the agents inventory, as their proxies report them. A row
 * opens the array: its comment, the nodes inventorying it, its disk groups, its
 * luns and its target ports. A StorageManager changes the comment and the proxies;
 * the quotas of the disk groups have their own view.
 */
export function ArraysPage() {
  const { t } = useTranslation();
  const prefs = useViewPrefs("arrays");
  const search = resolveListSearch(
    withSavedSearch(useSearch({ from: "/arrays" }), prefs),
    DEFAULT_SORT,
  );
  const navigate = useNavigate({ from: "/arrays" });
  const { data, isPending, isError, error, isFetching } = useArrays(search);

  async function allIds(): Promise<string[]> {
    const { data, error } = await api.GET("/arrays", {
      params: { query: { props: "id", limit: 0, filter: filterQuery(search.filters) } },
    });
    if (error !== undefined) throw new Error(problemText(error));
    const rows: ArrayRow[] = Array.isArray(data.data) ? data.data : [];
    return rows.flatMap((row) => (row.id === undefined ? [] : [String(row.id)]));
  }

  function update(next: Partial<ResolvedListSearch>) {
    prefs.saveSearch(next);
    void navigate({
      search: (previous) => mergeSearch(previous, next),
      resetScroll: resetsScroll(next),
    });
  }

  const selected = data?.rows.find((row) => String(row.id) === search.sel);

  return (
    <section>
      <h1 className="mb-3 flex items-center gap-2 text-title font-semibold">
        <ObjectIcon kind="array" className="h-5 w-5" />
        {t("arrays.title")}
      </h1>
      <p className="mb-3 max-w-3xl text-ink-muted">{t("arrays.intro")}</p>

      <CollectorList
        viewPrefs={prefs}
        columns={COLUMNS}
        defaultCols={DEFAULT_COLS}
        rows={data?.rows ?? []}
        rowId={(row) => (row.id === undefined ? undefined : String(row.id))}
        search={search}
        onChange={update}
        isPending={isPending}
        isFetching={isFetching}
        errorMessage={isError ? error.message : null}
        hasMore={data?.hasMore ?? false}
        exportPage={(page) => fetchArrays({ ...search, ...page })}
        total={data?.total}
        selectAllMatching={allIds}
        valueStats={arrayStats}
        filterable
      />

      <ArrayDetailPanel
        arrayId={search.sel}
        label={selected?.array_name ?? ""}
        onClose={() => {
          update({ sel: undefined, tab: undefined });
        }}
        tab={search.tab}
        onTabChange={(tab) => {
          update({ tab });
        }}
      />
    </section>
  );
}
