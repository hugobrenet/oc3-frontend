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
import { StatusBadge, type ObjectState } from "@/components/opensvc/StatusBadge";
import type { ColumnFamily } from "@/components/opensvc/ColumnFamily";
import { DateTime } from "@/components/ui/DateTime";
import {
  mergeSearch,
  resetsScroll,
  resolveListSearch,
  visibleProps,
  type ResolvedListSearch,
} from "@/lib/list-search";
import { filterQuery, filtersKey, type ColumnFilters } from "@/lib/column-filters";
import { STATS_LIMIT, toValueStats, type ValueStats } from "@/lib/api/value-stats";
import { useViewPrefs, withSavedSearch } from "@/lib/user-prefs";
import { DELIVERIES_KEY, SEVERITIES } from "./notifications-api";

type DeliveryRow = components["schemas"]["NotificationDeliveryRow"];

/** The latest first; the id breaks the ties of a message sent at once. */
const DEFAULT_SORT = ["-updated", "-id"];

const PROPS = [
  "updated",
  "state",
  "attempts",
  "recipient_kind",
  "recipient_label",
  "channel_name",
  "group_role",
  "alert_severity",
  "alert_object",
  "alert_type",
  "alert_message",
  "alert_present",
  "last_error",
  "next_try",
  "created",
  "alert_id",
  "recipient",
  "id",
] as const satisfies readonly (keyof DeliveryRow)[];

const DEFAULT_COLS: string[] = [
  "updated",
  "state",
  "recipient_label",
  "alert_severity",
  "alert_object",
  "alert_type",
  "alert_message",
  "last_error",
];

const NUMERIC_PROPS = new Set<string>(["attempts", "alert_id", "id"]);

const FAMILY: Record<string, ColumnFamily> = {
  updated: "time",
  created: "time",
  next_try: "time",
  state: "state",
  attempts: "state",
  last_error: "state",
  recipient_kind: "team",
  recipient_label: "team",
  channel_name: "team",
  group_role: "team",
  recipient: "team",
  alert_severity: "alert",
  alert_object: "alert",
  alert_type: "alert",
  alert_message: "alert",
  alert_present: "alert",
  alert_id: "alert",
  id: "state",
};

function stateOf(state: string | undefined): ObjectState {
  return state === "sent"
    ? "up"
    : state === "failed"
      ? "down"
      : state === "pending"
        ? "warn"
        : "unknown";
}

function queryProps(cols: string[] | undefined): string {
  const shown = visibleProps(cols, DEFAULT_COLS, [...PROPS]);
  // The state cell tells the next try of a failed delivery, and the tries.
  const extra = shown.includes("state") ? ["next_try", "attempts"] : [];
  return [...new Set(["id", ...shown, ...extra])].join(",");
}

