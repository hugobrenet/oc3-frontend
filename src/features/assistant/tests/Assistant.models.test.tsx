import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AssistantError, type Model, type RunResult } from "../assistant-client";
import { completed, fakeClient, type FakeClient } from "./fake-client";
import { renderAssistant, stubCollector } from "./render";

const models: Model[] = [
  { id: "default", label: "Claude Haiku", default: true, ready: true },
  { id: "luna", label: "GPT Luna", default: false, ready: true },
  { id: "small", label: "Mistral Small 4", default: false, ready: false },
];

describe("the choice of the model", () => {
  let client: FakeClient;
  beforeEach(() => {
    localStorage.clear();
    stubCollector();
    client = fakeClient([]);
    client.getCapabilities.mockResolvedValue({ feedback: true, models: true });
    client.listModels.mockResolvedValue(models);
    client.run.mockResolvedValue(completed("turn-live"));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });
  const select = () => screen.findByRole("combobox", { name: "Model" });
  const box = () => screen.getByRole("textbox", { name: "Message to the assistant" });
  const send = (text: string) => {
    fireEvent.change(box(), { target: { value: text } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
  };
  const inputOf = (call: number) => client.run.mock.calls[call]?.[1];

  test("offers the models beside the message box, one the user cannot run on shown only", async () => {
    await renderAssistant(client);
    const choice = await select();
    expect(choice).toHaveValue("default");
    const options = within(choice).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "Claude Haiku",
      "GPT Luna",
      "Mistral Small 4",
    ]);
    expect(options[2]).toBeDisabled();
  });

  test("sends the message on the model chosen", async () => {
    await renderAssistant(client);
    fireEvent.change(await select(), { target: { value: "luna" } });
    send("How many nodes?");
    await waitFor(() => {
      expect(client.run).toHaveBeenCalledTimes(1);
    });
    expect(inputOf(0)).toMatchObject({ prompt: "How many nodes?", model: "luna" });
  });

  test("offers no choice when the agent offers none", async () => {
    client.getCapabilities.mockResolvedValue({ feedback: true, models: false });
    await renderAssistant(client);
    await waitFor(() => {
      expect(client.getCapabilities).toHaveBeenCalled();
    });
    expect(screen.queryByRole("combobox", { name: "Model" })).not.toBeInTheDocument();
  });

  test("queues a message refused for a model the agent no longer offers, and sends it again on the default", async () => {
    await renderAssistant(client);
    fireEvent.change(await select(), { target: { value: "luna" } });
    // Refused once the conversation is on display, as over a network.
    client.run.mockImplementationOnce(
      () =>
        new Promise<RunResult>((_ok, ko) => {
          setTimeout(() => {
            ko(new AssistantError("model_unknown", 400));
          }, 20);
        }),
    );
    send("How many nodes?");
    expect(
      await screen.findByText(/This model is no longer available: the default model is selected/),
    ).toBeInTheDocument();
    const queued = await screen.findByRole("group", { name: "Queued message" });
    expect(within(queued).getByText("How many nodes?")).toBeInTheDocument();
    // What the user types meanwhile stays.
    fireEvent.change(box(), { target: { value: "draft" } });
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Model" })).toHaveValue("default");
    });
    fireEvent.click(within(queued).getByRole("button", { name: "Send again" }));
    await waitFor(() => {
      expect(client.run).toHaveBeenCalledTimes(2);
    });
    expect(inputOf(1)).toMatchObject({ prompt: "How many nodes?", model: "default" });
    expect(box()).toHaveValue("draft");
  });

  test("sends again a message queued then stopped on the model it was queued with", async () => {
    await renderAssistant(client);
    let fail: () => void = () => undefined;
    client.run.mockImplementationOnce(
      () =>
        new Promise<RunResult>((_ok, ko) => {
          fail = () => {
            ko(new AssistantError("http_error", 429));
          };
        }),
    );
    send("first");
    await waitFor(() => {
      expect(client.run).toHaveBeenCalledTimes(1);
    });
    fireEvent.change(await select(), { target: { value: "luna" } });
    fireEvent.change(box(), { target: { value: "second" } });
    fireEvent.click(screen.getByRole("button", { name: "Queue" }));
    fireEvent.change(await select(), { target: { value: "default" } });
    fail();
    const queued = await screen.findByRole("group", { name: "Queued message" });
    fireEvent.click(await within(queued).findByRole("button", { name: "Send again" }));
    await waitFor(() => {
      expect(client.run).toHaveBeenCalledTimes(2);
    });
    expect(inputOf(1)).toMatchObject({ prompt: "second", model: "luna" });
  });
});
