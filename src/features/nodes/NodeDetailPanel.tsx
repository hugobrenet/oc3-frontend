import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { components } from "@/lib/api/schema";
import { api } from "@/lib/api/client";
import { DetailContent, type DetailGroup } from "@/components/opensvc/DetailPanel";
import { linkedField } from "@/components/opensvc/linked-field";
import { TeamLink } from "@/features/groups/TeamLink";
import { NODE_RELATED_TABS, NODE_TAB_GROUPS } from "./related/node-related";
import { useSearch } from "@tanstack/react-router";
import { NodeActionsMenu } from "./NodeActionsMenu";
import { NodeWebappLink } from "@/components/opensvc/AgentWebappLink";
import { ObjectTags } from "@/components/opensvc/ObjectTags";
import { OsLogo } from "@/components/opensvc/OsLogo";
import { useTeams } from "@/features/groups/use-teams";
import { useAppCodes } from "@/features/apps/use-app-codes";
import { useTagEdit } from "@/features/tags/use-tag-edit";
import {
  useFieldConstraints,
  valueLists,
} from "@/features/field-constraints/use-field-constraints";
import { RelatedTabsPanel } from "@/components/opensvc/RelatedTabsPanel";
import { useNodeTags } from "./related/queries";
import { problemText } from "@/lib/api/problem";
import { AskAssistantLink } from "@/features/assistant/AskAssistantLink";

/**
 * Attributes a user may set, because the agent's inventory push does not write them.
 *
 * The list comes from `worker/job_feed_system.go` on the oc3 side, which enumerates
 * the 42 columns written by the push: anything appearing there would be overwritten
 * at the next one. Also left out are the fields held by other automatic paths — the
 * last contact and the freezing come from the daemon feed, the obsolescence dates
 * from the scheduler, the location and the chassis from propagation out of the parent
 * node of a container.
 */
const EDITABLE_DATES = new Set(["warranty_end", "maintenance_end", "snooze_till"]);

/** The API body types these two; a string would be refused there. */
const EDITABLE_NUMBERS = new Set(["power_supply_nb"]);
const EDITABLE_BOOLEANS = new Set(["notifications"]);

/**
 * Columns carrying a collector boolean ("T" / "F") and therefore shown as a switch.
 * `node_frozen` is one of them without being editable: the daemon feed drives it, so
 * the switch is read-only there.
 */
const BOOLEANS = new Set([...EDITABLE_BOOLEANS, "node_frozen"]);

const EDITABLE = new Set<string>([
  "app",
  "team_responsible",
  // The integration and support teams, the security zone and the asset
  // environment: the agent writes them only when its inventory carries them
  // (`Optional` in `worker/job_feed_system.go`), a value set here holding until the
  // next push that mentions it.
  "team_integ",
  "team_support",
  "sec_zone",
  "asset_env",
  // The virtualization: the agent never writes it.
  "hv",
  "hvpool",
  "hvvdc",
  "status",
  "role",
  "type",
  "assetname",
  "warranty_end",
  "maintenance_end",
  "power_supply_nb",
  "power_cabinet1",
  "power_cabinet2",
  "power_protect",
  "power_protect_breaker",
  "power_breaker1",
  "power_breaker2",
  "notifications",
  "snooze_till",
  // Location and agent attributes the historical node properties let one change.
  "tz",
  "loc_country",
  "loc_city",
  "loc_zip",
  "loc_addr",
  "loc_building",
  "loc_floor",
  "loc_room",
  "loc_rack",
  "enclosure",
  "enclosureslot",
  "connect_to",
  "action_type",
]);
import { formatDateTime, formatSizeMiB } from "@/lib/format";

type NodeRow = components["schemas"]["NodeRow"];

const text = (prop: keyof NodeRow) => (row: NodeRow) => {
  const value = row[prop];
  // A joined prop is null when the row it points at is missing: a node may name a
  // cluster the collector does not know. Nothing to show then, rather than "null".
  return value === undefined || value === null ? undefined : String(value);
};

const date = (prop: keyof NodeRow) => (row: NodeRow) => {
  const value = row[prop];
  return typeof value === "string" ? formatDateTime(value) : undefined;
};

/**
 * Team: a badge, whose group id is resolved by `TeamLink`, and a dropdown of the
 * known teams when editing it.
 */
