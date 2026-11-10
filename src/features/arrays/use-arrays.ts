import { useQuery } from "@tanstack/react-query";
import type { components } from "@/lib/api/schema";
import { api } from "@/lib/api/client";
import { problemText } from "@/lib/api/problem";

export type ArrayRow = components["schemas"]["ArrayRow"];
export type DiskGroupRow = components["schemas"]["DiskGroupRow"];
export type ArrayTargetRow = components["schemas"]["ArrayTargetRow"];

/** A node inventorying an array, with the name of the node. */
export interface ArrayProxy {
  nodeId: string;
  nodename: string;
}

const rows = <T>(data: { data?: unknown }): T[] =>
  Array.isArray(data.data) ? (data.data as T[]) : [];

/** Loads an array, for its detail panel. */
export function useArray(arrayId: string | undefined) {
  return useQuery({
    queryKey: ["array", arrayId],
    enabled: arrayId !== undefined,
    queryFn: async () => {
      const { data, error } = await api.GET("/arrays/{array_id}", {
        params: { path: { array_id: arrayId ?? "" } },
      });
      if (error !== undefined) throw new Error(problemText(error));
      return rows<ArrayRow>(data)[0] ?? null;
    },
  });
}

/** The disk groups of an array, by name. */
export function useArrayDiskgroups(arrayId: string | undefined) {
  return useQuery({
    queryKey: ["array", arrayId, "diskgroups"],
    enabled: arrayId !== undefined,
    queryFn: async () => {
      const { data, error } = await api.GET("/arrays/{array_id}/diskgroups", {
        params: { path: { array_id: arrayId ?? "" }, query: { limit: 0, orderby: "dg_name" } },
      });
      if (error !== undefined) throw new Error(problemText(error));
      return rows<DiskGroupRow>(data);
    },
  });
}

/** The target ports of an array. */
export function useArrayTargets(arrayId: string | undefined) {
  return useQuery({
    queryKey: ["array", arrayId, "targets"],
    enabled: arrayId !== undefined,
    queryFn: async () => {
      const { data, error } = await api.GET("/arrays/{array_id}/targets", {
        params: {
          path: { array_id: arrayId ?? "" },
          query: { limit: 0, orderby: "array_tgtid" },
        },
      });
      if (error !== undefined) throw new Error(problemText(error));
      return rows<ArrayTargetRow>(data);
    },
  });
}

/** The nodes inventorying an array, by name. */
export function useArrayProxies(arrayId: string | undefined) {
  return useQuery({
    queryKey: ["array", arrayId, "proxies"],
    enabled: arrayId !== undefined,
    queryFn: async (): Promise<ArrayProxy[]> => {
      const { data, error } = await api.GET("/arrays/{array_id}/proxies", {
        params: {
          path: { array_id: arrayId ?? "" },
          query: { props: "node_id,nodes.nodename", limit: 0 },
        },
      });
      if (error !== undefined) throw new Error(problemText(error));
      return rows<Record<string, unknown>>(data)
        .map((row) => {
          const nodeId = typeof row.node_id === "string" ? row.node_id : "";
          const name = row["nodes.nodename"];
          return { nodeId, nodename: typeof name === "string" && name !== "" ? name : nodeId };
        })
        .filter((p) => p.nodeId !== "")
        .sort((a, b) => a.nodename.localeCompare(b.nodename));
    },
  });
}

/** The nodes that can be set as proxies, by name. */
export function useNodeChoices(enabled: boolean) {
  return useQuery({
    queryKey: ["nodes", "choices"],
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await api.GET("/nodes", {
        params: { query: { props: "node_id,nodename", orderby: "nodename", limit: 0 } },
      });
      if (error !== undefined) throw new Error(problemText(error));
      return rows<{ node_id?: string; nodename?: string }>(data).flatMap((row) =>
        row.node_id === undefined
          ? []
          : [{ nodeId: row.node_id, nodename: row.nodename ?? row.node_id }],
      );
    },
  });
}

/** Sets a node as a proxy of an array, or unsets it. */
export function changeArrayProxy(arrayId: string, nodeId: string, add: boolean) {
  const params = { params: { path: { array_id: arrayId, node_id: nodeId } } };
  return add
    ? api.POST("/arrays/{array_id}/proxies/{node_id}", params)
    : api.DELETE("/arrays/{array_id}/proxies/{node_id}", params);
}

/** Changes the comment of an array. */
export async function setArrayComment(arrayId: string, comment: string) {
  const { error } = await api.POST("/arrays/{array_id}", {
    params: { path: { array_id: arrayId } },
    body: { array_comment: comment },
  });
  if (error !== undefined) throw new Error(problemText(error));
}
