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
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Assistant } from "../Assistant";
import { AskAssistantLink } from "../AskAssistantLink";
import { AssistantChatProvider } from "../assistant-chat-context";
import { AssistantDock, AssistantDockButton } from "../AssistantDock";
import type { RunResult } from "../assistant-client";
import { replayRun } from "./agui-fixtures";
import { completed, fakeClient, started, text, type FakeClient } from "./fake-client";

/** jsdom has no pointer events: mouse events carrying a pointer id stand for them. */
class TestPointerEvent extends MouseEvent {
  pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
  }
}

const question = "Analyze the alert “check out of bounds” on par-dev-app02.";
const dock = () => screen.getByRole("complementary");
const dockBox = () => within(dock()).getByRole("textbox", { name: "Message to the assistant" });
const link = () => screen.getByRole("link", { name: "Analyze with the assistant" });

/** A record panel as SlideOver is: not modal, closed by Escape anywhere, inert once closed. */
function RecordPanelStub() {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);
  return (
    <div role="dialog" aria-modal="false" aria-label="record" inert={!open}>
      panel
    </div>
  );
}

/**
 * The application as far as the dock goes: the chat held above the pages, a page
 * with a record and its link to the assistant, the page of the assistant, and
 * the dock over them.
 */
function renderApp(
  client: FakeClient,
  {
    link = true,
    panel = false,
    path = "/",
  }: { link?: boolean; panel?: boolean; path?: string } = {},
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({
    component: () => (
      <AssistantChatProvider client={client} identity="alice">
        <AssistantDockButton />
        <Outlet />
        <AssistantDock />
      </AssistantChatProvider>
    ),
  });
  const record = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => (
      <section aria-label="alert">
        {link && <AskAssistantLink prompt={question} />}
        {panel && <RecordPanelStub />}
      </section>
    ),
  });
  const page = createRoute({
    getParentRoute: () => rootRoute,
    path: "/ai",
    component: () => <Assistant client={client} />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([record, page]),
    history: createMemoryHistory({ initialEntries: [path] }),
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

  test("closes the list of the skills on Escape, staying open; the tag chosen goes with the draft to the page", async () => {
    client.getCapabilities.mockResolvedValue({ feedback: false, models: false, skills: true });
    client.listSkills.mockResolvedValue([
      { name: "morning-check", description: "Check the collector in the morning." },
    ]);
    const router = renderApp(client, { link: false });
    fireEvent.click(await screen.findByRole("button", { name: "Open the assistant" }));
    await waitFor(() => {
      expect(dockBox()).toBeEnabled();
    });
    await waitFor(() => {
      expect(client.listSkills).toHaveBeenCalled();
    });
    fireEvent.change(dockBox(), { target: { value: "/mor" } });
    expect(within(dock()).getByRole("listbox")).toBeInTheDocument();
    fireEvent.keyDown(dockBox(), { key: "Escape" });
    expect(within(dock()).queryByRole("listbox")).toBeNull();
    expect(dock()).toBeInTheDocument();
    fireEvent.change(dockBox(), { target: { value: "/morning-check " } });
    const remove = { name: "Remove the procedure “morning-check”" };
    expect(within(dock()).getByRole("button", remove)).toBeInTheDocument();
    // To the page of the assistant: the tag goes with the draft.
    fireEvent.click(within(dock()).getByRole("button", { name: "Open in the assistant page" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/ai");
    });
    expect(await screen.findByRole("button", remove)).toBeInTheDocument();
  });

  test("takes the question of a record in place of the skill chosen", async () => {
    client.getCapabilities.mockResolvedValue({ feedback: false, models: false, skills: true });
    client.listSkills.mockResolvedValue([
      { name: "morning-check", description: "Check the collector in the morning." },
    ]);
    renderApp(client);
    fireEvent.click(await screen.findByRole("button", { name: "Open the assistant" }));
    await waitFor(() => {
      expect(dockBox()).toBeEnabled();
    });
    await waitFor(() => {
      expect(client.listSkills).toHaveBeenCalled();
    });
    fireEvent.change(dockBox(), { target: { value: "/morning-check " } });
    const remove = { name: "Remove the procedure “morning-check”" };
    expect(within(dock()).getByRole("button", remove)).toBeInTheDocument();
    fireEvent.click(link());
    await waitFor(() => {
      expect(dockBox()).toHaveValue(question);
    });
    expect(within(dock()).queryByRole("button", remove)).toBeNull();
  });

  test("names an action waiting, to reject, or to decide on in the card of the page", async () => {
    // The golden confirmation expires on 2026-10-09 at 17:45.
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-09T17:00:00Z") });
    client.run.mockImplementationOnce(replayRun("confirmation_preview_action"));
    renderApp(client);
    await openFromRecord();
    fireEvent.click(within(dock()).getByRole("button", { name: "Send" }));
    const waiting = await within(dock()).findByRole("group", {
      name: "Action waiting for a decision",
    });
    await waitFor(() => {
      expect(within(waiting).getByRole("button", { name: "Reject" })).toBeEnabled();
    });
    // Approved in the card of the page only, never from the dock itself.
    expect(within(dock()).queryByRole("button", { name: /Approve/ })).toBeNull();
    fireEvent.click(within(waiting).getByRole("button", { name: "Decide on it" }));
    const card = await screen.findByRole("dialog", { name: /^Decide on the action/ });
    expect(within(card).getByRole("button", { name: /Approve/ })).toBeInTheDocument();
    // Over the page, which stays: the record, not the page of the assistant.
    expect(screen.getByRole("region", { name: "alert" })).toBeInTheDocument();
    fireEvent.keyDown(card, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /^Decide on the action/ })).toBeNull();
    });
    expect(dock()).toBeInTheDocument();
  });

  test("approves the action waiting in the card over the page, and goes on there", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-09T17:00:00Z") });
    client.run
      .mockImplementationOnce(replayRun("confirmation_preview_action"))
      .mockImplementationOnce(replayRun("resume_approved"));
    const router = renderApp(client);
    await openFromRecord();
    fireEvent.click(within(dock()).getByRole("button", { name: "Send" }));
    const waiting = await within(dock()).findByRole("group", {
      name: "Action waiting for a decision",
    });
    fireEvent.click(within(waiting).getByRole("button", { name: "Decide on it" }));
    const card = await screen.findByRole("dialog", { name: /^Decide on the action/ });
    await waitFor(() => {
      expect(within(card).getByRole("button", { name: /^Approve/ })).toBeEnabled();
    });
    fireEvent.click(within(card).getByRole("button", { name: /^Approve/ }));
    await waitFor(() => {
      expect(client.run).toHaveBeenCalledTimes(2);
    });
    const resumed = client.run.mock.calls[1]?.[1];
    expect(resumed !== undefined && "resume" in resumed ? resumed.resume : undefined).toMatchObject(
      {
        approved: true,
      },
    );
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /^Decide on the action/ })).toBeNull();
    });
    expect(router.state.location.pathname).toBe("/");
    expect(dock()).toBeInTheDocument();
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

  test("opens and folds from its button of the top bar, which it leaves without the focus", async () => {
    renderApp(client, { link: false });
    const button = await screen.findByRole("button", { name: "Open the assistant" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    await waitFor(() => {
      expect(dockBox()).toBeEnabled();
    });
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveAccessibleName("Fold the assistant");
    fireEvent.click(button);
    await waitFor(() => {
      expect(screen.queryByRole("complementary")).toBeNull();
    });
    fireEvent.click(button);
    await waitFor(() => {
      expect(dockBox()).toBeEnabled();
    });
    // Folded with Escape, the focus leaves with it: the button is not ringed.
    fireEvent.keyDown(dockBox(), { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("complementary")).toBeNull();
    });
    expect(button).not.toHaveFocus();
  });

  test("opens with the key a out of a field, and folds with it", async () => {
    renderApp(client, { link: false });
    const button = await screen.findByRole("button", { name: "Open the assistant" });
    fireEvent.keyDown(document.body, { key: "a" });
    await waitFor(() => {
      expect(dockBox()).toBeEnabled();
    });
    // Typed in the message box, the key is a letter.
    fireEvent.keyDown(dockBox(), { key: "a" });
    expect(dock()).toBeInTheDocument();
    button.focus();
    fireEvent.keyDown(button, { key: "a" });
    await waitFor(() => {
      expect(screen.queryByRole("complementary")).toBeNull();
    });
    // With Ctrl, the key is the browser's.
    fireEvent.keyDown(document.body, { key: "a", ctrlKey: true });
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  test("folds on Escape from the page, once the panel over it is closed", async () => {
    renderApp(client, { link: false, panel: true });
    fireEvent.click(await screen.findByRole("button", { name: "Open the assistant" }));
    await waitFor(() => {
      expect(dockBox()).toBeEnabled();
    });
    act(() => {
      (document.activeElement as HTMLElement | null)?.blur();
    });
    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => {
      expect(screen.getByText("panel").closest('[role="dialog"]')).toHaveAttribute("inert");
    });
    expect(dock()).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("complementary")).toBeNull();
    });
  });

  test("gives the focus back to the row it was opened from with the key a", async () => {
    renderApp(client, { link: false });
    await screen.findByRole("button", { name: "Open the assistant" });
    const row = document.createElement("button");
    row.textContent = "a row";
    document.body.appendChild(row);
    try {
      row.focus();
      fireEvent.keyDown(row, { key: "a" });
      await waitFor(() => {
        expect(dockBox()).toHaveFocus();
      });
      fireEvent.keyDown(dockBox(), { key: "Escape" });
      await waitFor(() => {
        expect(screen.queryByRole("complementary")).toBeNull();
      });
      expect(row).toHaveFocus();
    } finally {
      row.remove();
    }
  });

  test("leaves Escape to a dialog open over the page, such as the one of the Designer", async () => {
    renderApp(client, { link: false });
    fireEvent.click(await screen.findByRole("button", { name: "Open the assistant" }));
    await waitFor(() => {
      expect(dockBox()).toBeEnabled();
    });
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.appendChild(dialog);
    try {
      act(() => {
        (document.activeElement as HTMLElement | null)?.blur();
      });
      fireEvent.keyDown(document.body, { key: "Escape" });
      expect(dock()).toBeInTheDocument();
    } finally {
      dialog.remove();
    }
  });

  test("leaves Escape to the left-hand menu", async () => {
    renderApp(client, { link: false });
    fireEvent.click(await screen.findByRole("button", { name: "Open the assistant" }));
    await waitFor(() => {
      expect(dockBox()).toBeEnabled();
    });
    const menu = document.createElement("nav");
    menu.id = "app-sidebar";
    const entry = document.createElement("a");
    entry.href = "/nodes";
    menu.appendChild(entry);
    document.body.appendChild(menu);
    try {
      entry.focus();
      fireEvent.keyDown(entry, { key: "Escape" });
      expect(dock()).toBeInTheDocument();
    } finally {
      menu.remove();
    }
  });

  describe("on a wide window", () => {
    const KEY = "oc3.assistant.dock.geometry";
    let width: number;
    let height: number;
    beforeEach(() => {
      vi.stubGlobal("matchMedia", (query: string) => ({
        matches: query.includes("40rem"),
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }));
      vi.stubGlobal("PointerEvent", TestPointerEvent);
      localStorage.removeItem(KEY);
      localStorage.removeItem("oc3.assistant.dock.right");
      width = window.innerWidth;
      height = window.innerHeight;
    });
    afterEach(() => {
      window.innerWidth = width;
      window.innerHeight = height;
      localStorage.removeItem(KEY);
      localStorage.removeItem("oc3.assistant.dock.right");
    });
    const geometry = () => JSON.parse(localStorage.getItem(KEY) ?? "null") as unknown;
    const kept = () => geometry() as Record<string, number | null>;
    /** Its own height in the window of jsdom, as its classes say it. */
    const ownHeight = () => Math.min(576, window.innerHeight - 112);
    /** Its bottom as its style says it, above the bookmarks. */
    const bottom = (pixels: number) =>
      `calc(var(--bookmarks-bar-height, 0px) + ${String(pixels)}px)`;
    /** Drags `element` from x, y by dx, dy, as a pointer pressed, moved and released. */
    const dragBy = (element: Element, [x, y]: [number, number], [dx, dy]: [number, number]) => {
      fireEvent.pointerDown(element, { button: 0, clientX: x, clientY: y, pointerId: 1 });
      fireEvent.pointerMove(element, { clientX: x + dx, clientY: y + dy, pointerId: 1 });
      fireEvent.pointerUp(element, { clientX: x + dx, clientY: y + dy, pointerId: 1 });
    };
    const handle = () => within(dock()).getByRole("button", { name: "Move or size the assistant" });
    const bar = () => {
      const element = within(dock()).getByRole("heading").parentElement;
      if (element === null) throw new Error("no title bar");
      return element;
    };
    const edge = (name: string) => {
      const element = dock().querySelector(`[data-dock-edge="${name}"]`);
      if (element === null) throw new Error(`no edge ${name}`);
      return element;
    };
    const openWide = async () => {
      renderApp(client, { link: false });
      fireEvent.click(await screen.findByRole("button", { name: "Open the assistant" }));
      return dock();
    };

    test("moves anywhere and is sized with the keyboard on its handle, and remembers where", async () => {
      await openWide();
      fireEvent.keyDown(handle(), { key: "ArrowLeft" });
      fireEvent.keyDown(handle(), { key: "ArrowLeft" });
      fireEvent.keyDown(handle(), { key: "ArrowUp" });
      expect(dock().style.right).toBe("80px");
      expect(dock().style.bottom).toBe(bottom(48));
      expect(geometry()).toEqual({ right: 80, bottom: 48, width: null, height: null });
      fireEvent.keyDown(handle(), { key: "ArrowRight" });
      fireEvent.keyDown(handle(), { key: "ArrowDown" });
      expect(dock().style.right).toBe("48px");
      // Back against the bookmarks: its own bottom, that of its classes.
      expect(kept().bottom).toBeNull();
      // With Shift, the arrows size it, from its own size, the bottom right staying.
      fireEvent.keyDown(handle(), { key: "ArrowLeft", shiftKey: true });
      fireEvent.keyDown(handle(), { key: "ArrowDown", shiftKey: true });
      expect(dock().style.width).toBe("448px");
      expect(dock().style.height).toBe(`${String(ownHeight() - 32)}px`);
      expect(dock().style.right).toBe("48px");
      // Folded and opened again, where the user left it.
      fireEvent.click(screen.getByRole("button", { name: "Fold the assistant" }));
      await waitFor(() => {
        expect(screen.queryByRole("complementary")).toBeNull();
      });
      fireEvent.click(screen.getByRole("button", { name: "Open the assistant" }));
      await waitFor(() => {
        expect(dock().style.right).toBe("48px");
      });
      expect(dock().style.width).toBe("448px");
      // Home puts it back, at its own place and size.
      fireEvent.keyDown(handle(), { key: "Home" });
      expect(dock().style.right).toBe("");
      expect(dock().style.width).toBe("");
      expect(localStorage.getItem(KEY)).toBeNull();
    });

    test("gives its handle the focus when pressed, for its arrows", async () => {
      await openWide();
      fireEvent.pointerDown(handle(), { button: 0, clientX: 20, clientY: 300, pointerId: 1 });
      fireEvent.pointerUp(handle(), { clientX: 20, clientY: 300, pointerId: 1 });
      expect(handle()).toHaveFocus();
      fireEvent.keyDown(handle(), { key: "ArrowLeft" });
      expect(dock().style.right).toBe("48px");
    });

    test("moves by its title bar anywhere, against an edge once close to it, never over the top bar, and is put back by a double click", async () => {
      await openWide();
      fireEvent.pointerDown(bar(), { button: 0, clientX: 500, clientY: 500, pointerId: 1 });
      fireEvent.pointerMove(bar(), { clientX: 300, clientY: 450, pointerId: 1 });
      // While dragged it follows, and nothing is kept until released.
      expect(dock().style.right).toBe("216px");
      expect(dock().style.bottom).toBe(bottom(66));
      expect(localStorage.getItem(KEY)).toBeNull();
      fireEvent.pointerUp(bar(), { clientX: 300, clientY: 450, pointerId: 1 });
      expect(geometry()).toEqual({ right: 216, bottom: 66, width: null, height: null });
      // Close to the right edge, it goes against it; past the top bar, it stays under it.
      dragBy(bar(), [300, 450], [190, -950]);
      expect(geometry()).toMatchObject({
        right: null,
        bottom: window.innerHeight - ownHeight() - 96,
      });
      fireEvent.doubleClick(bar());
      expect(localStorage.getItem(KEY)).toBeNull();
      expect(dock().style.right).toBe("");
    });

    test("is not moved by a button of its bar, a plain click, another button or another pointer", async () => {
      await openWide();
      dragBy(within(dock()).getByRole("button", { name: "Fold" }), [300, 400], [-200, -50]);
      expect(localStorage.getItem(KEY)).toBeNull();
      // A plain click, or a move of less than its threshold, changes nothing, keeps nothing.
      dragBy(bar(), [300, 400], [-3, 2]);
      expect(dock().style.right).toBe("");
      expect(localStorage.getItem(KEY)).toBeNull();
      // The right button does not drag it.
      fireEvent.pointerDown(bar(), { button: 2, clientX: 300, clientY: 400, pointerId: 1 });
      fireEvent.pointerMove(bar(), { clientX: 100, clientY: 400, pointerId: 1 });
      expect(dock().style.right).toBe("");
      fireEvent.pointerUp(bar(), { clientX: 100, clientY: 400, pointerId: 1 });
      // Another pointer moving meanwhile does not move it.
      fireEvent.pointerDown(bar(), { button: 0, clientX: 300, clientY: 400, pointerId: 1 });
      fireEvent.pointerMove(bar(), { clientX: 100, clientY: 400, pointerId: 7 });
      expect(dock().style.right).toBe("");
      fireEvent.pointerMove(bar(), { clientX: 200, clientY: 400, pointerId: 1 });
      expect(dock().style.right).toBe("116px");
      // A drag cancelled keeps it where it was last dragged: a cancel tells no place.
      fireEvent.pointerCancel(bar(), { pointerId: 1 });
      expect(geometry()).toMatchObject({ right: 116, bottom: null });
      // As a capture lost, such as to another window; the next drag is free.
      fireEvent.pointerDown(bar(), { button: 0, clientX: 500, clientY: 500, pointerId: 2 });
      fireEvent.pointerMove(bar(), { clientX: 400, clientY: 450, pointerId: 2 });
      fireEvent(bar(), new TestPointerEvent("lostpointercapture", { pointerId: 2, bubbles: true }));
      expect(geometry()).toMatchObject({ right: 216, bottom: 66 });
      dragBy(bar(), [300, 400], [100, 0]);
      expect(geometry()).toMatchObject({ right: 116 });
      // A second pointer pressed while one drags it takes no part.
      fireEvent.pointerDown(bar(), { button: 0, clientX: 500, clientY: 500, pointerId: 1 });
      fireEvent.pointerDown(bar(), { button: 0, clientX: 100, clientY: 100, pointerId: 3 });
      fireEvent.pointerMove(bar(), { clientX: 0, clientY: 0, pointerId: 3 });
      fireEvent.pointerUp(bar(), { clientX: 0, clientY: 0, pointerId: 3 });
      expect(geometry()).toMatchObject({ right: 116 });
      fireEvent.pointerUp(bar(), { clientX: 500, clientY: 500, pointerId: 1 });
    });

    test("leaves the arrows with another modifier than Shift to the browser", async () => {
      await openWide();
      for (const modifier of ["altKey", "ctrlKey", "metaKey"])
        expect(fireEvent.keyDown(handle(), { key: "ArrowLeft", [modifier]: true })).toBe(true);
      expect(localStorage.getItem(KEY)).toBeNull();
    });

    test("stays above the bookmarks at the foot of the page, its own size above them too", async () => {
      // A window lower than its own height of 36rem: its classes take what is left.
      window.innerHeight = 600;
      document.documentElement.style.setProperty("--bookmarks-bar-height", "32px");
      try {
        await openWide();
        // Its own height, that of its classes, above the bookmarks: a move keeps it.
        fireEvent.keyDown(handle(), { key: "ArrowLeft" });
        expect(geometry()).toEqual({ right: 48, bottom: null, width: null, height: null });
        act(() => {
          window.innerHeight = 900;
          window.dispatchEvent(new Event("resize"));
        });
        // Up to the top bar, the bookmarks under it.
        dragBy(bar(), [500, 500], [0, -2000]);
        const top = 900 - 32 - Math.min(576, 900 - 32 - 112) - 96;
        expect(kept().bottom).toBe(top);
        expect(dock().style.bottom).toBe(bottom(top));
        // The bookmarks taller, on two lines: held under the top bar still.
        // Told by the bookmarks, not by a resize of the window.
        await act(async () => {
          document.documentElement.style.setProperty("--bookmarks-bar-height", "66px");
          await Promise.resolve();
        });
        expect(dock().style.bottom).toBe(bottom(top - 34));
        expect(kept().bottom).toBe(top);
      } finally {
        document.documentElement.style.removeProperty("--bookmarks-bar-height");
      }
    });

    test("is known to the record panel under it, which it leaves open", async () => {
      await openWide();
      expect(dock()).toHaveAttribute("data-assistant-dock");
    });

    test("is sized by each edge and corner, the opposite ones staying, within its bounds", async () => {
      // Room above it to move up without meeting the top bar.
      window.innerHeight = 900;
      await openWide();
      expect(
        [...dock().querySelectorAll<HTMLElement>("[data-dock-edge]")].map(
          (element) => element.dataset.dockEdge,
        ),
      ).toEqual([
        "left",
        "right",
        "top",
        "bottom",
        "top-left",
        "top-right",
        "bottom-left",
        "bottom-right",
      ]);
      dragBy(edge("top-left"), [600, 300], [-100, -50]);
      expect(geometry()).toEqual({
        right: null,
        bottom: null,
        width: 516,
        height: Math.min(ownHeight() + 50, window.innerHeight - 112),
      });
      // Never smaller than its smallest size.
      dragBy(edge("left"), [500, 300], [1000, 0]);
      expect(kept().width).toBe(320);
      // Never larger than the window leaves on the side of its edge: the bottom right stays.
      fireEvent.keyDown(handle(), { key: "ArrowLeft" });
      fireEvent.keyDown(handle(), { key: "ArrowLeft" });
      dragBy(edge("left"), [500, 300], [-2000, 0]);
      expect(geometry()).toMatchObject({ right: 80, width: window.innerWidth - 80 - 16 });
      dragBy(edge("top"), [500, 300], [0, -2000]);
      expect(kept().height).toBe(window.innerHeight - 112);
      fireEvent.keyDown(handle(), { key: "Home" });
      // Its right edge, its left one staying: wider to the right, down to the margin.
      for (let step = 0; step < 3; step += 1) fireEvent.keyDown(handle(), { key: "ArrowLeft" });
      dragBy(edge("right"), [900, 300], [40, 0]);
      expect(geometry()).toMatchObject({ right: 72, width: 416 + 40 });
      dragBy(edge("right"), [900, 300], [500, 0]);
      expect(geometry()).toMatchObject({ right: null, width: 416 + 96 });
      dragBy(edge("right"), [900, 300], [-1000, 0]);
      expect(kept().width).toBe(320);
      // Its bottom edge, its top one staying: taller to the bottom, down to the margin.
      fireEvent.keyDown(handle(), { key: "Home" });
      fireEvent.keyDown(handle(), { key: "ArrowUp" });
      fireEvent.keyDown(handle(), { key: "ArrowUp" });
      dragBy(edge("bottom"), [500, 700], [0, 30]);
      expect(geometry()).toMatchObject({ bottom: 50, height: ownHeight() + 30 });
      // Its bottom right corner, both: against the right margin already, taller only.
      dragBy(edge("bottom-right"), [900, 700], [20, 20]);
      expect(geometry()).toEqual({
        right: null,
        bottom: 30,
        width: null,
        height: ownHeight() + 50,
      });
      // Its top right corner, away from the right margin: wider and taller.
      fireEvent.keyDown(handle(), { key: "ArrowLeft" });
      fireEvent.keyDown(handle(), { key: "ArrowLeft" });
      dragBy(edge("top-right"), [900, 300], [24, -10]);
      expect(geometry()).toMatchObject({ right: 56, width: 416 + 24, height: ownHeight() + 60 });
    });

    test("keeps what the user chose through a smaller window, and gives it back after", async () => {
      window.innerWidth = 1600;
      window.innerHeight = 1200;
      localStorage.setItem(
        KEY,
        JSON.stringify({ right: 600, bottom: 300, width: 700, height: 700 }),
      );
      await openWide();
      expect(dock().style.width).toBe("700px");
      act(() => {
        window.innerWidth = 1000;
        window.innerHeight = 500;
        window.dispatchEvent(new Event("resize"));
      });
      // Held within the smaller window...
      expect(dock().style.right).toBe("284px");
      expect(dock().style.height).toBe(`${String(500 - 112)}px`);
      act(() => {
        window.innerWidth = 1600;
        window.innerHeight = 1200;
        window.dispatchEvent(new Event("resize"));
      });
      // ...and given back as chosen, nothing written meanwhile.
      expect(dock().style.right).toBe("600px");
      expect(dock().style.bottom).toBe(bottom(300));
      expect(dock().style.height).toBe("700px");
      expect(geometry()).toEqual({ right: 600, bottom: 300, width: 700, height: 700 });
    });

    test("reads where an older version moved it, along the bottom, and keeps it under its own key", async () => {
      localStorage.setItem("oc3.assistant.dock.right", "120");
      await openWide();
      await waitFor(() => {
        expect(dock().style.right).toBe("120px");
      });
      expect(localStorage.getItem("oc3.assistant.dock.right")).toBeNull();
      expect(geometry()).toMatchObject({ right: 120 });
    });

    test("takes a place the browser kept broken as none", async () => {
      localStorage.setItem(KEY, '{"right":"a","bottom":"b","width":-5,"height":1e999}');
      await openWide();
      expect(dock().style.right).toBe("");
      expect(dock().style.width).toBe("");
      expect(dock().style.height).toBe("");
    });
  });

  test("has no handle on a narrow window, where it takes the width", async () => {
    renderApp(client, { link: false });
    fireEvent.click(await screen.findByRole("button", { name: "Open the assistant" }));
    await waitFor(() => {
      expect(dockBox()).toBeEnabled();
    });
    expect(within(dock()).queryByRole("button", { name: "Move or size the assistant" })).toBeNull();
    expect(dock().querySelector("[data-dock-edge]")).toBeNull();
    // At its own place, whatever a wide window left.
    expect(dock().style.right).toBe("");
    expect(dock().style.width).toBe("");
    expect(dock().style.height).toBe("");
  });

  test("keeps its button greyed on the page of the assistant", async () => {
    renderApp(client, { link: false, path: "/ai" });
    expect(
      await screen.findByRole("button", { name: "The assistant is on this page" }),
    ).toBeDisabled();
  });

  test("keeps its button greyed while the user cannot use the assistant", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        Response.json({ enabled: true, available: false, reason: "password_sign_in" }),
      ),
    );
    renderApp(client, { link: false });
    const button = await screen.findByRole("button", {
      name: "The assistant is not available: see its page",
    });
    expect(button).toBeDisabled();
    fireEvent.keyDown(document.body, { key: "a" });
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  test("shows no button where oc3 names no agent", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(Response.json({ enabled: false, available: false, reason: "disabled" })),
    );
    renderApp(client, { link: false });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.queryByRole("button", { name: /assistant/i })).toBeNull();
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
