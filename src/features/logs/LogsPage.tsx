import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { components } from "@/lib/api/schema";
import { api } from "@/lib/api/client";
import { problemText } from "@/lib/api/problem";
import { toPage } from "@/lib/api/page";
import {
  CollectorList,
  type ColumnFilterOption,
  type ListColumn,
} from "@/components/opensvc/CollectorList";
import { CrossLink } from "@/components/opensvc/CrossLink";
import { ObjectIcon } from "@/components/opensvc/ObjectIcon";
import { StatusBadge } from "@/components/opensvc/StatusBadge";
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
import { LogDetailPanel } from "./LogDetailPanel";
import { formatLogMessage, logLevelState } from "./log-message";
import { LogUser } from "./LogUser";

type LogRow = components["schemas"]["LogRow"];

/**
 * By date, from the most recent to the oldest. Many log entries share the same
 * second: the id, which grows with writing, breaks the tie in the same order, without
 * which pagination could repeat or skip rows on equal dates.
 */
const DEFAULT_SORT = ["-log_date", "-id"];

/**
 * Properties exposed by apicollector, joined names included. `log_fmt` carries the
 * "Message" column: it shows the format filled in from `log_dict`.
 */
const LOG_PROPS = [
  "log_date",
  "log_level",
  "services.svcname",
  "nodes.nodename",
  "log_user",
  "log_impersonator",
  "log_origin",
  "log_request_id",
  "log_action",
  "log_fmt",
  "log_dict",
  "id",
  "svc_id",
  "node_id",
  "log_entry_id",
  "log_gtalk_sent",
  "log_email_sent",
] as const satisfies readonly (keyof LogRow)[];

/** Default columns: those of the historical table (`default_columns`). */
const DEFAULT_COLS: string[] = [
  "log_date",
  "log_level",
  "services.svcname",
  "nodes.nodename",
  "log_user",
  "log_action",
  "log_fmt",
];

/** The levels the collector writes, as the badges of the column show them. */
const LEVEL_OPTIONS: ColumnFilterOption[] = ["info", "warning", "error"].map((value) => ({
  value,
  render: <StatusBadge state={logLevelState(value)} label={value} />,
}));

const NUMERIC_PROPS = new Set<string>(["id", "log_entry_id", "log_gtalk_sent", "log_email_sent"]);

const FAMILY: Record<string, ColumnFamily> = {
  log_date: "time",
  log_level: "alert",
  "services.svcname": "service",
  "nodes.nodename": "node",
  log_user: "team",
  log_impersonator: "team",
  log_origin: "team",
  log_request_id: "state",
  log_action: "state",
  log_fmt: "alert",
  log_dict: "alert",
  id: "state",
  svc_id: "service",
  node_id: "node",
  log_entry_id: "state",
  log_gtalk_sent: "alert",
  log_email_sent: "alert",
};

/**
 * Columns shown and the id; the message needs the values from `log_dict`, and the
 * name of the node needs its OS for the logo.
 */
function queryProps(cols: string[] | undefined): string {
  const shown = visibleProps(cols, DEFAULT_COLS, [...LOG_PROPS]);
  const extra = [
    ...(shown.includes("log_fmt") ? ["log_dict"] : []),
    // The joined names are badges towards their view: they need their id.
    ...(shown.includes("nodes.nodename") ? ["node_id"] : []),
    ...(shown.includes("services.svcname") ? ["svc_id"] : []),
    // The user cell names the impersonator, when there was one, and the client
    // the action was made through, the assistant for one.
    ...(shown.includes("log_user") ? ["log_impersonator", "log_origin"] : []),
  ];
  return [...new Set(["id", ...shown, ...extra])].join(",");
}

/**
 * The distribution of a column's values over the selection: the filters given
 * apply, not the pagination.
 */
async function logStats(prop: string, filters: ColumnFilters): Promise<ValueStats> {
  const query = { props: prop, stats: "1", limit: STATS_LIMIT, filter: filterQuery(filters) };
  const response = await api.GET("/logs", { params: { query } });
  if (response.error !== undefined) throw new Error(problemText(response.error));
  return toValueStats(response.data.data, response.data.meta, prop);
}

/**
 * One page of the list, read with the sort, the filters and the columns of `search`.
 * The view reads the page on display with it, and the export every page in turn.
 */
