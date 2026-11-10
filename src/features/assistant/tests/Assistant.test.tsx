import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { EventType } from "@ag-ui/core";
import { AssistantError, type AssistantClient } from "../assistant-client";
import { groupConversations, NARROW_QUERY } from "../conversations";
import { replayRun } from "./agui-fixtures";
import {
  aborted,
  completed,
  fakeClient,
  stored,
  text,
  toolResult,
  toolStart,
  type FakeClient,
} from "./fake-client";
import { renderAssistant, stubCollector } from "./render";

const existing = { id: "existing", title: "Previous diagnostic" };
const created = { id: "new", title: "New diagnostic" };
const oldMessage = stored("turn-old:1", "user", "Older prompt");

type Options = Parameters<AssistantClient["run"]>[2];

let client: FakeClient;

beforeEach(() => {
  localStorage.removeItem("oc3.assistant.conversations");
  stubCollector();
  client = fakeClient([existing]);
  client.createConversation.mockResolvedValue(created);
  client.run.mockImplementation((_id, _input, options) => {
    options?.onEvent?.(toolStart("call-1", "get_cluster_health"));
    options?.onEvent?.(toolResult("call-1"));
    for (const event of text("Cluster looks healthy.", "turn-9:4")) options?.onEvent?.(event);
    return Promise.resolve(completed("turn-9", 12));
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const box = () => screen.getByRole("textbox", { name: "Message to the assistant" });
const log = () => screen.getByRole("log", { name: "Conversation with the assistant" });
const submit = async (prompt: string) => {
  fireEvent.change(box(), { target: { value: prompt } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => {
    expect(client.run).toHaveBeenCalledTimes(1);
  });
};
/** A run that hangs until its signal stops it, after the events given. */
const hanging =
  (events: Parameters<NonNullable<NonNullable<Options>["onEvent"]>>[0][] = []) =>
  (_id: string, _input: unknown, options: Options) =>
    new Promise<never>((_resolve, reject) => {
      for (const event of events) options?.onEvent?.(event);
      options?.signal?.addEventListener(
        "abort",
        () => {
          reject(aborted());
        },
        { once: true },
      );
    });

/** The step of an answer whose sentence is given, its steps unfolded. */
const stepOf = (container: HTMLElement, sentence: string) => {
  const folded = within(container)
    .getAllByRole("button", { expanded: false })
    .find((button) => /^\d+ steps? · /.test(button.textContent ?? ""));
  if (folded !== undefined) fireEvent.click(folded);
  return within(container).getByRole("button", { name: sentence }).closest("li");
};

describe("the page of the assistant", () => {
  test("sends a prompt with Enter, without a new line", async () => {
    await renderAssistant(client);
    fireEvent.change(box(), { target: { value: "Keyboard diagnostic" } });
    expect(fireEvent.keyDown(box(), { key: "Enter" })).toBe(false);
    await waitFor(() => {
      expect(client.run).toHaveBeenCalledTimes(1);
    });
    expect(client.run).toHaveBeenCalledWith(
      "new",
      { prompt: "Keyboard diagnostic", promptId: "prompt-1", held: [] },
      expect.any(Object),
    );
    expect(box()).toHaveValue("");
  });

  test("leaves Shift+Enter for a new line, without sending", async () => {
    await renderAssistant(client);
    fireEvent.change(box(), { target: { value: "First line" } });
    expect(fireEvent.keyDown(box(), { key: "Enter", shiftKey: true })).toBe(true);
    expect(client.run).not.toHaveBeenCalled();
    expect(box()).toHaveValue("First line");
  });

  test.each([{ isComposing: true }, { keyCode: 229 }])(
    "does not send Enter during an IME composition: %j",
    async (composition) => {
      await renderAssistant(client);
      fireEvent.change(box(), { target: { value: "Composing" } });
      expect(fireEvent.keyDown(box(), { key: "Enter", ...composition })).toBe(true);
      expect(client.run).not.toHaveBeenCalled();
    },
  );

  test("sends no empty prompt with Enter", async () => {
    await renderAssistant(client);
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(client.run).not.toHaveBeenCalled();
    expect(client.createConversation).not.toHaveBeenCalled();
  });

  test("starts empty, without creating a conversation nor sending a turn", async () => {
    await renderAssistant(client);
    expect(
      within(log()).getByRole("heading", { name: "Ask about your estate" }),
    ).toBeInTheDocument();
    expect(client.createConversation).not.toHaveBeenCalled();
    expect(client.run).not.toHaveBeenCalled();
  });

  test("sends a turn and shows its answer, its steps and its foot", async () => {
    await renderAssistant(client);
    await submit("Diagnose my estate");
    expect(await screen.findByText("Cluster looks healthy.")).toBeInTheDocument();
    expect(within(log()).getByText("Diagnose my estate")).toBeInTheDocument();
    expect(stepOf(log(), "Get cluster health")).toHaveTextContent("done");
    expect(within(log()).getByText(/1 step · Tokens: 12/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
  });

  test("reads the saved messages of a conversation without sending a turn", async () => {
    await renderAssistant(client);
    fireEvent.click(screen.getByRole("button", { name: "Previous diagnostic" }));
    await waitFor(() => {
      expect(client.getMessages).toHaveBeenCalledWith("existing", expect.anything());
    });
    expect(
      await within(log()).findByRole("heading", { name: "Ask about your estate" }),
    ).toBeInTheDocument();
    expect(client.run).not.toHaveBeenCalled();
  });

  test("shows the answer stopped, without retrying", async () => {
    let signal: AbortSignal | undefined;
    client.run.mockImplementation((id, input, options) => {
      signal = options?.signal;
      return hanging(text("Partial response"))(id, input, options);
    });
    await renderAssistant(client);
    await submit("hello");
    fireEvent.click(await screen.findByRole("button", { name: "Stop" }));
    expect(await screen.findByText(/Incomplete answer, stopped/)).toBeInTheDocument();
    expect(screen.getByText("Partial response")).toBeInTheDocument();
    expect(screen.getByText(/The turn was not retried/)).toBeInTheDocument();
    expect(signal?.aborted).toBe(true);
    expect(client.run).toHaveBeenCalledTimes(1);
  });

  test("restores and pages the saved messages without running a turn", async () => {
    const answer = stored("turn-old:2", "assistant", "Saved answer");
    client.getMessages
      .mockResolvedValueOnce({ messages: [answer], nextCursor: "1:2" })
      .mockResolvedValueOnce({ messages: [oldMessage], nextCursor: "" });
    await renderAssistant(client);
    fireEvent.click(screen.getByRole("button", { name: "Previous diagnostic" }));
    expect(await screen.findByText("Saved answer")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load earlier messages" }));
    expect(await screen.findByText("Older prompt")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load earlier messages" })).not.toBeInTheDocument();
    const content = log().textContent ?? "";
    expect(content.indexOf("Older prompt")).toBeLessThan(content.indexOf("Saved answer"));
    expect(client.run).not.toHaveBeenCalled();
    expect(client.createConversation).not.toHaveBeenCalled();
  });

  test("keeps the reading position when older messages are put before", async () => {
    client.getMessages.mockResolvedValueOnce({ messages: [oldMessage], nextCursor: "1:1" });
    await renderAssistant(client);
    fireEvent.click(screen.getByRole("button", { name: "Previous diagnostic" }));
    await screen.findByText("Older prompt");
    let height = 1000;
    Object.defineProperty(log(), "scrollHeight", {
      configurable: true,
      get: () => height,
    });
    log().scrollTop = 120;
    client.getMessages.mockImplementationOnce(() => {
      height = 1500;
      return Promise.resolve({
        messages: [stored("turn-earlier:1", "user", "Earlier message")],
        nextCursor: "",
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "Load earlier messages" }));
    await screen.findByText("Earlier message");
    expect(log().scrollTop).toBe(620);
  });

  test("sends nothing after a history error, until the conversation is selected again", async () => {
    client.getMessages
      .mockRejectedValueOnce(new AssistantError("http_error", 401))
      .mockResolvedValueOnce({ messages: [oldMessage], nextCursor: "" });
    await renderAssistant(client);
    fireEvent.click(screen.getByRole("button", { name: "Previous diagnostic" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your session no longer authenticates you to the assistant",
    );
    expect(box()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(client.run).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Previous diagnostic" }));
    await screen.findByText("Older prompt");
    expect(box()).toBeEnabled();
  });

  test("shows the saved messages as text, never as HTML", async () => {
    client.getMessages.mockResolvedValue({
      messages: [{ ...oldMessage, text: '<img src=x onerror="alert(1)">' }],
      nextCursor: "",
    });
    const { container } = await renderAssistant(client);
    fireEvent.click(screen.getByRole("button", { name: "Previous diagnostic" }));
    expect(await screen.findByText('<img src=x onerror="alert(1)">')).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  test("says an error of the stream, without retrying", async () => {
    client.run.mockRejectedValue(new AssistantError("stream_interrupted"));
    await renderAssistant(client);
    await submit("hello");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The connection to the assistant was cut off",
    );
    expect(client.run).toHaveBeenCalledTimes(1);
  });

  test("renders the streamed Markdown without the HTML of the model, the prompt as typed", async () => {
    client.run.mockImplementation((_id, _input, options) => {
      for (const event of text("**Healthy**\n\n")) options?.onEvent?.(event);
      options?.onEvent?.({
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: "turn-9:2",
        delta: '<img src=x onerror="alert(1)">',
      });
      return Promise.resolve(completed());
    });
    const { container } = await renderAssistant(client);
    await submit("**diagnose**");
    expect(await screen.findByText("Healthy")).toHaveProperty("tagName", "STRONG");
    expect(screen.getByText("**diagnose**")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  test("renders the saved answers with the same Markdown", async () => {
    client.getMessages.mockResolvedValue({
      messages: [stored("turn-old:2", "assistant", "**Saved diagnostic**")],
      nextCursor: "",
    });
    await renderAssistant(client);
    fireEvent.click(screen.getByRole("button", { name: "Previous diagnostic" }));
    expect(await screen.findByText("Saved diagnostic")).toHaveProperty("tagName", "STRONG");
    expect(client.run).not.toHaveBeenCalled();
  });

  test("renames in place, Enter saving without a dialog, and asks before deleting", async () => {
    await renderAssistant(client);
    await submit("hello");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Rename the conversation" })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole("button", { name: "Rename the conversation" }));
    const field = screen.getByRole("textbox", { name: "Conversation title" });
    expect(field).toHaveFocus();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.change(field, { target: { value: "  Renamed  " } });
    fireEvent.keyDown(field, { key: "Enter" });
    // Saved once: the blur of the field leaving does not save again.
    fireEvent.blur(field);
    expect(screen.queryByRole("textbox", { name: "Conversation title" })).not.toBeInTheDocument();
    await screen.findByRole("heading", { name: "Renamed" });
    expect(client.renameConversation).toHaveBeenCalledTimes(1);
    expect(client.renameConversation).toHaveBeenCalledWith("new", "Renamed", expect.any(Object));
    // The trash of its row in the list, the conversation named.
    fireEvent.click(await screen.findByRole("button", { name: "Delete the conversation Renamed" }));
    expect(screen.getByRole("dialog")).toHaveTextContent('Delete "Renamed" and its saved context?');
    expect(client.deleteConversation).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm the deletion" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(client.deleteConversation).toHaveBeenCalledWith("new", expect.any(Object));
    expect(
      screen.queryByRole("button", { name: "Rename the conversation" }),
    ).not.toBeInTheDocument();
  });

  test("keeps the title on Escape or when empty, and saves it on leaving the field", async () => {
    await renderAssistant(client);
    await submit("hello");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Rename the conversation" })).toBeEnabled();
    });
    const edit = () => {
      fireEvent.click(screen.getByRole("button", { name: "Rename the conversation" }));
      return screen.getByRole("textbox", { name: "Conversation title" });
    };
    let field = edit();
    fireEvent.change(field, { target: { value: "Not this" } });
    fireEvent.keyDown(field, { key: "Escape" });
    // Escape kept the title there was, and the field starts from it.
    expect(screen.getByRole("heading", { name: "New diagnostic" })).toBeInTheDocument();
    field = edit();
    expect(field).toHaveValue("New diagnostic");
    fireEvent.change(field, { target: { value: "   " } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(client.renameConversation).not.toHaveBeenCalled();
    field = edit();
    fireEvent.change(field, { target: { value: "Renamed" } });
    fireEvent.blur(field);
    await waitFor(() => {
      expect(client.renameConversation).toHaveBeenCalledWith("new", "Renamed", expect.any(Object));
    });
  });

  test("deletes another conversation of the list, the one shown staying", async () => {
    await renderAssistant(client);
    await submit("hello");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Rename the conversation" })).toBeEnabled();
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Delete the conversation Previous diagnostic" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm the deletion" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(client.deleteConversation).toHaveBeenCalledWith("existing", expect.any(Object));
    expect(screen.queryByRole("button", { name: "Previous diagnostic" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rename the conversation" })).toBeInTheDocument();
  });

  test("stops the turn when the page is left", async () => {
    let signal: AbortSignal | undefined;
    client.run.mockImplementation((id, input, options) => {
      signal = options?.signal;
      return hanging(text("Private response"))(id, input, options);
    });
    const { unmount } = await renderAssistant(client);
    await submit("private prompt");
    act(() => {
      unmount();
    });
    expect(signal?.aborted).toBe(true);
    expect(client.run).toHaveBeenCalledTimes(1);
  });

  describe("the confirmation of an action", () => {
    // The golden confirmations expire on 2026-10-09 at 17:45: the page reads
    // them a while before.
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-09T17:00:00Z") });
    });
    const region = () => screen.findByRole("region", { name: "Action waiting for confirmation" });

    test("shows the exact call, a YAML by its lines, and answers it with a resume", async () => {
      client.run
        .mockImplementationOnce(replayRun("confirmation"))
        .mockImplementationOnce(replayRun("resume_approved"));
      await renderAssistant(client);
      await submit("Start web with /bin/true");
      const card = await region();
      // The card shows before the run ends: its buttons wait for the end.
      await waitFor(() => {
        expect(within(card).getByRole("button", { name: "Reject" })).toBeEnabled();
      });
      expect(within(card).getByText("Destructive action to confirm")).toBeInTheDocument();
      expect(within(card).getByText("Update object config")).toBeInTheDocument();
      expect(within(card).getByText("update_object_config")).toBeInTheDocument();
      expect(within(card).getByText("web")).toHaveProperty("tagName", "CODE");
      // The YAML keeps its lines and indentation, under its media type.
      expect(within(card).getByText("application/yaml")).toBeInTheDocument();
      const lines = [...(card.querySelector("pre")?.querySelectorAll(".table-row") ?? [])].map(
        (row) => row.lastElementChild?.textContent,
      );
      expect(lines).toEqual(["app#1:", "  start: /bin/true"]);
      expect(stepOf(log(), "Update object config")).toHaveTextContent("waiting for your decision");
      // The message box stays open: what is sent waits for the decision.
      expect(box()).toBeEnabled();
      expect(screen.getByRole("button", { name: "Queue" })).toBeDisabled();
      fireEvent.click(within(card).getByRole("button", { name: "Approve" }));
      await waitFor(() => {
        expect(client.run).toHaveBeenLastCalledWith(
          "new",
          expect.objectContaining({ resume: { interruptId: "confirmation-1", approved: true } }),
          expect.anything(),
        );
      });
      await waitFor(() => {
        expect(
          screen.queryByRole("region", { name: "Action waiting for confirmation" }),
        ).not.toBeInTheDocument();
      });
      expect(await screen.findByText("Done: web starts with /bin/true.")).toBeInTheDocument();
      expect(stepOf(log(), "Update object config")).toHaveTextContent("done");
    });

    test("keeps the line breaks of an untyped text argument", async () => {
      client.getConversation.mockResolvedValue({
        conversation: existing,
        confirmation: {
          id: "confirmation-1",
          turnId: "turn-1",
          tool: { name: "set_note", title: "Set note", destructive: true },
          arguments: { note: "first\n  second" },
          argumentTypes: {},
          editable: false,
          expiresAt: "2099-10-09T17:45:00Z",
        },
      });
      await renderAssistant(client);
      fireEvent.click(screen.getByRole("button", { name: "Previous diagnostic" }));
      const card = await region();
      expect(card.querySelector("pre")?.textContent).toBe("first\n  second");
      // A call that takes no edits offers none.
      expect(within(card).queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    });

    test("edits the arguments in a form built from the input schema, and approves with them", async () => {
      client.run
        .mockImplementationOnce(replayRun("confirmation"))
        .mockImplementationOnce(replayRun("resume_edited"));
      await renderAssistant(client);
      await submit("Start web with /bin/true");
      const card = await region();
      await waitFor(() => {
        expect(within(card).getByRole("button", { name: "Edit" })).toBeEnabled();
      });
      fireEvent.click(within(card).getByRole("button", { name: "Edit" }));
      const form = within(card).getByRole("form", { name: "Arguments of the action" });
      // The labels and descriptions come from the schema, the values from the call.
      const path = within(form).getByRole("textbox", { name: /path/ });
      const yaml = within(form).getByRole("textbox", { name: /yaml/ });
      expect(path).toHaveValue("web");
      expect(path).toHaveAttribute("aria-required", "true");
      expect(yaml).toHaveValue("app#1:\n  start: /bin/true\n");
      expect(yaml).toHaveClass("font-mono");
      expect(within(form).getByText("application/yaml")).toBeInTheDocument();
      expect(within(form).getByText("The configuration to apply.")).toBeInTheDocument();
      expect(within(form).getByRole("checkbox", { name: /wait/ })).not.toBeChecked();
      expect(within(card).getByRole("button", { name: "Approve" })).toBeEnabled();
      fireEvent.change(yaml, { target: { value: "app#1:\n  start: /bin/false\n" } });
      fireEvent.click(within(card).getByRole("button", { name: "Approve with my changes" }));
      await waitFor(() => {
        expect(client.run).toHaveBeenLastCalledWith(
          "new",
          expect.objectContaining({
            resume: {
              interruptId: "confirmation-1",
              approved: true,
              editedArgs: { path: "web", yaml: "app#1:\n  start: /bin/false\n" },
            },
          }),
          expect.anything(),
        );
      });
      await screen.findByText("Done: web starts with /bin/false, as you set it.");
      expect(stepOf(log(), "Update object config")).toHaveTextContent(
        /done.*\(with your changes\)/,
      );
    });

    test("checks the form against the schema before sending it, and discards the changes", async () => {
      client.getConversation.mockResolvedValue({
        conversation: existing,
        confirmation: {
          id: "confirmation-1",
          turnId: "turn-1",
          tool: { name: "scale_service", title: "Scale service", destructive: true },
          arguments: { service: "web", count: 2 },
          argumentTypes: {},
          editable: true,
          inputSchema: {
            type: "object",
            properties: {
              service: { type: "string", minLength: 1 },
              count: { type: "integer", minimum: 1 },
            },
            required: ["service"],
          },
          expiresAt: "2099-10-09T17:45:00Z",
        },
      });
      await renderAssistant(client);
      fireEvent.click(screen.getByRole("button", { name: "Previous diagnostic" }));
      const card = await region();
      fireEvent.click(within(card).getByRole("button", { name: "Edit" }));
      fireEvent.change(within(card).getByRole("textbox", { name: /count/ }), {
        target: { value: "many" },
      });
      expect(within(card).getByText("A number is required.")).toBeInTheDocument();
      fireEvent.change(within(card).getByRole("textbox", { name: /count/ }), {
        target: { value: "0" },
      });
      expect(within(card).getByText(/expected number to be >=1/)).toBeInTheDocument();
      fireEvent.change(within(card).getByRole("textbox", { name: /service/ }), {
        target: { value: "" },
      });
      expect(within(card).getByText(/expected string to have >=1 characters/)).toBeInTheDocument();
      expect(within(card).getByRole("button", { name: "Approve with my changes" })).toBeDisabled();
      fireEvent.click(within(card).getByRole("button", { name: "Discard the changes" }));
      expect(within(card).getByRole("button", { name: "Approve" })).toBeEnabled();
      expect(within(card).getByText("2")).toBeInTheDocument();
      expect(client.run).not.toHaveBeenCalled();
    });

    test("offers no approval of a request expired", async () => {
      client.getConversation.mockResolvedValue({
        conversation: existing,
        confirmation: {
          id: "confirmation-1",
          turnId: "turn-1",
          tool: { name: "delete_service", title: "Delete service", destructive: true },
          arguments: { service: "web" },
          argumentTypes: {},
          editable: false,
          expiresAt: "2020-01-01T00:00:00Z",
        },
      });
      await renderAssistant(client);
      fireEvent.click(screen.getByRole("button", { name: "Previous diagnostic" }));
      const card = await region();
      expect(within(card).getByText(/This request has expired/)).toBeInTheDocument();
      expect(within(card).getByRole("button", { name: "Approve" })).toBeDisabled();
      expect(within(card).getByRole("button", { name: "Reject" })).toBeEnabled();
    });

    test("offers no Stop while an approved action runs: its result is what to see", async () => {
      client.run
        .mockImplementationOnce(replayRun("confirmation"))
        .mockImplementationOnce(() => new Promise(() => undefined));
      await renderAssistant(client);
      await submit("Start web with /bin/true");
      const card = await region();
      await waitFor(() => {
        expect(within(card).getByRole("button", { name: "Approve" })).toBeEnabled();
      });
      fireEvent.click(within(card).getByRole("button", { name: "Approve" }));
      await waitFor(() => {
        expect(client.run).toHaveBeenCalledTimes(2);
      });
      // The rest of the turn: the box stays open, what is sent is queued.
      expect(box()).toBeEnabled();
      expect(screen.getByRole("button", { name: "Queue" })).toBeDisabled();
      expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
    });
  });

  describe("the layout", () => {
    const local = (...parts: [number, number, number?, number?, number?]) =>
      new Date(...(parts as [number, number])).toISOString();
    const toggle = (name: string) => screen.getByRole("button", { name });

    test("folds the conversations, remembers it, and still starts a conversation folded", async () => {
      const { unmount } = await renderAssistant(client);
      const hide = toggle("Hide the conversations");
      expect(hide).toHaveAttribute("aria-expanded", "true");
      const panel = document.getElementById(hide.getAttribute("aria-controls") ?? "");
      expect(panel).toContainElement(screen.getByRole("button", { name: "Previous diagnostic" }));
      fireEvent.click(hide);
      expect(toggle("Show the conversations")).toHaveAttribute("aria-expanded", "false");
      expect(panel).not.toBeVisible();
      expect(screen.queryByRole("button", { name: "Previous diagnostic" })).not.toBeInTheDocument();
      expect(localStorage.getItem("oc3.assistant.conversations")).toBe("closed");
      unmount();
      await renderAssistant(client);
      expect(toggle("Show the conversations")).toHaveAttribute("aria-expanded", "false");
      fireEvent.click(toggle("Show the conversations"));
      expect(localStorage.getItem("oc3.assistant.conversations")).toBe("open");
      expect(screen.getByRole("button", { name: "Previous diagnostic" })).toBeVisible();
    });

    test("folds the conversations of a narrow window by default, and once one is chosen", async () => {
      vi.stubGlobal(
        "matchMedia",
        vi.fn((query: string) => ({
          matches: query === NARROW_QUERY,
          media: query,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        })),
      );
      await renderAssistant(client);
      fireEvent.click(toggle("Show the conversations"));
      fireEvent.click(screen.getByRole("button", { name: "Previous diagnostic" }));
      expect(toggle("Show the conversations")).toHaveAttribute("aria-expanded", "false");
      // Narrow, the fold is no preference.
      expect(localStorage.getItem("oc3.assistant.conversations")).toBeNull();
    });

    test("searches the titles of the conversations loaded", async () => {
      client.listConversations.mockResolvedValue([
        existing,
        { id: "pool", title: "Pool usage" },
        { id: "untitled", title: "" },
      ]);
      await renderAssistant(client);
      const search = screen.getByRole("searchbox", { name: "Search the conversations" });
      fireEvent.change(search, { target: { value: "POOL" } });
      expect(screen.getByRole("button", { name: "Pool usage" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Previous diagnostic" })).not.toBeInTheDocument();
      // An untitled conversation is found by the name it shows.
      fireEvent.change(search, { target: { value: "new conv" } });
      expect(screen.getAllByRole("button", { name: "New conversation" })).toHaveLength(2);
      fireEvent.change(search, { target: { value: "nothing like it" } });
      expect(screen.getByText("No conversation matches.")).toBeInTheDocument();
      expect(client.listConversations).toHaveBeenCalledTimes(1);
    });

    test("groups the conversations by the day of their last change", async () => {
      vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 9, 23, 15, 0) });
      client.listConversations.mockResolvedValue([
        {
          id: "a",
          title: "Disk check",
          created_at: local(2026, 9, 1),
          updated_at: local(2026, 9, 23, 9, 0),
        },
        { id: "b", title: "Freeze review", updated_at: local(2026, 9, 22, 23, 30) },
        { id: "c", title: "Pool usage", updated_at: local(2026, 9, 18, 12, 0) },
        { id: "d", title: "Old upgrade", updated_at: local(2026, 8, 1) },
        { id: "e", title: "No date" },
        { id: "f", title: "Latest", created_at: local(2026, 9, 23, 14, 0) },
      ]);
      await renderAssistant(client);
      const panel = screen.getByRole("region", { name: "Conversations" });
      expect(
        within(panel)
          .getAllByRole("heading", { level: 3 })
          .map((heading) => heading.textContent),
      ).toEqual(["Today", "Yesterday", "Previous 7 days", "Older"]);
      // The title of each row, in the first span of its first button.
      const titles = (name: string) =>
        within(screen.getByRole("list", { name }))
          .getAllByRole("listitem")
          .map((row) => row.querySelector("button span")?.textContent);
      expect(titles("Today")).toEqual(["Latest", "Disk check"]);
      expect(titles("Yesterday")).toEqual(["Freeze review"]);
      expect(titles("Previous 7 days")).toEqual(["Pool usage"]);
      expect(titles("Older")).toEqual(["Old upgrade", "No date"]);
    });

    test("leaves out the empty groups, by the local day of now", () => {
      const now = new Date(2026, 9, 23, 0, 30);
      const late = { id: "a", title: "", updated_at: local(2026, 9, 22, 23, 59) };
      expect(groupConversations([late], now)).toEqual([{ key: "yesterday", items: [late] }]);
      expect(groupConversations([], now)).toEqual([]);
    });

    test("suggests first questions, into the message box, until the first message", async () => {
      await renderAssistant(client);
      const suggestions = screen.getByRole("list", { name: "Questions to start with" });
      expect(within(suggestions).getAllByRole("button")).toHaveLength(4);
      fireEvent.click(
        within(suggestions).getByRole("button", { name: "Which services are down right now?" }),
      );
      expect(box()).toHaveValue("Which services are down right now?");
      expect(box()).toHaveFocus();
      expect(client.run).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
      await screen.findByText("Cluster looks healthy.");
      expect(
        screen.queryByRole("list", { name: "Questions to start with" }),
      ).not.toBeInTheDocument();
    });

    test("names the panel the toggle controls", async () => {
      await renderAssistant(client);
      expect(log()).toBeInTheDocument();
      expect(toggle("Hide the conversations")).toHaveAttribute(
        "aria-controls",
        "assistant-conversations-panel",
      );
    });
  });
});
