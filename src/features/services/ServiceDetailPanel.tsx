import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { components, paths } from "@/lib/api/schema";
import { api } from "@/lib/api/client";
import { problemText } from "@/lib/api/problem";
import { DetailContent, type DetailGroup } from "@/components/opensvc/DetailPanel";
import { statusField } from "@/components/opensvc/status-field";
import { AvailabilityRate } from "@/components/opensvc/AvailabilityRate";
import { formatPercent } from "@/lib/format";
import { linkedField } from "@/components/opensvc/linked-field";
import { NodeNameLinks } from "@/components/opensvc/NodeNameLinks";
import { ObjectTags } from "@/components/opensvc/ObjectTags";
import { useTagEdit } from "@/features/tags/use-tag-edit";
import { useAmIResponsible } from "@/lib/api/am-i-responsible";
import {
  useFieldConstraints,
  valueLists,
} from "@/features/field-constraints/use-field-constraints";
import { RelatedTabsPanel } from "@/components/opensvc/RelatedTabsPanel";
import { StatusTimeline } from "@/components/opensvc/StatusTimeline";
import { ServiceActionsMenu } from "./ServiceActionsMenu";
import { ServiceWebappLink } from "@/components/opensvc/AgentWebappLink";
import { useServiceTags } from "./related/queries";
import { SERVICE_RELATED_TABS, SERVICE_TAB_GROUPS } from "./related/service-related";
import { formatDateTime } from "@/lib/format";
import { AskAssistantLink } from "@/features/assistant/AskAssistantLink";

type ServiceRow = components["schemas"]["ServiceRow"];

const text = (prop: keyof ServiceRow) => (row: ServiceRow) => {
  const value = row[prop];
  return value === undefined ? undefined : String(value);
};

const date = (prop: keyof ServiceRow) => (row: ServiceRow) => {
  const value = row[prop];
  return typeof value === "string" ? formatDateTime(value) : undefined;
};

const field = (
  prop: keyof ServiceRow,
  format?: (row: ServiceRow, locale: string) => string | undefined,
) => ({ prop, format: format ?? text(prop) });

/**
 * Booleans shown as a switch, read-only: the daemon keeps them up to date.
 *
 * `svc_frozen` and `svc_provisioned` are not among them: they are states with
 * several values on the om3 side — "frozen", "unfrozen", "mixed", "n/a" for one,
 * "true", "false", "mixed", "n/a" for the other — which a switch cannot represent.
 */
const flag = (prop: keyof ServiceRow) => ({ ...field(prop), input: "boolean" as const });

/**
 * The body of a change of the service. A responsible sets the SLA, the
 * notifications and their snooze, the start wave and the disaster recovery
 * nodes, as the historical service properties let one: the agents do not report
 * them. `svc_app` is not offered: the configuration feed writes it back at each
 * push.
 */
type ServiceUpdate = NonNullable<
  paths["/services/{svc_id}"]["post"]["requestBody"]
>["content"]["application/json"];

