import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { AppShell } from "./layout/AppShell";
import { AboutPage } from "@/features/about/AboutPage";
import { AppsPage } from "@/features/apps/AppsPage";
import { ComplianceLogsPage } from "@/features/compliance-logs/ComplianceLogsPage";
import { ComplianceAttachmentsPage } from "@/features/compliance-attachments/ComplianceAttachmentsPage";
import { TABLE_KEYS } from "@/features/compliance-attachments/tables";
import { ComplianceStatusPage } from "@/features/compliance-status/ComplianceStatusPage";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { DesignerPage } from "@/features/designer/DesignerPage";
import { DisksPage } from "@/features/disks/DisksPage";
import { ChecksPage } from "@/features/checks/ChecksPage";
import { CheckDefaultsPage } from "@/features/checks/CheckDefaultsPage";
import { CheckContextualPage } from "@/features/checks/CheckContextualPage";
import { PackagesPage } from "@/features/packages/PackagesPage";
import { HardwarePage } from "@/features/hardware/HardwarePage";
import { SwitchesPage } from "@/features/switches/SwitchesPage";
import { MetricsPage } from "@/features/metrics/MetricsPage";
import { ReportsPage } from "@/features/reports/ReportsPage";
import { ReportReaderPage } from "@/features/report-reader/ReportReaderPage";
import { OrchestrationsPage } from "@/features/orchestrations/OrchestrationsPage";
import { OrchestrationEditorPage } from "@/features/orchestrations/OrchestrationEditorPage";
import { RunsPage } from "@/features/orchestrations/RunsPage";
import { RunPage } from "@/features/orchestrations/RunPage";
import { parseReaderSearch } from "@/features/report-reader/reader-search";
import { ChartsPage } from "@/features/charts/ChartsPage";
import { ClustersPage } from "@/features/clusters/ClustersPage";
import { ResourcesPage } from "@/features/resources/ResourcesPage";
import { ServiceActionsPage } from "@/features/service-actions/ServiceActionsPage";
import { FiltersPage } from "@/features/filters/FiltersPage";
import { ClaimMappingsPage } from "@/features/claim-mappings/ClaimMappingsPage";
import { FormConnectorsPage } from "@/features/form-connectors/FormConnectorsPage";
import { NotificationsPage } from "@/features/notifications/NotificationsPage";
import { FieldConstraintsPage } from "@/features/field-constraints/FieldConstraintsPage";
import { FiltersetsPage } from "@/features/filtersets/FiltersetsPage";
import { FormsPage } from "@/features/forms/FormsPage";
import { SafePage } from "@/features/safe/SafePage";
import { AssistantPage } from "@/features/assistant/AssistantPage";
import { NewRequestPage } from "@/features/requests/NewRequestPage";
import { QuotasPage } from "@/features/quotas/QuotasPage";
import { SavesPage } from "@/features/saves/SavesPage";
import {
  AllRequestsPage,
  TeamRequestsPage,
  TiersRequestsPage,
} from "@/features/requests/AllRequestsPage";
import { parseRequestSearch } from "@/features/requests/catalog";
import { GroupsPage } from "@/features/groups/GroupsPage";
import { InstancesPage } from "@/features/instances/InstancesPage";
import { LogsPage } from "@/features/logs/LogsPage";
import { ModulesetsPage } from "@/features/modulesets/ModulesetsPage";
import { CompModulesPage } from "@/features/comp-modules/CompModulesPage";
import { NetworksPage } from "@/features/networks/NetworksPage";
import { NodesPage } from "@/features/nodes/NodesPage";
import { ObsolescencePage } from "@/features/obsolescence/ObsolescencePage";
import { ActionsPage } from "@/features/actions/ActionsPage";
import { ProfilePage } from "@/features/profile/ProfilePage";
import { RulesetsPage } from "@/features/rulesets/RulesetsPage";
import { ServicesPage } from "@/features/services/ServicesPage";
import { TagsPage } from "@/features/tags/TagsPage";
import { UsersPage } from "@/features/users/UsersPage";
import { parseListSearch } from "@/lib/list-search";

// Routing declared in code for the bootstrap. Moving to file-based routing (the
// @tanstack/router-plugin) to be decided when the number of views grows.
const rootRoute = createRootRoute({ component: AppShell });

