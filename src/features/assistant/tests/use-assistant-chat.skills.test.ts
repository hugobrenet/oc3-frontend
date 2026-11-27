import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { AssistantError, type Model, type Skill } from "../assistant-client";
import { useAssistantChat } from "../use-assistant-chat";
import { completed, fakeClient, stored, type FakeClient } from "./fake-client";
import { replayEvents, runFinished, runStarted } from "./agui-fixtures";

const morning: Skill = { name: "morning-check", description: "Check the collector." };
const maintenance: Skill = { name: "node-maintenance", description: "Reboot a node." };
const haiku: Model = { id: "default", label: "Claude Haiku", default: true, ready: true };
const luna: Model = { id: "luna", label: "GPT Luna", default: false, ready: true };

describe("the skills of useAssistantChat", () => {
  let client: FakeClient;
  beforeEach(() => {
    client = fakeClient([{ id: "existing", title: "Previous diagnostic" }]);
    client.getCapabilities.mockResolvedValue({ feedback: true, models: false, skills: true });
    client.listSkills.mockResolvedValue([morning, maintenance]);
    client.run.mockResolvedValue(completed("turn-live"));
  });
  const setup = async () => {
    const hook = renderHook(() => useAssistantChat(client));
    await waitFor(() => {
      expect(hook.result.current.pending).toBe("");
    });
    await waitFor(() => {
      expect(client.listSkills).toHaveBeenCalled();
    });
    return hook;
  };
  const resume = async (result: { current: ReturnType<typeof useAssistantChat> }) => {
    await act(async () => {
      await result.current.resumeConversation("existing");
    });
  };

  it("offers the skills of the agent, and sends the one asked", async () => {
    const { result } = await setup();
    await waitFor(() => {
      expect(result.current.skills).toEqual([morning, maintenance]);
    });
    await act(async () => {
      await result.current.send("/morning-check", undefined, undefined, "morning-check");
    });
    expect(client.run.mock.calls[0]?.[1]).toMatchObject({
      prompt: "/morning-check",
      skill: "morning-check",
    });
  });

  it("does not ask again a collector that relays no list", async () => {
    client.listSkills.mockRejectedValue(new AssistantError("skills_unlisted", 404));
    const { result } = await setup();
    await act(async () => {
      await result.current.send("hello");
    });
    await resume(result);
    expect(client.listSkills).toHaveBeenCalledTimes(1);
    expect(result.current.skills).toBeNull();
  });

  it("reads the list again, with the next action of the user, when it could not be read", async () => {
    client.listSkills.mockRejectedValueOnce(new AssistantError("skills_unavailable", 502));
    const { result } = await setup();
    expect(result.current.skills).toBeNull();
    await resume(result);
    await waitFor(() => {
      expect(result.current.skills).toEqual([morning, maintenance]);
    });
    expect(client.listSkills).toHaveBeenCalledTimes(2);
  });

  it("offers not the list of an identity to the next one, while its own is read", async () => {
    const hook = renderHook(({ identity }) => useAssistantChat(client, true, identity), {
      initialProps: { identity: "alice" },
    });
    await waitFor(() => {
      expect(hook.result.current.skills).toEqual([morning, maintenance]);
    });
    let release: (list: Skill[]) => void = () => undefined;
    client.listSkills.mockImplementationOnce(
      () =>
        new Promise<Skill[]>((ok) => {
          release = ok;
        }),
    );
    hook.rerender({ identity: "bob" });
    expect(hook.result.current.skills).toBeNull();
    await waitFor(() => {
      expect(client.listSkills).toHaveBeenCalledTimes(2);
    });
    expect(hook.result.current.skills).toBeNull();
    await act(async () => {
      release([maintenance]);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(hook.result.current.skills).toEqual([maintenance]);
    });
  });

  it("reads the list again for another identity, none offered meanwhile, the late list of the previous one dropped", async () => {
    let resolve: (list: Skill[]) => void = () => undefined;
    client.listSkills.mockImplementationOnce(
      () =>
        new Promise<Skill[]>((ok) => {
          resolve = ok;
        }),
    );
    const hook = renderHook(({ identity }) => useAssistantChat(client, true, identity), {
      initialProps: { identity: "alice" },
    });
    await waitFor(() => {
      expect(client.listSkills).toHaveBeenCalledTimes(1);
    });
    let release: (list: Skill[]) => void = () => undefined;
    client.listSkills.mockImplementationOnce(
      () =>
        new Promise<Skill[]>((ok) => {
          release = ok;
        }),
    );
    hook.rerender({ identity: "bob" });
    await waitFor(() => {
      expect(client.listSkills).toHaveBeenCalledTimes(2);
    });
    // Alice's list, late, is not Bob's.
    await act(async () => {
      resolve([morning, maintenance]);
      await Promise.resolve();
    });
    expect(hook.result.current.skills).toBeNull();
    await act(async () => {
      release([maintenance]);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(hook.result.current.skills).toEqual([maintenance]);
    });
  });

  it.each(["skill_unavailable", "invalid_skill"])(
    "on %s reads the list again, and queues the words without the skill, on their model",
    async (code) => {
      client.getCapabilities.mockResolvedValue({ feedback: true, models: true, skills: true });
      client.listModels.mockResolvedValue([haiku, luna]);
      const { result } = await setup();
      await waitFor(() => {
        expect(result.current.models).not.toBeNull();
      });
      client.run.mockRejectedValueOnce(
        new AssistantError(code, code === "invalid_skill" ? 400 : null),
      );
      await act(async () => {
        await result.current.send("on n1", undefined, "luna", "node-maintenance");
      });
      await waitFor(() => {
        expect(client.listSkills).toHaveBeenCalledTimes(2);
      });
      expect(result.current.queued).toMatchObject({ text: "on n1", model: "luna" });
      expect(result.current.queued).not.toHaveProperty("skill");
    },
  );

  it("queues nothing for a skill asked without words", async () => {
    const { result } = await setup();
    client.run.mockRejectedValueOnce(new AssistantError("skill_unavailable"));
    await act(async () => {
      await result.current.send("/morning-check", undefined, undefined, "morning-check");
    });
    await waitFor(() => {
      expect(client.listSkills).toHaveBeenCalledTimes(2);
    });
    expect(result.current.queued).toBeNull();
  });

  describe("through a snapshot of the thread", () => {
    const answered = (turnId: string, messageId: string) => [
      { type: "TEXT_MESSAGE_START", messageId, role: "assistant" },
      { type: "TEXT_MESSAGE_CONTENT", messageId, delta: "Done." },
      { type: "TEXT_MESSAGE_END", messageId },
      runFinished({ result: { turnId } }),
    ];
    const snapshot = (messages: unknown[]) => ({ type: "MESSAGES_SNAPSHOT", messages });
    const skillsOf = (messages: readonly { role: string; id: string; skill?: string }[]) =>
      messages
        .filter((message) => message.role === "user")
        .map((message) => `${message.id}=${message.skill ?? ""}`);
    const opened = async () => {
      client.getMessages.mockResolvedValue({
        messages: [
          { ...stored("turn-1:1", "user", "check"), skill: "morning-check" },
          stored("turn-1:2", "assistant", "ok"),
        ],
        nextCursor: "",
      });
      const hook = await setup();
      await resume(hook.result);
      expect(skillsOf(hook.result.current.messages)).toEqual(["turn-1:1=morning-check"]);
      return hook;
    };

    it("keeps the skill of the prompts the page holds, and of the prompt of the run", async () => {
      const { result } = await opened();
      // Out of phase: the prompt goes under another ID, which the snapshot
      // names without the skill, as an agent of before does.
      client.run.mockImplementationOnce(
        replayEvents([
          runStarted,
          snapshot([
            { id: "turn-1:1", role: "user", content: "check" },
            { id: "turn-1:2", role: "assistant", content: "ok" },
            { id: "turn-2:1", role: "user", content: "on n1" },
          ]),
          ...answered("turn-2", "turn-2:2"),
        ]),
      );
      await act(async () => {
        await result.current.send("on n1", undefined, undefined, "node-maintenance");
      });
      expect(skillsOf(result.current.messages)).toEqual([
        "turn-1:1=morning-check",
        "turn-2:1=node-maintenance",
      ]);
    });

    it("shows the skill the snapshot names, such as of the turn a run resumes", async () => {
      const { result } = await opened();
      client.run.mockImplementationOnce(
        replayEvents([
          runStarted,
          snapshot([
            { id: "turn-1:1", role: "user", content: "check" },
            { id: "turn-1:2", role: "assistant", content: "ok" },
            { id: "turn-2:1", role: "user", content: "stop web", skill: "node-maintenance" },
            { id: "turn-2:2", role: "assistant", content: "Stopped." },
            { id: "turn-3:1", role: "user", content: "and now?" },
          ]),
          ...answered("turn-3", "turn-3:2"),
        ]),
      );
      await act(async () => {
        await result.current.send("and now?");
      });
      expect(skillsOf(result.current.messages)).toEqual([
        "turn-1:1=morning-check",
        "turn-2:1=node-maintenance",
        "turn-3:1=",
      ]);
    });

    it("refuses a snapshot naming a skill not shaped as one", async () => {
      const { result } = await opened();
      client.run.mockImplementationOnce(
        replayEvents([
          runStarted,
          snapshot([{ id: "turn-2:1", role: "user", content: "on n1", skill: "Node Maintenance" }]),
          ...answered("turn-2", "turn-2:2"),
        ]),
      );
      await act(async () => {
        await result.current.send("on n1");
      });
      expect(result.current.error).toMatchObject({ code: "invalid_response" });
    });
  });
});
