import { useState, type ReactNode } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ObjectIcon } from "@/components/opensvc/ObjectIcon";
import { DateTime } from "@/components/ui/DateTime";
import {
  useAIGroups,
  useAIResources,
  useAISkills,
  KIND_ICON,
  readStats,
  type AIBackend,
  type AIRead,
  type AIContentKind,
} from "./ai-content-api";
import { AIResourcePanel, AISkillPanel } from "./AIContentPanel";
import { toolsOf, type Frontmatter } from "./ai-content-draft";

/** A row of the table, whichever the kind. */
interface Row {
  name: string;
  /** Under the name: the title of a resource. */
  subtitle: string;
  description: string;
  backends: AIBackend[];
  publications: number[];
  /** The reads of the assistants, by backend: absent when not given. */
  reads: AIRead[] | undefined;
  size: number;
  updated: string;
  /** The column proper to the kind: the format of a resource, the tools of a skill. */
  extra: ReactNode;
}

function useRows(kind: AIContentKind) {
  const { t } = useTranslation();
  const resources = useAIResources(kind === "resources");
  const skills = useAISkills(kind === "skills");
  if (kind === "resources") {
    return {
      ...resources,
      rows: resources.data?.map((r): Row => ({
        name: r.name,
        subtitle: r.title,
        description: r.description,
        backends: r.backends,
        publications: r.publications ?? [],
        reads: r.reads,
        size: r.size,
        updated: r.updated,
        extra: t(`aiContent.mime.${r.mime_type === "text/plain" ? "plain" : "markdown"}`),
      })),
    };
  }
  return {
    ...skills,
    rows: skills.data?.map((s): Row => {
      const values = s.frontmatter as Frontmatter["values"];
      const tools = toolsOf(values);
      return {
        name: s.name,
        subtitle: "",
        description: typeof values.description === "string" ? values.description : "",
        backends: s.backends,
        publications: s.publications ?? [],
        reads: s.reads,
        size: s.size,
        updated: s.updated,
        extra:
          tools.length === 0 ? (
            <span className="text-ink-muted">—</span>
          ) : (
            <span className="font-mono">{tools.join(", ")}</span>
          ),
      };
    }),
  };
}

/**
 * The texts the assistant reads, as an AIManager writes them: the resources,
 * documents it reads when their description tells it a question needs them,
 * and the skills, procedures it loads to carry out a task. Each is for the
 * collector, the clusters or both, and published to some groups, or to
 * everybody. The selected text lives in the URL.
 */
