import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api/client";
import { toPage } from "@/lib/api/page";
import { problemText } from "@/lib/api/problem";
import { hasPrivilege, useEffectivePrivileges } from "@/lib/api/effective-privileges";
import { CollectorList, type ListColumn } from "@/components/opensvc/CollectorList";
import type { ColumnFamily } from "@/components/opensvc/ColumnFamily";
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
import { EncryptionMark } from "./EncryptionMark";
import { SafeDetailPanel } from "./SafeDetailPanel";
import { SafeSecretsSection } from "./SafeSecretsSection";
import { SafeUploadPanel } from "./SafeUploadPanel";
import { formatBytes, type SafeFileRow } from "./use-safe";

/** The files by name, as the historical table sorts them. */
const DEFAULT_SORT = ["name"];

/** The columns of the historical safe table, with whether the file is encrypted at rest. */
const SAFE_PROPS = [
  "id",
  "uuid",
  "name",
  "size",
  "md5",
  "encrypted",
  "safe_team_publication",
  "safe_team_responsible",
  "uploader",
  "uploader_name",
  "uploaded_from",
  "uploaded_date",
  "sha256",
] as const satisfies readonly (keyof SafeFileRow)[];

/** The default columns of the historical safe table, and whether the file is encrypted. */
const DEFAULT_COLS: string[] = [
  "id",
  "uuid",
  "name",
  "size",
  "md5",
  "encrypted",
  "safe_team_publication",
  "safe_team_responsible",
  "uploader_name",
  "uploaded_from",
  "uploaded_date",
];

/** The icons of the historical columns: safe16, guys16, guy16, ip16, time16. */
const FAMILY: Record<string, ColumnFamily> = {
  safe_team_publication: "team",
  safe_team_responsible: "team",
  uploader: "team",
  uploader_name: "team",
  uploaded_from: "network",
  uploaded_date: "time",
  encrypted: "state",
};

const NUMERIC_PROPS = new Set<string>(["id", "size", "uploader"]);

const COLUMNS: ListColumn<SafeFileRow>[] = SAFE_PROPS.map((prop) => ({
  prop,
  labelKey: `safe.fields.${prop}`,
  numeric: NUMERIC_PROPS.has(prop),
  family: FAMILY[prop] ?? "safe",
  // A condition rather than a column: no text filter to type into.
  filter: prop === "encrypted" ? { kind: "none" as const } : undefined,
  render: (row: SafeFileRow, locale: string) => {
    const value = row[prop];
    if (prop === "size") return formatBytes(row.size, locale);
    if (prop === "encrypted") return <EncryptionMark encrypted={row.encrypted === true} />;
    if (prop === "uploaded_date" && typeof value === "string") return <DateTime value={value} />;
    if ((prop === "md5" || prop === "sha256" || prop === "uuid") && typeof value === "string")
      return <span className="font-mono text-data break-all">{value}</span>;
    if (typeof value === "boolean") return String(value);
    return value;
  },
}));

const ALL_PROPS: string[] = [...SAFE_PROPS];

/** Columns shown, plus the id and the name the detail is titled with. */
function queryProps(cols: string[] | undefined): string {
  return [...new Set(["id", "name", ...visibleProps(cols, DEFAULT_COLS, ALL_PROPS)])].join(",");
}

