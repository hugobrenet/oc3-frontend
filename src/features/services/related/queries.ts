import { useQueries, useQuery } from "@tanstack/react-query";
import { ALERT_PROPS } from "@/components/opensvc/alerts";
import type { components } from "@/lib/api/schema";
import { api } from "@/lib/api/client";
import { problemText } from "@/lib/api/problem";
import { toPage } from "@/lib/api/page";
import { toValueStats } from "@/lib/api/value-stats";
import { toTagRows } from "@/features/tags/tag-row";
import { NODE_PROPS } from "@/features/nodes/node-props";

type DiskRow = components["schemas"]["DiskRow"];
type HbaRow = components["schemas"]["HbaRow"];
type InstanceRow = components["schemas"]["InstanceRow"];

/** Disks of the service, as seen by each of its nodes. */
export function useServiceDisks(svcId: string | undefined) {
  return useQuery({
    queryKey: ["service", svcId, "disks"],
    enabled: svcId !== undefined,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET("/services/{svc_id}/disks", {
        signal,
        params: {
          path: { svc_id: svcId ?? "" },
          query: {
            props:
              "disk_id,disk_name,disk_vendor,disk_model,disk_size,disk_used,disk_dg,node_id,nodename,svc_id,updated",
            orderby: "nodename,disk_id",
            limit: 0,
          },
        },
      });
      if (error !== undefined) throw new Error(problemText(error));
      const rows: DiskRow[] = Array.isArray(data.data) ? data.data : [];
      return rows;
    },
  });
}

/**
 * Host bus adapters of the nodes carrying an instance of the service, as in the
 * Storage tab of the historical collector (`ajax_svc_stor`). apicollector has no
 * dedicated endpoint: the instances are read, then the HBAs of each node.
 */
export function useServiceHbas(svcId: string | undefined) {
  return useQuery({
    queryKey: ["service", svcId, "hbas"],
    enabled: svcId !== undefined,
    queryFn: async ({ signal }) => {
      const instances = await api.GET("/services_instances/{svc_id}", {
        signal,
        params: {
          path: { svc_id: svcId ?? "" },
          query: { props: "node_id,nodes.nodename", limit: 0 },
        },
      });
      if (instances.error !== undefined) throw new Error(problemText(instances.error));
      const nodes: InstanceRow[] = Array.isArray(instances.data.data) ? instances.data.data : [];
      const unique = [...new Map(nodes.map((node) => [node.node_id ?? "", node])).values()].filter(
        (node) => node.node_id !== undefined && node.node_id !== "",
      );
      const perNode = await Promise.all(
        unique.map(async (node) => {
          const { data, error } = await api.GET("/nodes/{node_id}/hbas", {
            signal,
            params: {
              path: { node_id: node.node_id ?? "" },
              query: {
                props: "id,node_id,hba_id,hba_type,updated",
                orderby: "hba_type,hba_id",
                limit: 0,
              },
            },
          });
          if (error !== undefined) throw new Error(problemText(error));
          const rows: HbaRow[] = Array.isArray(data.data) ? data.data : [];
          return { nodename: node["nodes.nodename"] ?? node.node_id ?? "", rows };
        }),
      );
      return perNode.sort((a, b) => a.nodename.localeCompare(b.nodename));
    },
  });
}

/** Tags attached to the service. `GET /…/tags` returns the generic `ListResponse`: read by `toTagRows`. */
export function useServiceTags(svcId: string | undefined) {
  return useQuery({
    queryKey: ["service", svcId, "tags"],
    enabled: svcId !== undefined,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET("/services/{svc_id}/tags", {
        signal,
        params: { path: { svc_id: svcId ?? "" }, query: { orderby: "tag_name", limit: 0 } },
      });
      if (error !== undefined) throw new Error(problemText(error));
      return toTagRows(data.data);
    },
  });
}

type PackagesDiff = components["schemas"]["PackagesDiffResponse"];

