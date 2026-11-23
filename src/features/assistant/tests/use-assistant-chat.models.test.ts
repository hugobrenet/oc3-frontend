import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AssistantError, type Model, type RunResult } from "../assistant-client";
import { MODEL_KEY, useAssistantChat } from "../use-assistant-chat";
import { completed, fakeClient, started, stored, text, type FakeClient } from "./fake-client";

const existing = { id: "existing", title: "Previous diagnostic" };
const other = { id: "other", title: "Other diagnostic" };
const haiku: Model = { id: "default", label: "Claude Haiku", default: true, ready: true };
const luna: Model = { id: "luna", label: "GPT Luna", default: false, ready: true };
const small: Model = { id: "small", label: "Mistral Small 4", default: false, ready: true };
const saved = (modelId?: string) => [
  stored("turn-1:1", "user", "Old prompt"),
  stored("turn-1:2", "assistant", "Old answer", modelId !== undefined ? { modelId } : {}),
];
const refused = () => new AssistantError("model_unknown", 400);

describe("the models of useAssistantChat", () => {
  let client: FakeClient;
  beforeEach(() => {
    localStorage.clear();
    client = fakeClient([existing, other]);
    client.getCapabilities.mockResolvedValue({ feedback: true, models: true });
    client.listModels.mockResolvedValue([haiku, luna, small]);
    client.getMessages.mockResolvedValue({ messages: saved("small"), nextCursor: "" });
    client.run.mockResolvedValue(completed("turn-live"));
  });
  afterEach(() => {
    localStorage.clear();
  });
  const setup = async ({ models = true } = {}) => {
    const hook = renderHook(() => useAssistantChat(client));
    await waitFor(() => {
      expect(hook.result.current.pending).toBe("");
    });
    if (models)
      await waitFor(() => {
        expect(hook.result.current.models).not.toBeNull();
      });
    return hook;
  };
  const sentModel = (call = 0) => {
    const input = client.run.mock.calls[call]?.[1];
    return input !== undefined && "model" in input ? input.model : undefined;
  };
  const send = async (result: { current: ReturnType<typeof useAssistantChat> }, text: string) => {
    await act(async () => {
      await result.current.send(text);
    });
  };

  it("offers the models of the agent, the default chosen", async () => {
    const { result } = await setup();
    expect(result.current.models).toEqual([haiku, luna, small]);
    expect(result.current.model).toBe("default");
    await send(result, "hello");
    expect(sentModel()).toBe("default");
  });

  it("offers no choice, and sends no model, when the agent does not say its runs choose", async () => {
    client.getCapabilities.mockResolvedValue({ feedback: true, models: false });
    const { result } = await setup({ models: false });
    await waitFor(() => {
      expect(result.current.feedbackEnabled).toBe(true);
    });
    expect(client.listModels).not.toHaveBeenCalled();
    expect(result.current.models).toBeNull();
    await send(result, "hello");
    expect(sentModel()).toBeUndefined();
  });

  it("offers no choice with one model", async () => {
    client.listModels.mockResolvedValue([haiku]);
    const { result } = await setup({ models: false });
    await waitFor(() => {
      expect(client.listModels).toHaveBeenCalled();
    });
    expect(result.current.models).toBeNull();
    expect(result.current.model).toBeNull();
  });

  it("sends the model chosen, and keeps the choice for the next visit", async () => {
    const { result, unmount } = await setup();
    act(() => {
      result.current.selectModel("luna");
    });
    await send(result, "hello");
    expect(sentModel()).toBe("luna");
    expect(localStorage.getItem(MODEL_KEY)).toBe("luna");
    unmount();
    const next = await setup();
    expect(next.result.current.model).toBe("luna");
  });

  it("passes over a choice the list does not offer", async () => {
    localStorage.setItem(MODEL_KEY, "gone");
    client.listModels.mockResolvedValue([haiku, { ...luna, ready: false }]);
    const { result } = await setup();
    expect(result.current.model).toBe("default");
    act(() => {
      result.current.selectModel("luna");
    });
    expect(result.current.model).toBe("default");
  });

  it("goes on with the model of the last turn of the conversation opened", async () => {
    const { result } = await setup();
    await act(async () => {
      await result.current.resumeConversation("existing");
    });
    expect(result.current.model).toBe("small");
    expect(localStorage.getItem(MODEL_KEY)).toBeNull();
    await send(result, "and then?");
    expect(sentModel()).toBe("small");
  });

  it("starts a new conversation, or one naming no model, from the choice kept", async () => {
    localStorage.setItem(MODEL_KEY, "luna");
    const { result } = await setup();
    await act(async () => {
      await result.current.resumeConversation("existing");
    });
    expect(result.current.model).toBe("small");
    act(() => {
      result.current.startConversation();
    });
    expect(result.current.model).toBe("luna");
    await act(async () => {
      await result.current.resumeConversation("existing");
    });
    client.getMessages.mockResolvedValue({ messages: saved(), nextCursor: "" });
    client.getConversation.mockResolvedValue({ conversation: other, confirmation: null });
    await act(async () => {
      await result.current.resumeConversation("other");
    });
    expect(result.current.model).toBe("luna");
  });

  it("leaves the model of a conversation deleted with it", async () => {
    const { result } = await setup();
    await act(async () => {
      await result.current.resumeConversation("existing");
    });
    expect(result.current.model).toBe("small");
    await act(async () => {
      await result.current.deleteConversation();
    });
    expect(result.current.model).toBe("default");
  });

  it("queues the prompt again, on the default model, when the agent no longer offers the model", async () => {
    const { result } = await setup();
    act(() => {
      result.current.selectModel("luna");
    });
    client.run.mockRejectedValueOnce(refused());
    await send(result, "hello");
    expect(result.current.error).toMatchObject({ code: "model_unknown" });
    expect(result.current.messages).toEqual([]);
    expect(result.current.queued).toMatchObject({ conversationId: "new", text: "hello" });
    expect(result.current.queued).not.toHaveProperty("model");
    // The default, even should a replica still offer the model refused, and
    // the choice kept forgotten.
    await waitFor(() => {
      expect(client.listModels).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(result.current.models).toEqual([haiku, luna, small]);
    });
    expect(result.current.model).toBe("default");
    expect(localStorage.getItem(MODEL_KEY)).toBeNull();
  });

  it("keeps a message queued meanwhile, the prompt refused left failed in the thread", async () => {
    const { result } = await setup();
    act(() => {
      result.current.selectModel("luna");
    });
    let refuse: () => void = () => undefined;
    client.run.mockImplementationOnce(
      () =>
        new Promise<RunResult>((_ok, ko) => {
          refuse = () => {
            ko(refused());
          };
        }),
    );
    act(() => {
      void result.current.send("hello");
    });
    await waitFor(() => {
      expect(client.run).toHaveBeenCalledTimes(1);
    });
    act(() => {
      expect(result.current.queue("second")).toBe(true);
    });
    await act(async () => {
      refuse();
      await Promise.resolve();
    });
    expect(result.current.queued).toMatchObject({ text: "second" });
    expect(result.current.messages.map((message) => message.text)).toContain("hello");
  });

  it("goes on the default when the model of the conversation is refused, the choice kept untouched", async () => {
    localStorage.setItem(MODEL_KEY, "luna");
    const { result } = await setup();
    await act(async () => {
      await result.current.resumeConversation("existing");
    });
    client.run.mockRejectedValueOnce(refused());
    await send(result, "hello");
    await waitFor(() => {
      expect(client.listModels).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(result.current.models).not.toBeNull();
    });
    expect(result.current.model).toBe("default");
    expect(localStorage.getItem(MODEL_KEY)).toBe("luna");
  });

  it("sends a queued message on the model chosen when it was queued", async () => {
    let end: () => void = () => undefined;
    client.run.mockImplementationOnce(
      () =>
        new Promise<RunResult>((ok) => {
          end = () => {
            ok(completed("turn-a"));
          };
        }),
    );
    const { result } = await setup();
    act(() => {
      void result.current.send("first");
    });
    await waitFor(() => {
      expect(client.run).toHaveBeenCalledTimes(1);
    });
    act(() => {
      result.current.selectModel("small");
    });
    act(() => {
      expect(result.current.queue("second")).toBe(true);
    });
    act(() => {
      result.current.selectModel("luna");
    });
    await act(async () => {
      end();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(client.run).toHaveBeenCalledTimes(2);
    });
    expect(sentModel(0)).toBe("default");
    expect(sentModel(1)).toBe("small");
  });

  it("reads the list again, with the next action of the user, when it could not be read", async () => {
    client.listModels.mockRejectedValueOnce(new AssistantError("http_error", 503));
    const { result } = await setup({ models: false });
    await waitFor(() => {
      expect(client.listModels).toHaveBeenCalledTimes(1);
    });
    expect(result.current.models).toBeNull();
    await act(async () => {
      await result.current.resumeConversation("existing");
    });
    await waitFor(() => {
      expect(result.current.models).toEqual([haiku, luna, small]);
    });
    expect(client.listModels).toHaveBeenCalledTimes(2);
  });

  it("leaves the choice of the user as it is when a message queued with another model is refused", async () => {
    let end: () => void = () => undefined;
    client.run.mockImplementationOnce(
      () =>
        new Promise<RunResult>((ok) => {
          end = () => {
            ok(completed("turn-a"));
          };
        }),
    );
    const { result } = await setup();
    act(() => {
      void result.current.send("first");
    });
    await waitFor(() => {
      expect(client.run).toHaveBeenCalledTimes(1);
    });
    act(() => {
      result.current.selectModel("small");
    });
    act(() => {
      expect(result.current.queue("second")).toBe(true);
    });
    act(() => {
      result.current.selectModel("luna");
    });
    client.run.mockRejectedValueOnce(refused());
    await act(async () => {
      end();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(client.run).toHaveBeenCalledTimes(2);
    });
    expect(sentModel(1)).toBe("small");
    await waitFor(() => {
      expect(result.current.queued).toMatchObject({ text: "second" });
    });
    expect(result.current.queued).not.toHaveProperty("model");
    await waitFor(() => {
      expect(result.current.models).not.toBeNull();
    });
    expect(result.current.model).toBe("luna");
    expect(localStorage.getItem(MODEL_KEY)).toBe("luna");
  });

  it("keeps the choice of the user when the conversation shown is read again whole", async () => {
    client.getMessages.mockResolvedValue({ messages: saved("small"), nextCursor: "" });
    client.run.mockImplementationOnce((_id, _input, options) => {
      options?.onEvent?.(started());
      options?.onEvent?.({
        type: "MESSAGES_SNAPSHOT",
        omittedTurns: 2,
        messages: [{ id: "turn-8:1", role: "user", content: "Later" }],
      } as never);
      for (const event of text("Hello")) options?.onEvent?.(event);
      return Promise.resolve(completed());
    });
    const { result } = await setup();
    await send(result, "hello");
    expect(result.current.partial).toBe(true);
    act(() => {
      result.current.selectModel("luna");
    });
    await act(async () => {
      await result.current.resumeConversation("new");
    });
    expect(result.current.partial).toBe(false);
    expect(result.current.model).toBe("luna");
  });

  it("offers no choice, and does not ask again, a collector that relays no list", async () => {
    client.listModels.mockRejectedValue(new AssistantError("models_unlisted", 404));
    const { result } = await setup({ models: false });
    await waitFor(() => {
      expect(client.listModels).toHaveBeenCalledTimes(1);
    });
    await send(result, "hello");
    await act(async () => {
      await result.current.resumeConversation("existing");
    });
    expect(client.listModels).toHaveBeenCalledTimes(1);
    expect(result.current.models).toBeNull();
    expect(sentModel()).toBeUndefined();
  });

  it("sends no model while the list read again after a refusal cannot be read", async () => {
    const { result } = await setup();
    act(() => {
      result.current.selectModel("luna");
    });
    client.run.mockRejectedValueOnce(refused());
    client.listModels.mockRejectedValue(new AssistantError("http_error", 503));
    await send(result, "hello");
    await waitFor(() => {
      expect(client.listModels).toHaveBeenCalledTimes(2);
    });
    expect(result.current.models).toBeNull();
    expect(result.current.model).toBeNull();
    await send(result, "again");
    expect(sentModel(1)).toBeUndefined();
  });

  it("forgets the model of the conversation of another identity", async () => {
    const hook = renderHook(({ identity }) => useAssistantChat(client, true, identity), {
      initialProps: { identity: "alice" },
    });
    await waitFor(() => {
      expect(hook.result.current.models).not.toBeNull();
    });
    await act(async () => {
      await hook.result.current.resumeConversation("existing");
    });
    expect(hook.result.current.model).toBe("small");
    hook.rerender({ identity: "bob" });
    await waitFor(() => {
      expect(hook.result.current.models).not.toBeNull();
    });
    expect(hook.result.current.model).toBe("default");
  });

  it("reads the list again for another identity, and drops the late list of the previous one", async () => {
    let resolve: (list: Model[]) => void = () => undefined;
    client.listModels.mockImplementationOnce(
      () =>
        new Promise<Model[]>((ok) => {
          resolve = ok;
        }),
    );
    const hook = renderHook(({ identity }) => useAssistantChat(client, true, identity), {
      initialProps: { identity: "alice" },
    });
    await waitFor(() => {
      expect(client.listModels).toHaveBeenCalledTimes(1);
    });
    client.listModels.mockResolvedValue([haiku, small]);
    hook.rerender({ identity: "bob" });
    await waitFor(() => {
      expect(hook.result.current.models).toEqual([haiku, small]);
    });
    await act(async () => {
      resolve([haiku, luna]);
      await Promise.resolve();
    });
    expect(hook.result.current.models).toEqual([haiku, small]);
  });
});
