import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "@/components/ui/Modal";
import { SearchBox } from "@/components/ui/SearchBox";
import { AssistantError, type AssistantClient, type ToolDoc } from "./assistant-client";

/** The groups of the tools: what reads, what acts once confirmed, what acts. */
const GROUPS: [key: string, belongs: (tool: ToolDoc) => boolean][] = [
  ["read", (tool) => tool.readOnly],
  ["confirmed", (tool) => !tool.readOnly && tool.needsConfirmation],
  ["act", (tool) => !tool.readOnly && !tool.needsConfirmation],
];

/** The description past its summary, which the list shows already; whole when it does not start with it. */
function restOf(tool: ToolDoc): string {
  const summary = tool.summary.replace(/…$/, "");
  return (
    tool.description.startsWith(summary) ? tool.description.slice(summary.length) : tool.description
  ).trim();
}

/**
 * A tool of the list: its title, its name and its summary; one with more to tell
 * unfolds in place, the rest of its description and its arguments, so that
 * several read side by side.
 */
function ToolItem({ tool }: { tool: ToolDoc }) {
  const { t } = useTranslation();
  const rest = restOf(tool);
  const args = Object.entries(tool.arguments).sort(([a], [b]) => a.localeCompare(b));
  const heading = (
    <>
      <span className="font-medium text-ink">{tool.title}</span>{" "}
      <code className="font-mono text-ink-muted">{tool.name}</code>
      {tool.summary !== "" && (
        <span className="block [overflow-wrap:anywhere] text-ink-muted">{tool.summary}</span>
      )}
    </>
  );
  if (rest === "" && args.length === 0) return <li>{heading}</li>;
  return (
    <li>
      <details>
        <summary className="cursor-pointer">{heading}</summary>
        <div className="mt-1 flex flex-col gap-1 border-l-2 border-line pl-3">
          {rest !== "" && <p className="[overflow-wrap:anywhere] whitespace-pre-line">{rest}</p>}
          {args.length > 0 && (
            <>
              <p className="font-medium">{t("assistant.tools.arguments")}</p>
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5">
                {args.map(([name, description]) => (
                  <div key={name} className="contents">
                    <dt>
                      <code className="font-mono">{name}</code>
                    </dt>
                    <dd className="min-w-0 [overflow-wrap:anywhere] text-ink-muted">
                      {description}
                    </dd>
                  </div>
                ))}
              </dl>
            </>
          )}
        </div>
      </details>
    </li>
  );
}

/** A text folded for a search: no case, no accent. */
const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** Why the tools could not be read, keys of `assistant.tools`. */
type Failure = "unavailable" | "unlisted" | "failed";

/**
 * What the assistant can do: the tools the agent lists for the user, read when
 * the dialog opens, grouped by what they do and filtered by a text. A relay that
 * does not list them says so, as an agent that could not read them.
 */
export function ToolsDialog({ client, onClose }: { client: AssistantClient; onClose: () => void }) {
  const { t } = useTranslation();
  const [tools, setTools] = useState<ToolDoc[] | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    client.listTools({ signal: controller.signal }).then(setTools, (error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setFailure(
        error instanceof AssistantError && error.code === "tools_unavailable"
          ? "unavailable"
          : error instanceof AssistantError && error.code === "tools_unlisted"
            ? "unlisted"
            : "failed",
      );
    });
    return () => {
      controller.abort();
    };
  }, [client]);

  const groups = useMemo(() => {
    const words = fold(filter)
      .split(/\s+/)
      .filter((word) => word !== "");
    const shown = (tools ?? []).filter((tool) => {
      const text = fold(`${tool.title} ${tool.name} ${tool.summary}`);
      return words.every((word) => text.includes(word));
    });
    return GROUPS.map(
      ([key, belongs]) =>
        [key, shown.filter(belongs).sort((a, b) => a.title.localeCompare(b.title))] as const,
    ).filter(([, list]) => list.length > 0);
  }, [tools, filter]);

  return (
    <Modal title={t("assistant.tools.title")} closeLabel={t("detail.close")} onClose={onClose}>
      <div className="flex flex-col gap-2">
        <p className="text-ink-muted">{t("assistant.tools.intro")}</p>
        {tools === null && failure === null && (
          <p role="status" className="text-ink-muted">
            {t("assistant.tools.loading")}
          </p>
        )}
        {failure !== null && (
          <p role="alert" className="text-state-down">
            ■ {t(`assistant.tools.${failure}`)}
          </p>
        )}
        {tools !== null && (
          <>
            <SearchBox
              value={filter}
              onChange={setFilter}
              label={t("assistant.tools.filter")}
              className="w-full"
            />
            <p className="text-ink-muted" aria-live="polite">
              {t("assistant.tools.count", {
                count: groups.reduce<number>((total, [, list]) => total + list.length, 0),
              })}
            </p>
            <div className="flex max-h-[60dvh] flex-col gap-3 overflow-y-auto">
              {groups.map(([key, list]) => (
                <section key={key} aria-labelledby={`assistant-tools-${key}`}>
                  <h3 id={`assistant-tools-${key}`} className="font-semibold">
                    {t(`assistant.tools.groups.${key}`)}
                  </h3>
                  <ul className="mt-1 flex flex-col gap-1.5">
                    {list.map((tool) => (
                      <ToolItem key={tool.name} tool={tool} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