const team = (prop: keyof NodeRow) => ({
  prop,
  format: text(prop),
  editable: EDITABLE.has(prop),
  optionsKey: "teams",
  render: (row: NodeRow) => <TeamLink name={row[prop]} />,
});

const field = (
  prop: keyof NodeRow,
  format?: (row: NodeRow, locale: string) => string | undefined,
) => ({
  prop,
  format: format ?? text(prop),
  // Editing is offered only on the attributes listed above.
  editable: EDITABLE.has(prop),
  input: EDITABLE_DATES.has(prop)
    ? ("date" as const)
    : EDITABLE_NUMBERS.has(prop)
      ? ("number" as const)
      : BOOLEANS.has(prop)
        ? ("boolean" as const)
        : ("text" as const),
});

/**
 * The sections of the properties, in the order and with the content of the
 * historical node properties (`node_properties.html`): identity, hardware,
 * system, location, and the OpenSVC agent.
 */
const GROUPS: DetailGroup<NodeRow>[] = [
  {
    key: "identity",
    family: "node",
    fields: [
      field("nodename"),
      field("fqdn"),
      field("node_id"),
      // The cluster the node belongs to, named before its id: the name is what one
      // reads, the id is what the API joins on.
      field("clusters.cluster_name"),
      field("cluster_id"),
      {
        ...linkedField<NodeRow>("app", "app", (row) => row.app, text("app")),
        // Chosen among the apps the user is responsible for: the server would give
        // any other one back as their default app.
        editable: EDITABLE.has("app"),
        optionsKey: "apps",
      },
      field("status"),
      field("role"),
      field("asset_env"),
      field("assetname"),
      field("type"),
      field("sec_zone"),
      team("team_responsible"),
      team("team_integ"),
      team("team_support"),
      field("notifications"),
      field("snooze_till", date("snooze_till")),
    ],
  },
  {
    key: "hardware",
    family: "cpu",
    fields: [
      field("manufacturer"),
      field("model"),
      field("serial"),
      field("cpu_vendor"),
      field("cpu_model"),
      field("cpu_freq"),
      field("cpu_cores"),
      field("cpu_threads"),
      field("cpu_dies"),
      field("mem_bytes", (row, locale) => formatSizeMiB(row.mem_bytes, locale)),
      field("mem_banks"),
      field("mem_slots"),
      field("power_supply_nb"),
      field("power_protect"),
      field("power_protect_breaker"),
      field("power_cabinet1"),
      field("power_breaker1"),
      field("power_cabinet2"),
      field("power_breaker2"),
      field("blade_cabinet"),
      field("warranty_end", date("warranty_end")),
      field("maintenance_end", date("maintenance_end")),
    ],
  },
  {
    key: "system",
    family: "os",
    fields: [
      {
        prop: "os_name",
        format: text("os_name"),
        // Same logo as in the list, next to the name of the system.
        render: (row: NodeRow) => (
          <span className="inline-flex items-center gap-1.5">
            <OsLogo osName={row.os_name} />
            {row.os_name}
          </span>
        ),
      },
      field("os_release"),
      field("os_vendor"),
      field("os_arch"),
      field("os_kernel"),
      field("os_update"),
      field("last_boot", date("last_boot")),
    ],
  },
  {
    key: "virtualization",
    family: "hypervisor",
    fields: [field("hv"), field("hvpool"), field("hvvdc")],
  },
  {
    key: "location",
    family: "location",
    fields: [
      field("tz"),
      field("loc_country"),
      field("loc_city"),
      field("loc_zip"),
      field("loc_addr"),
      field("loc_building"),
      field("loc_floor"),
      field("loc_room"),
      field("loc_rack"),
      field("enclosure"),
      field("enclosureslot"),
    ],
  },
  {
    key: "agent",
    family: "service",
    fields: [
      field("node_frozen"),
      field("version"),
      field("collector"),
      field("connect_to"),
      field("listener_port"),
      field("node_env"),
      // The agent either pushes its actions to the collector or pulls them.
      { ...field("action_type"), optionsKey: "actionTypes" },
      field("last_comm", date("last_comm")),
      field("updated", date("updated")),
    ],
  },
];

