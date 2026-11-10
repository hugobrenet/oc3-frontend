import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { components } from "@/lib/api/schema";
import { CrossLink } from "@/components/opensvc/CrossLink";
import { RelatedTable, type RelatedColumn } from "@/components/opensvc/RelatedTable";
import { StatusBadge } from "@/components/opensvc/StatusBadge";
import { DateTime } from "@/components/ui/DateTime";
import { SearchBox } from "@/components/ui/SearchBox";
import { FlashScope } from "@/components/opensvc/Flash";
import { matchesSearch } from "@/lib/search-match";
import { filterKey } from "@/lib/column-filters";
import { formatLogMessage, logLevelState } from "@/features/logs/log-message";
import { LogUser } from "@/features/logs/LogUser";
import { SERVICE_LOGS_LIMIT, useServiceLogs } from "./queries";

type LogRow = components["schemas"]["LogRow"];

/**
 * The log entries of a service, the most recent first, as the historical service
 * log tab: date, level, node, user (and who really signed in, when impersonated),
 * action and message, the message filled from its values. The latest
 * `SERVICE_LOGS_LIMIT` show here; the Logs view, filtered on the service, has them
 * all.
 */
export function ServiceLogs({ svcId }: { svcId: string; locale: string }) {
  const { t } = useTranslation();
  const logs = useServiceLogs(svcId);
  const all = logs.data?.rows ?? [];
  const total = logs.data?.total;
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  // On what each column shows: the message filled from its values, the user and
  // whoever really signed in.
  const rows = all.filter((row) =>
    matchesSearch(
      needle,
      row.log_date,
      row.log_level,
      row["nodes.nodename"],
      row.log_user,
      row.log_impersonator,
      row.log_action,
      formatLogMessage(row.log_fmt, row.log_dict).text,
    ),
  );

  const columns: RelatedColumn<LogRow>[] = [
    {
      key: "log_date",
      label: t("logs.fields.log_date"),
      render: (row) => <DateTime value={row.log_date} />,
    },
    {
      key: "log_level",
      label: t("logs.fields.log_level"),
      render: (row) =>
        row.log_level === undefined ? null : (
          <StatusBadge state={logLevelState(row.log_level)} label={row.log_level} />
        ),
    },
    {
      key: "nodes.nodename",
      label: t("logs.fields.nodes.nodename"),
      render: (row) =>
        row["nodes.nodename"] === null || row["nodes.nodename"] === undefined ? null : (
          <CrossLink kind="node" id={row.node_id}>
            {row["nodes.nodename"]}
          </CrossLink>
        ),
    },
    {
      key: "log_user",
      label: t("logs.fields.log_user"),
      render: (row) => (
        <LogUser user={row.log_user} impersonator={row.log_impersonator} origin={row.log_origin} />
      ),
    },
    { key: "log_action", label: t("logs.fields.log_action"), render: (row) => row.log_action },
    {
      key: "log_fmt",
      label: t("logs.fields.log_fmt"),
      grow: true,
      render: (row) => {
        const message = formatLogMessage(row.log_fmt, row.log_dict);
        return message.corrupted ? (
          <span>
            {message.parts} <span className="text-state-warn">▲ {t("logs.corrupted")}</span>
          </span>
        ) : (
          <span>{message.parts}</span>
        );
      },
    },
  ];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <SearchBox value={query} onChange={setQuery} label={t("services.logs.search")} />
        {logs.isSuccess && (
          <p role="status" className="text-ink-muted tabular-nums">
            {needle === ""
              ? t("services.logs.count", { count: all.length })
              : t("services.logs.matching", { count: rows.length, total: all.length })}
          </p>
        )}
      </div>
      {/* Rows a search brings back are no live update: they do not flash. */}
      <FlashScope subject={needle}>
        <RelatedTable
          columns={columns}
          groups={[{ key: "all", label: "", rows }]}
          rowKey={(row) => String(row.id)}
          isPending={logs.isPending}
          errorMessage={logs.isError ? logs.error.message : null}
          empty={needle === "" ? t("services.logs.empty") : t("services.logs.noMatch")}
          caption={t("services.related.logs")}
        />
      </FlashScope>
      {all.length > 0 && (
        <p className="flex flex-wrap items-center gap-x-3 text-ink-muted">
          {logs.data?.hasMore === true &&
            t(needle === "" ? "nodes.logs.latest" : "nodes.logs.searchLatest", {
              count: SERVICE_LOGS_LIMIT,
              total: total ?? SERVICE_LOGS_LIMIT,
            })}
          <Link
            to="/logs"
            search={{ [filterKey("svc_id")]: `eq:${svcId}` }}
            className="text-accent hover:underline"
          >
            {t("nodes.logs.open")}
          </Link>
        </p>
      )}
    </div>
  );
}
