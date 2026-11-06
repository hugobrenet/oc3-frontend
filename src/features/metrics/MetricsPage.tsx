import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { components } from "@/lib/api/schema";
import { api } from "@/lib/api/client";
import { toPage } from "@/lib/api/page";
import { problemText } from "@/lib/api/problem";
import { CollectorList, type ListColumn } from "@/components/opensvc/CollectorList";
import { FlagSwitch } from "@/components/opensvc/FlagSwitch";
import { FLAG_FILTER_OPTIONS } from "@/components/opensvc/filter-options";
import { ObjectIcon } from "@/components/opensvc/ObjectIcon";
import type { ColumnFamily } from "@/components/opensvc/ColumnFamily";
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
import { MetricDetailPanel } from "./MetricDetailPanel";
import { MetricFormPanel } from "./MetricFormPanel";
import { useMetric } from "./use-metric";

type MetricRow = components["schemas"]["MetricRow"];

/** By name, as the historical table. */
const DEFAULT_SORT = ["metric_name"];

/** The columns of the historical metrics table, in its order. */
const METRIC_PROPS = [
  "id",
  "metric_name",
  "metric_historize",
  "metric_sql",
  "metric_col_value_index",
  "metric_col_instance_index",
  "metric_col_instance_label",
  "metric_created",
  "metric_author",
] as const satisfies readonly (keyof MetricRow)[];

/** Default columns: those of the historical table (`default_columns`). */
const DEFAULT_COLS: string[] = [
  "metric_name",
  "metric_historize",
  "metric_sql",
  "metric_col_value_index",
  "metric_col_instance_index",
  "metric_col_instance_label",
];

const NUMERIC_PROPS = new Set<string>([
  "id",
  "metric_col_value_index",
  "metric_col_instance_index",
]);

const FAMILY: Record<string, ColumnFamily> = {
  metric_created: "time",
  metric_author: "team",
};

const COLUMNS: ListColumn<MetricRow>[] = METRIC_PROPS.map((prop) => ({
  prop,
  labelKey: `metrics.fields.${prop}`,
  numeric: NUMERIC_PROPS.has(prop),
  family: FAMILY[prop] ?? "state",
  filter: prop === "metric_historize" ? { kind: "enum", options: FLAG_FILTER_OPTIONS } : undefined,
  render: (row: MetricRow) => {
    if (prop === "metric_historize")
      return <FlagSwitch value={row.metric_historize} labelKey="metrics.fields.metric_historize" />;
    if (prop === "metric_created") return <DateTime value={row.metric_created} />;
    if (prop === "metric_sql")
      // Two lines of the request at most: the whole of it is in the detail.
      return (
        <code title={row.metric_sql} className="line-clamp-2 font-mono text-data break-all">
          {row.metric_sql}
        </code>
      );
    return row[prop];
  },
}));

const ALL_PROPS = [...METRIC_PROPS];

/** Columns shown, plus the id used by the detail. */
function queryProps(cols: string[] | undefined): string {
  return [...new Set(["id", ...visibleProps(cols, DEFAULT_COLS, ALL_PROPS)])].join(",");
}

/**
 * One page of the list, read with the sort, the filters and the columns of `search`.
 * The view reads the page on display with it, and the export every page in turn.
 */
