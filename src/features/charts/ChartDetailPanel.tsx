import { useTranslation } from "react-i18next";
import type { components } from "@/lib/api/schema";
import { DetailContent, type DetailGroup } from "@/components/opensvc/DetailPanel";
import { RelatedTabsPanel } from "@/components/opensvc/RelatedTabsPanel";
import type { RelatedTab } from "@/components/opensvc/related-tabs";
import { HistoryIcon } from "@/components/ui/icons";
import { YamlCode } from "@/components/ui/YamlCode";
import { ReportObjectActions } from "@/features/reports/ReportObjectActions";
import { ReportObjectRevisions } from "@/features/reports/ReportObjectRevisions";
import { ReportObjectTeams } from "@/features/reports/ReportObjectTeams";
import { useObjectRevisions } from "@/features/reports/report-admin";
import { useChart } from "./use-chart";

type ChartRow = components["schemas"]["ChartRow"];

const text = (prop: keyof ChartRow) => (row: ChartRow) => {
  const value = row[prop];
  return value === undefined || value === null || value === "" ? undefined : String(value);
};

const GROUPS: DetailGroup<ChartRow>[] = [
  {
    key: "definition",
    family: "state",
    fields: [
      { prop: "chart_name", format: text("chart_name") },
      {
        prop: "chart_yaml",
        format: text("chart_yaml"),
        render: (row) => (
          <div className="max-h-[32rem] overflow-auto rounded-(--radius-control) bg-surface-sunken p-2">
            <YamlCode text={row.chart_yaml ?? ""} lineNumbers />
          </div>
        ),
      },
    ],
  },
  {
    key: "record",
    family: "time",
    fields: [{ prop: "id", format: text("id") }],
  },
];

/** The revisions of the chart definition. */
const CHART_TABS: RelatedTab[] = [
  {
    key: "revisions",
    labelKey: "reportAdmin.revisions.tab",
    descriptionKey: "reportAdmin.revisions.description",
    icon: <HistoryIcon className="h-3.5 w-3.5 text-icon-metric" />,
    useSummary: (id) => ({ count: useObjectRevisions("chart", id).data?.length }),
    render: (id) => <ReportObjectRevisions kind="chart" id={id} />,
  },
];

/**
 * A chart: its name and its YAML definition, the groups it is published to and
 * those responsible for it, its actions (edit, delete), then the revisions of its
 * definition. The open tab lives in the URL (`tab`), held by the view.
 */
export function ChartDetailPanel({
  chartId,
  label,
  onClose,
  onEdit,
  tab,
  onTabChange,
}: {
  chartId: string | undefined;
  label: string;
  onClose: () => void;
  onEdit: () => void;
  tab: string | undefined;
  onTabChange: (tab: string | undefined) => void;
}) {
  const { t } = useTranslation();
  const { data: chart, isPending, isError, error } = useChart(chartId);
  const open = chartId !== undefined;

  return (
    <RelatedTabsPanel
      open={open}
      title={chart?.chart_name ?? (label === "" ? t("charts.detail.title") : label)}
      kind="chart"
      onClose={onClose}
      objectId={chartId}
      tabs={CHART_TABS}
      tab={tab}
      onTabChange={onTabChange}
      propertiesFamily="state"
      label={t("reportAdmin.tabs.chart")}
    >
      <DetailContent
        groups={GROUPS}
        row={chart}
        labelPrefix="charts.fields"
        groupPrefix="charts.detail.groups"
        isPending={open && isPending}
        errorMessage={isError ? error.message : null}
        actions={
          chartId === undefined ? undefined : (
            <div className="flex flex-col gap-3">
              <ReportObjectTeams kind="chart" id={chartId} />
              <ReportObjectActions
                kind="chart"
                id={chartId}
                name={chart?.chart_name ?? label}
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
