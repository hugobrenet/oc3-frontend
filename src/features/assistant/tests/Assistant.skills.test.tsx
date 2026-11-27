import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { Assistant } from "../Assistant";
import { AssistantChatProvider } from "../assistant-chat-context";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AssistantError, type RunResult, type Skill } from "../assistant-client";
import {
  completed,
  fakeClient,
  started,
  text,
  toolResult,
  toolStart,
  type FakeClient,
} from "./fake-client";
import { renderAssistant, stubCollector } from "./render";

const skills: Skill[] = [
  { name: "morning-check", description: "Check the collector in the morning." },
  { name: "node-maintenance", description: "Reboot a node." },
  { name: "drain-a-node", description: "Drain a node before its maintenance." },
  { name: "node", description: "Read a node." },
];

/** A run the test ends when it wants. */
function heldRun(client: FakeClient) {
  let finish: () => void = () => undefined;
  client.run.mockImplementationOnce(
    (_id, _input, options) =>
      new Promise<RunResult>((resolve) => {
        options?.onEvent?.(started());
        finish = () => {
          for (const event of text("Done.")) options?.onEvent?.(event);
          resolve(completed());
        };
      }),
  );
  return {
    finish: () => {
      finish();
    },
  };
}

describe("the skills of the assistant, asked with /", () => {
  let client: FakeClient;
  beforeEach(() => {
    localStorage.clear();
    stubCollector();
    client = fakeClient([]);
    client.getCapabilities.mockResolvedValue({ feedback: false, models: false, skills: true });
    client.listSkills.mockResolvedValue(skills);
    client.run.mockImplementation((_id, _input, options) => {
      options?.onEvent?.(started());
      for (const event of text("Done.")) options?.onEvent?.(event);
      return Promise.resolve(completed());
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });
  const box = () => screen.getByRole("textbox", { name: "Message to the assistant" });
  const renderReady = async () => {
    await renderAssistant(client);
    await waitFor(() => {
      expect(client.listSkills).toHaveBeenCalled();
    });
  };
  const list = () => screen.queryByRole("listbox", { name: "Procedures matching what you type" });
  const names = () => {
    const shown = list();
    if (shown === null) return [];
    return within(shown)
      .getAllByRole("option")
      .map((option) => option.querySelector(".font-mono")?.textContent);
  };
  const tag = (name: string) =>
    screen.queryByRole("button", { name: `Remove the procedure “${name}”` });
  const sent = (index = 0) => client.run.mock.calls[index]?.[1];
  const enter = () => {
    fireEvent.keyDown(box(), { key: "Enter" });
  };
  const type = (value: string) => {
    fireEvent.change(box(), { target: { value } });
  };

  test("a / at the start lists the skills, the one named whole first, then those beginning with it, and Enter chooses one", async () => {
    await renderReady();
    expect(
      screen.getByText(
        "Enter to send · Shift+Enter for a new line · Type / at the start to follow a procedure of the assistant.",
      ),
    ).toBeInTheDocument();
    type("/");
    expect(names()).toEqual(["/morning-check", "/node-maintenance", "/drain-a-node", "/node"]);
    expect(within(list() as HTMLElement).getAllByRole("option")[0]).toHaveTextContent(
      "Check the collector in the morning.",
    );
    type("/node");
    expect(names()).toEqual(["/node", "/node-maintenance", "/drain-a-node"]);
    // In any case, as typed.
    type("/Mor");
    expect(names()).toEqual(["/morning-check"]);
    type("/n");
    expect(names()).toEqual(["/node-maintenance", "/node", "/morning-check", "/drain-a-node"]);
    fireEvent.keyDown(box(), { key: "ArrowDown" });
    expect(box()).toHaveAttribute(
      "aria-activedescendant",
      within(list() as HTMLElement).getAllByRole("option")[1]?.id,
    );
    fireEvent.keyDown(box(), { key: "ArrowUp" });
    enter();
    // Chosen: a tag over the box, told, the box empty, nothing sent yet, the
    // hint of the skills gone.
    expect(list()).toBeNull();
    expect(screen.getByText("Enter to send · Shift+Enter for a new line")).toBeInTheDocument();
    expect(tag("node-maintenance")).toBeInTheDocument();
    expect(screen.getByText("Procedure /node-maintenance chosen")).toBeInTheDocument();
    expect(box()).toHaveValue("");
    expect(client.run).not.toHaveBeenCalled();
    // Sent without words: the message is the skill named.
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(client.run).toHaveBeenCalledTimes(1);
    });
    expect(sent()).toMatchObject({ prompt: "/node-maintenance", skill: "node-maintenance" });
    await screen.findByText("Done.");
    expect(tag("node-maintenance")).toBeNull();
  });

  test("the words typed after the skill are the message, a click or Tab choosing it, not Shift+Tab", async () => {
    await renderReady();
    type("/mor");
    fireEvent.click(within(list() as HTMLElement).getAllByRole("option")[0] as HTMLElement);
    type("and tell me the frozen nodes");
    enter();
    await waitFor(() => {
      expect(client.run).toHaveBeenCalledTimes(1);
    });
    expect(sent()).toMatchObject({
      prompt: "and tell me the frozen nodes",
      skill: "morning-check",
    });
    await screen.findByText("Done.");
    type("/drain");
    fireEvent.keyDown(box(), { key: "Tab", shiftKey: true });
    expect(tag("drain-a-node")).toBeNull();
    fireEvent.keyDown(box(), { key: "Tab" });
    expect(tag("drain-a-node")).toBeInTheDocument();
  });

  test("a skill named whole is that skill: then a space, it is chosen; sent as it is, it goes with it", async () => {
    await renderReady();
    type("/morning-check ");
    expect(tag("morning-check")).toBeInTheDocument();
    expect(box()).toHaveValue("");
    fireEvent.click(tag("morning-check") as HTMLElement);
    type("/node-maintenance");
    fireEvent.keyDown(box(), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(client.run).toHaveBeenCalledTimes(1);
    });
    expect(sent()).toMatchObject({ prompt: "/node-maintenance", skill: "node-maintenance" });
  });

  test("Escape or leaving the box closes the list, typing opens it again; a / elsewhere or after a space is text", async () => {
    await renderReady();
    type("/");
    fireEvent.keyDown(box(), { key: "Escape" });
    expect(list()).toBeNull();
    type("");
    type("/");
    expect(list()).not.toBeNull();
    fireEvent.blur(box());
    expect(list()).toBeNull();
    fireEvent.focus(box());
    expect(list()).not.toBeNull();
    type("is /etc/hosts full?");
    expect(list()).toBeNull();
    type("/etc/hosts is full");
    expect(list()).toBeNull();
    enter();
    await waitFor(() => {
      expect(client.run).toHaveBeenCalledTimes(1);
    });
    expect(sent()).not.toHaveProperty("skill");
    expect(sent()).toMatchObject({ prompt: "/etc/hosts is full" });
  });

  test("the tag goes by its button, or Backspace in an empty box, not a Backspace held", async () => {
    await renderReady();
    type("/node-m");
    enter();
    fireEvent.click(tag("node-maintenance") as HTMLElement);
    expect(tag("node-maintenance")).toBeNull();
    type("/node-m");
    enter();
    fireEvent.keyDown(box(), { key: "Backspace", repeat: true });
    expect(tag("node-maintenance")).toBeInTheDocument();
    fireEvent.keyDown(box(), { key: "Backspace" });
    expect(tag("node-maintenance")).toBeNull();
  });

  test("a message queued keeps its skill apart: shown, sent with it once released, taken back as a tag", async () => {
    const held = heldRun(client);
    await renderReady();
    type("first");
    enter();
    await waitFor(() => {
      expect(client.run).toHaveBeenCalledTimes(1);
    });
    // The skill alone, queued: shown, and taken back as a tag, the box empty.
    type("/node-m");
    enter();
    enter();
    const queued = screen.getByRole("group", { name: "Queued message" });
    expect(queued).toHaveTextContent("/node-maintenance");
    fireEvent.click(within(queued).getByRole("button", { name: "Edit" }));
    expect(box()).toHaveValue("");
    expect(tag("node-maintenance")).toBeInTheDocument();
    // With words, queued again, and released with the turn.
    type("on n1");
    enter();
    expect(screen.getByRole("group", { name: "Queued message" })).toHaveTextContent(
      "/node-maintenanceon n1",
    );
    await act(async () => {
      held.finish();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(client.run).toHaveBeenCalledTimes(2);
    });
    expect(sent(1)).toMatchObject({ prompt: "on n1", skill: "node-maintenance" });
  });

  test("a model no longer offered queues the message again with its skill", async () => {
    client.getCapabilities.mockResolvedValue({ feedback: false, models: true, skills: true });
    client.listModels.mockResolvedValue([
      { id: "default", label: "GPT Luna", default: true, ready: true },
      { id: "haiku", label: "Claude Haiku", default: false, ready: true },
    ]);
    // Refused once the conversation is on display, as over a network.
    client.run.mockImplementationOnce(
      () =>
        new Promise<RunResult>((_ok, ko) => {
          setTimeout(() => {
            ko(new AssistantError("model_unknown", 400));
          }, 20);
        }),
    );
    await renderReady();
    await screen.findByRole("combobox", { name: "Model" });
    type("/node-m");
    enter();
    type("on n1");
    enter();
    const queued = await screen.findByRole("group", { name: "Queued message" });
    expect(queued).toHaveTextContent("/node-maintenanceon n1");
    fireEvent.click(within(queued).getByRole("button", { name: "Send again" }));
    await waitFor(() => {
      expect(client.run).toHaveBeenCalledTimes(2);
    });
    expect(sent(1)).toMatchObject({ prompt: "on n1", skill: "node-maintenance" });
  });

  test("a skill no longer served: its step failed, the list read again, the words queued without it", async () => {
    client.run.mockImplementationOnce(async (_id, _input, options) => {
      options?.onEvent?.(started());
      // An agent of before tells no error of its own tools.
      options?.onEvent?.(toolStart("call_skill_1", "load_skill"));
      options?.onEvent?.(toolResult("call_skill_1", { structured: false }));
      // Failed once the conversation is on display, as over a network.
      await new Promise((resolve) => setTimeout(resolve, 20));
      throw new AssistantError("skill_unavailable");
    });
    await renderReady();
    type("/morning");
    enter();
    type("tell me the frozen nodes");
    enter();
    expect(
      await screen.findByText(/This procedure is not available to you now/),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(client.listSkills).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByRole("log")).toHaveTextContent("refused by the tool");
    const queued = screen.getByRole("group", { name: "Queued message" });
    expect(queued).toHaveTextContent("tell me the frozen nodes");
    expect(queued).not.toHaveTextContent("/morning-check");
  });

  test("a skill chosen that the list read again no longer holds goes, said so", async () => {
    // A turn under way, which fails as another skill is no longer served.
    let fail: () => void = () => undefined;
    client.run.mockImplementationOnce(
      (_id, _input, options) =>
        new Promise<RunResult>((_ok, ko) => {
          options?.onEvent?.(started());
          fail = () => {
            ko(new AssistantError("skill_unavailable"));
          };
        }),
    );
    await renderReady();
    type("/morning");
    enter();
    enter();
    await waitFor(() => {
      expect(client.run).toHaveBeenCalledTimes(1);
    });
    // Meanwhile, another skill chosen in the box, which the agent no longer serves.
    type("/node-m");
    enter();
    expect(tag("node-maintenance")).toBeInTheDocument();
    client.listSkills.mockResolvedValue(
      skills.filter((skill) => skill.name !== "node-maintenance"),
    );
    await act(async () => {
      fail();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(client.listSkills).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(tag("node-maintenance")).toBeNull();
    });
    // Shown, and told by the region always there.
    const gone =
      "The procedure “node-maintenance” is no longer available to you: it was removed from your message.";
    expect(screen.getAllByText(gone)).toHaveLength(2);
    expect(
      screen.getAllByText(gone).some((element) => element.getAttribute("aria-live") === "polite"),
    ).toBe(true);
    type("/node-m");
    expect(list()).toBeNull();
  });

  test("an agent that serves no skill, or a list that cannot be read or is empty, lists none", async () => {
    client.getCapabilities.mockResolvedValue({ feedback: false, models: false, skills: false });
    const view = await renderAssistant(client);
    await waitFor(() => {
      expect(client.getCapabilities).toHaveBeenCalled();
    });
    type("/");
    expect(list()).toBeNull();
    expect(client.listSkills).not.toHaveBeenCalled();
    expect(screen.queryByText(/Type \/ at the start/)).toBeNull();
    view.unmount();
    for (const answer of [
      () => Promise.reject(new AssistantError("skills_unavailable", 502)),
      () => Promise.reject(new AssistantError("skills_unlisted", 404)),
      () => Promise.resolve([]),
    ]) {
      client.getCapabilities.mockResolvedValue({ feedback: false, models: false, skills: true });
      client.listSkills.mockReset();
      client.listSkills.mockImplementation(answer);
      const again = await renderAssistant(client);
      await waitFor(() => {
        expect(client.listSkills).toHaveBeenCalled();
      });
      type("/");
      expect(list()).toBeNull();
      expect(screen.queryByText(/Type \/ at the start/)).toBeNull();
      again.unmount();
    }
  });

  test("an Enter while composing, as with an input method, does not choose a skill", async () => {
    await renderReady();
    type("/node-m");
    fireEvent.keyDown(box(), { key: "Enter", isComposing: true });
    fireEvent.keyDown(box(), { key: "Enter", keyCode: 229 });
    expect(tag("node-maintenance")).toBeNull();
    expect(list()).not.toBeNull();
    expect(client.run).not.toHaveBeenCalled();
  });

  test("a message queued is announced with its skill, which the dialog replacing it keeps", async () => {
    const held = heldRun(client);
    await renderReady();
    type("first");
    enter();
    await waitFor(() => {
      expect(client.run).toHaveBeenCalledTimes(1);
    });
    type("second");
    enter();
    // Another, with a skill, in place of the one queued.
    type("/node-m");
    enter();
    // The hint of the skills goes while one is chosen.
    expect(screen.queryByText(/Type \/ at the start/)).toBeNull();
    type("on n1");
    enter();
    fireEvent.click(await screen.findByRole("button", { name: "Replace" }));
    expect(screen.getByRole("group", { name: "Queued message" })).toHaveTextContent(
      "/node-maintenanceon n1",
    );
    expect(screen.getByText("Message queued: /node-maintenance on n1")).toBeInTheDocument();
    await act(async () => {
      held.finish();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(client.run).toHaveBeenCalledTimes(2);
    });
    expect(sent(1)).toMatchObject({ prompt: "on n1", skill: "node-maintenance" });
  });

  test("a question to start with replaces the skill chosen: a question of its own", async () => {
    await renderReady();
    type("/node-m");
    enter();
    fireEvent.click(screen.getByRole("button", { name: "Which services are down right now?" }));
    expect(box()).toHaveValue("Which services are down right now?");
    expect(tag("node-maintenance")).toBeNull();
  });

  test("a message queued, its turn stopped, comes back with its skill in another conversation", async () => {
    client = fakeClient([{ id: "existing", title: "Previous diagnostic" }]);
    client.getCapabilities.mockResolvedValue({ feedback: false, models: false, skills: true });
    client.listSkills.mockResolvedValue(skills);
    client.run.mockImplementationOnce(
      (_id, _input, options) =>
        new Promise<RunResult>((_ok, ko) => {
          options?.onEvent?.(started());
          options?.signal?.addEventListener("abort", () => {
            ko(new DOMException("Canceled", "AbortError"));
          });
        }),
    );
    await renderReady();
    type("first");
    enter();
    await waitFor(() => {
      expect(client.run).toHaveBeenCalledTimes(1);
    });
    type("/node-m");
    enter();
    type("on n1");
    enter();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Send again" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Previous diagnostic" }));
    await waitFor(() => {
      expect(box()).toHaveValue("on n1");
    });
    expect(tag("node-maintenance")).toBeInTheDocument();
  });

  /** The page of the assistant in the provider of the application, for an identity to change. */
  const renderFor = async () => {
    let identity = "alice";
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createRouter({
      routeTree: createRootRoute({ component: () => <Assistant client={client} /> }),
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
    await waitFor(() => {
      expect(client.listSkills).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(box()).toBeEnabled();
    });
    return (next: string) => {
      identity = next;
      view.rerender(tree());
    };
  };

  test("another identity takes not the skill chosen", async () => {
    const signIn = await renderFor();
    type("/node-m");
    enter();
    expect(tag("node-maintenance")).toBeInTheDocument();
    signIn("bob");
    await waitFor(() => {
      expect(tag("node-maintenance")).toBeNull();
    });
  });

  test("another identity takes not the notice of a skill gone", async () => {
    const signIn = await renderFor();
    let fail: () => void = () => undefined;
    client.run.mockImplementationOnce(
      (_id, _input, options) =>
        new Promise<RunResult>((_ok, ko) => {
          options?.onEvent?.(started());
          fail = () => {
            ko(new AssistantError("skill_unavailable"));
          };
        }),
    );
    type("go");
    enter();
    await waitFor(() => {
      expect(client.run).toHaveBeenCalledTimes(1);
    });
    type("/morning");
    enter();
    client.listSkills.mockResolvedValue(skills.filter((skill) => skill.name !== "morning-check"));
    await act(async () => {
      fail();
      await Promise.resolve();
    });
    const gone = /The procedure “morning-check” is no longer available/;
    await waitFor(() => {
      expect(screen.getAllByText(gone)).toHaveLength(2);
    });
    signIn("bob");
    await waitFor(() => {
      expect(screen.queryAllByText(gone)).toHaveLength(0);
    });
  });

  test("choosing another skill takes the notice of one gone away", async () => {
    await renderReady();
    let fail: () => void = () => undefined;
    client.run.mockImplementationOnce(
      (_id, _input, options) =>
        new Promise<RunResult>((_ok, ko) => {
          options?.onEvent?.(started());
          fail = () => {
            ko(new AssistantError("skill_unavailable"));
          };
        }),
    );
    type("go");
    enter();
    await waitFor(() => {
      expect(client.run).toHaveBeenCalledTimes(1);
    });
    type("/morning");
    enter();
    client.listSkills.mockResolvedValue(skills.filter((skill) => skill.name !== "morning-check"));
    await act(async () => {
      fail();
      await Promise.resolve();
    });
    const gone = /The procedure “morning-check” is no longer available/;
    await waitFor(() => {
      expect(screen.getAllByText(gone)).toHaveLength(2);
    });
    type("/node-m");
    enter();
    expect(tag("node-maintenance")).toBeInTheDocument();
    expect(screen.queryAllByText(gone)).toHaveLength(0);
  });

  test("shows the procedure asked on the message sent, alone when sent without words", async () => {
    await renderReady();
    type("/node-m");
    enter();
    type("on n1");
    enter();
    const sentMessage = await screen.findByText("on n1", { selector: "p" });
    const bubble = sentMessage.closest("li") as HTMLElement;
    expect(within(bubble).getByText("/node-maintenance")).toBeInTheDocument();
    expect(within(bubble).getByText("Procedure")).toBeInTheDocument();
    await screen.findByText("Done.");
    // Sent without words: the procedure alone, its tag, not named twice.
    type("/morning-check ");
    enter();
    await waitFor(() => {
      expect(client.run).toHaveBeenCalledTimes(2);
    });
    expect(sent(1)).toMatchObject({ prompt: "/morning-check", skill: "morning-check" });
    const alone = (await screen.findByText("/morning-check")).closest("li") as HTMLElement;
    expect(within(alone).getByText("Procedure")).toBeInTheDocument();
    expect(screen.getAllByText("/morning-check")).toHaveLength(1);
  });

  test("shows the procedure a prompt of the history asked", async () => {
    client = fakeClient([{ id: "existing", title: "Previous diagnostic" }]);
    client.getCapabilities.mockResolvedValue({ feedback: false, models: false, skills: true });
    client.listSkills.mockResolvedValue(skills);
    client.getMessages.mockResolvedValue({
      messages: [
        {
          id: "turn-1:1",
          turnId: "turn-1",
          role: "user",
          text: "on n1",
          createdAt: "2026-11-27T10:00:00Z",
          skill: "node-maintenance",
        },
        {
          id: "turn-1:2",
          turnId: "turn-1",
          role: "assistant",
          text: "Done.",
          createdAt: "2026-11-27T10:00:05Z",
        },
        {
          id: "turn-2:1",
          turnId: "turn-2",
          role: "user",
          text: "/morning-check",
          createdAt: "2026-11-27T10:01:00Z",
          skill: "morning-check",
        },
        {
          id: "turn-2:2",
          turnId: "turn-2",
          role: "assistant",
          text: "Fine.",
          createdAt: "2026-11-27T10:01:05Z",
        },
      ],
      nextCursor: "",
    });
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Previous diagnostic" }));
    // Sent without words: its tag alone, the text not shown again.
    const alone = (await screen.findByText("/morning-check")).closest("li") as HTMLElement;
    expect(within(alone).getByText("Procedure")).toBeInTheDocument();
    expect(screen.getAllByText("/morning-check")).toHaveLength(1);
    const prompt = await screen.findByText("on n1", { selector: "p" });
    expect(
      within(prompt.closest("li") as HTMLElement).getByText("/node-maintenance"),
    ).toBeInTheDocument();
  });
});