const GROUPS: DetailGroup<ServiceRow>[] = [
  {
    key: "identity",
    family: "service",
    fields: [
      field("svcname"),
      field("svc_id"),
      linkedField<ServiceRow>("svc_app", "app", (row) => row.svc_app, text("svc_app")),
      field("svc_env"),
      field("cluster_id"),
      field("svc_comment"),
    ],
  },
  {
    key: "state",
    family: "state",
    fields: [
      statusField<ServiceRow>("svc_availstatus", (row) => row.svc_availstatus),
      statusField<ServiceRow>("svc_status", (row) => row.svc_status),
      // The availability target the Services view flags the rate against; set by
      // the responsibles of the service, empty to remove it.
      {
        prop: "svc_sla",
        format: (row) => (typeof row.svc_sla === "number" ? String(row.svc_sla) : undefined),
        render: (row, locale) =>
          typeof row.svc_sla === "number" ? formatPercent(row.svc_sla, locale, 3) : null,
        editable: true,
      },
      {
        prop: "svc_availability",
        format: (row) =>
          typeof row.svc_availability === "number" ? String(row.svc_availability) : undefined,
        // Flagged against the SLA and followed by its trend, as in the Services view.
        render: (row, locale) =>
          typeof row.svc_availability === "number" ? (
            <AvailabilityRate
              rate={row.svc_availability}
              sla={row.svc_sla}
              trend={row.svc_availability_trend}
              locale={locale}
            />
          ) : null,
      },
      field("svc_frozen"),
      field("svc_provisioned"),
      field("svc_status_updated", date("svc_status_updated")),
      {
        ...field("svc_snooze_till", date("svc_snooze_till")),
        input: "date" as const,
        editable: true,
      },
      { ...flag("svc_notifications"), editable: true },
    ],
  },
  {
    key: "placement",
    family: "node",
    fields: [
      field("svc_topology"),
      field("svc_placement"),
      {
        ...field("svc_nodes"),
        render: (row) => <NodeNameLinks names={row.svc_nodes ?? ""} clusterId={row.cluster_id} />,
      },
      flag("svc_ha"),
      field("svc_autostart"),
      field("svc_flex_min_nodes"),
      field("svc_flex_max_nodes"),
      field("svc_flex_target"),
      field("svc_flex_cpu_low_threshold"),
      field("svc_flex_cpu_high_threshold"),
      { ...field("svc_wave"), input: "number" as const, editable: true },
    ],
  },
  {
    key: "disasterRecovery",
    family: "drp",
    fields: [
      { ...field("svc_drpnode"), editable: true },
      { ...field("svc_drpnodes"), editable: true },
      field("svc_drptype"),
      field("svc_metrocluster"),
      flag("svc_drnoaction"),
    ],
  },
  {
    key: "collector",
    family: "service",
    fields: [
      field("svc_created", date("svc_created")),
      field("svc_config_updated", date("svc_config_updated")),
      field("updated", date("updated")),
      field("svc_hostid"),
    ],
  },
];

// Ask the collector only for the properties actually shown, plus the trend the
// availability field renders without a field of its own.
const PROPS = [
  ...GROUPS.flatMap((group) => group.fields.map((f) => f.prop)),
  "svc_availability_trend",
].join(",");

/**
 * Detail of a service: its properties, then its related data, one tab each
 * (`SERVICE_RELATED_TABS`), gathered in groups (`SERVICE_TAB_GROUPS`). The open tab
 * lives in the URL (`tab`), held by the view.
 */
