import { useTranslation } from "react-i18next";
import type { components } from "@/lib/api/schema";
import { DetailContent, type DetailGroup } from "@/components/opensvc/DetailPanel";
import { FlagSwitch } from "@/components/opensvc/FlagSwitch";
import { RelatedTabsPanel } from "@/components/opensvc/RelatedTabsPanel";
import type { RelatedTab } from "@/components/opensvc/related-tabs";
import { HistoryIcon } from "@/components/ui/icons";
import { ReportObjectActions } from "@/features/reports/ReportObjectActions";
import { ReportObjectRevisions } from "@/features/reports/ReportObjectRevisions";
import { ReportObjectTeams } from "@/features/reports/ReportObjectTeams";
import { useObjectRevisions } from "@/features/reports/report-admin";
import { formatDateTime } from "@/lib/format";
import { useMetric } from "./use-metric";

type MetricRow = components["schemas"]["MetricRow"];

const text = (prop: keyof MetricRow) => (row: MetricRow) => {
  const value = row[prop];
  return value === undefined || value === null || value === "" ? undefined : String(value);
};

const GROUPS: DetailGroup<MetricRow>[] = [
  {
    key: "definition",
    family: "state",
    fields: [
      { prop: "metric_name", format: text("metric_name") },
      {
        prop: "metric_historize",
        format: text("metric_historize"),
        render: (row) => (
          <FlagSwitch
            value={row.metric_historize}
            labelKey="metrics.fields.metric_historize"
            size="md"
          />
        ),
      },
      {
        prop: "metric_sql",
        format: text("metric_sql"),
        // A request reads best as typed, line breaks and indentation included.
        render: (row) => (
          <pre className="max-h-80 overflow-auto rounded-(--radius-control) bg-surface-sunken p-2 font-mono text-data whitespace-pre-wrap">
            {row.metric_sql}
          </pre>
        ),
      },
    ],
  },
  {
    key: "columns",
    family: "state",
    fields: [
      { prop: "metric_col_value_index", format: text("metric_col_value_index") },
      { prop: "metric_col_instance_index", format: text("metric_col_instance_index") },
      { prop: "metric_col_instance_label", format: text("metric_col_instance_label") },
    ],
  },
  {
    key: "record",
    family: "time",
    fields: [
      { prop: "metric_author", format: text("metric_author") },
      {
        prop: "metric_created",
        format: (row) => formatDateTime(row.metric_created),
      },
      { prop: "id", format: text("id") },
    ],
  },
];

/** The revisions of the metric request. */
const METRIC_TABS: RelatedTab[] = [
  {
    key: "revisions",
    labelKey: "reportAdmin.revisions.tab",
    descriptionKey: "reportAdmin.revisions.description",
    icon: <HistoryIcon className="h-3.5 w-3.5 text-icon-metric" />,
    useSummary: (id) => ({ count: useObjectRevisions("metric", id).data?.length }),
    render: (id) => <ReportObjectRevisions kind="metric" id={id} />,
  },
];

/**
 * A metric: its request and its columns, the groups it is published to, its
 * actions (edit, delete: a Manager's), then the revisions of its request. The open
 * tab lives in the URL (`tab`), held by the view.
 */
export function MetricDetailPanel({
  metricId,
  label,
  onClose,
  onEdit,
  tab,
  onTabChange,
}: {
  metricId: string | undefined;
  label: string;
  onClose: () => void;
  onEdit: () => void;
  tab: string | undefined;
  onTabChange: (tab: string | undefined) => void;
}) {
  const { t } = useTranslation();
  const { data: metric, isPending, isError, error } = useMetric(metricId);
  const open = metricId !== undefined;

  return (
    <RelatedTabsPanel
      open={open}
      title={metric?.metric_name ?? (label === "" ? t("metrics.detail.title") : label)}
      kind="metric"
      onClose={onClose}
      objectId={metricId}
      tabs={METRIC_TABS}
      tab={tab}
      onTabChange={onTabChange}
      propertiesFamily="state"
      label={t("reportAdmin.tabs.metric")}
    >
      <DetailContent
        groups={GROUPS}
        row={metric}
        labelPrefix="metrics.fields"
        groupPrefix="metrics.detail.groups"
        isPending={open && isPending}
        errorMessage={isError ? error.message : null}
        actions={
          metricId === undefined ? undefined : (
            <div className="flex flex-col gap-3">
              <ReportObjectTeams kind="metric" id={metricId} />
              <ReportObjectActions
                kind="metric"
                id={metricId}
                name={metric?.metric_name ?? label}
                onEdit={onEdit}
                onDeleted={onClose}
              />
            </div>
          )
        }
      />
    </RelatedTabsPanel>
  );
}