/**
 * Packages that differ between the nodes of the service, as the historical
 * PkgDiff tab: between the nodes running its instances, or with `encap` between
 * its encapsulated nodes. Null when there is nothing to compare: the API answers
 * 400 below two nodes, which a service on a single node always meets.
 *
 * Costly for the collector: refreshed live only by the packages the nodes push,
 * at most every two minutes. Not read while `enabled` is false; what was read is
 * still given.
 */
export function useServicePackagesDiff(svcId: string | undefined, encap: boolean, enabled = true) {
  return useQuery({
    queryKey: ["service", svcId, "pkgdiff", encap],
    enabled: enabled && svcId !== undefined,
    meta: { liveTables: ["packages"], liveMinMs: 2 * 60 * 1000 },
    queryFn: async ({ signal }): Promise<PackagesDiff | null> => {
      const { data, error, response } = await api.GET("/packages/diff", {
        params: { query: { svc_ids: svcId ?? "", encap } },
        signal,
      });
      if (response.status === 400) return null;
      if (error !== undefined) throw new Error(problemText(error));
      return data;
    },
  });
}

type NodeRow = components["schemas"]["NodeRow"];
type ComplianceStatusRow = components["schemas"]["ComplianceStatusRow"];
type ModulesetRow = components["schemas"]["ModulesetRow"];
type RulesetRow = components["schemas"]["RulesetRow"];

/** The ids of the nodes running an instance of the service, as the historical nodediff reads them. */
export function useServiceNodeIds(svcId: string | undefined) {
  return useQuery({
    queryKey: ["service", svcId, "node-ids"],
    enabled: svcId !== undefined,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET("/services_instances", {
        signal,
        params: {
          query: { props: "node_id", limit: 0, filter: [`svc_id:eq:${svcId ?? ""}`] },
        },
      });
      if (error !== undefined) throw new Error(problemText(error));
      const rows: InstanceRow[] = Array.isArray(data.data) ? data.data : [];
      // An encapsulated service has one row per container on a node: counted once.
      return [...new Set(rows.flatMap((row) => (row.node_id ? [row.node_id] : [])))].sort();
    },
  });
}

/**
 * Every property of the given nodes, by name, for the asset differences: refreshed
 * live at most every minute. Not read while `enabled` is false.
 */
export function useNodesAssets(nodeIds: string[] | undefined, enabled = true) {
  return useQuery({
    queryKey: ["nodes", "assets", nodeIds],
    enabled: enabled && nodeIds !== undefined && nodeIds.length > 0,
    meta: { liveTables: ["nodes"], liveMinMs: 60 * 1000 },
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET("/nodes", {
        signal,
        params: {
          query: {
            props: NODE_PROPS.join(","),
            orderby: "nodename",
            limit: 0,
            filter: [`node_id:in:${(nodeIds ?? []).join(",")}`],
          },
        },
      });
      if (error !== undefined) throw new Error(problemText(error));
      const rows: NodeRow[] = Array.isArray(data.data) ? data.data : [];
      return rows;
    },
  });
}

/** What the compliance of a node is made of, for the compliance differences. */
export interface NodeCompliance {
  nodeId: string;
  status: ComplianceStatusRow[];
  modulesets: ModulesetRow[];
  rulesets: RulesetRow[];
}

/**
 * The compliance of each of the given nodes: the last run of each module, and the
 * modulesets and rulesets attached. Read node by node, the API having no request
 * over several nodes; a service runs on a handful of them. Refreshed live only by
 * the compliance tables, at most every minute; not read while `enabled` is false.
 */