async function fetchMetrics(search: ResolvedListSearch) {
  // One row more than the page: whether another page follows.
  const { data, error } = await api.GET("/metrics", {
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
  const all: MetricRow[] = Array.isArray(data.data) ? data.data : [];
  return toPage(all, data.meta, search.limit);
}

/**
 * The distribution of a column's values over the metrics the filters given keep,
 * for its filter: the pagination does not apply.
 */
async function metricStats(prop: string, filters: ColumnFilters): Promise<ValueStats> {
  const query = { props: prop, stats: "1", limit: STATS_LIMIT, filter: filterQuery(filters) };
  const response = await api.GET("/metrics", { params: { query } });
  if (response.error !== undefined) throw new Error(problemText(response.error));
  return toValueStats(response.data.data, response.data.meta, prop);
}

function useMetrics(search: ResolvedListSearch) {
  return useQuery({
    queryKey: [
      "metrics",
      search.sort,
      search.offset,
      search.limit,
      search.cols,
      filtersKey(search.filters),
    ],
    // The rows on display stay while the next ones load: typing a filter must not
    // empty the table under the field.
    placeholderData: keepPreviousData,
    queryFn: () => fetchMetrics(search),
  });
}

/**
 * The metrics: SQL requests whose results feed the charts and the reports, as in the
 * historical collector's administration (`adm-metrics`). A Manager sees them all,
 * the others those published to one of their teams. Creating and editing require
 * the Manager privilege; the interface does not know the caller's privileges and
 * shows the server's refusal.
 */
export function MetricsPage() {
  const { t } = useTranslation();
  const prefs = useViewPrefs("metrics");
  const search = resolveListSearch(
    withSavedSearch(useSearch({ from: "/metrics" }), prefs),
    DEFAULT_SORT,
  );
  const navigate = useNavigate({ from: "/metrics" });
  const { data, isPending, isError, error, isFetching } = useMetrics(search);
  // A single form: creation when nothing is selected, editing otherwise.
  const [form, setForm] = useState<"create" | "edit" | null>(null);
  const selectedMetric = useMetric(form === "edit" ? search.sel : undefined);

  /** Ids of the whole selection, filters included, without pagination. */
  async function allIds(): Promise<string[]> {
    const { data, error } = await api.GET("/metrics", {
      params: { query: { props: "id", limit: 0, filter: filterQuery(search.filters) } },
    });
    if (error !== undefined) throw new Error(problemText(error));
    const rows: MetricRow[] = Array.isArray(data.data) ? data.data : [];
    return rows.flatMap((row) => (row.id === undefined ? [] : [String(row.id)]));
  }

  function update(next: Partial<ResolvedListSearch>) {
    // Choosing a row ends a creation in progress: the row's detail takes the right
    // edge, where the two drawers would otherwise overlap.
    if (next.sel !== undefined && form === "create") setForm(null);
    // Columns, sort, filters and page size follow the account, the other states
    // stay in the URL.
    prefs.saveSearch(next);
    void navigate({
      search: (previous) => mergeSearch(previous, next),
      resetScroll: resetsScroll(next),
    });
  }

  const selected = data?.rows.find((row) => String(row.id) === search.sel);

  return (
    <section>
      <div className="mb-3 flex items-center gap-3">
        <h1 className="flex items-center gap-2 text-title font-semibold">
          <ObjectIcon kind="metric" className="h-5 w-5" />
          {t("metrics.title")}
        </h1>
        <button
          type="button"
          onClick={() => {
            // The drawers share the right edge: opening the creation closes the detail.
            update({ sel: undefined });
            setForm("create");
          }}
          className="h-7 rounded-(--radius-control) bg-accent px-3 font-medium text-accent-ink"
        >
          {t("metrics.form.open")}
        </button>
      </div>
      <p className="mb-3 max-w-3xl text-ink-muted">{t("metrics.intro")}</p>

      <CollectorList
        viewPrefs={prefs}
        valueStats={metricStats}
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
        exportPage={(page) => fetchMetrics({ ...search, ...page })}
        total={data?.total}
        selectAllMatching={allIds}
        filterable
      />

      <MetricDetailPanel
        metricId={form === null ? search.sel : undefined}
        label={selected?.metric_name ?? ""}
        onClose={() => {
          update({ sel: undefined, tab: undefined });
        }}
        onEdit={() => {
          setForm("edit");
        }}
        tab={search.tab}
        onTabChange={(tab) => {
          update({ tab });
        }}
      />

      <MetricFormPanel
        open={form === "create" || (form === "edit" && selectedMetric.data !== undefined)}
        metric={form === "edit" ? selectedMetric.data : undefined}
        onClose={() => {
          setForm(null);
        }}
        onSaved={(id) => {
          // After a creation, the new metric opens in the detail.
          if (form === "create" && id !== undefined) update({ sel: String(id) });
        }}
      />
    </section>
  );
}
