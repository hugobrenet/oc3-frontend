/**
 * Menu structure, as data rather than JSX: adding a view or a section is done here,
 * and folding by section will be able to rely on the category key without touching
 * the rendering.
 *
 * The sections mirror those of the historical collector menu, listed in MIGRATION.md
 * §4.4. Only sections with at least one ported view are declared: an empty section
 * would promise views that do not exist yet.
 */
import type { ObjectKind } from "@/components/opensvc/ObjectIcon";

/** The keys of the menu entries, one per entry, see `NavEntry.menuId`. */
export type MenuId =
  | "view-dashboard"
  | "view-ai"
  | "orch-workflows"
  | "orch-runs"
  | "view-nodes"
  | "view-clusters"
  | "view-services"
  | "view-service-instances"
  | "view-resources"
  | "view-actions"
  | "view-checks"
  | "view-node-net"
  | "view-disks"
  | "view-disks-quotas"
  | "view-saves"
  | "view-san"
  | "view-nodes-hw"
  | "view-pkg"
  | "comp-status"
  | "comp-log"
  | "req-new"
  | "req-pending-my"
  | "req-pending-tiers"
  | "req-all"
  | "stat-reports"
  | "adm-usr"
  | "adm-groups"
  | "adm-claim-mappings"
  | "adm-form-connectors"
  | "adm-notifications"
  | "adm-field-constraints"
  | "view-app"
  | "adm-tags"
  | "adm-obs"
  | "adm-chk-def"
  | "adm-chk-ctx"
  | "comp-modsets"
  | "comp-modules"
  | "comp-rsets"
  | "comp-designer"
  | "comp-attachments"
  | "comp-safe"
  | "adm-forms"
  | "adm-metrics"
  | "adm-charts"
  | "adm-reports"
  | "adm-filters"
  | "adm-filtersets"
  | "adm-log";

export interface NavEntry {
  to:
    | "/"
    | "/nodes"
    | "/clusters"
    | "/hardware"
    | "/services"
    | "/instances"
    | "/resources"
    | "/service-actions"
    | "/checks"
    | "/checks/defaults"
    | "/checks/contextual"
    | "/networks"
    | "/disks"
    | "/quotas"
    | "/saves"
    | "/san-switches"
    | "/packages"
    | "/apps"
    | "/groups"
    | "/tags"
    | "/users"
    | "/obsolescence"
    | "/logs"
    | "/filters"
    | "/claim-mappings"
    | "/form-connectors"
    | "/notifications"
    | "/field-constraints"
    | "/metrics"
    | "/reports"
    | "/stats/reports"
    | "/charts"
    | "/filtersets"
    | "/forms"
    | "/requests"
    | "/requests/all"
    | "/requests/team"
    | "/requests/tiers"
    | "/safe"
    | "/ai"
    | "/compliance/modulesets"
    | "/compliance/modules"
    | "/compliance/rulesets"
    | "/compliance/status"
    | "/compliance/logs"
    | "/compliance/designer"
    | "/compliance/attachments"
    | "/orchestrations"
    | "/orchestrations/runs";
  /**
   * The key of the entry for the menu entries a group hides
   * (`/groups/{id}/hidden_menu_entries`): the id of the entry of the historical
   * menu, so that the entries hidden there stay hidden; one of oc3's
   * `validMenuEntries`, where the views it did not have were added.
   */
  menuId: MenuId;
  labelKey: string;
  icon: ObjectKind;
  /** True for the root: without it, prefix matching would activate it everywhere. */
  exact?: boolean;
  /**
   * The privileges one of which the entry needs to be shown; a Manager holds them
   * all. Absent, everybody sees it. The menu only: the API serves the view to
   * whoever opens its address, its actions checking their own privilege.
   */
  privileges?: readonly string[];
}

/**
 * The two menus the side menu switches between: "operator", to watch the estate
 * and act on it day to day, and "admin", to set up how the collector works. Each
 * section belongs to one of them, so does each page.
 */
export type NavView = "operator" | "admin";

export const NAV_VIEWS: readonly NavView[] = ["operator", "admin"];

export interface NavCategory {
  key: string;
  labelKey: string;
  view: NavView;
  entries: NavEntry[];
}

/** Entries outside any category, at the top of the operator menu. */
export const NAV_TOP: NavEntry[] = [
  {
    to: "/",
    menuId: "view-dashboard",
    labelKey: "nav.dashboard",
    icon: "dashboardView",
    exact: true,
  },
  // The conversation with the AI assistant, right after the dashboard: a way into
  // the estate as a whole rather than a view of one kind of object.
  { to: "/ai", menuId: "view-ai", labelKey: "nav.ai", icon: "ai" },
];

/**
 * The sections of both menus. The operator sections keep the keys of the former
 * single menu, so that the sections a user folded stay folded.
 */
