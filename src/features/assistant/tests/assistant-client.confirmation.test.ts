import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAssistantClient, type AssistantClient } from "../assistant-client";

const confirmation = {
  id: "confirmation-1",
  turn_id: "turn-1",
  tool: { name: "delete_service", title: "Delete service", destructive: true },
  arguments: { service: "prod/svc/web" },
  expires_at: "2026-10-09T17:45:00Z",
};
const parsed = {
  id: "confirmation-1",
  turnId: "turn-1",
  tool: { name: "delete_service", title: "Delete service", destructive: true },
  arguments: { service: "prod/svc/web" },
  expiresAt: "2026-10-09T17:45:00Z",
};

// A confirmation left waiting is read with the conversation, after a reload:
// the runs give it with their interrupt (assistant-client.runs.test.ts).
describe("the confirmation a conversation waits on", () => {
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
  const read = (pending: unknown) => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        conversation: { id: "conversation-1", title: "" },
        pending_confirmation: pending,
      }),
    );
    return client.getConversation("conversation-1");
  };

  it("reads it with the types of its arguments", async () => {
    expect(await read({ ...confirmation, argument_types: { yaml: "application/yaml" } })).toEqual({
      conversation: { id: "conversation-1", title: "" },
      confirmation: { ...parsed, argumentTypes: { yaml: "application/yaml" }, editable: false },
    });
    expect((await read(confirmation)).confirmation?.argumentTypes).toEqual({});
    // An editable call carries the input schema of its tool.
    const inputSchema = { type: "object", properties: { service: { type: "string" } } };
    expect(
      (await read({ ...confirmation, editable: true, input_schema: inputSchema })).confirmation,
    ).toMatchObject({ editable: true, inputSchema });
    fetchMock.mockResolvedValueOnce(Response.json({ conversation: { id: "conversation-1" } }));
    expect(await client.getConversation("conversation-1")).toEqual({
      conversation: { id: "conversation-1", title: "" },
      confirmation: null,
    });
  });

  it.each([
    { ...confirmation, id: "bad id" },
    { ...confirmation, tool: { ...confirmation.tool, destructive: "yes" } },
    { ...confirmation, arguments: ["prod/svc/web"] },
    { ...confirmation, expires_at: "tomorrow" },
    { ...confirmation, argument_types: ["yaml"] },
    { ...confirmation, argument_types: { yaml: 42 } },
    { ...confirmation, argument_types: { yaml: "application/yaml\n" } },
    { ...confirmation, editable: "yes" },
    { ...confirmation, editable: true },
    { ...confirmation, editable: true, input_schema: { type: "string" } },
    {
      ...confirmation,
      editable: true,
      input_schema: { type: "object", description: "x".repeat(64 * 1024) },
    },
    {
      ...confirmation,
      argument_types: Object.fromEntries(
        Array.from({ length: 33 }, (_, index) => [`a${String(index)}`, "text/plain"]),
      ),
    },
  ])("refuses a malformed confirmation %#", async (pending) => {
    await expect(read(pending)).rejects.toMatchObject({ code: "invalid_response" });
  });
});
