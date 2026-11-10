import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { components } from "@/lib/api/schema";
import { api } from "@/lib/api/client";
import { toPage } from "@/lib/api/page";
import { problemText } from "@/lib/api/problem";
import { CollectorList, type ListColumn } from "@/components/opensvc/CollectorList";
import { ObjectIcon } from "@/components/opensvc/ObjectIcon";
import { YamlCode } from "@/components/ui/YamlCode";
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
import { ChartCreatePanel } from "./ChartCreatePanel";
import { ChartDetailPanel } from "./ChartDetailPanel";
import { useChart } from "./use-chart";

type ChartRow = components["schemas"]["ChartRow"];

/** By name, as the historical table. */
const DEFAULT_SORT = ["chart_name"];

/** The columns of the historical charts table, in its order. */
const REPORT_PROPS = [
  "id",
  "chart_name",
  "chart_yaml",
] as const satisfies readonly (keyof ChartRow)[];

/** Default columns: those of the historical table (`default_columns`). */
const DEFAULT_COLS: string[] = ["chart_name", "chart_yaml"];

/** Lines of a definition shown in its cell; the rest is counted. */
const DEFINITION_LINES = 8;

function columns(t: TFunction): ListColumn<ChartRow>[] {
  return REPORT_PROPS.map((prop) => ({
    prop,
    labelKey: `charts.fields.${prop}`,
    numeric: prop === "id",
    family: prop === "chart_yaml" ? "alert" : "state",
    render: (row: ChartRow) => {
      if (prop === "chart_yaml")
        // The first lines of the definition as YAML: the whole of it is in the detail.
        return row.chart_yaml === undefined || row.chart_yaml.trim() === "" ? (
          <span className="text-ink-muted italic">{t("charts.definitionEmpty")}</span>
        ) : (
          <YamlCode
            text={row.chart_yaml}
            maxLines={DEFINITION_LINES}
            moreLabel={(count) => t("charts.definitionMore", { count })}
          />
        );
      return row[prop];
    },
  }));
}

const ALL_PROPS = [...REPORT_PROPS];

/** Columns shown, plus the id used by the detail. */
function queryProps(cols: string[] | undefined): string {
  return [...new Set(["id", ...visibleProps(cols, DEFAULT_COLS, ALL_PROPS)])].join(",");
}

/**
 * One page of the list, read with the sort, the filters and the columns of `search`.
 * The view reads the page on display with it, and the export every page in turn.
 */
async function fetchCharts(search: ResolvedListSearch) {
  // One row more than the page: whether another page follows.
  const { data, error } = await api.GET("/charts", {
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
  const all: ChartRow[] = Array.isArray(data.data) ? data.data : [];
  return toPage(all, data.meta, search.limit);
}

/**
 * The distribution of a column's values over the charts the filters given keep,
 * for its filter: the pagination does not apply.
 */
async function chartStats(prop: string, filters: ColumnFilters): Promise<ValueStats> {
  const query = { props: prop, stats: "1", limit: STATS_LIMIT, filter: filterQuery(filters) };
  const response = await api.GET("/charts", { params: { query } });
  if (response.error !== undefined) throw new Error(problemText(response.error));
  return toValueStats(response.data.data, response.data.meta, prop);
}

function useCharts(search: ResolvedListSearch) {
  return useQuery({
    queryKey: [
      "charts",
      search.sort,
      search.offset,
      search.limit,
      search.cols,
      filtersKey(search.filters),
    ],
    // The rows on display stay while the next ones load: typing a filter must not
    // empty the table under the field.
    placeholderData: keepPreviousData,
    queryFn: () => fetchCharts(search),
  });
}

/**
 * The charts: time series of historized metrics, defined in YAML, as in the
 * historical collector's administration (`adm-charts`). A Manager sees them all, the
 * others those published to one of their teams. Creating one requires the
 * ReportsManager privilege, as for the reports; the interface does not know the
 * caller's privileges and shows the server's refusal. A chart is not edited nor
 * drawn here yet: its detail is read-only.
 */
export function ChartsPage() {
  const { t } = useTranslation();
  const prefs = useViewPrefs("charts");
  const search = resolveListSearch(
    withSavedSearch(useSearch({ from: "/charts" }), prefs),
    DEFAULT_SORT,
  );
  const navigate = useNavigate({ from: "/charts" });
  const { data, isPending, isError, error, isFetching } = useCharts(search);
  // A single form: creation when nothing is selected, editing of the selected chart.
  const [form, setForm] = useState<"create" | "edit" | null>(null);
  const creating = form === "create";
  const edited = useChart(form === "edit" ? search.sel : undefined);

  /** Ids of the whole selection, filters included, without pagination. */
  async function allIds(): Promise<string[]> {
    const { data, error } = await api.GET("/charts", {
      params: { query: { props: "id", limit: 0, filter: filterQuery(search.filters) } },
    });
    if (error !== undefined) throw new Error(problemText(error));
    const rows: ChartRow[] = Array.isArray(data.data) ? data.data : [];
    return rows.flatMap((row) => (row.id === undefined ? [] : [String(row.id)]));
  }

  function update(next: Partial<ResolvedListSearch>) {
    // Choosing a row ends a creation in progress: the row's detail takes the right
    // edge, where the two drawers would otherwise overlap.
    if (next.sel !== undefined) setForm(null);
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
          <ObjectIcon kind="chart" className="h-5 w-5" />
          {t("charts.title")}
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
          {t("charts.form.open")}
        </button>
      </div>
      <p className="mb-3 max-w-3xl text-ink-muted">{t("charts.intro")}</p>

      <CollectorList
        viewPrefs={prefs}
        valueStats={chartStats}
        columns={columns(t)}
        defaultCols={DEFAULT_COLS}
        rows={data?.rows ?? []}
        rowId={(row) => (row.id === undefined ? undefined : String(row.id))}
        search={search}
        onChange={update}
        isPending={isPending}
        isFetching={isFetching}
        errorMessage={isError ? error.message : null}
        hasMore={data?.hasMore ?? false}
        exportPage={(page) => fetchCharts({ ...search, ...page })}
        total={data?.total}
        selectAllMatching={allIds}
        filterable
      />

      <ChartDetailPanel
        chartId={form !== null ? undefined : search.sel}
        label={selected?.chart_name ?? ""}
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

      <ChartCreatePanel
        open={creating || (form === "edit" && edited.data !== undefined)}
        chart={form === "edit" ? edited.data : undefined}
        onClose={() => {
          setForm(null);
        }}
        onCreated={(id) => {
          // The new chart opens in the detail.
          if (id !== undefined) update({ sel: String(id) });
        }}
      />
    </section>
  );
}
