import {
  BellIcon,
  AlertTriangleIcon,
  DashboardIcon,
  AsteriskIcon,
  CheckIcon,
  CodeIcon,
  PieChartIcon,
  LineChartIcon,
  CpuIcon,
  CubeIcon,
  ArchiveIcon,
  DatabaseIcon,
  FilterIcon,
  GearIcon,
  HistoryIcon,
  InstanceIcon,
  LifeRingIcon,
  NetworkIcon,
  PuzzleIcon,
  SparklesIcon,
  LockIcon,
  ServerIcon,
  StackIcon,
  SwitchIcon,
  TagIcon,
  TagsIcon,
  UserIcon,
  UsersIcon,
  HoneycombIcon,
  HashIcon,
  KeyIcon,
  FirewallIcon,
  LinkIcon,
  ListChecksIcon,
  TerminalIcon,
} from "@/components/ui/icons";

/** Collector object kinds that have a visual identity of their own. */
export type ObjectKind =
  | "dashboard"
  | "dashboardView"
  | "node"
  | "cluster"
  | "service"
  | "instance"
  | "resource"
  | "action"
  | "network"
  | "disk"
  | "save"
  | "app"
  | "tag"
  | "tags"
  | "group"
  | "privilege"
  | "user"
  | "obsolescence"
  | "log"
  | "filter"
  | "filterset"
  | "form"
  | "safe"
  | "ai"
  | "package"
  | "hardware"
  | "switch"
  | "metric"
  | "report"
  | "chart"
  | "moduleset"
  | "compModule"
  | "ruleset"
  | "complianceStatus"
  | "check"
  | "complianceLog"
  | "designer"
  | "claimMapping"
  | "fieldConstraint"
  | "compAttachment"
  | "formConnector"
  | "notification"
  | "orchestration";

/**
 * Pictogram and tint of an object kind. The same vocabulary in the menu, in panel
 * headers and everywhere it will be necessary to say what is being talked about:
 * this is what ties a table row to the menu entry it comes from.
 *
 * The classes are written out in full: Tailwind does not see names built at runtime.
 */