export const NAV_CATEGORIES: NavCategory[] = [
  {
    key: "infrastructure",
    labelKey: "nav.categories.infrastructure",
    view: "operator",
    entries: [
      { to: "/nodes", menuId: "view-nodes", labelKey: "nav.nodes", icon: "node" },
      { to: "/clusters", menuId: "view-clusters", labelKey: "nav.clusters", icon: "cluster" },
      { to: "/services", menuId: "view-services", labelKey: "nav.services", icon: "service" },
      {
        to: "/instances",
        menuId: "view-service-instances",
        labelKey: "nav.instances",
        icon: "instance",
      },
      { to: "/resources", menuId: "view-resources", labelKey: "nav.resources", icon: "resource" },
      {
        to: "/service-actions",
        menuId: "view-actions",
        labelKey: "nav.serviceActions",
        icon: "action",
      },
      { to: "/checks", menuId: "view-checks", labelKey: "nav.checks", icon: "check", exact: true },
    ],
  },
  {
    key: "inventory",
    labelKey: "nav.categories.inventory",
    view: "operator",
    entries: [
      { to: "/networks", menuId: "view-node-net", labelKey: "nav.networks", icon: "network" },
      { to: "/disks", menuId: "view-disks", labelKey: "nav.disks", icon: "disk" },
      { to: "/quotas", menuId: "view-disks-quotas", labelKey: "nav.quotas", icon: "disk" },
      { to: "/saves", menuId: "view-saves", labelKey: "nav.saves", icon: "save" },
      { to: "/san-switches", menuId: "view-san", labelKey: "nav.switches", icon: "switch" },
      { to: "/hardware", menuId: "view-nodes-hw", labelKey: "nav.hardware", icon: "hardware" },
      { to: "/packages", menuId: "view-pkg", labelKey: "nav.packages", icon: "package" },
    ],
  },
  {
    key: "compliance",
    labelKey: "nav.categories.compliance",
    view: "operator",
    entries: [
      {
        to: "/compliance/status",
        menuId: "comp-status",
        labelKey: "nav.complianceStatus",
        icon: "complianceStatus",
      },
      {
        to: "/compliance/logs",
        menuId: "comp-log",
        labelKey: "nav.complianceLogs",
        icon: "complianceLog",
      },
    ],
  },
  {
    key: "requests",
    labelKey: "nav.categories.requests",
    view: "operator",
    entries: [
      { to: "/requests", menuId: "req-new", labelKey: "nav.newRequest", icon: "form", exact: true },
      {
        to: "/requests/team",
        menuId: "req-pending-my",
        labelKey: "nav.teamRequests",
        icon: "form",
      },
      {
        to: "/requests/tiers",
        menuId: "req-pending-tiers",
        labelKey: "nav.tiersRequests",
        icon: "form",
      },
      { to: "/requests/all", menuId: "req-all", labelKey: "nav.allRequests", icon: "form" },
    ],
  },
  {
    key: "orchestration",
    labelKey: "nav.categories.orchestration",
    view: "operator",
    entries: [
      // Manager only, as the api: a plan acts on any object of the estate.
      {
        to: "/orchestrations",
        menuId: "orch-workflows",
        labelKey: "nav.orchestrations",
        icon: "orchestration",
        exact: true,
        privileges: ["Manager"],
      },
      {
        to: "/orchestrations/runs",
        menuId: "orch-runs",
        labelKey: "nav.orchestrationRuns",
        icon: "orchestration",
        privileges: ["Manager"],
      },
    ],
  },
  {
    key: "statistics",
    labelKey: "nav.categories.statistics",
    view: "operator",
    entries: [
      { to: "/stats/reports", menuId: "stat-reports", labelKey: "nav.statReports", icon: "report" },
    ],
  },
  {
    key: "access",
    labelKey: "nav.categories.access",
    view: "admin",
    entries: [
      {
        to: "/users",
        menuId: "adm-usr",
        labelKey: "nav.users",
        icon: "user",
        privileges: ["UserManager"],
      },
      {
        to: "/groups",
        menuId: "adm-groups",
        labelKey: "nav.groups",
        icon: "group",
        privileges: ["GroupManager"],
      },
      {
        to: "/claim-mappings",
        menuId: "adm-claim-mappings",
        labelKey: "nav.claimMappings",
        icon: "claimMapping",
        privileges: ["Manager"],
      },
      // Who the alerts are sent to, by mail or to the team messaging.
      {
        to: "/notifications",
        menuId: "adm-notifications",
        labelKey: "nav.notifications",
        icon: "notification",
        privileges: ["AlertsManager"],
      },
    ],
  },
  {
    key: "inventoryData",
    labelKey: "nav.categories.inventoryData",
    view: "admin",
    entries: [
      { to: "/apps", menuId: "view-app", labelKey: "nav.apps", icon: "app" },
      { to: "/tags", menuId: "adm-tags", labelKey: "nav.tags", icon: "tags" },
      {
        to: "/field-constraints",
        menuId: "adm-field-constraints",
        labelKey: "nav.fieldConstraints",
        icon: "fieldConstraint",
        privileges: ["Manager"],
      },
      {
        to: "/obsolescence",
        menuId: "adm-obs",
        labelKey: "nav.obsolescence",
        icon: "obsolescence",
        privileges: ["ObsManager"],
      },
    ],
  },
  {
    key: "checks",
    labelKey: "nav.categories.checks",
    view: "admin",
    entries: [
      {
        to: "/checks/defaults",
        menuId: "adm-chk-def",
        labelKey: "nav.checkDefaults",
        icon: "check",
        privileges: ["CheckManager"],
      },
      {
        to: "/checks/contextual",
        menuId: "adm-chk-ctx",
        labelKey: "nav.checkContextual",
        icon: "check",
        privileges: ["ContextCheckManager"],
      },
    ],
  },
  {
    key: "complianceDesign",
    labelKey: "nav.categories.compliance",
    view: "admin",
    entries: [
      {
        to: "/compliance/modulesets",
        menuId: "comp-modsets",
        labelKey: "nav.modulesets",
        icon: "moduleset",
      },
      {
        to: "/compliance/modules",
        menuId: "comp-modules",
        labelKey: "nav.compModules",
        icon: "compModule",
      },
      {
        to: "/compliance/rulesets",
        menuId: "comp-rsets",
        labelKey: "nav.rulesets",
        icon: "ruleset",
      },
      // Manager and CompExec, as the data actions attaching modulesets and rulesets.
      {
        to: "/compliance/attachments",
        menuId: "comp-attachments",
        labelKey: "nav.complianceAttachments",
        icon: "compAttachment",
        privileges: ["CompExec"],
      },
      {
        to: "/compliance/designer",
        menuId: "comp-designer",
        labelKey: "nav.designer",
        icon: "designer",
        privileges: ["CompManager"],
      },
      // Everyone: the files published to one's teams, which the rulesets and the
      // service configurations reference (safe://).
      { to: "/safe", menuId: "comp-safe", labelKey: "nav.safe", icon: "safe" },
    ],
  },
  {
    key: "requestForms",
    labelKey: "nav.categories.requests",
    view: "admin",
    entries: [
      {
        to: "/forms",
        menuId: "adm-forms",
        labelKey: "nav.forms",
        icon: "form",
        privileges: ["FormsManager"],
      },
      // Manager only, as the api: a connector decides what oc3 calls on the
      // network, and with which credentials.
      {
        to: "/form-connectors",
        menuId: "adm-form-connectors",
        labelKey: "nav.formConnectors",
        icon: "formConnector",
        privileges: ["Manager"],
      },
    ],
  },
  {
    key: "reporting",
    labelKey: "nav.categories.reporting",
    view: "admin",
    entries: [
      {
        to: "/metrics",
        menuId: "adm-metrics",
        labelKey: "nav.metrics",
        icon: "metric",
        privileges: ["ReportsManager"],
      },
      {
        to: "/charts",
        menuId: "adm-charts",
        labelKey: "nav.charts",
        icon: "chart",
        privileges: ["ReportsManager"],
      },
      {
        to: "/reports",
        menuId: "adm-reports",
        labelKey: "nav.reports",
        icon: "report",
        privileges: ["ReportsManager"],
      },
    ],
  },
  {
    key: "filtering",
    labelKey: "nav.categories.filtering",
    view: "admin",
    entries: [
      {
        to: "/filters",
        menuId: "adm-filters",
        labelKey: "nav.filters",
        icon: "filter",
        privileges: ["Manager"],
      },
      {
        to: "/filtersets",
        menuId: "adm-filtersets",
        labelKey: "nav.filtersets",
        icon: "filterset",
        privileges: ["Manager"],
      },
    ],
  },
  {
    key: "audit",
    labelKey: "nav.categories.audit",
    view: "admin",
    entries: [{ to: "/logs", menuId: "adm-log", labelKey: "nav.logs", icon: "log" }],
  },
];

/**
 * The menu a page belongs to: that of the entry its path starts with, the longest
 * one winning (`/stats/reports/12` is Statistics' Reports, `/reports` Report
 * definitions); the operator menu for the entries at its top, the dashboard and
 * the assistant. Null for a page of no menu, such as the profile or the action
 * queue: the side menu then stays as it is.
 */
export function viewOfPath(pathname: string): NavView | null {
  // The entries outside any category are at the top of the operator menu.
  for (const entry of NAV_TOP) {
    if (pathname === entry.to || (entry.to !== "/" && pathname.startsWith(`${entry.to}/`)))
      return "operator";
  }
  let best: { length: number; view: NavView } | null = null;
  for (const category of NAV_CATEGORIES) {
    for (const entry of category.entries) {
      const hit = pathname === entry.to || pathname.startsWith(`${entry.to}/`);
      if (hit && (best === null || entry.to.length > best.length))
        best = { length: entry.to.length, view: category.view };
    }
  }
  return best?.view ?? null;
}