export function useNodesCompliance(nodeIds: string[] | undefined, enabled = true) {
  return useQueries({
    queries: (nodeIds ?? []).map((nodeId) => ({
      queryKey: ["node", nodeId, "compliance-summary"],
      enabled,
      meta: {
        liveTables: ["comp_status", "comp_node_moduleset", "comp_rulesets_nodes"],
        liveMinMs: 60 * 1000,
      },
      queryFn: async ({ signal }: { signal: AbortSignal }): Promise<NodeCompliance> => {
        const path = { node_id: nodeId };
        const [status, modulesets, rulesets] = await Promise.all([
          api.GET("/nodes/{node_id}/compliance/status", {
            params: { path, query: { props: "run_module,run_status,svc_id", limit: 0 } },
            signal,
          }),
          api.GET("/nodes/{node_id}/compliance/modulesets", {
            params: { path, query: { props: "id,modset_name", limit: 0 } },
            signal,
          }),
          api.GET("/nodes/{node_id}/compliance/rulesets", {
            params: { path, query: { props: "id,ruleset_name", limit: 0 } },
            signal,
          }),
        ]);
        for (const r of [status, modulesets, rulesets])
          if (r.error !== undefined) throw new Error(problemText(r.error));
        return {
          nodeId,
          status: Array.isArray(status.data?.data) ? status.data.data : [],
          modulesets: Array.isArray(modulesets.data?.data) ? modulesets.data.data : [],
          rulesets: Array.isArray(rulesets.data?.data) ? rulesets.data.data : [],
        };
      },
    })),
    combine: (results) => ({
      data: results.every((r) => r.isSuccess)
        ? results.flatMap((r) => (r.data === undefined ? [] : [r.data]))
        : undefined,
      isPending: results.some((r) => r.isPending),
      error: results.find((r) => r.isError)?.error ?? null,
    }),
  });
}

type ResourceRow = components["schemas"]["ResourceRow"];

/** A resource of the service, with the name of the node that reports it. */
export interface ServiceResource extends ResourceRow {
  nodename: string;
}

/** The props of a resource the service and instance panels show. */
export const SERVICE_RESOURCE_PROPS =
  "id,node_id,vmname,rid,res_type,res_status,res_desc,res_log,res_monitor,res_disable,res_optional,updated";

/**
 * The instances of a service, for the names of its nodes and its own: the
 * per-service resource endpoints give neither.
 */
export function getServiceInstanceNames(svcId: string, signal?: AbortSignal) {
  return api.GET("/services_instances/{svc_id}", {
    signal,
    params: {
      path: { svc_id: svcId },
      query: { props: "node_id,nodes.nodename,services.svcname", limit: 0 },
    },
  });
}

/**
 * Resources completed with their service and node, by id and name, as the
 * Resources list gives them: what the actions menu queues and names.
 */
export function namedResources(
  svcId: string,
  rows: ResourceRow[],
  instances: InstanceRow[],
): ServiceResource[] {
  const nodes = new Map(instances.map((row) => [row.node_id ?? "", row["nodes.nodename"] ?? ""]));
  const svcname = instances.find((row) => (row["services.svcname"] ?? "") !== "")?.[
    "services.svcname"
  ];
  return rows.map((row) => {
    const nodename = nodes.get(row.node_id ?? "") || (row.node_id ?? "");
    return {
      ...row,
      svc_id: svcId,
      "services.svcname": svcname ?? svcId,
      "nodes.nodename": nodename,
      nodename,
    };
  });
}

/**
 * Resources of the service, as each of its instances reports them: the historical
 * "resources status" tab (`table_resources_svc`). The per-service endpoint has no
 * node names: they come from the service's instances, as for the HBAs.
 */
export function useServiceResources(svcId: string | undefined) {
  return useQuery({
    queryKey: ["service", svcId, "resources"],
    enabled: svcId !== undefined,
    queryFn: async ({ signal }): Promise<ServiceResource[]> => {
      const [resources, instances] = await Promise.all([
        api.GET("/services/{svc_id}/resources", {
          signal,
          params: {
            path: { svc_id: svcId ?? "" },
            query: { props: SERVICE_RESOURCE_PROPS, orderby: "node_id,vmname,rid", limit: 0 },
          },
        }),
        getServiceInstanceNames(svcId ?? "", signal),
      ]);
      if (resources.error !== undefined) throw new Error(problemText(resources.error));
      if (instances.error !== undefined) throw new Error(problemText(instances.error));
      return namedResources(
        svcId ?? "",
        (Array.isArray(resources.data.data) ? resources.data.data : []) as ResourceRow[],
        Array.isArray(instances.data.data) ? (instances.data.data as InstanceRow[]) : [],
      );
    },
  });
}