async function fetchLogs(search: ResolvedListSearch) {
  // One row more than the page: apicollector does not return the total of a selection.
  const { data, error } = await api.GET("/logs", {
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
  if (error !== undefined) throw new Error(JSON.stringify(error));
  const all: LogRow[] = Array.isArray(data.data) ? data.data : [];
  return toPage(all, data.meta, search.limit);
}

function useLogs(search: ResolvedListSearch) {
  return useQuery({
    queryKey: [
      "logs",
      search.sort,
      search.offset,
      search.limit,
      search.cols,
      filtersKey(search.filters),
    ],
    // The rows on display stay while the next ones load: typing a filter must not
    // empty the table under the field.
    placeholderData: keepPreviousData,
    queryFn: () => fetchLogs(search),
  });
}

export function LogsPage() {
  const { t } = useTranslation();
  const prefs = useViewPrefs("logs");
  const search = resolveListSearch(
    withSavedSearch(useSearch({ from: "/logs" }), prefs),
    DEFAULT_SORT,
  );
  const navigate = useNavigate({ from: "/logs" });
  const { data, isPending, isError, error, isFetching } = useLogs(search);

  /** Ids of the whole selection, filters included, without pagination. */
  async function allIds(): Promise<string[]> {
    const { data, error } = await api.GET("/logs", {
      params: {
        query: {
          props: "id",
          limit: 0,
          filter: filterQuery(search.filters),
        },
      },
    });
    if (error !== undefined) throw new Error(JSON.stringify(error));
    const rows: LogRow[] = Array.isArray(data.data) ? data.data : [];
    return rows
      .map((row) => row.id)
      .filter((id): id is number => id !== undefined)
      .map(String);
  }

  function update(next: Partial<ResolvedListSearch>) {
    // Columns, sort, filters and page size follow the account, the other states
    // stay in the URL.
    prefs.saveSearch(next);
    void navigate({
      search: (previous) => mergeSearch(previous, next),
      resetScroll: resetsScroll(next),
    });
  }

  const columns: ListColumn<LogRow>[] = LOG_PROPS.map((prop) => ({
    prop,
    labelKey: `logs.fields.${prop}`,
    numeric: NUMERIC_PROPS.has(prop),
    family: FAMILY[prop] ?? "state",
    // The message filters on the format and the values filling it together (the
    // API compares both): a node or tag name typed there is among the values.
    filter: prop === "log_level" ? { kind: "enum", options: LEVEL_OPTIONS } : undefined,
    render: (row: LogRow) => {
      const value = row[prop];
      if (prop === "log_date") return <DateTime value={row.log_date} />;
      if (prop === "log_level")
        return row.log_level === undefined ? undefined : (
          <StatusBadge state={logLevelState(row.log_level)} label={row.log_level} />
        );
      if (prop === "services.svcname")
        return value === null || value === undefined ? undefined : (
          <CrossLink kind="service" id={row.svc_id}>
            {value}
          </CrossLink>
        );
      if (prop === "nodes.nodename")
        return value === null || value === undefined ? undefined : (
          <CrossLink kind="node" id={row.node_id}>
            {value}
          </CrossLink>
        );
      if (prop === "log_user")
        return (
          <LogUser
            user={row.log_user}
            impersonator={row.log_impersonator}
            origin={row.log_origin}
          />
        );
      if (prop === "log_fmt") {
        const message = formatLogMessage(row.log_fmt, row.log_dict);
        return message.corrupted ? (
          <span title={t("logs.corrupted")}>
            {message.parts} <span className="text-state-warn">▲ {t("logs.corrupted")}</span>
          </span>
        ) : (
          <span>{message.parts}</span>
        );
      }
      return value;
    },
  }));

  const selected = data?.rows.find((row) => String(row.id) === search.sel);

  return (
    <section>
      <div className="mb-3 flex items-center gap-3">
        <h1 className="flex items-center gap-2 text-title font-semibold">
          <ObjectIcon kind="log" className="h-5 w-5" />
          {t("logs.title")}
        </h1>
      </div>

      <CollectorList
        viewPrefs={prefs}
        columns={columns}
        defaultCols={DEFAULT_COLS}
        rows={data?.rows ?? []}
        rowId={(row) => (row.id === undefined ? undefined : String(row.id))}
        search={search}
        onChange={update}
        isPending={isPending}
        isFetching={isFetching}
        errorMessage={isError ? error.message : null}
        hasMore={data?.hasMore ?? false}
        exportPage={(page) => fetchLogs({ ...search, ...page })}
        total={data?.total}
        selectAllMatching={allIds}
        valueStats={logStats}
        filterable
      />

      <LogDetailPanel
        logId={search.sel}
        label={selected?.log_action ?? ""}
        onClose={() => {
          update({ sel: undefined });
        }}
      />
    </section>
  );
}
