import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantError, createAssistantClient, type AssistantClient } from "../assistant-client";

const metadata = {
  id: "conversation-1",
  title: "Diagnostic",
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-02T00:00:00Z",
};
const savedMessage = {
  id: "turn-1:1",
  turn_id: "turn-1",
  role: "user",
  text: "Previous prompt",
  created_at: "2026-10-05T12:00:00Z",
};
const parsedMessage = {
  id: "turn-1:1",
  turnId: "turn-1",
  role: "user",
  text: "Previous prompt",
  createdAt: "2026-10-05T12:00:00Z",
};

let client: AssistantClient;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  client = createAssistantClient();
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** The request of the nth call, as the API client sends it. */
const requestAt = (index: number) => fetchMock.mock.calls[index]?.[0] as Request;
const path = (request: Request) => {
  const url = new URL(request.url);
  return `${url.pathname}${url.search}`;
};

describe("the client of the assistant refusing a creation", () => {
  it.each(["conversation_quota", "conversation_limit"])("keeps the code %s", async (code) => {
    fetchMock.mockResolvedValue(Response.json({ error: { code, message: "x" } }, { status: 409 }));
    await expect(client.createConversation()).rejects.toMatchObject({ code, status: 409 });
  });
});

describe("the conversations of the client", () => {
  it("creates, lists and reads through the relay of oc3, without a token of its own", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ conversation: metadata }, { status: 201 }))
      .mockResolvedValueOnce(Response.json({ conversations: [metadata] }))
      .mockResolvedValueOnce(Response.json({ conversation: metadata }));
    expect(await client.createConversation()).toEqual(metadata);
    expect(await client.listConversations()).toEqual([metadata]);
    expect(await client.getConversation(metadata.id)).toEqual({
      conversation: metadata,
      confirmation: null,
    });
    expect([0, 1, 2].map((index) => [path(requestAt(index)), requestAt(index).method])).toEqual([
      ["/api/assistant/conversations", "POST"],
      ["/api/assistant/conversations", "GET"],
      ["/api/assistant/conversations/conversation-1", "GET"],
    ]);
    // The relay holds the token of the session: the page sends none, nor a cluster.
    for (const index of [0, 1, 2]) {
      expect(requestAt(index).headers.get("Authorization")).toBeNull();
      expect(requestAt(index).headers.get("X-OpenSVC-Cluster-ID")).toBeNull();
    }
    // A request that changes something carries the header a forged one cannot.
    expect(requestAt(0).headers.get("X-OC3-CSRF")).toBe("1");
  });

  it("keeps the fields a conversation shows", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ conversations: [{ ...metadata, stored_bytes: 12 }, { id: "untitled" }] }),
    );
    expect(await client.listConversations()).toEqual([metadata, { id: "untitled", title: "" }]);
  });

  it("loads messages with exclusive cursor pagination", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ messages: [savedMessage], next_cursor: "1:1" }))
      .mockResolvedValueOnce(Response.json({ messages: [], next_cursor: "" }));
    expect(await client.getMessages(metadata.id)).toEqual({
      messages: [parsedMessage],
      nextCursor: "1:1",
    });
    await client.getMessages(metadata.id, { limit: 10, before: "1:1" });
    expect([path(requestAt(0)), path(requestAt(1))]).toEqual([
      "/api/assistant/conversations/conversation-1/messages?limit=50",
      "/api/assistant/conversations/conversation-1/messages?limit=10&before=1%3A1",
    ]);
  });

  it.each([
    { limit: 0 },
    { limit: 101 },
    { limit: 1.5 },
    { before: "01:1" },
    { before: "0:1" },
    { before: "1:1:1" },
    { before: "9223372036854775808:1" },
  ])("refuses an invalid history query %j before any request", (query) => {
    expect(() => client.getMessages(metadata.id, query)).toThrow("invalid_history_query");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { messages: [], next_cursor: null },
    { messages: [], next_cursor: "1:1" },
    { messages: [savedMessage], next_cursor: "01:1" },
    { messages: [null], next_cursor: "" },
    { messages: [{ ...savedMessage, role: "tool" }], next_cursor: "" },
    { messages: [{ ...savedMessage, role: "assistant", id: "wrong-id" }], next_cursor: "" },
    { messages: [{ ...savedMessage, id: "wrong id" }], next_cursor: "" },
    { messages: [{ ...savedMessage, text: null }], next_cursor: "" },
    { messages: [{ ...savedMessage, created_at: "invalid" }], next_cursor: "" },
    { messages: [savedMessage, savedMessage], next_cursor: "" },
    {
      messages: Array.from({ length: 101 }, (_, index) => ({
        ...savedMessage,
        id: `turn-1:${String(index + 1)}`,
      })),
      next_cursor: "",
    },
  ])("refuses a malformed history page", async (page) => {
    fetchMock.mockResolvedValue(Response.json(page));
    await expect(client.getMessages(metadata.id)).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it.each(["2:2", "3:1"])("refuses a history cursor %s that does not go back", async (cursor) => {
    fetchMock.mockResolvedValue(Response.json({ messages: [savedMessage], next_cursor: cursor }));
    await expect(client.getMessages(metadata.id, { before: "2:2" })).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("takes a prompt under the ID this page gave it, never an answer", async () => {
    const prompt = { ...savedMessage, id: "0f3c2a9e5b7d4c1a8e6f2b9d0c4a7e13" };
    fetchMock
      .mockResolvedValueOnce(Response.json({ messages: [prompt], next_cursor: "" }))
      .mockResolvedValueOnce(
        Response.json({ messages: [{ ...prompt, role: "assistant" }], next_cursor: "" }),
      )
      .mockResolvedValueOnce(
        Response.json({ messages: [{ ...prompt, id: "has space" }], next_cursor: "" }),
      );
    expect((await client.getMessages(metadata.id)).messages).toEqual([
      { ...parsedMessage, id: prompt.id },
    ]);
    for (let index = 0; index < 2; index++)
      await expect(client.getMessages(metadata.id)).rejects.toMatchObject({
        code: "invalid_response",
      });
  });

  it("keeps only the fields a history message shows", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        messages: [{ ...savedMessage, tool_results: "not shown", provider_state: "not shown" }],
        next_cursor: "",
      }),
    );
    expect(await client.getMessages(metadata.id)).toEqual({
      messages: [parsedMessage],
      nextCursor: "",
    });
  });

  describe("the steps of a turn in its history", () => {
    const answer = {
      id: "turn-1:4",
      turn_id: "turn-1",
      role: "assistant",
      text: "Stopped.",
      created_at: "2026-10-05T12:00:01Z",
    };
    const step = {
      id: "call-1",
      tool: "get_node",
      arguments: { node: "n1" },
      started_at: 1100,
      ended_at: 1400,
      status: "completed",
      result_excerpt: '{"content":[]}',
      result_truncated: false,
      refusal: "",
    };
    const served = {
      ...answer,
      steps: [
        step,
        {
          ...step,
          id: "call-2",
          tool: "delete_service",
          status: "rejected",
          ended_at: undefined,
          edited_arguments: { service: "db" },
        },
      ],
      steps_omitted: 2,
      runs: [{ started_at: 1000, ended_at: 2500 }],
      usage: { total_tokens: 370 },
    };
    const page = (messages: unknown[]) =>
      fetchMock.mockResolvedValue(Response.json({ messages, next_cursor: "" }));

    it("reads them with the last assistant message of the turn", async () => {
      page([{ ...answer, id: "turn-1:2", text: "I will stop it." }, served]);
      const { messages } = await client.getMessages(metadata.id);
      expect(messages[0]?.history).toBeUndefined();
      expect(messages[1]?.history).toEqual({
        steps: [
          {
            id: "call-1",
            tool: "get_node",
            arguments: { node: "n1" },
            startedAt: 1100,
            endedAt: 1400,
            status: "completed",
            resultExcerpt: '{"content":[]}',
            resultTruncated: false,
            refusal: "",
          },
          {
            id: "call-2",
            tool: "delete_service",
            arguments: { node: "n1" },
            startedAt: 1100,
            endedAt: null,
            status: "rejected",
            resultExcerpt: '{"content":[]}',
            resultTruncated: false,
            refusal: "",
            editedArgs: { service: "db" },
          },
        ],
        stepsOmitted: 2,
        runs: [{ startedAt: 1000, endedAt: 2500 }],
        usage: { totalTokens: 370 },
      });
    });

    it("keeps the arguments the agent left out as such", async () => {
      page([{ ...served, steps: [{ ...step, arguments: null, arguments_omitted: true }] }]);
      const { messages } = await client.getMessages(metadata.id);
      expect(messages[0]?.history?.steps[0]).toMatchObject({
        arguments: null,
        argumentsOmitted: true,
      });
    });

    it.each([
      ["steps on a prompt", [{ ...savedMessage, steps: [] }]],
      ["steps before the last answer of the turn", [served, { ...answer, id: "turn-1:6" }]],
      ["an unknown status", [{ ...served, steps: [{ ...step, status: "done" }] }]],
      ["a time that is no integer", [{ ...served, steps: [{ ...step, started_at: 1.5 }] }]],
      [
        "an excerpt past 4 KiB",
        [{ ...served, steps: [{ ...step, result_excerpt: "x".repeat(4097) }] }],
      ],
      ["arguments that are no object", [{ ...served, steps: [{ ...step, arguments: "web" }] }]],
      ["a tool that is no name", [{ ...served, steps: [{ ...step, tool: "get node" }] }]],
      ["the same call twice", [{ ...served, steps: [step, step] }]],
      [
        "more than 64 steps",
        [
          {
            ...served,
            steps: Array.from({ length: 65 }, (_, index) => ({
              ...step,
              id: `call-${String(index)}`,
            })),
          },
        ],
      ],
      ["a run without start", [{ ...served, runs: [{ ended_at: 5 }] }]],
      ["tokens that are no integer", [{ ...served, usage: { total_tokens: "370" } }]],
    ])("refuses %s", async (_, messages) => {
      page(messages);
      await expect(client.getMessages(metadata.id)).rejects.toMatchObject({
        code: "invalid_response",
      });
    });
  });

  describe("the tools the assistant may call", () => {
    const tool = {
      name: "delete_service",
      title: "Delete service",
      summary: "Delete the service.",
      read_only: false,
      needs_confirmation: true,
    };

    it("reads them as any route of the relay, with the credentials of the session", async () => {
      const documented = {
        ...tool,
        description: "Delete the service.\nAnd its instances.",
        arguments: { service: "the exact service name" },
      };
      fetchMock.mockResolvedValue(
        Response.json({
          tools: [
            documented,
            { ...tool, name: "list_nodes", title: "", read_only: true, needs_confirmation: false },
          ],
        }),
      );
      expect(await client.listTools()).toEqual([
        {
          name: "delete_service",
          title: "Delete service",
          summary: "Delete the service.",
          description: "Delete the service.\nAnd its instances.",
          arguments: { service: "the exact service name" },
          readOnly: false,
          needsConfirmation: true,
        },
        {
          name: "list_nodes",
          title: "list_nodes",
          summary: "Delete the service.",
          description: "",
          arguments: {},
          readOnly: true,
          needsConfirmation: false,
        },
      ]);
      const [url, init] = fetchMock.mock.calls[0] ?? [];
      expect(url).toBe("/api/assistant/tools");
      expect(new Headers(init?.headers).get("Accept")).toBe("application/json");
    });

    it("tells an agent that could not read them by its code", async () => {
      fetchMock.mockResolvedValue(
        Response.json({ error: { code: "tools_unavailable", message: "x" } }, { status: 502 }),
      );
      await expect(client.listTools()).rejects.toMatchObject({
        code: "tools_unavailable",
        status: 502,
      });
    });

    it("tells a relay that does not list them, as the agent of om3 told a 404", async () => {
      fetchMock.mockResolvedValue(new Response("404 page not found", { status: 404 }));
      await expect(client.listTools()).rejects.toMatchObject({
        code: "tools_unlisted",
        status: 404,
      });
    });

    it.each([
      ["no list", {}],
      ["a name that is no tool name", { tools: [{ ...tool, name: "delete service" }] }],
      ["a name twice", { tools: [tool, tool] }],
      ["a summary past its bound", { tools: [{ ...tool, summary: "x".repeat(601) }] }],
      ["a flag that is no boolean", { tools: [{ ...tool, read_only: "false" }] }],
      ["a description that is no text", { tools: [{ ...tool, description: 42 }] }],
      ["a description past its bound", { tools: [{ ...tool, description: "x".repeat(8193) }] }],
      ["arguments that are no object", { tools: [{ ...tool, arguments: ["node"] }] }],
      ["an argument description that is no text", { tools: [{ ...tool, arguments: { node: 1 } }] }],
      [
        "an argument description past its bound",
        { tools: [{ ...tool, arguments: { node: "x".repeat(2049) } }] },
      ],
    ])("refuses %s", async (_, body) => {
      fetchMock.mockResolvedValue(Response.json(body));
      await expect(client.listTools()).rejects.toMatchObject({ code: "invalid_response" });
    });
  });

  it("decodes UTF-8 history split across network chunks", async () => {
    const page = { messages: [{ ...savedMessage, text: "État 😀" }], next_cursor: "" };
    const bytes = new TextEncoder().encode(JSON.stringify(page));
    fetchMock.mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
            controller.close();
          },
        }),
        { headers: { "Content-Type": "application/json; charset=utf-8" } },
      ),
    );
    expect((await client.getMessages(metadata.id)).messages[0]?.text).toBe("État 😀");
  });

  it("cancels an oversized history body before it ends", async () => {
    const cancel = vi.fn();
    fetchMock.mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(1024 * 1024 + 1));
          },
          cancel,
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
    );
    await expect(client.getMessages(metadata.id)).rejects.toMatchObject({
      code: "invalid_response",
    });
    expect(cancel).toHaveBeenCalled();
  });

  it("cancels an unexpected history response that is no JSON", async () => {
    const cancel = vi.fn();
    fetchMock.mockResolvedValue(
      new Response(new ReadableStream({ cancel }), { headers: { "Content-Type": "text/html" } }),
    );
    await expect(client.getMessages(metadata.id)).rejects.toMatchObject({
      code: "invalid_response",
    });
    expect(cancel).toHaveBeenCalled();
  });

  it("aborts a history read while its body still streams", async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), {
      headers: { "Content-Type": "application/json" },
    });
    fetchMock.mockResolvedValue(response);
    const controller = new AbortController();
    const pending = client.getMessages(metadata.id, { signal: controller.signal });
    const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => {
      expect(response.body?.locked).toBe(true);
    });
    controller.abort();
    await assertion;
    expect(cancel).toHaveBeenCalled();
  });

  it.each([401, 403, 404, 410, 413, 503])(
    "keeps a history refusal %s by its status, never its message, without retrying",
    async (status) => {
      fetchMock.mockResolvedValue(Response.json({ error: "private upstream failure" }, { status }));
      const error = await client.getMessages(metadata.id).catch((error: unknown) => error);
      expect(error).toMatchObject({ code: "http_error", status });
      expect((error as Error).message).not.toContain("private");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    [404, "assistant_disabled"],
    [401, "assistant_token_unavailable"],
    [403, "assistant_forbidden"],
    [502, "assistant_unreachable"],
  ])("explains the refusal %i of the relay by its code %s", async (status, code) => {
    fetchMock.mockResolvedValue(Response.json({ error: { code, message: "x" } }, { status }));
    await expect(client.listConversations()).rejects.toMatchObject({ code, status });
  });

  it("renames with PATCH, normalized as the agent does, and gives the conversation back", async () => {
    const renamed = { ...metadata, title: "Cluster health" };
    fetchMock.mockResolvedValue(Response.json({ conversation: renamed }));
    expect(await client.renameConversation(metadata.id, "  Cluster\thealth\n ")).toEqual(renamed);
    expect(requestAt(0).method).toBe("PATCH");
    expect(path(requestAt(0))).toBe("/api/assistant/conversations/conversation-1");
    expect(await requestAt(0).json()).toEqual({ title: "Cluster health" });
  });

  it("counts Unicode code points for titles and normalizes controls", async () => {
    const title = "😀".repeat(80);
    fetchMock.mockResolvedValue(Response.json({ conversation: { ...metadata, title } }));
    await client.renameConversation(metadata.id, ` \u200b${title}\t `);
    expect(await requestAt(0).json()).toEqual({ title });
  });

  it.each(["", " \t\n​ ", "a".repeat(81), "😀".repeat(81)])(
    "refuses an invalid title before any request",
    (title) => {
      expect(() => client.renameConversation(metadata.id, title)).toThrow("invalid_title");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("deletes with DELETE and requires the empty 204", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json({}));
    await expect(client.deleteConversation(metadata.id)).resolves.toBeUndefined();
    expect(requestAt(0).method).toBe("DELETE");
    expect(path(requestAt(0))).toBe("/api/assistant/conversations/conversation-1");
    await expect(client.deleteConversation(metadata.id)).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("closes the body of an unexpected deletion response", async () => {
    const cancel = vi.fn();
    fetchMock.mockResolvedValue(new Response(new ReadableStream({ cancel }), { status: 200 }));
    await expect(client.deleteConversation(metadata.id)).rejects.toMatchObject({
      code: "invalid_response",
    });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each(["rename", "delete"])("refuses %s without a valid conversation ID", (operation) => {
    const invoke = (id: string) =>
      operation === "rename"
        ? client.renameConversation(id, "New title")
        : client.deleteConversation(id);
    expect(() => invoke("../ask")).toThrow("invalid_conversation");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["rename", "delete"])(
    "keeps the refusals of %s by their status, never their message, without retries",
    async (operation) => {
      for (const status of [403, 404, 409, 410]) {
        fetchMock.mockResolvedValueOnce(
          Response.json({ error: { message: "secret upstream" } }, { status }),
        );
        const pending =
          operation === "rename"
            ? client.renameConversation(metadata.id, "New title")
            : client.deleteConversation(metadata.id);
        const error = await pending.catch((error: unknown) => error);
        expect(error).toMatchObject({ code: "http_error", status });
        expect((error as Error).message).not.toContain("secret");
      }
      expect(fetchMock).toHaveBeenCalledTimes(4);
    },
  );

  it.each(["rename", "delete"])("stops %s with the signal of the caller", async (operation) => {
    const controller = new AbortController();
    fetchMock.mockImplementation(
      (request) =>
        new Promise((_resolve, reject) => {
          (request as Request).signal.addEventListener(
            "abort",
            () => {
              reject(new DOMException("Canceled", "AbortError"));
            },
            { once: true },
          );
        }),
    );
    const pending =
      operation === "rename"
        ? client.renameConversation(metadata.id, "New title", { signal: controller.signal })
        : client.deleteConversation(metadata.id, { signal: controller.signal });
    const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    controller.abort();
    await assertion;
  });

  it.each(["../ask", "a/b", "", "a?token=secret"])(
    "refuses the invalid conversation ID %j",
    (id) => {
      expect(() => client.getConversation(id)).toThrow("invalid_conversation");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("refuses an invalid JSON envelope", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ conversations: null }));
    await expect(client.listConversations()).rejects.toMatchObject({ code: "invalid_response" });
  });

  it.each([403, 404, 409, 410, 429, 500, 503])(
    "reports %s without the body nor a retry",
    async (status) => {
      fetchMock.mockResolvedValue(
        Response.json({ error: { message: "secret upstream" } }, { status }),
      );
      const error = await client.listConversations().catch((error: unknown) => error);
      expect(error).toBeInstanceOf(AssistantError);
      expect((error as AssistantError).status).toBe(status);
      expect((error as Error).message).not.toContain("secret");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("says a network failure by its code, never its message", async () => {
    fetchMock.mockRejectedValue(new Error("request contained a secret"));
    const error = await client.createConversation().catch((error: unknown) => error);
    expect(error).toMatchObject({ code: "network_error" });
    expect((error as Error).message).not.toContain("secret");
  });

  it("does not fetch for a signal already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(client.listConversations({ signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
