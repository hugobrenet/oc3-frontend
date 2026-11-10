import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";

/** A node or a service the collector holds, which the page can show the record of. */
export interface Target {
  kind: "node" | "service";
  /** Its collector ID, which its record opens by. */
  id: string;
  name: string;
}

/** A name or an ID worth asking the collector about: no space, no comma, within a name's length. */
const CANDIDATE = /^[A-Za-z0-9][A-Za-z0-9_.:/@-]{0,254}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The inline code spans of a Markdown text, the names its answer may give. */
export function codeSpans(text: string): string[] {
  return [...text.matchAll(/(?<!`)`([^`\n]+)`(?!`)/g)].map((match) => (match[1] ?? "").trim());
}

type Row = Record<string, unknown>;

/**
 * The rows of a list of the collector whose `prop` is one of `values`, with the
 * properties `props`; none without a value to look for.
 */
async function rowsOf(
  path: "/nodes" | "/services",
  props: string,
  prop: string,
  values: string[],
): Promise<Row[]> {
  if (values.length === 0) return [];
  const query = { props, limit: 0, filter: [`${prop}:in:${values.join(",")}`] };
  const { data, error } =
    path === "/nodes"
      ? await api.GET("/nodes", { params: { query } })
      : await api.GET("/services", { params: { query } });
  if (error !== undefined) throw new Error(path);
  const rows: unknown = data.data;
  return Array.isArray(rows) ? (rows as Row[]) : [];
}

/**
 * The targets of rows, by the name and by the ID they hold: a value that names
 * several, such as a service name in several clusters, holds them all.
 */
function byValue(rows: Row[], kind: Target["kind"], idProp: string, nameProp: string) {
  const found = new Map<string, Map<string, Target>>();
  for (const row of rows) {
    const id = row[idProp];
    const name = row[nameProp];
    if (typeof id !== "string" || typeof name !== "string") continue;
    for (const value of [id, name]) {
      const targets = found.get(value) ?? new Map<string, Target>();
      targets.set(id, { kind, id, name });
      found.set(value, targets);
    }
  }
  return found;
}

/**
 * The nodes and services a list of names or IDs designates, among those the
 * user may see, by the name or ID asked: what the model names becomes a badge
 * only when the collector holds it, a name made up staying text. A name that
 * is a node and a service, or several of either, designates nothing. Asked once
 * per set of names, and kept a while: the records barely change in a
 * conversation.
 */
export function useTargets(values: string[]): Map<string, Target> {
  const candidates = [...new Set(values.filter((value) => CANDIDATE.test(value)))].sort();
  const { data } = useQuery({
    queryKey: ["assistant", "targets", candidates],
    enabled: candidates.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const ids = candidates.filter((value) => UUID.test(value));
      const names = candidates.filter((value) => !UUID.test(value));
      const [nodesByName, nodesById, servicesByName, servicesById] = await Promise.all([
        rowsOf("/nodes", "node_id,nodename", "nodename", names),
        rowsOf("/nodes", "node_id,nodename", "node_id", ids),
        rowsOf("/services", "svc_id,svcname", "svcname", names),
        rowsOf("/services", "svc_id,svcname", "svc_id", ids),
      ]);
      const nodes = byValue([...nodesByName, ...nodesById], "node", "node_id", "nodename");
      const services = byValue(
        [...servicesByName, ...servicesById],
        "service",
        "svc_id",
        "svcname",
      );
      const targets = new Map<string, Target>();
      for (const value of candidates) {
        const found = [
          ...(nodes.get(value)?.values() ?? []),
          ...(services.get(value)?.values() ?? []),
        ];
        const target = found[0];
        if (found.length === 1 && target !== undefined) targets.set(value, target);
      }
      return targets;
    },
  });
  return data ?? EMPTY;
}

const EMPTY = new Map<string, Target>();
