import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { components } from "@/lib/api/schema";
import { api } from "@/lib/api/client";
import { DetailPanel, type DetailGroup } from "@/components/opensvc/DetailPanel";
import { linkedField } from "@/components/opensvc/linked-field";
import { problemText } from "@/lib/api/problem";
import { formatDateTime } from "@/lib/format";
import { formatLogMessage } from "./log-message";

type LogRow = components["schemas"]["LogRow"];

const text = (prop: keyof LogRow) => (row: LogRow) => {
  const value = row[prop];
  // The joined names are null when the log entry names neither node nor service.
  return value === undefined || value === null ? undefined : String(value);
};

const field = (prop: keyof LogRow) => ({ prop, format: text(prop) });

/** Detail of a log entry, read-only: the collector log cannot be edited. */
const GROUPS: DetailGroup<LogRow>[] = [
  {
    key: "event",
    family: "alert",
    fields: [
      { prop: "log_date", format: (row) => formatDateTime(row.log_date) },
      field("log_level"),
      field("log_action"),
      field("log_user"),
      // The user who really signed in, when the action was made as log_user.
      field("log_impersonator"),
      // The client the action was made through, as it declared it, and its
      // request ID, on the audit lines of the agent and of the MCP too.
      field("log_origin"),
      field("log_request_id"),
      // Plain text in the panel: the bold of the table adds nothing there.
      { prop: "log_fmt", format: (row) => formatLogMessage(row.log_fmt, row.log_dict).text },
    ],
  },
  {
    key: "object",
    family: "service",
    fields: [
      linkedField<LogRow>(
        "services.svcname",
        "service",
        (row) => row.svc_id,
        text("services.svcname"),
      ),
      field("svc_id"),
      linkedField<LogRow>("nodes.nodename", "node", (row) => row.node_id, text("nodes.nodename")),
      field("node_id"),
    ],
  },
  {
    key: "raw",
    family: "state",
    fields: [
      field("id"),
      { prop: "log_raw_fmt", format: (row) => row.log_fmt },
      field("log_dict"),
      field("log_entry_id"),
      field("log_email_sent"),
      field("log_gtalk_sent"),
    ],
  },
];

const PROPS = [
  "id",
  "log_date",
  "log_level",
  "log_action",
  "log_user",
  "log_impersonator",
  "log_origin",
  "log_request_id",
  "log_fmt",
  "log_dict",
  "services.svcname",
  "svc_id",
  "nodes.nodename",
  "node_id",
  "log_entry_id",
  "log_email_sent",
  "log_gtalk_sent",
].join(",");

export function LogDetailPanel({
  logId,
  label,
  onClose,
}: {
  logId: string | undefined;
  label: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const {
    data: entry,
    isPending,
    isError,
    error,
  } = useQuery({
    queryKey: ["log", logId],
    enabled: logId !== undefined,
    queryFn: async () => {
      const { data, error: failure } = await api.GET("/logs/{log_id}", {
        params: { path: { log_id: logId ?? "" }, query: { props: PROPS } },
      });
      if (failure !== undefined) throw new Error(problemText(failure));
      const rows: LogRow[] = Array.isArray(data.data) ? data.data : [];
      return rows[0] ?? null;
    },
  });

  return (
    <DetailPanel
      kind="log"
      open={logId !== undefined}
      title={entry?.log_action ?? (label === "" ? t("logs.detail.title") : label)}
      onClose={onClose}
      groups={GROUPS}
      row={entry}
      labelPrefix="logs.fields"
      groupPrefix="logs.detail.groups"
      isPending={isPending}
      errorMessage={isError ? error.message : null}
    />
  );
}
