import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { expect, vi } from "vitest";
import { Assistant } from "../Assistant";
import type { AssistantClient } from "../assistant-client";

/**
 * Renders a view as the application does: with a query client, and in a router,
 * which the badges of the records open in.
 */
export function renderWithProviders(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({ component: () => ui });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/ai"] }),
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

type Row = Record<string, string>;

/**
 * The lists of the collector the page reads the nodes and services named by an
 * answer from, holding the rows given, filtered as the collector does by
 * `prop:in:a,b`. Any other request is refused.
 */
export function stubCollector({
  nodes = [],
  services = [],
}: { nodes?: Row[]; services?: Row[] } = {}) {
  const fetchMock = vi.fn<typeof fetch>((input) => {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
    const rows =
      url.pathname === "/api/nodes" ? nodes : url.pathname === "/api/services" ? services : null;
    if (rows === null) return Promise.resolve(Response.json({}, { status: 404 }));
    const filter = /^(\w+):in:(.*)$/.exec(url.searchParams.get("filter") ?? "");
    const values = (filter?.[2] ?? "").split(",");
    return Promise.resolve(
      Response.json({ data: rows.filter((row) => values.includes(row[filter?.[1] ?? ""] ?? "")) }),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/**
 * The page of the assistant on the client given, once its conversations are
 * read: its button that starts a new one, named in the language of the page,
 * is enabled then.
 */
export async function renderAssistant(
  client: AssistantClient,
  newConversation = "New conversation",
) {
  const view = renderWithProviders(<Assistant client={client} />);
  // Once the conversations are read: an untitled one shows under the same name.
  await waitFor(() => {
    expect(screen.getAllByRole("button", { name: newConversation })[0]).toBeEnabled();
  });
  return view;
}