async function fetchDeliveries(search: ResolvedListSearch) {
  const { data, error } = await api.GET("/notifications/deliveries", {
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
  const rows: DeliveryRow[] = Array.isArray(data.data) ? data.data : [];
  return toPage(rows, data.meta, search.limit);
}

async function deliveryStats(prop: string, filters: ColumnFilters): Promise<ValueStats> {
  const query = { props: prop, stats: "1", limit: STATS_LIMIT, filter: filterQuery(filters) };
  const { data, error } = await api.GET("/notifications/deliveries", { params: { query } });
  if (error !== undefined) throw new Error(problemText(error));
  return toValueStats(data.data, data.meta, prop);
}

/**
 * The deliveries of the notifications, as the other lists of the collector:
 * columns to choose, filters by column, sort, pagination, export. Their settings
 * follow the account, the page and the filters live in the URL of the page.
 */
export function DeliveriesList() {
  const { t } = useTranslation();
  const prefs = useViewPrefs("notificationDeliveries");
  const search = resolveListSearch(
    withSavedSearch(useSearch({ from: "/notifications" }), prefs),
    DEFAULT_SORT,
  );
  const navigate = useNavigate({ from: "/notifications" });
  const { data, isPending, isError, error, isFetching } = useQuery({
    queryKey: [
      ...DELIVERIES_KEY,
      search.sort,
      search.offset,
      search.limit,
      search.cols,
      filtersKey(search.filters),
    ],
    placeholderData: keepPreviousData,
    queryFn: () => fetchDeliveries(search),
    refetchInterval: 60_000,
  });

  function update(next: Partial<ResolvedListSearch>) {
    prefs.saveSearch(next);
    void navigate({
      search: (previous) => mergeSearch(previous, next),
      resetScroll: resetsScroll(next),
    });
  }

  const enumOf = (
    values: string[],
    label: (v: string) => string,
    state?: (v: string) => ObjectState,
  ): ColumnFilterOption[] =>
    values.map((value) => ({
      value,
      render:
        state === undefined ? (
          label(value)
        ) : (
          <StatusBadge state={state(value)} label={label(value)} />
        ),
    }));
  const filters: Record<string, ListColumn<DeliveryRow>["filter"]> = {
    state: {
      kind: "enum",
      options: enumOf(
        ["sent", "pending", "failed"],
        (v) => t(`notifications.states.${v}`),
        stateOf,
      ),
    },
    recipient_kind: {
      kind: "enum",
      options: enumOf(["subscription", "user"], (v) => t(`notifications.recipientKinds.${v}`)),
    },
    alert_severity: {
      kind: "enum",
      options: enumOf(["0", "1", "2", "3", "4"], (v) =>
        t(`notifications.severities.${SEVERITIES[Number(v)] ?? "notice"}`),
      ),
    },
    alert_present: {
      kind: "enum",
      options: enumOf(["1", "0"], (v) =>
        v === "1" ? t("notifications.present.yes") : t("notifications.present.no"),
      ),
    },
  };

  const columns: ListColumn<DeliveryRow>[] = PROPS.map((prop) => ({
    prop,
    labelKey: `notifications.deliveryFields.${prop}`,
    numeric: NUMERIC_PROPS.has(prop),
    family: FAMILY[prop] ?? "state",
    filter: filters[prop],
    render: (row: DeliveryRow) => {
      const value = row[prop];
      if (prop === "updated" || prop === "created" || prop === "next_try")
        return value === null || value === undefined || value === "" ? undefined : (
          <DateTime value={String(value)} />
        );
      if (prop === "state")
        return (
          <span>
            <StatusBadge
              state={stateOf(row.state)}
              label={t(`notifications.states.${row.state ?? "pending"}`)}
            />
            {row.attempts !== undefined && row.attempts > 1 && (
              <span className="ml-1 text-ink-muted">×{row.attempts}</span>
            )}
            {row.state === "failed" && row.next_try !== undefined && row.next_try !== null && (
              <span className="block text-ink-muted">
                {t("notifications.deliveries.nextTry")} <DateTime value={row.next_try} />
              </span>
            )}
          </span>
        );
      if (prop === "recipient_kind")
        return row.recipient_kind === undefined
          ? undefined
          : t(`notifications.recipientKinds.${row.recipient_kind}`);
      if (prop === "alert_severity")
        return row.alert_severity === undefined || row.alert_severity === null
          ? undefined
          : t(`notifications.severities.${SEVERITIES[row.alert_severity] ?? "notice"}`);
      if (prop === "alert_present")
        return row.alert_present === undefined ? undefined : row.alert_present ? (
          t("notifications.present.yes")
        ) : (
          <span className="text-state-up">{t("notifications.deliveries.gone")}</span>
        );
      if (prop === "last_error")
        return row.last_error === undefined || row.last_error === "" ? undefined : (
          <span className="text-state-down">{row.last_error}</span>
        );
      return value === null || value === undefined ? undefined : String(value);
    },
  }));

  return (
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
      exportPage={(page) => fetchDeliveries({ ...search, ...page })}
      total={data?.total}
      valueStats={deliveryStats}
      filterable
    />
  );
}
