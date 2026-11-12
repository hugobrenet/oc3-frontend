import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { components } from "@/lib/api/schema";
import { api } from "@/lib/api/client";
import { DetailPanel, type DetailGroup } from "@/components/opensvc/DetailPanel";
import { severityField } from "@/components/opensvc/status-field";
import { linkedField } from "@/components/opensvc/linked-field";
import { formatDateTime } from "@/lib/format";
import { AlertTimeline } from "./AlertTimeline";
import { AlertActionsMenu } from "./AlertActionsMenu";
import { alertName } from "./alert-name";
import { AskAssistantLink } from "@/features/assistant/AskAssistantLink";

type AlertRow = components["schemas"]["AlertRow"];

const text = (prop: keyof AlertRow) => (row: AlertRow) => {
  const value = row[prop];
  // A joined prop is null when the entry aims at the other kind of object.
  return value === undefined || value === null ? undefined : String(value);
};

const date = (prop: keyof AlertRow) => (row: AlertRow) => {
  const value = row[prop];
  return typeof value === "string" ? formatDateTime(value) : undefined;
};

const field = (
  prop: keyof AlertRow,
  format?: (row: AlertRow, locale: string) => string | undefined,
) => ({ prop, format: format ?? text(prop) });

const GROUPS: DetailGroup<AlertRow>[] = [
  {
    key: "alert",
    family: "alert",
    fields: [
      field("dash_type"),
      severityField<AlertRow>("dash_severity", (row) => row.dash_severity),
      field("alert"),
      field("dash_env"),
      field("dash_instance"),
      field("dash_created", date("dash_created")),
      field("dash_updated", date("dash_updated")),
    ],
  },
  {
    key: "object",
    family: "service",
    fields: [
      linkedField<AlertRow>(
        "services.svcname",
        "service",
        (row) => row.svc_id,
        text("services.svcname"),
      ),
      linkedField<AlertRow>("nodes.nodename", "node", (row) => row.node_id, text("nodes.nodename")),
      field("svc_id"),
      field("node_id"),
    ],
  },
  {
    key: "raw",
    family: "state",
    fields: [field("id"), field("dash_fmt"), field("dash_dict"), field("dash_dict_md5")],
  },
];

const PROPS = GROUPS.flatMap((group) => group.fields.map((f) => f.prop)).join(",");

export function AlertDetailPanel({
  alertId,
  label,
  onClose,
  onDeleted,
}: {
  alertId: string | undefined;
  label: string;
  onClose: () => void;
  /** After the alert was deleted from its menu; the panel closes by itself. */
  onDeleted?: (id: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const {
    data: alert,
    isPending,
    isError,
    error,
  } = useQuery({
    queryKey: ["alert", alertId],
    enabled: alertId !== undefined,
    queryFn: async () => {
      const { data, error: failure } = await api.GET("/alerts/{id}", {
        params: { path: { id: alertId ?? "" }, query: { props: PROPS } },
      });
      if (failure !== undefined) throw new Error(JSON.stringify(failure));
      const rows: AlertRow[] = Array.isArray(data.data) ? data.data : [];
      return rows[0] ?? null;
    },
  });

  return (
    <DetailPanel
      kind="dashboard"
      open={alertId !== undefined}
      title={alert?.dash_type ?? (label === "" ? t("dashboard.detail.title") : label)}
      onClose={onClose}
      titleActions={
        alertId !== undefined && alert !== null && alert !== undefined ? (
          <div className="flex items-center gap-2">
            <AlertActionsMenu
              alerts={[{ id: alertId, name: alertName(alert) }]}
              onDeleted={() => {
                onDeleted?.(alertId);
                onClose();
              }}
            />
            <AskAssistantLink
              prompt={t("assistant.askAbout.alert", {
                type: alert.dash_type ?? "",
                object: alert["services.svcname"] ?? alert["nodes.nodename"] ?? "",
                instance: alert.dash_instance ?? "",
                context: alert.dash_instance ? "instance" : undefined,
              })}
            />
          </div>
        ) : undefined
      }
      groups={GROUPS}
      row={alert}
      labelPrefix="alerts.fields"
      groupPrefix="dashboard.detail.groups"
      isPending={isPending}
      errorMessage={isError ? error.message : null}
      actions={
        alertId !== undefined && alert !== null && alert !== undefined ? (
          <section>
            <h3 className="mb-1 font-semibold text-ink-muted">{t("dashboard.timeline.title")}</h3>
            <AlertTimeline alertId={alertId} created={alert.dash_created} locale={i18n.language} />
          </section>
        ) : undefined
      }
    />
  );
}