type LogRow = components["schemas"]["LogRow"];

/** Log entries shown in the service tab: the Logs view, filtered on the service, has them all. */
export const SERVICE_LOGS_LIMIT = 100;

/** The latest log entries of the service, the most recent first. */
export function useServiceLogs(svcId: string | undefined) {
  return useQuery({
    queryKey: ["service", svcId, "logs"],
    enabled: svcId !== undefined,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET("/logs", {
        signal,
        params: {
          query: {
            props:
              "id,log_date,log_level,node_id,nodes.nodename,log_user,log_impersonator,log_origin,log_action,log_fmt,log_dict",
            orderby: "-log_date,-id",
            // One more than shown: whether older entries remain.
            limit: SERVICE_LOGS_LIMIT + 1,
            filter: [`svc_id:eq:${svcId ?? ""}`],
          },
        },
      });
      if (error !== undefined) throw new Error(problemText(error));
      const rows: LogRow[] = Array.isArray(data.data) ? data.data : [];
      return toPage(rows, data.meta, SERVICE_LOGS_LIMIT);
    },
  });
}

type ServiceAction = components["schemas"]["ServiceActionRow"];

/** Actions listed in the service tab, the latest first; the timeline draws them all. */
export const SERVICE_ACTIONS_LIMIT = 100;
/** Days of actions the tab counter covers, as the historical service actions tab. */
export const SERVICE_ACTIONS_DAYS = 60;
/** The periods the tab offers, in days, and the one it opens on. */
export const SERVICE_ACTIONS_PERIODS = [1, 7, 30, 60] as const;
export const SERVICE_ACTIONS_DEFAULT_DAYS = 7;
/** Actions the timeline draws at most: past them, a note asks for a shorter period. */
export const SERVICE_ACTIONS_TIMELINE_LIMIT = 1000;

/**
 * The start of a period of `days`, as the collector writes dates. Rounded down to
 * the hour, so that the cache key holds that long.
 */