// The dashboard is the home page: it is the collector's entry view, the one that
// says what is going wrong before looking for a particular object.
// Sort, pagination, filterset, columns and selected row live in the URL.
const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: DashboardPage,
  validateSearch: parseListSearch,
});

// Links to the old dashboard address keep working, with their URL state.
const dashboardRedirectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/dashboard",
  validateSearch: parseListSearch,
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/", search });
  },
});

const nodesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/nodes",
  component: NodesPage,
  validateSearch: parseListSearch,
});

const appsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/apps",
  component: AppsPage,
  validateSearch: parseListSearch,
});

const networksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/networks",
  component: NetworksPage,
  validateSearch: parseListSearch,
});

const checksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/checks",
  component: ChecksPage,
  validateSearch: parseListSearch,
});

const checkDefaultsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/checks/defaults",
  component: CheckDefaultsPage,
  validateSearch: parseListSearch,
});

const checkContextualRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/checks/contextual",
  component: CheckContextualPage,
  validateSearch: parseListSearch,
});

const savesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/saves",
  component: SavesPage,
  validateSearch: parseListSearch,
});

const quotasRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/quotas",
  component: QuotasPage,
  validateSearch: parseListSearch,
});

const disksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/disks",
  component: DisksPage,
  validateSearch: parseListSearch,
});

const chartsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/charts",
  component: ChartsPage,
  validateSearch: parseListSearch,
});

const reportsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reports",
  component: ReportsPage,
  validateSearch: parseListSearch,
});

// Statistics › Reports: the reports to read, apart from their administration above.
// Without a report, the list alone; with one, the report rendered next to it.
const statReportsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/stats/reports",
  component: ReportReaderPage,
  validateSearch: parseReaderSearch,
});

const statReportRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/stats/reports/$reportId",
  component: ReportReaderPage,
  validateSearch: parseReaderSearch,
});

// Orchestration: the plans of agent actions, their editor, and their runs.
const orchestrationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/orchestrations",
  component: OrchestrationsPage,
  validateSearch: parseListSearch,
});

const orchestrationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/orchestrations/$orchestrationId",
  component: OrchestrationEditorPage,
});

const orchestrationRunsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/orchestrations/runs",
  component: RunsPage,
  validateSearch: parseListSearch,
});

const orchestrationRunRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/orchestrations/runs/$runId",
  component: RunPage,
});

const metricsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/metrics",
  component: MetricsPage,
  validateSearch: parseListSearch,
});

const clustersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/clusters",
  component: ClustersPage,
  validateSearch: parseListSearch,
});

const switchesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/san-switches",
  component: SwitchesPage,
  validateSearch: parseListSearch,
});

const hardwareRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/hardware",
  component: HardwarePage,
  validateSearch: parseListSearch,
});

const packagesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/packages",
  component: PackagesPage,
  validateSearch: parseListSearch,
});

const groupsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/groups",
  component: GroupsPage,
  validateSearch: parseListSearch,
});

const servicesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/services",
  component: ServicesPage,
  validateSearch: parseListSearch,
});

const instancesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/instances",
  component: InstancesPage,
  validateSearch: parseListSearch,
});

// `view-resources` of the historical menu: the resources of the service instances.
const resourcesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/resources",
  component: ResourcesPage,
  validateSearch: parseListSearch,
});

// `view-actions` of the historical menu: the actions the agents ran on the services.
const serviceActionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/service-actions",
  component: ServiceActionsPage,
  validateSearch: parseListSearch,
});

const tagsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tags",
  component: TagsPage,
  validateSearch: parseListSearch,
});

const obsolescenceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/obsolescence",
  component: ObsolescencePage,
  validateSearch: parseListSearch,
});

const logsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/logs",
  component: LogsPage,
  validateSearch: parseListSearch,
});

const filtersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/filters",
  component: FiltersPage,
  validateSearch: parseListSearch,
});

// The external APIs the forms call through oc3: Manager only, as the api.
const formConnectorsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/form-connectors",
  component: FormConnectorsPage,
  validateSearch: parseListSearch,
});

// The channels and subscriptions of the alert notifications: AlertsManager, as the api.
const notificationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/notifications",
  component: NotificationsPage,
  validateSearch: parseListSearch,
});

const claimMappingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/claim-mappings",
  component: ClaimMappingsPage,
  validateSearch: parseListSearch,
});

const fieldConstraintsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/field-constraints",
  component: FieldConstraintsPage,
  validateSearch: parseListSearch,
});

const filtersetsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/filtersets",
  component: FiltersetsPage,
  validateSearch: parseListSearch,
});

// The conversation with the AI assistant, not connected yet.
const assistantRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/ai",
  component: AssistantPage,
});

// The files of the collector safe, a list as the others.
const safeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/safe",
  component: SafePage,
  validateSearch: parseListSearch,
});

const formsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/forms",
  component: FormsPage,
  validateSearch: parseListSearch,
});

// Every request submitted, a list as the others.
const allRequestsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/requests/all",
  component: AllRequestsPage,
  validateSearch: parseListSearch,
});

// The pending requests of the user's team, awaiting it or awaiting someone else.
const teamRequestsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/requests/team",
  component: TeamRequestsPage,
  validateSearch: parseListSearch,
});

const tiersRequestsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/requests/tiers",
  component: TiersRequestsPage,
  validateSearch: parseListSearch,
});

// The request catalog: the form chosen lives in the URL.
const requestsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/requests",
  component: NewRequestPage,
  validateSearch: parseRequestSearch,
});

const modulesetsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/compliance/modulesets",
  component: ModulesetsPage,
  validateSearch: parseListSearch,
});

// The scripts the modulesets name, kept by oc3 in git: everyone reads, a
// CompManager creates, as the api.
const compModulesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/compliance/modules",
  component: CompModulesPage,
  validateSearch: parseListSearch,
});

const designerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/compliance/designer",
  component: DesignerPage,
  validateSearch: parseListSearch,
});

const complianceStatusRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/compliance/status",
  component: ComplianceStatusPage,
  validateSearch: parseListSearch,
});

const complianceAttachmentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/compliance/attachments",
  component: ComplianceAttachmentsPage,
  // The list state, and which of the four tables it is the state of.
  validateSearch: (raw: Record<string, unknown>) => ({
    ...parseListSearch(raw),
    of: TABLE_KEYS.find((key) => key === raw.of),
  }),
});

const complianceLogsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/compliance/logs",
  component: ComplianceLogsPage,
  validateSearch: parseListSearch,
});

const rulesetsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/compliance/rulesets",
  component: RulesetsPage,
  validateSearch: parseListSearch,
});

const usersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/users",
  component: UsersPage,
  validateSearch: parseListSearch,
});

// Action queue of the collector: reached from the top bar, not from the menu.
const actionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/actions",
  component: ActionsPage,
  validateSearch: parseListSearch,
});

// Profile of the signed-in user: no list state, hence no search.
const profileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/profile",
  component: ProfilePage,
});

// About the collector: no list state either. `AppShell` shows it signed out too.
const aboutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/about",
  component: AboutPage,
});

const routeTree = rootRoute.addChildren([
  dashboardRoute,
  dashboardRedirectRoute,
  nodesRoute,
  clustersRoute,
  servicesRoute,
  instancesRoute,
  resourcesRoute,
  serviceActionsRoute,
  networksRoute,
  disksRoute,
  quotasRoute,
  savesRoute,
  checksRoute,
  checkDefaultsRoute,
  checkContextualRoute,
  switchesRoute,
  metricsRoute,
  reportsRoute,
  statReportsRoute,
  statReportRoute,
  chartsRoute,
  packagesRoute,
  hardwareRoute,
  groupsRoute,
  tagsRoute,
  appsRoute,
  usersRoute,
  obsolescenceRoute,
  logsRoute,
  filtersRoute,
  claimMappingsRoute,
  formConnectorsRoute,
  notificationsRoute,
  fieldConstraintsRoute,
  filtersetsRoute,
  formsRoute,
  safeRoute,
  assistantRoute,
  requestsRoute,
  allRequestsRoute,
  teamRequestsRoute,
  tiersRequestsRoute,
  modulesetsRoute,
  compModulesRoute,
  rulesetsRoute,
  complianceStatusRoute,
  complianceLogsRoute,
  complianceAttachmentsRoute,
  designerRoute,
  actionsRoute,
  orchestrationsRoute,
  orchestrationRoute,
  orchestrationRunsRoute,
  orchestrationRunRoute,
  profileRoute,
  aboutRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
