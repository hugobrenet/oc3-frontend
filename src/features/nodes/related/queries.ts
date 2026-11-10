import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ALERT_PROPS } from "@/components/opensvc/alerts";
import type { components } from "@/lib/api/schema";
import { api } from "@/lib/api/client";
import { problemText } from "@/lib/api/problem";
import { toTagRows } from "@/features/tags/tag-row";
import { toPage } from "@/lib/api/page";

type NodeHardwareRow = components["schemas"]["NodeHardwareRow"];
type LogRow = components["schemas"]["LogRow"];
type AlertRow = components["schemas"]["AlertRow"];
type IpRow = components["schemas"]["IpRow"];
type DiskRow = components["schemas"]["DiskRow"];
type HbaRow = components["schemas"]["HbaRow"];
type CheckRow = components["schemas"]["CheckRow"];
export type NodeServiceRow = components["schemas"]["InstanceRow"];

/**
 * Hardware inventory of the node, as pushed by the agent. Loaded whole: a node counts
 * a few dozen components.
 */
export function useNodeHardware(nodeId: string | undefined) {
  return useQuery({
    queryKey: ["node", nodeId, "hardware"],
    enabled: nodeId !== undefined,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET("/nodes/{node_id}/hardware", {
        signal,
        params: {
          path: { node_id: nodeId ?? "" },
          query: {
            props: "id,hw_type,hw_path,hw_class,hw_description,hw_driver,updated",
            orderby: "hw_type,hw_path",
            limit: 0,
          },
        },
      });
      if (error !== undefined) throw new Error(problemText(error));
      const rows: NodeHardwareRow[] = Array.isArray(data.data) ? data.data : [];
      return rows;
    },
  });
}

/** Log entries of a node shown in its tab: the most recent ones. */
export const NODE_LOGS_LIMIT = 100;

/**
 * The latest log entries of the node, the most recent first, and how many there
 * are in all: `GET /logs` filtered on the node, as the historical node logs tab.
 */
export function useNodeLogs(nodeId: string | undefined) {
  return useQuery({
    queryKey: ["node", nodeId, "logs"],
    enabled: nodeId !== undefined,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET("/logs", {
        signal,
        params: {
          query: {
            props:
              "id,log_date,log_level,svc_id,services.svcname,log_user,log_impersonator,log_origin,log_action,log_fmt,log_dict",
            orderby: "-log_date,-id",
            // One more than shown: whether older entries remain.
            limit: NODE_LOGS_LIMIT + 1,
            filter: [`node_id:eq:${nodeId ?? ""}`],
          },
        },
      });
      if (error !== undefined) throw new Error(problemText(error));
      const rows: LogRow[] = Array.isArray(data.data) ? data.data : [];
      return toPage(rows, data.meta, NODE_LOGS_LIMIT);
    },
  });
}

/** Dashboard alerts aimed at the node, the most severe then the most recent first. */
export function useNodeAlerts(nodeId: string | undefined) {
  return useQuery({
    queryKey: ["node", nodeId, "alerts"],
    enabled: nodeId !== undefined,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET("/nodes/{node_id}/alerts", {
        signal,
        params: {
          path: { node_id: nodeId ?? "" },
          query: {
            props: ALERT_PROPS,
            orderby: "-dash_severity,-dash_updated",
            limit: 0,
          },
        },
      });
      if (error !== undefined) throw new Error(problemText(error));
      const rows: AlertRow[] = Array.isArray(data.data) ? data.data : [];
      return rows;
    },
  });
}

/**
 * Checks of the node, as its agent last reported them, with the thresholds the
 * collector set and the object each one is attributed to. Loaded whole: a node
 * counts a few hundred at most.
 */
export function useNodeChecks(nodeId: string | undefined) {
  return useQuery({
    queryKey: ["node", nodeId, "checks"],
    enabled: nodeId !== undefined,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET("/nodes/{node_id}/checks", {
        signal,
        params: {
          path: { node_id: nodeId ?? "" },
          query: {
            props:
              "id,svc_id,services.svcname,chk_type,chk_instance,chk_value,chk_low,chk_high,chk_err,chk_threshold_provider,chk_updated",
            orderby: "chk_type,chk_instance",
            limit: 0,
          },
        },
      });
      if (error !== undefined) throw new Error(problemText(error));
      const rows: CheckRow[] = Array.isArray(data.data) ? data.data : [];
      return rows;
    },
  });
}

/**
 * The service instances of the node, one row per container for an encapsulated
 * service, with the columns of the historical collector's node tab
 * (`table_service_instances_node`). Loaded whole: a node hosts a few hundred
 * instances at most.
 */
