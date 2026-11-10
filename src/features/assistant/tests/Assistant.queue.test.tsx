import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AssistantClient } from "../assistant-client";
import { replayRun } from "./agui-fixtures";
import { aborted, completed, fakeClient, started, type FakeClient } from "./fake-client";
import { renderAssistant, stubCollector } from "./render";

const existing = { id: "existing", title: "Previous diagnostic" };

/** A run that waits until the user stops it. */
const hangingRun: AssistantClient["run"] = (_id, _input, options) =>
  new Promise((_resolve, reject) => {
    options?.onEvent?.(started(1000));
    options?.signal?.addEventListener(
      "abort",
      () => {
        reject(aborted());
      },
      { once: true },
    );
  });

describe("the message queued while the assistant answers", () => {
  let client: FakeClient;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-09T17:00:00Z") });
    stubCollector();
    client = fakeClient([existing]);
    client.createConversation.mockResolvedValue({ id: "new", title: "" });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  const box = () => screen.getByRole("textbox", { name: "Message to the assistant" });
  const type = (text: string) => fireEvent.change(box(), { target: { value: text } });
  const start = async (run: AssistantClient["run"] = hangingRun) => {
    client.run.mockImplementationOnce(run);
    const view = await renderAssistant(client);
    type("First");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByRole("button", { name: "Stop" });
    return view;
  };
  const queued = () => screen.queryByRole("group", { name: "Queued message" });
  const queueButton = () => screen.getByRole("button", { name: "Queue" });

  test("announces the first message queued, in a live region always there", async () => {
    await start();
    const live = document.querySelector('p[aria-live="polite"].sr-only');
    expect(live).toBeEmptyDOMElement();
    type("Second");
    fireEvent.click(queueButton());
    expect(live).toHaveTextContent("Message queued: Second");
  });

  test("stays open while an approved action runs and the model goes on", async () => {
    await start(replayRun("confirmation"));
    const card = await screen.findByRole("region", { name: "Action waiting for confirmation" });
    await waitFor(() => {
      expect(within(card).getByRole("button", { name: "Approve" })).toBeEnabled();
    });
    client.run.mockImplementationOnce(hangingRun);
    fireEvent.click(within(card).getByRole("button", { name: "Approve" }));
    await waitFor(() => {
      expect(client.run).toHaveBeenCalledTimes(2);
    });
    expect(box()).toBeEnabled();
    expect(screen.getByText(/your message will be sent once it ends/)).toBeInTheDocument();
    type("Then check it");
    fireEvent.click(queueButton());
    expect(within(queued()!).getByText("Then check it")).toBeInTheDocument();
    // No stop: the action runs on the agent, which a stop would not cancel.
    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
  });

  test("closes the replacement asked when the message queued went meanwhile, keeping what is typed", async () => {
    let end: () => void = () => undefined;
    await start(
      (_id, _input, options) =>
        new Promise((resolve) => {
          options?.onEvent?.(started(1000));
          end = () => {
            resolve(completed("turn-1"));
          };
        }),
    );
    type("Second");
    fireEvent.click(queueButton());
    type("Third");
    fireEvent.click(queueButton());
    await screen.findByRole("dialog", { name: "Replace the queued message" });
    client.run.mockImplementationOnce(hangingRun);
    end();
    await waitFor(() => {
      expect(client.run).toHaveBeenCalledTimes(2);
    });
    const input = client.run.mock.calls[1]?.[1];
    expect(input !== undefined && "prompt" in input ? input.prompt : undefined).toBe("Second");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(box()).toHaveValue("Third");
  });

  test("stays open while the turn runs, and queues the message with Enter", async () => {
    await start();
    expect(box()).toBeEnabled();
    expect(screen.getByText(/your message will be sent once it ends/)).toBeInTheDocument();
    type("Second");
    expect(fireEvent.keyDown(box(), { key: "Enter" })).toBe(false);
    expect(within(queued()!).getByText("Second")).toBeInTheDocument();
    expect(box()).toHaveValue("");
    expect(box()).toHaveFocus();
    expect(queueButton()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
    expect(client.run).toHaveBeenCalledTimes(1);
  });

  test("gives the message back to edit, never over what is typed, and removes it", async () => {
    await start();
    type("Second");
    fireEvent.click(queueButton());
    type("Typing");
    expect(within(queued()!).getByRole("button", { name: "Edit" })).toBeDisabled();
    type("");
    fireEvent.click(within(queued()!).getByRole("button", { name: "Edit" }));
    expect(box()).toHaveValue("Second");
    expect(queued()).toBeNull();
    fireEvent.click(queueButton());
    fireEvent.click(within(queued()!).getByRole("button", { name: "Remove" }));
    expect(queued()).toBeNull();
  });

  test("asks before replacing the message queued", async () => {
    await start();
    type("Second");
    fireEvent.click(queueButton());
    type("Second, rather");
    fireEvent.click(queueButton());
    const dialog = await screen.findByRole("dialog", { name: "Replace the queued message" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(within(queued()!).getByText("Second")).toBeInTheDocument();
    expect(box()).toHaveValue("Second, rather");
    fireEvent.click(queueButton());
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Replace" }),
    );
    expect(within(queued()!).getByText("Second, rather")).toBeInTheDocument();
    expect(box()).toHaveValue("");
  });

  test("waits for the decision on a confirmation, the card saying so", async () => {
    await start(replayRun("confirmation"));
    const card = await screen.findByRole("region", { name: "Action waiting for confirmation" });
    await waitFor(() => {
      expect(within(card).getByRole("button", { name: "Reject" })).toBeEnabled();
    });
    expect(box()).toBeEnabled();
    expect(screen.getByText(/it does not answer the confirmation/)).toBeInTheDocument();
    type("Then check it");
    fireEvent.click(queueButton());
    expect(
      within(card).getByText("A message is queued: it will be sent after your decision."),
    ).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Approve" })).toBeEnabled();
    expect(within(card).getByRole("button", { name: "Reject" })).toBeEnabled();
    expect(client.run).toHaveBeenCalledTimes(1);
  });

  test("stays after a stop, sent again on demand, and comes back into the box of another conversation", async () => {
    await start();
    type("Second");
    fireEvent.click(queueButton());
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await screen.findByText(/Incomplete answer, stopped/);
    // Nothing goes alone: the box sends what is typed, the chip what is queued.
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
    expect(within(queued()!).getByRole("button", { name: "Send again" })).toBeEnabled();
    expect(client.run).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Previous diagnostic" }));
    // Once the conversation is there, its history read, not in between.
    await waitFor(() => {
      expect(client.getMessages).toHaveBeenCalledWith("existing", expect.anything());
    });
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Previous diagnostic" })).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Previous diagnostic" })).toBeEnabled();
    });
    expect(box()).toHaveValue("Second");
    expect(queued()).toBeNull();
  });

  test("sends the queued message again when the user asks, after a stop", async () => {
    await start();
    type("Second");
    fireEvent.click(queueButton());
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await screen.findByText(/Incomplete answer, stopped/);
    client.run.mockImplementationOnce(replayRun("text_and_tools"));
    fireEvent.click(within(queued()!).getByRole("button", { name: "Send again" }));
    await waitFor(() => {
      expect(client.run).toHaveBeenCalledTimes(2);
    });
    const input = client.run.mock.calls[1]?.[1];
    expect(input !== undefined && "prompt" in input ? input.prompt : undefined).toBe("Second");
    expect(queued()).toBeNull();
  });
});