/** The values of action_type the API accepts. */
const ACTION_TYPES = ["push", "pull"];

// Ask the collector only for the properties actually shown.
const PROPS = GROUPS.flatMap((group) => group.fields.map((f) => f.prop)).join(",");

/**
 * Detail of a node: its properties, then its related data, one tab each
 * (`NODE_RELATED_TABS`), gathered in groups (`NODE_TAB_GROUPS`). The open tab lives
 * in the URL (`tab`), held by the view.
 */
export function NodeDetailPanel({
  nodeId,
  nodename,
  onClose,
  tab,
  onTabChange,
}: {
  nodeId: string | undefined;
  nodename: string;
  onClose: () => void;
  tab: string | undefined;
  onTabChange: (tab: string | undefined) => void;
}) {
  const { t } = useTranslation();
  // The category of the former Inventory tab, which links of before its split name.
  const search: { diff?: unknown } = useSearch({ strict: false });
  const queryClient = useQueryClient();
  const {
    data: node,
    isPending,
    isError,
    error,
  } = useQuery({
    queryKey: ["node", nodeId],
    enabled: nodeId !== undefined,
    queryFn: async ({ signal }) => {
      const { data, error: failure } = await api.GET("/nodes/{node_id}", {
        signal,
        params: { path: { node_id: nodeId ?? "" }, query: { props: PROPS } },
      });
      if (failure !== undefined) throw new Error(JSON.stringify(failure));
      const rows: NodeRow[] = Array.isArray(data.data) ? data.data : [];
      return rows[0] ?? null;
    },
  });

  const save = useMutation({
    mutationFn: async (changes: Record<string, string | number | boolean>) => {
      const { error: failure } = await api.POST("/nodes/{node_id}", {
        params: { path: { node_id: nodeId ?? "" } },
        body: changes,
      });
      if (failure !== undefined) throw new Error(problemText(failure));
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["nodes"] });
      await queryClient.invalidateQueries({ queryKey: ["node", nodeId] });
    },
  });

  const open = nodeId !== undefined;
  const tags = useNodeTags(nodeId);
  const teams = useTeams();
  const appCodes = useAppCodes();
  const tagEdit = useTagEdit("node", nodeId);
  // The values a Manager configured for some attributes, offered when editing them.
  const constraints = useFieldConstraints("node");

  return (
    <RelatedTabsPanel
      open={open}
      title={node?.nodename ?? (nodename === "" ? t("nodes.detail.title") : nodename)}
      kind="node"
      onClose={onClose}
      objectId={nodeId}
      tabs={NODE_RELATED_TABS}
      groups={NODE_TAB_GROUPS}
      // The boxes as a horizontal masonry rather than in columns.
      tileLayout="masonry"
      tab={currentTab(tab, search.diff)}
      onTabChange={onTabChange}
      propertiesFamily="node"
      label={t("nodes.related.label")}
      titleActions={
        <div className="flex items-center gap-2">
          {tagEdit.allowed && nodeId !== undefined && (
            <NodeActionsMenu
              nodes={[{ id: nodeId, name: node?.nodename ?? nodeId }]}
              onDeleted={onClose}
            />
          )}
          <NodeWebappLink node={node} />
          {node?.nodename !== undefined && (
            <AskAssistantLink prompt={t("assistant.askAbout.node", { node: node.nodename })} />
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
        options={{ teams: teams.data ?? [], apps: appCodes.data ?? [], actionTypes: ACTION_TYPES }}
        valueLists={valueLists(constraints.data?.data)}
        row={node}
        onSave={(changes) => save.mutateAsync(changes)}
        labelPrefix="nodes.fields"
        groupPrefix="nodes.detail.groups"
        isPending={open && isPending}
        errorMessage={isError ? error.message : null}
      />
    </RelatedTabsPanel>
  );
}

/** The categories the Inventory tab held, a tab each since. */
const INVENTORY_TABS = ["hardware", "networks", "storage", "packages"];

/**
 * The tab to open: a link of before the split of the Inventory tab
 * (`tab=inventory`, its category in `diff`) opens that category, hardware by default.
 */
function currentTab(tab: string | undefined, diff: unknown): string | undefined {
  if (tab !== "inventory") return tab;
  return INVENTORY_TABS.find((key) => key === diff) ?? "hardware";
}