function actionsSince(days: number): string {
  const start = new Date(Date.now() - days * 24 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(start.getFullYear())}-${pad(start.getMonth() + 1)}-${pad(start.getDate())} ${pad(start.getHours())}:00:00`;
}

/**
 * The actions a tab shows: those of a service, on one of its nodes with `nodeId`
 * (an instance), or those of a node, of every service.
 */
type ActionScope = { svcId: string; nodeId?: string } | { svcId?: undefined; nodeId: string };

/** The cache key of the actions of a scope, under the object's: live updates reload it. */
function scopeKey(scope: ActionScope | undefined, ...rest: string[]): unknown[] {
  if (scope?.svcId !== undefined) return ["service", scope.svcId, ...rest, scope.nodeId ?? ""];
  return ["node", scope?.nodeId, ...rest];
}

/**
 * The filters of the tab: the actions themselves (`log_type` "status"), not their
 * log lines, of the period covered.
 */
function actionFilters(days: number, nodeId?: string): string[] {
  const filters = ["log_type:eq:status", `begin:gte:${actionsSince(days)}`];
  return nodeId === undefined ? filters : [...filters, `node_id:eq:${nodeId}`];
}

interface ActionQuery {
  props: string;
  limit?: number;
  stats?: string;
  filter: string[];
}

/**
 * Reads the actions of a scope: those of a service through its own route, those
 * of a node through the list of every action, filtered on it.
 */
async function readActions(scope: ActionScope, query: ActionQuery, signal: AbortSignal) {
  const filter =
    scope.svcId === undefined ? [...query.filter, `node_id:eq:${scope.nodeId}`] : query.filter;
  const { data, error } =
    scope.svcId === undefined
      ? await api.GET("/services_actions", { signal, params: { query: { ...query, filter } } })
      : await api.GET("/services/{svc_id}/actions", {
          signal,
          params: { path: { svc_id: scope.svcId }, query: { ...query, filter } },
        });
  if (error !== undefined) throw new Error(problemText(error));
  return data;
}

/** The node of a service scope, as its filters name it; none for a node scope, filtered whole. */
function serviceNode(scope: ActionScope): string | undefined {
  return scope.svcId === undefined ? undefined : scope.nodeId;
}

function useScopedActions(scope: ActionScope | undefined, days: number) {
  return useQuery({
    queryKey: scopeKey(scope, "actions", actionsSince(days)),
    enabled: scope !== undefined,
    queryFn: async ({ signal }) => {
      if (scope === undefined) return toPage<ServiceAction>([], undefined, 0);
      const data = await readActions(
        scope,
        {
          props:
            "id,svc_id,services.svcname,node_id,nodes.nodename,action,rid,subset,status,begin,end,time,cron,sid,pid,command,ack,acked_by,acked_date,acked_comment",
          // One more than drawn: whether older actions remain.
          limit: SERVICE_ACTIONS_TIMELINE_LIMIT + 1,
          filter: actionFilters(days, serviceNode(scope)),
        },
        signal,
      );
      const rows: ServiceAction[] = Array.isArray(data.data) ? data.data : [];
      return toPage(rows, data.meta, SERVICE_ACTIONS_TIMELINE_LIMIT);
    },
  });
}

function useScopedActionStats(scope: ActionScope | undefined) {
  return useQuery({
    queryKey: scopeKey(scope, "actions", "stats", actionsSince(SERVICE_ACTIONS_DAYS)),
    enabled: scope !== undefined,
    queryFn: async ({ signal }) => {
      if (scope === undefined) return toValueStats(undefined, undefined, "status");
      const data = await readActions(
        scope,
        {
          props: "status",
          stats: "1",
          filter: actionFilters(SERVICE_ACTIONS_DAYS, serviceNode(scope)),
        },
        signal,
      );
      return toValueStats(data.data, data.meta, "status");
    },
  });
}

function useScopedUnackedErrors(scope: ActionScope | undefined) {
  return useQuery({
    queryKey: scopeKey(scope, "unackedActionErrors"),
    enabled: scope !== undefined,
    queryFn: async ({ signal }) => {
      if (scope === undefined) return [];
      // The actions themselves, not the lines they logged, which carry a status too.
      const node = serviceNode(scope);
      const data = await readActions(
        scope,
        {
          props: "id,action,begin,services.svcname,nodes.nodename",
          limit: 0,
          filter: [
            "log_type:eq:status",
            "status:err",
            "ack:!1",
            ...(node === undefined ? [] : [`node_id:${node}`]),
          ],
        },
        signal,
      );
      const rows: ServiceAction[] = Array.isArray(data.data) ? data.data : [];
      return rows;
    },
  });
}

const serviceScope = (svcId: string | undefined, nodeId?: string): ActionScope | undefined =>
  svcId === undefined ? undefined : { svcId, nodeId };
const nodeScope = (nodeId: string | undefined): ActionScope | undefined =>
  nodeId === undefined ? undefined : { nodeId };

/**
 * The actions the agents ran on the service over the last `days`, the latest
 * first, up to `SERVICE_ACTIONS_TIMELINE_LIMIT`: the timeline draws them, the list
 * shows the latest of them; of one node only, for an instance, with `nodeId`.
 */
export function useServiceActions(svcId: string | undefined, days: number, nodeId?: string) {
  return useScopedActions(serviceScope(svcId, nodeId), days);
}

/** The actions the agents ran on a node over the last `days`, of every service. */
export function useNodeActions(nodeId: string | undefined, days: number) {
  return useScopedActions(nodeScope(nodeId), days);
}

/**
 * The actions of the period counted by status, all of them and not only those
 * shown; of one node only, for an instance, with `nodeId`.
 */
export function useServiceActionStats(svcId: string | undefined, nodeId?: string) {
  return useScopedActionStats(serviceScope(svcId, nodeId));
}

/** The actions of a node over the period, of every service, counted by status. */
export function useNodeActionStats(nodeId: string | undefined) {
  return useScopedActionStats(nodeScope(nodeId));
}

/**
 * The failed actions of a service not acknowledged yet, whatever their date; of
 * one node only, for an instance, with `nodeId`. What the historical service
 * properties counted as action errors, and what an acknowledgement clears.
 */
export function useUnackedActionErrors(svcId: string | undefined, nodeId?: string) {
  return useScopedUnackedErrors(serviceScope(svcId, nodeId));
}

/** The failed actions of a node not acknowledged yet, of every service. */
export function useNodeUnackedActionErrors(nodeId: string | undefined) {
  return useScopedUnackedErrors(nodeScope(nodeId));
}

type AlertRow = components["schemas"]["AlertRow"];

/** Alerts of the service, the most severe and the latest first. */
export function useServiceAlerts(svcId: string | undefined) {
  return useQuery({
    queryKey: ["service", svcId, "alerts"],
    enabled: svcId !== undefined,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET("/services/{svc_id}/alerts", {
        signal,
        params: {
          path: { svc_id: svcId ?? "" },
          query: { props: ALERT_PROPS, orderby: "-dash_severity,-dash_updated", limit: 0 },
        },
      });
      if (error !== undefined) throw new Error(problemText(error));
      const rows: AlertRow[] = Array.isArray(data.data) ? data.data : [];
      return rows;
    },
  });
}

/**
 * Instances of the service, with the names of their nodes: the historical
 * Status tab (`table_service_instances`), one row per node and per container of
 * an encapsulated service.
 */
export function useServiceInstances(svcId: string | undefined) {
  return useQuery({
    queryKey: ["service", svcId, "instances"],
    enabled: svcId !== undefined,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET("/services_instances/{svc_id}", {
        signal,
        params: {
          path: { svc_id: svcId ?? "" },
          query: {
            props:
              "svc_id,node_id,nodes.nodename,services.svcname,mon_vmname,mon_vmtype,mon_availstatus,mon_overallstatus,mon_frozen,mon_updated",
            orderby: "nodes.nodename,mon_vmname",
            limit: 0,
          },
        },
      });
      if (error !== undefined) throw new Error(problemText(error));
      const rows: InstanceRow[] = Array.isArray(data.data) ? data.data : [];
      return rows;
    },
  });
}

type ResinfoRow = components["schemas"]["ResinfoRow"];

/** A key a resource of the service declares, with the name of its node. */
export interface ServiceResinfo extends ResinfoRow {
  nodename: string;
}

/**
 * The keys and values the resources of the service declare, on each of its
 * nodes: the historical Resinfo tab (`table_resinfo_svc`). The endpoint has no
 * node names: they come from the service's instances.
 */
export function useServiceResinfo(svcId: string | undefined) {
  return useQuery({
    queryKey: ["service", svcId, "resinfo"],
    enabled: svcId !== undefined,
    queryFn: async ({ signal }): Promise<ServiceResinfo[]> => {
      const [resinfo, instances] = await Promise.all([
        api.GET("/services/{svc_id}/resinfo", {
          signal,
          params: {
            path: { svc_id: svcId ?? "" },
            query: {
              props: "id,node_id,rid,res_key,res_value,updated",
              orderby: "node_id,rid,res_key",
              limit: 0,
            },
          },
        }),
        getServiceInstanceNames(svcId ?? "", signal),
      ]);
      if (resinfo.error !== undefined) throw new Error(problemText(resinfo.error));
      if (instances.error !== undefined) throw new Error(problemText(instances.error));
      const names = new Map(
        (Array.isArray(instances.data.data) ? (instances.data.data as InstanceRow[]) : []).map(
          (row) => [row.node_id ?? "", row["nodes.nodename"] ?? ""],
        ),
      );
      const rows = (Array.isArray(resinfo.data.data) ? resinfo.data.data : []) as ResinfoRow[];
      return rows.map((row) => ({
        ...row,
        nodename: names.get(row.node_id ?? "") || (row.node_id ?? ""),
      }));
    },
  });
}
