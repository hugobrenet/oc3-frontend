import { useQuery } from "@tanstack/react-query";
import type { components } from "@/lib/api/schema";
import { api } from "@/lib/api/client";
import { problemText } from "@/lib/api/problem";

/**
 * The objects of the reports: the reports, the charts, the metrics. They share
 * their administration: the groups they are published to and, but for the
 * metrics, those responsible for them, the history of their definition, their
 * deletion. A ReportsManager responsible for a report or a chart changes it; the
 * metrics, SQL requests, are the managers' only.
 */
export type ReportObjectKind = "report" | "chart" | "metric";

export type Revision = components["schemas"]["FormRevision"];

const PLURAL: Record<ReportObjectKind, string> = {
  report: "reports",
  chart: "charts",
  metric: "metrics",
};

/** Whether the kind has responsible groups: the metrics have publications only. */
export const HAS_RESPONSIBLES: Record<ReportObjectKind, boolean> = {
  report: true,
  chart: true,
  metric: false,
};

/** The query key of the list of the kind, invalidated by every change. */
export const LIST_KEY: Record<ReportObjectKind, string> = PLURAL;

/** The query key of one object, and of what hangs from it. */
export const objectKey = (kind: ReportObjectKind, id: string | undefined) => [kind, id];

/**
 * The paths of these endpoints differ by kind only (`/reports/{report_id}/…`,
 * `/charts/{chart_id}/…`): they are written out here, and called through the
 * client untyped, their answers typed by the schemas they share.
 */
interface Untyped {
  GET(path: string, init?: object): Promise<{ data?: unknown; error?: unknown }>;
  POST(path: string, init?: object): Promise<{ data?: unknown; error?: unknown }>;
  DELETE(path: string, init?: object): Promise<{ data?: unknown; error?: unknown }>;
}
const raw = api as unknown as Untyped;

function path(kind: ReportObjectKind, id: string, rest = "") {
  return `/${PLURAL[kind]}/${encodeURIComponent(id)}${rest}`;
}

async function call<T>(method: keyof Untyped, url: string, init?: object): Promise<T> {
  const { data, error } = await raw[method](url, init);
  if (error !== undefined) throw new Error(problemText(error));
  return data as T;
}

const roles = (data: { data?: unknown }) =>
  (Array.isArray(data.data) ? (data.data as { role?: string }[]) : [])
    .flatMap((row) => (row.role === undefined ? [] : [row.role]))
    .sort((a, b) => a.localeCompare(b));

/** The groups the object is published to and those responsible for it, by role. */
export function useObjectTeams(kind: ReportObjectKind, id: string | undefined) {
  return useQuery({
    queryKey: [...objectKey(kind, id), "teams"],
    enabled: id !== undefined,
    queryFn: async () => {
      const init = { params: { query: { props: "id,role", limit: 0 } } };
      const [publications, responsibles] = await Promise.all([
        call<{ data?: unknown }>("GET", path(kind, id ?? "", "/publications"), init),
        HAS_RESPONSIBLES[kind]
          ? call<{ data?: unknown }>("GET", path(kind, id ?? "", "/responsibles"), init)
          : Promise.resolve({ data: [] }),
      ]);
      return { publications: roles(publications), responsibles: roles(responsibles) };
    },
  });
}

/** Whether the user may change the object: the privilege of its kind, and its responsibility. */
export function useObjectResponsible(kind: ReportObjectKind, id: string | undefined) {
  return useQuery({
    queryKey: [...objectKey(kind, id), "responsible"],
    enabled: id !== undefined,
    queryFn: async () =>
      (await call<{ data: boolean }>("GET", path(kind, id ?? "", "/am_i_responsible"))).data,
  });
}

/**
 * Publishes the object to a group, or makes it responsible; or the reverse. The
 * answer is returned as is, its error included, for the change line to tell.
 */
export function changeObjectTeam(
  kind: ReportObjectKind,
  id: string,
  role: "publications" | "responsibles",
  groupId: string,
  add: boolean,
): Promise<{ error?: unknown }> {
  return raw[add ? "POST" : "DELETE"](path(kind, id, `/${role}/${encodeURIComponent(groupId)}`));
}

/** The revisions of the definition, the newest first. */
export function useObjectRevisions(kind: ReportObjectKind, id: string | undefined) {
  return useQuery({
    queryKey: [...objectKey(kind, id), "revisions"],
    enabled: id !== undefined,
    queryFn: async () =>
      (await call<{ data: Revision[] }>("GET", path(kind, id ?? "", "/revisions"))).data,
  });
}

/** The change a revision made, or with `other`, the differences from it to `other`. */
export function useObjectDiff(
  kind: ReportObjectKind,
  id: string,
  cid: string | undefined,
  other?: string,
) {
  return useQuery({
    queryKey: [...objectKey(kind, id), "diff", cid, other],
    enabled: cid !== undefined,
    queryFn: async () =>
      (
        await call<{ data: string }>(
          "GET",
          path(kind, id, `/diff/${encodeURIComponent(cid ?? "")}`),
          {
            params: { query: other === undefined ? {} : { other } },
          },
        )
      ).data,
  });
}

/** Restores the definition of a revision, recorded as a new revision. */
export async function rollbackObject(kind: ReportObjectKind, id: string, cid: string) {
  await call("POST", path(kind, id, `/rollback/${encodeURIComponent(cid)}`));
}

/** Deletes the object, with its publications and responsibles. */
export async function deleteObject(kind: ReportObjectKind, id: string) {
  await call("DELETE", path(kind, id));
}

export type ReportExport = components["schemas"]["ReportExport"];
export type ReportImportResult = components["schemas"]["ReportImportResponse"];

/** The report with the charts and the metrics it shows, the ids replaced by the names. */
export async function exportReport(id: string): Promise<ReportExport> {
  const { data, error } = await api.GET("/reports/{report_id}/export", {
    params: { path: { report_id: id } },
  });
  if (error !== undefined) throw new Error(problemText(error));
  return data;
}

/** Creates the metrics, the charts and the reports of an export not already there. */
export async function importReports(body: ReportExport): Promise<ReportImportResult> {
  const { data, error } = await api.POST("/reports/import", { body });
  if (error !== undefined) throw new Error(problemText(error));
  return data;
}

/**
 * Who made a revision and, for a rollback, what it restored: `content` reads
 * "Author: Name <email>", then "<br>" and the line of the commit message
 * ("rollback to <date>"), as the historical history does.
 */
export function revisionAuthor(revision: Revision): { author: string; note: string } {
  const [first = "", ...rest] = (revision.content ?? "").split("<br>");
  return {
    author: first
      .replace(/^Author:\s*/, "")
      .replace(/\s*<[^>]*>\s*$/, "")
      .trim(),
    note: rest.join(" ").trim(),
  };
}