export function useNodeServices(nodeId: string | undefined) {
  return useQuery({
    queryKey: ["node", nodeId, "services"],
    enabled: nodeId !== undefined,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET("/nodes/{node_id}/services", {
        signal,
        params: {
          path: { node_id: nodeId ?? "" },
          query: {
            props:
              "svc_id,node_id,services.svcname,services.svc_ha,services.svc_topology,mon_vmtype,mon_vmname,mon_availstatus,mon_overallstatus,mon_frozen,mon_updated",
            orderby: "services.svcname,mon_vmname",
            limit: 0,
          },
        },
      });
      if (error !== undefined) throw new Error(problemText(error));
      const rows: NodeServiceRow[] = Array.isArray(data.data) ? data.data : [];
      return rows;
    },
  });
}

/**
 * IP addresses of the node, with the declared network that contains them. The
 * endpoint refuses `orderby` (same mapping as `/ips`): a node counts a few hundred at
 * most, so sorting is done on display.
 */
export function useNodeIps(nodeId: string | undefined) {
  return useQuery({
    queryKey: ["node", nodeId, "ips"],
    enabled: nodeId !== undefined,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET("/nodes/{node_id}/ips", {
        signal,
        params: {
          path: { node_id: nodeId ?? "" },
          query: {
            props:
              "id,intf,type,addr,mask,mac,flag_deprecated,net_name,net_network,net_netmask,net_gateway,updated",
            limit: 0,
          },
        },
      });
      if (error !== undefined) throw new Error(problemText(error));
      const rows: IpRow[] = Array.isArray(data.data) ? data.data : [];
      return rows;
    },
  });
}

/** Disks seen by the node, sorted by service then by id. */
export function useNodeDisks(nodeId: string | undefined) {
  return useQuery({
    queryKey: ["node", nodeId, "disks"],
    enabled: nodeId !== undefined,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET("/nodes/{node_id}/disks", {
        signal,
        params: {
          path: { node_id: nodeId ?? "" },
          query: {
            props:
              "disk_id,disk_name,disk_vendor,disk_model,disk_size,disk_used,disk_dg,disk_group,disk_raid,svc_id,svcname,app,updated",
            orderby: "svcname,disk_id",
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

/** Host bus adapters of the node (iSCSI, Fibre Channel…), by type then id. */
export function useNodeHbas(nodeId: string | undefined) {
  return useQuery({
    queryKey: ["node", nodeId, "hbas"],
    enabled: nodeId !== undefined,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET("/nodes/{node_id}/hbas", {
        signal,
        params: {
          path: { node_id: nodeId ?? "" },
          query: { props: "id,hba_id,hba_type,updated", orderby: "hba_type,hba_id", limit: 0 },
        },
      });
      if (error !== undefined) throw new Error(problemText(error));
      const rows: HbaRow[] = Array.isArray(data.data) ? data.data : [];
      return rows;
    },
  });
}

/** The SAN wiring of the node, as a graph: adapters, switches, arrays and their links. */
export function useNodeSan(nodeId: string | undefined) {
  return useQuery({
    queryKey: ["node", nodeId, "san"],
    enabled: nodeId !== undefined,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET("/nodes/{node_id}/san", {
        signal,
        params: { path: { node_id: nodeId ?? "" } },
      });
      if (error !== undefined) throw new Error(problemText(error));
      return data.data;
    },
  });
}

/** Tags attached to the node. `GET /…/tags` returns the generic `ListResponse`: read by `toTagRows`. */
export function useNodeTags(nodeId: string | undefined) {
  return useQuery({
    queryKey: ["node", nodeId, "tags"],
    enabled: nodeId !== undefined,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET("/nodes/{node_id}/tags", {
        signal,
        params: { path: { node_id: nodeId ?? "" }, query: { orderby: "tag_name", limit: 0 } },
      });
      if (error !== undefined) throw new Error(problemText(error));
      return toTagRows(data.data);
    },
  });
}

type PackageRow = components["schemas"]["PackageRow"];

/** The filter naming the node's packages in `GET /packages`. */
function nodePackagesFilter(nodeId: string | undefined): string {
  return `node_id:eq:${nodeId ?? ""}`;
}

/**
 * Number of packages installed on the node, for the tab counter: read from the
 * total of a one-row page, a node counting a couple of thousand packages that the
 * counter need not load whenever the panel opens.
 */
export function useNodePackageCount(nodeId: string | undefined) {
  return useQuery({
    queryKey: ["node", nodeId, "packages", "count"],
    enabled: nodeId !== undefined,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET("/packages", {
        signal,
        params: { query: { props: "id", limit: 1, filter: [nodePackagesFilter(nodeId)] } },
      });
      if (error !== undefined) throw new Error(problemText(error));
      return data.meta?.total;
    },
  });
}

/** Packages installed on the node, by name then architecture; loaded when the tab opens. */
export function useNodePackages(nodeId: string | undefined) {
  return useQuery({
    queryKey: ["node", nodeId, "packages"],
    enabled: nodeId !== undefined,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET("/packages", {
        signal,
        params: {
          query: {
            props:
              "id,pkg_name,pkg_version,pkg_arch,pkg_type,sig_provider,pkg_install_date,pkg_updated",
            orderby: "pkg_name,pkg_arch",
            limit: 0,
            filter: [nodePackagesFilter(nodeId)],
          },
        },
      });
      if (error !== undefined) throw new Error(problemText(error));
      const rows: PackageRow[] = Array.isArray(data.data) ? data.data : [];
      return rows;
    },
  });
}

export type SysreportChange = components["schemas"]["SysreportChange"];
export type SysreportFileDiff = components["schemas"]["SysreportFileDiff"];
export type SysreportEntry = components["schemas"]["SysreportEntry"];

/**
 * Changes of the files and command outputs the node reports (sysreport), newest
 * first: the first `limit` of those made since `begin` whose paths contain `path`.
 * The previous list stays on display while a filter or a longer list loads.
 */
export function useNodeSysreport(
  nodeId: string | undefined,
  filter: { path: string; begin: string | undefined; limit: number },
) {
  return useQuery({
    queryKey: ["node", nodeId, "sysreport", filter.path, filter.begin, filter.limit],
    enabled: nodeId !== undefined,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET("/nodes/{node_id}/sysreport", {
        signal,
        params: {
          path: { node_id: nodeId ?? "" },
          query: {
            path: filter.path === "" ? undefined : filter.path,
            begin: filter.begin,
            limit: filter.limit,
          },
        },
      });
      if (error !== undefined) throw new Error(problemText(error));
      return { changes: data.data, total: data.meta.total };
    },
  });
}

/** What a report changed, file by file, as unified diffs; loaded when it is opened. */
export function useNodeSysreportChange(nodeId: string, cid: string, enabled: boolean) {
  return useQuery({
    queryKey: ["node", nodeId, "sysreport", "change", cid],
    enabled,
    // A report does not change once made.
    staleTime: Infinity,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET("/nodes/{node_id}/sysreport/{cid}", {
        signal,
        params: { path: { node_id: nodeId, cid } },
      });
      if (error !== undefined) throw new Error(problemText(error));
      return data.data;
    },
  });
}

