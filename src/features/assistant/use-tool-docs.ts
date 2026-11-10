import { useEffect, useState } from "react";
import type { AssistantClient, ToolDoc } from "./assistant-client";

/**
 * The documentation of the tools, by name, as the agent lists them: read once,
 * when first needed, such as by a confirmation card. A failure, a relay that does
 * not list them included, leaves it empty: the card shows the call without it.
 */
export function useToolDocs(client: AssistantClient, needed: boolean): Map<string, ToolDoc> | null {
  const [docs, setDocs] = useState<Map<string, ToolDoc> | null>(null);
  const loaded = docs !== null;

  useEffect(() => {
    if (!needed || loaded) return;
    const controller = new AbortController();
    // A failure, thrown or rejected, leaves the docs empty.
    Promise.resolve()
      .then(() => client.listTools({ signal: controller.signal }))
      .then(
        (tools) => {
          setDocs(new Map(tools.map((tool) => [tool.name, tool])));
        },
        () => undefined,
      );
    return () => {
      controller.abort();
    };
  }, [needed, client, loaded]);

  return docs;
}
