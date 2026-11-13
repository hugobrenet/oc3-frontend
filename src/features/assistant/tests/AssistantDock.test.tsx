import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Assistant } from "../Assistant";
import { AskAssistantLink } from "../AskAssistantLink";
import { AssistantChatProvider } from "../assistant-chat-context";
import { AssistantDock } from "../AssistantDock";
import type { RunResult } from "../assistant-client";
import { replayRun } from "./agui-fixtures";
import { completed, fakeClient, started, text, type FakeClient } from "./fake-client";

const question = "Analyze the alert “check out of bounds” on par-dev-app02.";
const dock = () => screen.getByRole("complementary");
const dockBox = () => within(dock()).getByRole("textbox", { name: "Message to the assistant" });
const link = () => screen.getByRole("link", { name: "Analyze with the assistant" });

/**
 * The application as far as the dock goes: the chat held above the pages, a page
 * with a record and its link to the assistant, the page of the assistant, and
 * the dock over them.
 */
function renderApp(client: FakeClient, { link = true }: { link?: boolean } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({
    component: () => (
      <AssistantChatProvider client={client} identity="alice">
        <Outlet />
        <AssistantDock />
      </AssistantChatProvider>
    ),
  });
  const record = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => (
      <section aria-label="alert">{link && <AskAssistantLink prompt={question} />}</section>
    ),
  });
  const page = createRoute({
    getParentRoute: () => rootRoute,
    path: "/ai",
    component: () => <Assistant client={client} />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([record, page]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

/** Opens the dock from the link of the record, the question in its box. */
async function openFromRecord() {
  fireEvent.click(await screen.findByRole("link", { name: "Analyze with the assistant" }));
  await waitFor(() => {
    expect(dockBox()).toHaveValue(question);
  });
}

describe("the dock of the assistant", () => {
  let client: FakeClient;
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  beforeEach(() => {
    // The status of the assistant, and the lists the answers read the records from.
    fetchMock = vi.fn<typeof fetch>((input) => {
      const url = new URL(
        input instanceof Request ? input.url : String(input),
        window.location.href,
      );
      if (url.pathname === "/api/assistant/status")
        return Promise.resolve(Response.json({ enabled: true, available: true }));
      return Promise.resolve(Response.json({ data: [] }));
    });
    vi.stubGlobal("fetch", fetchMock);
    client = fakeClient([{ id: "existing", title: "Previous diagnostic" }]);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test("opens over the record with the question in its box, nothing sent", async () => {
    const router = renderApp(client);
    await openFromRecord();
    expect(router.state.location.pathname).toBe("/");
    expect(screen.getByRole("region", { name: "alert" })).toBeInTheDocument();
    expect(client.run).not.toHaveBeenCalled();
    expect(client.createConversation).not.toHaveBeenCalled();
  });

  test("leaves a click with a modifier to the link", async () => {
    const router = renderApp(client);
    // The browser would open the link in another tab; jsdom cannot.
    const leave = (event: MouseEvent) => {
      event.preventDefault();
    };
    document.addEventListener("click", leave);
    fireEvent.click(await screen.findByRole("link", { name: "Analyze with the assistant" }), {
      ctrlKey: true,
    });
    document.removeEventListener("click", leave);
    // The browser opens the page in another tab: the dock stays folded.
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(router.state.location.pathname).toBe("/");
  });

  test("drops a question asked while a turn runs, and says so", async () => {
    let finish: (result: RunResult) => void = () => undefined;
    client.run.mockImplementation(
      (_id, _input, options) =>
        new Promise<RunResult>((resolve) => {
          options?.onEvent?.(started());
          finish = (result) => {
            for (const event of text("Checked.")) options?.onEvent?.(event);
            resolve(result);
          };
        }),
    );
    renderApp(client);
    await openFromRecord();
    fireEvent.click(within(dock()).getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(within(dock()).getByRole("button", { name: "Stop" })).toBeInTheDocument();
    });
    fireEvent.click(link());
    expect(
      await within(dock()).findByText(/The question prepared was not taken/),
    ).toBeInTheDocument();
    expect(dockBox()).toHaveValue("");
    await act(async () => {
      finish(completed());
      await Promise.resolve();
    });
  });

  test("is not shown on the page of the assistant", async () => {
    const router = renderApp(client);
    await openFromRecord();
    await act(async () => {
      await router.navigate({ to: "/ai" });
    });
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "New conversation" })[0]).toBeEnabled();
    });
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  test("expands to the page, the conversation and the message typed kept", async () => {
    const router = renderApp(client);
    await openFromRecord();
    fireEvent.change(dockBox(), { target: { value: `${question} Since when?` } });
    fireEvent.click(within(dock()).getByRole("button", { name: "Open in the assistant page" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/ai");
    });
    expect(screen.queryByRole("complementary")).toBeNull();
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Message to the assistant" })).toHaveValue(
        `${question} Since when?`,
      );
    });
    // The same chat: nothing read again, nothing sent.
    expect(client.listConversations).toHaveBeenCalledOnce();
    expect(client.run).not.toHaveBeenCalled();
    // A move, not an end: back on another page, the dock is there, folded.
    await act(async () => {
      await router.navigate({ to: "/" });
    });
    expect(await screen.findByRole("button", { name: "Open the assistant" })).toBeInTheDocument();
  });

  test("names an action waiting, to reject or to decide on the page, never to approve", async () => {
    // The golden confirmation expires on 2026-10-09 at 17:45.
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-09T17:00:00Z") });
    client.run.mockImplementationOnce(replayRun("confirmation_preview_action"));
    renderApp(client);
    await openFromRecord();
    fireEvent.click(within(dock()).getByRole("button", { name: "Send" }));
    const waiting = await within(dock()).findByRole("group", {
      name: "Action waiting for a decision",
    });
    expect(
      within(waiting).getByRole("button", { name: "See the details to decide" }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(within(waiting).getByRole("button", { name: "Reject" })).toBeEnabled();
    });
    expect(within(dock()).queryByRole("button", { name: /Approve/ })).toBeNull();
  });

  test("folds on Escape, the focus back on the link that opened it", async () => {
    renderApp(client);
    await openFromRecord();
    fireEvent.keyDown(dockBox(), { key: "Escape" });
    await waitFor(() => {
      expect(link()).toHaveFocus();
    });
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.getByRole("button", { name: "Open the assistant" })).toBeInTheDocument();
  });

  test("tells, folded, that a turn ended meanwhile", async () => {
    let finish: (result: RunResult) => void = () => undefined;
    client.run.mockImplementation(
      (_id, _input, options) =>
        new Promise<RunResult>((resolve) => {
          options?.onEvent?.(started());
          finish = (result) => {
            for (const event of text("Checked.")) options?.onEvent?.(event);
            resolve(result);
          };
        }),
    );
    renderApp(client);
    await openFromRecord();
    fireEvent.click(within(dock()).getByRole("button", { name: "Send" }));
    fireEvent.click(await within(dock()).findByRole("button", { name: "Fold" }));
    expect(
      await screen.findByRole("button", {
        name: "Open the assistant · The assistant is answering",
      }),
    ).toBeInTheDocument();
    await act(async () => {
      finish(completed());
      await Promise.resolve();
    });
    expect(
      await screen.findByRole("button", {
        name: "Open the assistant · The assistant has finished",
      }),
    ).toBeInTheDocument();
  });

  test("is there, folded, on every page, reading nothing of the chat", async () => {
    renderApp(client, { link: false });
    fireEvent.click(await screen.findByRole("button", { name: "Open the assistant" }));
    expect(dock()).toBeInTheDocument();
    fireEvent.click(within(dock()).getByRole("button", { name: "Fold" }));
    expect(await screen.findByRole("button", { name: "Open the assistant" })).toBeInTheDocument();
  });

  test("reads only the status of the assistant until it opens", async () => {
    renderApp(client, { link: false });
    await screen.findByRole("button", { name: "Open the assistant" });
    const paths = fetchMock.mock.calls.map(
      ([input]) =>
        new URL(input instanceof Request ? input.url : String(input), window.location.href)
          .pathname,
    );
    expect(paths).toEqual(["/api/assistant/status"]);
    expect(client.listConversations).not.toHaveBeenCalled();
  });

  test("opened while the chat is read, takes the focus, then gives it to the message box", async () => {
    let listed: (conversations: { id: string; title: string }[]) => void = () => undefined;
    client.listConversations.mockImplementation(
      () =>
        new Promise((resolve) => {
          listed = resolve;
        }),
    );
    renderApp(client);
    fireEvent.click(await screen.findByRole("button", { name: "Open the assistant" }));
    expect(within(dock()).getByRole("heading", { name: "AI assistant" })).toHaveFocus();
    await act(async () => {
      listed([]);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(dockBox()).toHaveFocus();
    });
  });
});