const KINDS: Record<ObjectKind, { Icon: typeof ServerIcon; className: string }> = {
  dashboard: { Icon: AlertTriangleIcon, className: "text-icon-dashboard" },
  // The Dashboard view itself, in the menu and its page: the tiles of a dashboard.
  // Its alerts keep the triangle ("dashboard"), which also keys their bookmarks.
  dashboardView: { Icon: DashboardIcon, className: "text-icon-dashboard" },
  node: { Icon: ServerIcon, className: "text-icon-node" },
  // The tint of the nodes it groups, as the cluster column family.
  cluster: { Icon: HoneycombIcon, className: "text-icon-node" },
  service: { Icon: StackIcon, className: "text-icon-service" },
  // Service tint: an instance is a service seen from a node.
  instance: { Icon: InstanceIcon, className: "text-icon-service" },
  // The sea green hashtag of the historical `resource` class, a part of a service.
  resource: { Icon: HashIcon, className: "text-icon-service" },
  // The gear of the historical `action16` class, in the green of the services.
  action: { Icon: GearIcon, className: "text-icon-service" },
  // An orchestration: steps of agent actions, one after the other.
  orchestration: { Icon: ListChecksIcon, className: "text-icon-service" },
  network: { Icon: NetworkIcon, className: "text-icon-network" },
  disk: { Icon: DatabaseIcon, className: "text-icon-disk" },
  save: { Icon: ArchiveIcon, className: "text-icon-disk" },
  app: { Icon: AsteriskIcon, className: "text-icon-app" },
  // The collector's dark cyan label (`tag16`); the Tags menu entry and view show a pair.
  tag: { Icon: TagIcon, className: "text-icon-tag" },
  tags: { Icon: TagsIcon, className: "text-icon-tag" },
  group: { Icon: UsersIcon, className: "text-icon-group" },
  // A privilege group, told from an organizational one where both are listed.
  privilege: { Icon: FirewallIcon, className: "text-icon-group" },
  // Same tint as groups: the historical collector paints `guy16` and `guys16` in the
  // same salmon, both speak of people.
  user: { Icon: UserIcon, className: "text-icon-group" },
  // Cornflower blue in the historical collector: the tint of nodes, which it is about.
  obsolescence: { Icon: LifeRingIcon, className: "text-icon-node" },
  metric: { Icon: CodeIcon, className: "text-icon-metric" },
  // The same sandy brown as the metrics: the historical collector gives it to all
  // its statistics objects.
  report: { Icon: PieChartIcon, className: "text-icon-metric" },
  chart: { Icon: LineChartIcon, className: "text-icon-metric" },
  // `log16` has no colour of its own in the historical collector: neutral tint.
  log: { Icon: HistoryIcon, className: "text-icon-dashboard" },
  // `filter16` has no colour of its own either: neutral tint.
  filter: { Icon: FilterIcon, className: "text-icon-dashboard" },
  // Same icon as the filter: the historical collector marks both of them `filter16`.
  filterset: { Icon: FilterIcon, className: "text-icon-dashboard" },
  form: { Icon: PuzzleIcon, className: "text-icon-form" },
  // The padlock of the historical safe16 class, in the colour of the forms it shares.
  safe: { Icon: LockIcon, className: "text-icon-form" },
  // The assistant takes the accent: it belongs to no object family.
  ai: { Icon: SparklesIcon, className: "text-accent" },
  package: { Icon: CubeIcon, className: "text-icon-package" },
  // Cornflower blue in the historical collector (`hw16`): the tint of nodes.
  hardware: { Icon: CpuIcon, className: "text-icon-node" },
  // Network tint: the historical menu gives the SAN switches the network icon; the
  // glyph differs so that the two menu entries do not look alike.
  switch: { Icon: SwitchIcon, className: "text-icon-network" },
  // The cogs of the historical collector (`modset16`), in its compliance crimson.
  moduleset: { Icon: GearIcon, className: "text-icon-compliance" },
  // A terminal in the compliance crimson: the scripts the modulesets name.
  compModule: { Icon: TerminalIcon, className: "text-icon-compliance" },
  // The cube of the historical collector (`rset16`), in its compliance crimson.
  ruleset: { Icon: CubeIcon, className: "text-icon-compliance" },
  // The check mark of the historical compliance status (`compstatus`), in its crimson.
  complianceStatus: { Icon: CheckIcon, className: "text-icon-compliance" },
  // The green check mark of the historical checks (`check16`), in the green of the
  // services, the compliance status keeping the crimson one.
  check: { Icon: CheckIcon, className: "text-icon-service" },
  // The history clock of the historical compliance log (`complog`), in its crimson.
  complianceLog: { Icon: HistoryIcon, className: "text-icon-compliance" },
  // The puzzle piece of the historical designer (`designer16`), in the compliance crimson.
  designer: { Icon: PuzzleIcon, className: "text-icon-compliance" },
  // A key in the tint of users and teams: who gets in, and with which teams.
  claimMapping: { Icon: KeyIcon, className: "text-icon-group" },
  // The values allowed for node attributes: the tint of the nodes they constrain.
  fieldConstraint: { Icon: ListChecksIcon, className: "text-icon-node" },
  // A link in the tint of compliance: modulesets and rulesets tied to their targets.
  compAttachment: { Icon: LinkIcon, className: "text-icon-compliance" },
  // A link in the tint of the forms: the external APIs they call.
  formConnector: { Icon: LinkIcon, className: "text-icon-form" },
  // The tint of the alerts it sends.
  notification: { Icon: BellIcon, className: "text-icon-dashboard" },
};

export function ObjectIcon({ kind, className }: { kind: ObjectKind; className?: string }) {
  const { Icon, className: hue } = KINDS[kind];
  return <Icon className={`shrink-0 ${hue} ${className ?? ""}`} />;
}