/** The files and command outputs of the node's sysreport at a revision, HEAD for the latest. */
export function useNodeSysreportTree(nodeId: string | undefined, cid: string, enabled = true) {
  return useQuery({
    queryKey: ["node", nodeId, "sysreport", "tree", cid],
    enabled: enabled && nodeId !== undefined,
    queryFn: async ({ signal }) => {
      const { data, error, response } = await api.GET("/nodes/{node_id}/sysreport/{cid}/tree", {
        signal,
        params: { path: { node_id: nodeId ?? "", cid } },
      });
      // A node that never reported has no tree: nothing to list, not an error.
      if (error !== undefined && response.status === 404) return [];
      if (error !== undefined) throw new Error(problemText(error));
      return data.data;
    },
  });
}

/** The content of a file of the sysreport; loaded when it is opened. */
export function useNodeSysreportFile(nodeId: string, cid: string, oid: string, enabled: boolean) {
  return useQuery({
    queryKey: ["node", nodeId, "sysreport", "file", oid],
    enabled,
    // An object id names one content for ever.
    staleTime: Infinity,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET("/nodes/{node_id}/sysreport/{cid}/tree/{oid}", {
        signal,
        params: { path: { node_id: nodeId, cid, oid } },
      });
      if (error !== undefined) throw new Error(problemText(error));
      return data.data;
    },
  });
}

/**
 * What changed in each file between two reports of the node, the older first;
 * without an end, up to the latest report.
 */
export function useNodeSysreportTimediff(nodeId: string, begin: string, end: string | undefined) {
  return useQuery({
    queryKey: ["node", nodeId, "sysreport", "timediff", begin, end ?? "latest"],
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET("/nodes/{node_id}/sysreport/timediff", {
        signal,
        params: { path: { node_id: nodeId }, query: { begin, end } },
      });
      if (error !== undefined) throw new Error(problemText(error));
      return data.data;
    },
  });
}