async function fetchSafeFiles(search: ResolvedListSearch) {
  const { data, error } = await api.GET("/safe", {
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
  const all: SafeFileRow[] = Array.isArray(data.data) ? data.data : [];
  return toPage(all, data.meta, search.limit);
}

/**
 * The distribution of a column's values over the safe files the filters given keep,
 * for its filter: the pagination does not apply.
 */
async function safeFileStats(prop: string, filters: ColumnFilters): Promise<ValueStats> {
  const query = { props: prop, stats: "1", limit: STATS_LIMIT, filter: filterQuery(filters) };
  const response = await api.GET("/safe", { params: { query } });
  if (response.error !== undefined) throw new Error(problemText(response.error));
  return toValueStats(response.data.data, response.data.meta, prop);
}

function useSafeFiles(search: ResolvedListSearch) {
  return useQuery({
    queryKey: [
      "safe",
      "list",
      search.sort,
      search.offset,
      search.limit,
      search.cols,
      filtersKey(search.filters),
    ],
    placeholderData: keepPreviousData,
    queryFn: () => fetchSafeFiles(search),
  });
}

/**
 * The files of the collector safe the user may see: those they uploaded or that
 * are published to one of their groups, every file for a Manager. Each version is a
 * row. The files are referenced as safe://<id> by the service configurations and
 * the compliance rulesets; the agents download them with their node credentials.
 * Uploading needs the SafeUploader privilege.
 */
export function SafePage() {
  const { t } = useTranslation();
  const prefs = useViewPrefs("safe");
  const search = resolveListSearch(
    withSavedSearch(useSearch({ from: "/safe" }), prefs),
    DEFAULT_SORT,
  );
  const navigate = useNavigate({ from: "/safe" });
  const { data, isPending, isError, error, isFetching } = useSafeFiles(search);
  const privileges = useEffectivePrivileges();
  const canUpload =
    privileges.data !== undefined && hasPrivilege(privileges.data, ["SafeUploader"]);
  const [uploading, setUploading] = useState(false);
  // The secrets kept apart from the files, to those managing what holds them.
  const seesSecrets =
    privileges.data !== undefined &&
    hasPrivilege(privileges.data, ["FormsManager", "AlertsManager"]);

  /** Ids of the whole selection, filters included, without pagination. */
  async function allIds(): Promise<string[]> {
    const { data, error } = await api.GET("/safe", {
      params: { query: { props: "id", limit: 0, filter: filterQuery(search.filters) } },
    });
    if (error !== undefined) throw new Error(problemText(error));
    const rows: SafeFileRow[] = Array.isArray(data.data) ? data.data : [];
    return rows.flatMap((row) => (row.id === undefined ? [] : [String(row.id)]));
  }

  function update(next: Partial<ResolvedListSearch>) {
    // Choosing a row ends an upload in progress: the two drawers share the right edge.
    if (next.sel !== undefined) setUploading(false);
    prefs.saveSearch(next);
    void navigate({
      search: (previous) => mergeSearch(previous, next),
      resetScroll: resetsScroll(next),
    });
  }

  const selected = data?.rows.find((row) => String(row.id) === search.sel);

  return (
    <section>
      <div className="mb-1 flex min-h-7 items-center gap-3">
        <h1 className="flex items-center gap-2 text-title font-semibold">
          <ObjectIcon kind="safe" className="h-5 w-5" />
          {t("safe.title")}
        </h1>
        {canUpload && (
          <button
            type="button"
            onClick={() => {
              update({ sel: undefined });
              setUploading(true);
            }}
            className="h-7 rounded-(--radius-control) bg-accent px-3 font-medium text-accent-ink"
          >
            {t("safe.upload.open")}
          </button>
        )}
      </div>
      <p className="mb-3 max-w-3xl text-ink-muted">{t("safe.intro")}</p>

      <CollectorList
        viewPrefs={prefs}
        valueStats={safeFileStats}
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
        exportPage={(page) => fetchSafeFiles({ ...search, ...page })}
        total={data?.total}
        selectAllMatching={allIds}
        filterable
      />

      {seesSecrets && (
        <SafeSecretsSection
          onOpen={() => {
            // The panel of a secret's holder takes the right edge the file panels use.
            setUploading(false);
            update({ sel: undefined, tab: undefined });
          }}
        />
      )}

      <SafeUploadPanel
        open={uploading}
        onClose={() => {
          setUploading(false);
        }}
        onUploaded={(id) => {
          // The new file opens in the detail.
          if (id !== undefined) update({ sel: String(id) });
        }}
      />

      <SafeDetailPanel
        fileId={uploading ? undefined : search.sel}
        label={selected?.name ?? ""}
        tab={search.tab}
        onTabChange={(tab) => {
          update({ tab });
        }}
        onClose={() => {
          update({ sel: undefined, tab: undefined });
        }}
      />
    </section>
  );
}
