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
import { AssistantChatProvider } from "../assistant-chat-context";
import { AssistantDock, AssistantDockButton } from "../AssistantDock";
import { AssistantError, type RunResult } from "../assistant-client";
import { replayRun } from "./agui-fixtures";
import { completed, fakeClient, started, text, type FakeClient } from "./fake-client";

const dock = () => screen.getByRole("complementary");

/**
 * The application as far as the dock goes: the chat held above the pages, a
 * page of a record, the page of the assistant, and the dock over them; the
 * identity the chat is for, to change.
 */
function renderApp(client: FakeClient) {
  let identity = "alice";
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({
    component: () => (
      <>
        <AssistantDockButton />
        <Outlet />
        <AssistantDock />
      </>
    ),
  });
  const record = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <section aria-label="alert">record</section>,
  });
  const page = createRoute({
    getParentRoute: () => rootRoute,
    path: "/ai",
    component: () => <Assistant client={client} />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([record, page]),
    history: createMemoryHistory({ initialEntries: ["/ai"] }),
  });
  const tree = () => (
    <QueryClientProvider client={queryClient}>
      <AssistantChatProvider client={client} identity={identity}>
        <RouterProvider router={router} />
      </AssistantChatProvider>
    </QueryClientProvider>
  );
  const view = render(tree());
  return {
    router,
    // Another identity: the provider is not remounted, as in the application.
    signIn: (next: string) => {
      identity = next;
      view.rerender(tree());
    },
  };
}

/** A run that streams a text, then waits to be finished. */
function hangingRun(client: FakeClient) {
  const run: { finish: (result: RunResult) => void } = { finish: () => undefined };
  client.run.mockImplementation(
    (_id, _input, options) =>
      new Promise<RunResult>((resolve) => {
        options?.onEvent?.(started());
        for (const event of text("Checking.")) options?.onEvent?.(event);
        run.finish = resolve;
      }),
  );
  return run;
}