function AIContentPage({ kind }: { kind: AIContentKind }) {
  const { t, i18n } = useTranslation();
  const from = kind === "resources" ? "/ai-resources" : "/ai-skills";
  const search = useSearch({ from });
  const navigate = useNavigate({ from });
  const list = useRows(kind);
  const groups = useAIGroups();
  const [creating, setCreating] = useState(false);
  const selected = list.rows?.find((r) => r.name === search.sel)?.name;
  const size = new Intl.NumberFormat(i18n.language);

  function select(sel: string | undefined) {
    void navigate({ search: (previous) => ({ ...previous, sel }) });
  }
  const roleOf = (gid: number) => groups.data?.find((g) => g.id === gid)?.role ?? String(gid);

  const panel = {
    open: creating || selected !== undefined,
    name: creating ? undefined : selected,
    onClose: () => {
      setCreating(false);
      select(undefined);
    },
    onSaved: (name: string) => {
      setCreating(false);
      select(name);
    },
  };

  return (
    <section>
      <div className="mb-3 flex items-center gap-3">
        <h1 className="flex items-center gap-2 text-title font-semibold">
          <ObjectIcon kind={KIND_ICON[kind]} className="h-5 w-5" />
          {t(`aiContent.${kind}.title`)}
        </h1>
        <button
          type="button"
          onClick={() => {
            select(undefined);
            setCreating(true);
          }}
          className="h-7 rounded-(--radius-control) bg-accent px-3 font-medium text-accent-ink"
        >
          {t(`aiContent.${kind}.new`)}
        </button>
      </div>
      <p className="mb-3 max-w-3xl text-ink-muted">{t(`aiContent.${kind}.intro`)}</p>

      {list.isPending ? (
        <p className="text-ink-muted">{t("list.loading")}</p>
      ) : list.isError ? (
        <p role="alert" className="text-state-down">
          ■ {list.error.message}
        </p>
      ) : list.rows === undefined || list.rows.length === 0 ? (
        <p className="text-ink-muted">{t(`aiContent.${kind}.empty`)}</p>
      ) : (
        <div className="overflow-x-auto rounded-(--radius-panel) border border-line bg-surface-raised">
          <table className="w-full border-collapse text-data">
            <caption className="sr-only">{t(`aiContent.${kind}.title`)}</caption>
            <thead>
              <tr className="border-b border-line text-left text-ink-muted">
                {[
                  "name",
                  "description",
                  kind === "resources" ? "mime_type" : "tools",
                  "backends",
                  "publications",
                  "reads",
                  "last_read",
                  "size",
                  "updated",
                ].map((key) => (
                  <th key={key} scope="col" className="px-3 py-1.5 font-medium whitespace-nowrap">
                    {t(`aiContent.fields.${key}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.rows.map((r) => (
                <tr
                  key={r.name}
                  className={`border-b border-line/60 align-top last:border-b-0 ${
                    selected === r.name ? "bg-accent-soft" : ""
                  }`}
                >
                  <th scope="row" className="px-3 py-1.5 text-left font-normal">
                    <button
                      type="button"
                      onClick={() => {
                        setCreating(false);
                        select(r.name);
                      }}
                      className="font-mono font-medium text-accent hover:underline"
                    >
                      {r.name}
                    </button>
                    {r.subtitle !== "" && <span className="block">{r.subtitle}</span>}
                  </th>
                  <td className="max-w-md px-3 py-1.5">
                    {/* Two lines at most: a long description would make each row a
                        paragraph. The whole of it in the title, and in the panel. */}
                    <span title={r.description} className="line-clamp-2">
                      {r.description}
                    </span>
                  </td>
                  <td className="px-3 py-1.5">{r.extra}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    {r.backends.map((b) => t(`aiContent.backends.${b}`)).join(", ")}
                  </td>
                  <td className="px-3 py-1.5">
                    {r.publications.length === 0 ? (
                      <span className="text-state-warn">
                        <span aria-hidden="true">▲</span> {t("aiContent.everybody")}
                      </span>
                    ) : (
                      r.publications.map(roleOf).join(", ")
                    )}
                  </td>
                  <ReadCells reads={r.reads} format={size} />
                  <td className="px-3 py-1.5 text-right whitespace-nowrap tabular-nums">
                    {size.format(r.size)}
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    <DateTime value={r.updated} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {kind === "resources" ? <AIResourcePanel {...panel} /> : <AISkillPanel {...panel} />}
    </section>
  );
}

/**
 * How often the assistants read a text, all backends together, the count by
 * backend in its title, and when they read it last: a text never read has a
 * description the model does not follow, or answers no question asked.
 */
function ReadCells({ reads, format }: { reads: AIRead[] | undefined; format: Intl.NumberFormat }) {
  const { t } = useTranslation();
  const stats = readStats(reads);
  if (stats === undefined)
    return (
      <>
        <td className="px-3 py-1.5 text-ink-muted">—</td>
        <td className="px-3 py-1.5 text-ink-muted">—</td>
      </>
    );
  const byBackend = (reads ?? [])
    .map((r) =>
      t("aiContent.readsBy", { backend: t(`aiContent.backends.${r.backend}`), count: r.count }),
    )
    .join("\n");
  return (
    <>
      <td
        className="px-3 py-1.5 text-right whitespace-nowrap tabular-nums"
        title={byBackend === "" ? undefined : byBackend}
      >
        {format.format(stats.count)}
      </td>
      <td className="px-3 py-1.5 whitespace-nowrap">
        {stats.last === undefined ? (
          <span className="text-state-warn">
            <span aria-hidden="true">▲</span> {t("aiContent.neverRead")}
          </span>
        ) : (
          <DateTime value={stats.last} />
        )}
      </td>
    </>
  );
}

export function AIResourcesPage() {
  return <AIContentPage kind="resources" />;
}

export function AISkillsPage() {
  return <AIContentPage kind="skills" />;
}