export function ServiceDetailPanel({
  svcId,
  svcname,
  onClose,
  tab,
  onTabChange,
}: {
  svcId: string | undefined;
  svcname: string;
  onClose: () => void;
  tab: string | undefined;
  onTabChange: (tab: string | undefined) => void;
}) {
  const { t, i18n } = useTranslation();
  const {
    data: service,
    isPending,
    isError,
    error,
  } = useQuery({
    queryKey: ["service", svcId],
    enabled: svcId !== undefined,
    queryFn: async ({ signal }) => {
      const { data, error: failure } = await api.GET("/services/{svc_id}", {
        signal,
        params: { path: { svc_id: svcId ?? "" }, query: { props: PROPS } },
      });
      if (failure !== undefined) throw new Error(JSON.stringify(failure));
      const rows: ServiceRow[] = Array.isArray(data.data) ? data.data : [];
      return rows[0] ?? null;
    },
  });

  const open = svcId !== undefined;
  const tags = useServiceTags(svcId);
  const tagEdit = useTagEdit("service", svcId);
  // The values a Manager configured for some attributes, offered when editing them.
  const constraints = useFieldConstraints("service");
  const queryClient = useQueryClient();
  // The owners of the service justify its periods of unavailability.
  const responsible = useAmIResponsible("service", svcId);

  return (
    <RelatedTabsPanel
      open={open}
      title={service?.svcname ?? (svcname === "" ? t("services.detail.title") : svcname)}
      kind="service"
      onClose={onClose}
      objectId={svcId}
      tabs={SERVICE_RELATED_TABS}
      groups={SERVICE_TAB_GROUPS}
      // The boxes as a horizontal masonry, as on the node.
      tileLayout="masonry"
      tab={tab}
      onTabChange={onTabChange}
      propertiesFamily="service"
      label={t("services.related.label")}
      titleActions={
        <div className="flex items-center gap-2">
          {tagEdit.allowed && svcId !== undefined && (
            <ServiceActionsMenu
              services={[{ id: svcId, name: service?.svcname ?? svcId }]}
              onDeleted={onClose}
            />
          )}
          <ServiceWebappLink
            svcname={service?.svcname}
            nodes={service?.svc_nodes}
            clusterId={service?.cluster_id}
          />
          {service?.svcname !== undefined && (
            <AskAssistantLink
              prompt={t("assistant.askAbout.service", { service: service.svcname })}
            />
          )}
        </div>
      }
    >
      <ObjectTags
        tags={tags.data}
        isPending={open && tags.isPending}
        errorMessage={tags.isError ? tags.error.message : null}
        edit={tagEdit}
      />
      <DetailContent
        groups={GROUPS}
        row={service}
        labelPrefix="services.fields"
        groupPrefix="services.detail.groups"
        valueLists={valueLists(constraints.data?.data)}
        isPending={open && isPending}
        errorMessage={isError ? error.message : null}
        editHint={t("services.detail.editHint")}
        // Offered to the responsibles of the service, as the API checks it.
        onSave={
          tagEdit.allowed
            ? async (changes) => {
                if (svcId === undefined) return;
                const body: ServiceUpdate = {};
                const str = (v: unknown) => (typeof v === "string" ? v : undefined);
                body.svc_sla = str(changes.svc_sla);
                body.svc_snooze_till = str(changes.svc_snooze_till);
                body.svc_drpnode = str(changes.svc_drpnode);
                body.svc_drpnodes = str(changes.svc_drpnodes);
                if (typeof changes.svc_wave === "number") body.svc_wave = changes.svc_wave;
                if (typeof changes.svc_notifications === "boolean")
                  body.svc_notifications = changes.svc_notifications;
                for (const key of Object.keys(body) as (keyof ServiceUpdate)[])
                  if (body[key] === undefined) delete body[key];
                if (Object.keys(body).length === 0) return;
                const { error: failure } = await api.POST("/services/{svc_id}", {
                  params: { path: { svc_id: svcId } },
                  body,
                });
                if (failure !== undefined) throw new Error(problemText(failure));
                await Promise.all([
                  queryClient.invalidateQueries({ queryKey: ["service", svcId] }),
                  queryClient.invalidateQueries({ queryKey: ["services"] }),
                ]);
              }
            : undefined
        }
        groupFooters={
          svcId === undefined
            ? undefined
            : {
                // The availability of the service only: the instance statuses are
                // in the instance panels, the resources in their tab.
                state: (
                  <StatusTimeline
                    queryKey={["service", svcId, "status-log"]}
                    locale={i18n.language}
                    tracks={[{ key: "avail", label: t("statusTimeline.avail") }]}
                    load={async (days) => {
                      const { data, error: failure } = await api.GET(
                        "/services/{svc_id}/status_log",
                        { params: { path: { svc_id: svcId }, query: { days } } },
                      );
                      if (failure !== undefined) throw new Error(problemText(failure));
                      return {
                        periods: data.data.map((p) => ({
                          begin: p.begin,
                          end: p.end,
                          values: { avail: p.status },
                          ack:
                            p.ack === undefined
                              ? undefined
                              : {
                                  comment: p.ack.comment,
                                  account: p.ack.account,
                                  by: p.ack.acked_by,
                                  on: p.ack.acked_on,
                                },
                        })),
                        availability: {
                          rate: data.availability.rate,
                          from: data.availability.from,
                          excludedSeconds: data.availability.excluded_s,
                        },
                      };
                    }}
                    justify={{
                      track: "avail",
                      canEdit: responsible.data === true,
                      save: async (begin, end, comment, account) => {
                        const { error: failure } = await api.PUT(
                          "/services/{svc_id}/status_log/ack",
                          {
                            params: { path: { svc_id: svcId } },
                            body: { begin, end, comment, account },
                          },
                        );
                        return failure === undefined ? null : problemText(failure);
                      },
                      remove: async (begin, end) => {
                        const { error: failure } = await api.DELETE(
                          "/services/{svc_id}/status_log/ack",
                          {
                            params: { path: { svc_id: svcId }, query: { begin, end } },
                          },
                        );
                        return failure === undefined ? null : problemText(failure);
                      },
                    }}
                  />
                ),
              }
        }
      />
    </RelatedTabsPanel>
  );
}