describe("the end of an analysis out of sight", () => {
  let client: FakeClient;
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>((input) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input),
          window.location.href,
        );
        if (url.pathname === "/api/assistant/status")
          return Promise.resolve(Response.json({ enabled: true, available: true }));
        return Promise.resolve(Response.json({ data: [] }));
      }),
    );
    client = fakeClient([{ id: "existing", title: "Previous diagnostic" }]);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // A prompt sent on the page of the assistant.
  const send = async (prompt = "hello") => {
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "New conversation" })[0]).toBeEnabled();
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Message to the assistant" }), {
      target: { value: prompt },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
  };
  const leave = async (router: ReturnType<typeof renderApp>["router"]) => {
    await act(async () => {
      await router.navigate({ to: "/" });
    });
  };
  // The words of the notice, as the region always there tells them.
  const told = () =>
    [...document.querySelectorAll('p[role="status"].sr-only')].map((p) => p.textContent).join("");
  const toast = () => screen.queryByRole("button", { name: /^See the (answer|action)$/ });

  test("tells it where the dock opens, and opens the dock on its answer", async () => {
    const run = hangingRun(client);
    const { router } = renderApp(client);
    await send();
    await screen.findByRole("button", { name: "Stop" });
    await leave(router);
    expect(toast()).toBeNull();
    await act(async () => {
      run.finish(completed());
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(told()).toContain("Your analysis is done.");
    });
    fireEvent.click(screen.getByRole("button", { name: "See the answer" }));
    expect(within(dock()).getByText("Checking.")).toBeInTheDocument();
    expect(toast()).toBeNull();
  });

  test("is closed by its button, the focus on the button of the dock, which still tells it, or by Escape", async () => {
    const run = hangingRun(client);
    const { router } = renderApp(client);
    await send();
    await screen.findByRole("button", { name: "Stop" });
    await leave(router);
    await act(async () => {
      run.finish(completed());
      await Promise.resolve();
    });
    fireEvent.keyDown(await screen.findByRole("button", { name: "See the answer" }), {
      key: "Escape",
    });
    expect(toast()).toBeNull();
    const button = screen.getByRole("button", {
      name: "Open the assistant · The assistant has finished",
    });
    expect(button).toHaveFocus();
  });

  test("tells an answer that failed, as the button of the dock does", async () => {
    let fail: () => void = () => undefined;
    client.run.mockImplementation(
      (_id, _input, options) =>
        new Promise<RunResult>((_resolve, reject) => {
          options?.onEvent?.(started());
          for (const event of text("Checking.")) options?.onEvent?.(event);
          fail = () => {
            reject(new AssistantError("assistant_unreachable", 503));
          };
        }),
    );
    const { router } = renderApp(client);
    await send();
    await screen.findByRole("button", { name: "Stop" });
    await leave(router);
    await act(async () => {
      fail();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(told()).toContain("Your analysis failed: its answer is incomplete.");
    });
    expect(
      screen.getByRole("button", {
        name: "Open the assistant · The answer of the assistant failed",
      }),
    ).toBeInTheDocument();
  });

  test("tells an action that began to wait out of sight, the dock opening on it, not one seen waiting", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const confirmation = replayRun("confirmation");
    client.run.mockImplementationOnce(async (...args) => {
      await gate;
      return confirmation(...args);
    });
    const { router } = renderApp(client);
    await send("acknowledge the alert");
    await leave(router);
    await act(async () => {
      release();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(told()).toContain("Your analysis waits for your decision on an action.");
    });
    fireEvent.click(screen.getByRole("button", { name: "See the action" }));
    expect(
      await within(dock()).findByRole("group", { name: "Action waiting for a decision" }),
    ).toBeInTheDocument();
    // Seen, then folded: not told again, the button of the dock still telling it.
    fireEvent.click(within(dock()).getByRole("button", { name: "Fold" }));
    await waitFor(() => {
      expect(screen.queryByRole("complementary")).toBeNull();
    });
    expect(toast()).toBeNull();
    expect(screen.getByRole("button", { name: /waits for your decision/ })).toBeInTheDocument();
  });

  test("tells the end of a message queued once it ends too, not while it runs", async () => {
    const runs: ((result: RunResult) => void)[] = [];
    client.run.mockImplementation(
      (_id, _input, options) =>
        new Promise<RunResult>((resolve) => {
          options?.onEvent?.(started());
          for (const event of text(
            `Checking ${String(runs.length + 1)}.`,
            `turn-${String(runs.length + 1)}:2`,
          ))
            options?.onEvent?.(event);
          runs.push(resolve);
        }),
    );
    const { router } = renderApp(client);
    await send("first");
    await screen.findByRole("button", { name: "Stop" });
    fireEvent.change(screen.getByRole("textbox", { name: "Message to the assistant" }), {
      target: { value: "second" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Queue" }));
    await leave(router);
    // The first ends, the message queued runs at once: nothing to tell yet.
    await act(async () => {
      runs[0]?.(completed("turn-1"));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(runs).toHaveLength(2);
    });
    expect(toast()).toBeNull();
    await act(async () => {
      runs[1]?.(completed("turn-2"));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(told()).toContain("Your analysis is done.");
    });
  });

  test("tells nothing on the page of the assistant, which shows the answer", async () => {
    const run = hangingRun(client);
    renderApp(client);
    await send();
    await screen.findByRole("button", { name: "Stop" });
    await act(async () => {
      run.finish(completed());
      await Promise.resolve();
    });
    await screen.findByText("Checking.");
    expect(told()).toBe("");
    expect(toast()).toBeNull();
  });

  test("says it in the title of a hidden tab, given back once a turn runs again or the tab is shown", async () => {
    let visibility: DocumentVisibilityState = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
    document.title = "OpenSVC";
    const run = hangingRun(client);
    renderApp(client);
    await send();
    await screen.findByRole("button", { name: "Stop" });
    // Another tab: the page of the assistant stays on display there.
    visibility = "hidden";
    await act(async () => {
      run.finish(completed());
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(document.title).toBe("✓ Analysis done · OpenSVC");
    });
    // The next turn: the title is given back while it runs.
    const next = hangingRun(client);
    await send("again");
    await waitFor(() => {
      expect(document.title).toBe("OpenSVC");
    });
    await act(async () => {
      next.finish(completed());
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(document.title).toBe("✓ Analysis done · OpenSVC");
    });
    act(() => {
      visibility = "visible";
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(document.title).toBe("OpenSVC");
  });

  test("says nothing in the title of a turn ended by another identity", async () => {
    let visibility: DocumentVisibilityState = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
    document.title = "OpenSVC";
    hangingRun(client);
    const app = renderApp(client);
    await send();
    await screen.findByRole("button", { name: "Stop" });
    visibility = "hidden";
    act(() => {
      app.signIn("bob");
    });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
    });
    expect(document.title).toBe("OpenSVC");
  });
});
