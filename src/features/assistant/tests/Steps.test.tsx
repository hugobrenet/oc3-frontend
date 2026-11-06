import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import en from "@/i18n/locales/en.json";
import fr from "@/i18n/locales/fr.json";
import { AGENT_TOOLS, type Step } from "../assistant-client";
import { formatDuration, stepSentence } from "../steps";
import i18n from "@/i18n";
import { GOLDEN_RUN, GOLDEN_THREAD, replayEvents } from "./agui-fixtures";
import { aborted, fakeClient, started, stored, toolStart, type FakeClient } from "./fake-client";
import { renderAssistant, stubCollector } from "./render";

const T0 = 1_000_000;
const T1 = 9_000_000;
const run = { threadId: GOLDEN_THREAD, runId: GOLDEN_RUN };
const call = (id: string, name: string, args: unknown, at: number, parent = "turn-s:2") => [
  {
    type: "TOOL_CALL_START",
    toolCallId: id,
    toolCallName: name,
    parentMessageId: parent,
    timestamp: at,
  },
  { type: "TOOL_CALL_ARGS", toolCallId: id, delta: JSON.stringify(args), timestamp: at },
  { type: "TOOL_CALL_END", toolCallId: id, timestamp: at },
];
const result = (id: string, payload: unknown, at: number) => ({
  type: "TOOL_CALL_RESULT",
  messageId: `${id}-result`,
  toolCallId: id,
  role: "tool",
  content: JSON.stringify(payload),
  timestamp: at,
});
const text = (id: string, delta: string, at: number) => [
  { type: "TEXT_MESSAGE_START", messageId: id, role: "assistant", timestamp: at },
  { type: "TEXT_MESSAGE_CONTENT", messageId: id, delta, timestamp: at },
  { type: "TEXT_MESSAGE_END", messageId: id, timestamp: at },
];
const big = "x".repeat(5000);

// A turn as the agent streams it, on its clock: a search, two reads that
// overlap, a refusal of the MCP, a refusal of an older agent without isError, a
// large result, then an action the user rejects in a second run.
const firstRun = [
  { type: "RUN_STARTED", ...run, timestamp: T0 },
  ...call("call-0", "search_tools", { query: "verrous" }, T0 + 100),
  result("call-0", { content: [{ type: "text", text: "list_tags" }] }, T0 + 150),
  ...call("call-1", "get_service", { service: "test/svc/web" }, T0 + 400),
  ...call("call-2", "get_node", { node: "dev5n9" }, T0 + 410),
  result("call-1", { content: [], structuredContent: { avail: "up" } }, T0 + 700),
  result("call-2", { content: [], structuredContent: { state: "up" } }, T0 + 800),
  ...call("call-3", "get_service_instance", { service: "test/svc/web", node: "dev5n1" }, T0 + 1000),
  result(
    "call-3",
    {
      content: [{ type: "text", text: "instance test/svc/web on dev5n1: not found" }],
      isError: true,
    },
    T0 + 1100,
  ),
  ...call("call-4", "list_tags", {}, T0 + 1200),
  result("call-4", { content: [{ type: "text", text: "refused by an older agent" }] }, T0 + 1300),
  ...call("call-5", "list_nodes", {}, T0 + 1400),
  result("call-5", { content: [], structuredContent: { note: big } }, T0 + 1500),
  ...text("turn-s:2", "I will delete `test/svc/web`, not `test/svc/ghost`.", T0 + 1800),
  ...call("call-6", "delete_service", { service: "test/svc/web", node: "dev5n1" }, T0 + 2000),
  {
    type: "RUN_FINISHED",
    ...run,
    timestamp: T0 + 2500,
    outcome: {
      type: "interrupt",
      interrupts: [
        {
          id: "confirmation-s",
          reason: "tool_call",
          toolCallId: "call-6",
          message: "Confirm",
          responseSchema: {
            type: "object",
            properties: { approved: { type: "boolean" } },
            required: ["approved"],
          },
          expiresAt: "2099-10-26T17:45:00Z",
          metadata: {
            turnId: "turn-s",
            tool: { name: "delete_service", title: "Delete service", destructive: true },
            editable: false,
          },
        },
      ],
    },
  },
];
const secondRun = [
  { type: "RUN_STARTED", ...run, timestamp: T1 },
  result(
    "call-6",
    { rejected: true, message: "the user rejected this action; it did not run" },
    T1 + 10,
  ),
  ...text("turn-s:4", "Not deleted.", T1 + 300),
  {
    type: "RUN_FINISHED",
    ...run,
    timestamp: T1 + 500,
    outcome: { type: "success" },
    result: { turnId: "turn-s" },
  },
];

// The records the collector holds, which the badges open.
const collector = {
  nodes: [{ node_id: "node-1", nodename: "dev5n1" }],
  services: [{ svc_id: "svc-1", svcname: "test/svc/web" }],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the steps of an answer", () => {
  let client: FakeClient;
  beforeEach(() => {
    stubCollector(collector);
    client = fakeClient([]);
    client.createConversation.mockResolvedValue({ id: "new", title: "" });
  });
  const ask = async (prompt: string) => {
    const view = await renderAssistant(client);
    fireEvent.change(screen.getByRole("textbox", { name: "Message to the assistant" }), {
      target: { value: prompt },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    return view;
  };
  const answer = () => screen.getByText("Not deleted.").closest("li")!;
  const step = (sentence: string) =>
    within(answer()).getByRole("button", { name: sentence }).closest("li")!;

  test.each([
    ["stream", undefined, "search_docs", "Search the documentation"],
    ["stream", false, "search_docs", "Search the documentation"],
    ["stream", true, "search_docs", "Search the documentation"],
    ["snapshot", undefined, "search_docs", "Search the documentation"],
    ["snapshot", false, "search_docs", "Search the documentation"],
    ["snapshot", true, "search_docs", "Search the documentation"],
    ["stream", undefined, "search_code", "Search the code"],
    ["snapshot", true, "search_code", "Search the code"],
  ])(
    "shows the status of a search of the agent from a %s with isError=%s: %s",
    async (delivery, isError, tool, label) => {
      const payload = {
        content: [
          {
            type: "text",
            text:
              isError === true
                ? "Documentation unavailable."
                : "Frozen nodes do not evaluate quorum.",
          },
        ],
        ...(isError === undefined ? {} : { isError }),
      };
      const answerText = "Documentation checked.";
      const events =
        delivery === "stream"
          ? [
              ...call("docs-1", tool, { query: "frozen quorum" }, T0 + 100),
              result("docs-1", payload, T0 + 150),
              ...text("turn-s:2", answerText, T0 + 200),
            ]
          : [
              {
                type: "MESSAGES_SNAPSHOT",
                messages: [
                  { id: "turn-s:1", role: "user", content: "Does a frozen node evaluate quorum?" },
                  {
                    id: "turn-s:2",
                    role: "assistant",
                    content: "",
                    toolCalls: [
                      {
                        id: "docs-1",
                        type: "function",
                        function: { name: tool, arguments: '{"query":"frozen quorum"}' },
                      },
                    ],
                  },
                  {
                    id: "docs-1-result",
                    role: "tool",
                    toolCallId: "docs-1",
                    content: JSON.stringify(payload),
                  },
                  { id: "turn-s:4", role: "assistant", content: answerText },
                ],
              },
            ];
      client.run.mockImplementationOnce(
        replayEvents([
          { type: "RUN_STARTED", ...run, timestamp: T0 },
          ...events,
          {
            type: "RUN_FINISHED",
            ...run,
            timestamp: T0 + 300,
            outcome: { type: "success" },
            result: { turnId: "turn-s" },
          },
        ]),
      );
      await ask("Does a frozen node evaluate quorum?");
      const message = (await screen.findByText(answerText)).closest("li")!;
      fireEvent.click(within(message).getByRole("button", { name: /^1 step · / }));
      const list = within(message).getByRole("list", { name: "Steps of the answer" });
      const toggle = within(list).getByRole("button", { expanded: false });
      expect(toggle).toHaveTextContent(`${label}: “frozen quorum”`);
      const search = toggle.closest("li")!;
      const mark = within(search).getByText(isError === true ? "refused by the tool" : "done");
      expect(mark.parentElement).toHaveClass(
        isError === true ? "text-state-down" : "text-state-up",
      );
      fireEvent.click(toggle);
      if (isError === true)
        expect(within(search).getByText("Refused by the tool:")).toBeInTheDocument();
      else expect(within(search).queryByText("Refused by the tool:")).not.toBeInTheDocument();
      expect(within(search).getByText(/"content"/)).toHaveTextContent(payload.content[0]!.text);
    },
  );

  test("tells each step of the turn, in order, with the times of the agent", async () => {
    client.run
      .mockImplementationOnce(replayEvents(firstRun))
      .mockImplementationOnce(replayEvents(secondRun));
    await ask("Delete web on dev5n1");
    const card = await screen.findByRole("region", { name: "Action waiting for confirmation" });
    await waitFor(() => {
      expect(within(card).getByRole("button", { name: "Reject" })).toBeEnabled();
    });
    fireEvent.click(within(card).getByRole("button", { name: "Reject" }));
    await screen.findByText("Not deleted.");

    // Folded: the steps and the duration of the runs, the wait for the decision left out.
    const summary = within(answer()).getByRole("button", { name: "7 steps · 3 s" });
    expect(summary).toHaveAttribute("aria-expanded", "false");
    expect(
      within(answer()).getByText("3 s · 7 steps · 1 action rejected by you"),
    ).toBeInTheDocument();
    fireEvent.click(summary);
    const list = within(answer()).getByRole("list", { name: "Steps of the answer" });
    expect(
      within(list)
        .getAllByRole("button", { expanded: false })
        .map((button) => button.textContent),
    ).toEqual([
      "Search the tools: “verrous”",
      "Get service",
      "Get node",
      "Get service instance",
      "List tags",
      "List nodes",
      "Delete service",
    ]);
    // The time of the model between steps, the reads that overlap said so.
    expect(
      within(list)
        .getAllByText(/^model /)
        .map((line) => line.textContent),
    ).toEqual(["model 100 ms", "model 250 ms", "model 200 ms", "model 100 ms", "model 100 ms"]);
    expect(step("Get service")).toHaveTextContent(/done.*300 ms/);
    expect(step("Get node")).toHaveTextContent(/in parallel.*390 ms/);
    // A refusal of the MCP, by isError; one of an older agent, by its missing structured content.
    expect(step("Get service instance")).toHaveTextContent("refused by the tool");
    expect(step("List tags")).toHaveTextContent("refused by the tool");
    // The tools of the agent are steps too, greyed.
    expect(step("Search the tools: “verrous”")).toHaveClass("text-ink-muted");
    // The action the user rejected did not run: no duration; a read of a few
    // milliseconds says them, not 0 s.
    expect(step("Delete service")).toHaveTextContent("rejected by you");
    expect(step("Delete service")).not.toHaveTextContent(/\d ms|\d s/);
    expect(step("Search the tools: “verrous”")).toHaveTextContent(/50 ms/);

    // Badges for what the collector holds; a node it does not hold stays text.
    await waitFor(() => {
      expect(
        within(step("Get service")).getByRole("button", { name: "test/svc/web" }),
      ).toBeInTheDocument();
    });
    expect(
      within(step("Get node")).queryByRole("button", { name: "dev5n9" }),
    ).not.toBeInTheDocument();
    expect(within(step("Get node")).getByText("dev5n9")).toHaveProperty("tagName", "CODE");
    expect(
      within(step("Get service instance")).getByRole("button", { name: "dev5n1" }),
    ).toHaveAttribute("title", "Show this node");
    // In the text, a service the collector holds is a badge, another stays code.
    const first = screen.getByText(/I will delete/).closest("p")!;
    expect(within(first).getByRole("button", { name: "test/svc/web" })).toBeInTheDocument();
    expect(within(first).getByText("test/svc/ghost")).toHaveProperty("tagName", "CODE");

    // The details: the refusal whole, before the excerpt.
    fireEvent.click(within(list).getByRole("button", { name: "Get service instance" }));
    const refused = step("Get service instance");
    const refusal = within(refused).getByText("instance test/svc/web on dev5n1: not found");
    const excerpt = within(refused).getByText(/"isError":true/);
    expect(
      refusal.compareDocumentPosition(excerpt) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(refused).getByLabelText("Arguments")).toHaveTextContent('"node": "dev5n1"');
    // An excerpt is bounded at reading, said so.
    fireEvent.click(within(list).getByRole("button", { name: "List nodes" }));
    const bounded = step("List nodes");
    expect(within(bounded).getByText("Result, its first 4 KB:")).toBeInTheDocument();
    expect(within(bounded).getByText(/xxxx/).textContent).toHaveLength(4096);
  });

  test("counts the time of a running turn live, and tells an interrupted step", async () => {
    client.run.mockImplementation(
      (_id, _input, options) =>
        new Promise((_resolve, reject) => {
          options?.onEvent?.(started(T0));
          options?.onEvent?.(
            toolStart("call-1", "list_nodes", { parentMessageId: "turn-s:2", at: T0 + 10 }),
          );
          options?.signal?.addEventListener(
            "abort",
            () => {
              reject(aborted());
            },
            { once: true },
          );
        }),
    );
    await ask("How is the estate?");
    const live = await screen.findByRole("button", { name: /^Running · 00:0\d$/ });
    // The step running, under the folded summary.
    expect(screen.getAllByText("List nodes")[0]).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await screen.findByText(/Incomplete answer, stopped/);
    expect(live).not.toHaveTextContent(/Running/);
    fireEvent.click(screen.getByRole("button", { name: /^1 step · / }));
    expect(screen.getByRole("button", { name: "List nodes" }).closest("li")).toHaveTextContent(
      "interrupted",
    );
  });
});

describe("the steps of a thread given again", () => {
  let client: FakeClient;
  beforeEach(() => {
    stubCollector(collector);
    client = fakeClient([]);
    client.createConversation.mockResolvedValue({ id: "new", title: "" });
  });
  const ask = async (prompt: string) => {
    await renderAssistant(client);
    fireEvent.change(screen.getByRole("textbox", { name: "Message to the assistant" }), {
      target: { value: prompt },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
  };

  test("tells a result the compaction of the history cut as done, not refused", async () => {
    client.run.mockImplementationOnce(
      replayEvents([
        { type: "RUN_STARTED", ...run, timestamp: T0 },
        {
          type: "MESSAGES_SNAPSHOT",
          messages: [
            { id: "u-1", role: "user", content: "How many nodes?" },
            {
              id: "turn-1:2",
              role: "assistant",
              content: "",
              toolCalls: [
                {
                  id: "call-1",
                  type: "function",
                  function: { name: "list_nodes", arguments: "{}" },
                },
              ],
            },
            {
              id: "call-1-result",
              role: "tool",
              toolCallId: "call-1",
              content: JSON.stringify({
                content: [],
                _history_compaction: { omitted: ["structuredContent"] },
              }),
            },
            { id: "turn-1:4", role: "assistant", content: "Two nodes." },
            { id: "u-2", role: "user", content: "And now?" },
          ],
        },
        ...text("turn-2:2", "Still two.", T0 + 100),
        {
          type: "RUN_FINISHED",
          ...run,
          timestamp: T0 + 200,
          outcome: { type: "success" },
          result: { turnId: "turn-2" },
        },
      ]),
    );
    await ask("And now?");
    const earlier = (await screen.findByText("Two nodes.")).closest("li")!;
    fireEvent.click(within(earlier).getByRole("button", { name: /^1 step · / }));
    const read = within(earlier).getByRole("button", { name: "List nodes" }).closest("li");
    expect(read).toHaveTextContent("done");
    expect(read).not.toHaveTextContent("Refused by the tool");
  });

  test("shows the answer waits for the agent before the run starts", async () => {
    client.run.mockImplementation(() => new Promise(() => undefined));
    await ask("Hello");
    expect(await screen.findByText("Waiting for the agent…")).toBeInTheDocument();
  });
});

describe("the steps of a conversation reloaded", () => {
  const existing = { id: "existing", title: "Delete web" };
  const prompt = stored("turn-s:1", "user", "Delete web on dev5n1", {
    createdAt: "2026-10-26T10:00:00Z",
  });
  const first = stored("turn-s:2", "assistant", "I will delete `test/svc/web`.", {
    createdAt: "2026-10-26T10:00:02Z",
  });
  const step = (
    id: string,
    tool: string,
    args: Record<string, unknown> | null,
    startedAt: number | null,
    endedAt: number | null,
    fields: Partial<Step> = {},
  ): Step => ({
    id,
    tool,
    arguments: args,
    startedAt,
    endedAt,
    status: "completed",
    resultExcerpt: '{"content":[],"structuredContent":{}}',
    resultTruncated: false,
    refusal: "",
    ...fields,
  });
  const last = stored("turn-s:4", "assistant", "Not deleted.", {
    createdAt: "2026-10-26T10:00:09Z",
    feedback: { rating: "up", reasons: [], expected: "" },
    history: {
      steps: [
        step("call-1", "get_service", { service: "test/svc/web" }, T0 + 400, T0 + 700),
        step("call-2", "get_node", { node: "dev5n9" }, T0 + 410, T0 + 800),
        step(
          "call-3",
          "get_service_instance",
          { service: "test/svc/web", node: "dev5n1" },
          T0 + 1000,
          T0 + 1100,
          { status: "failed", refusal: "instance not found" },
        ),
        step("call-6", "delete_service", { service: "test/svc/web", node: "dev5n1" }, T1, null, {
          status: "rejected",
        }),
      ],
      stepsOmitted: 0,
      runs: [
        { startedAt: T0, endedAt: T0 + 2500 },
        { startedAt: T1, endedAt: T1 + 500 },
      ],
      usage: { totalTokens: 370 },
    },
  });
  let client: FakeClient;
  beforeEach(() => {
    stubCollector(collector);
    client = fakeClient([existing]);
    client.run.mockImplementation(
      replayEvents([
        { type: "RUN_STARTED", ...run, timestamp: T1 + 9000 },
        ...text("turn-t:2", "Done.", T1 + 9100),
        {
          type: "RUN_FINISHED",
          ...run,
          timestamp: T1 + 9200,
          outcome: { type: "success" },
          result: { turnId: "turn-t" },
        },
      ]),
    );
  });
  const reload = async (messages: ReturnType<typeof stored>[]) => {
    client.getMessages.mockResolvedValue({ messages, nextCursor: "" });
    await renderAssistant(client);
    fireEvent.click(screen.getByRole("button", { name: "Delete web" }));
    await screen.findByText("Not deleted.");
  };

  test("shows the steps of a turn as the stream showed them, one answer for the turn", async () => {
    await reload([prompt, first, last]);
    // The two answers of the turn are one message, its feedback on it.
    const answer = screen.getByText("Not deleted.").closest("li")!;
    expect(within(answer).getByText(/I will delete/)).toBeInTheDocument();
    expect(within(answer).getByRole("button", { name: "Helpful" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      within(answer).getByText("3 s · 4 steps · Tokens: 370 · 1 action rejected by you"),
    ).toBeInTheDocument();
    fireEvent.click(within(answer).getByRole("button", { name: "4 steps · 3 s" }));
    const list = within(answer).getByRole("list", { name: "Steps of the answer" });
    const row = (sentence: string) =>
      within(list).getByRole("button", { name: sentence }).closest("li");
    expect(row("Get service")).toHaveTextContent(/done.*300 ms/);
    expect(row("Get node")).toHaveTextContent(/in parallel.*390 ms/);
    expect(row("Get service instance")).toHaveTextContent("refused by the tool");
    expect(row("Delete service")).toHaveTextContent("rejected by you");
    expect(
      within(list)
        .getAllByText(/^model /)
        .map((line) => line.textContent),
    ).toEqual(["model 400 ms", "model 200 ms"]);
    // In phase: the next run sends the IDs of both answers, the agent needs no snapshot.
    fireEvent.change(screen.getByRole("textbox", { name: "Message to the assistant" }), {
      target: { value: "And now?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(client.run).toHaveBeenCalledTimes(1);
    });
    expect(client.run.mock.calls[0]?.[1].held?.map((message) => message.id)).toEqual([
      "turn-s:1",
      "turn-s:2",
      "turn-s:4",
    ]);
  });

  test("keeps the order served of a turn stored without times, with no duration", async () => {
    await reload([
      prompt,
      {
        ...last,
        history: {
          steps: [
            step("call-b", "get_node", { node: "dev5n1" }, null, null),
            step("call-a", "get_service", { service: "test/svc/web" }, null, null),
          ],
          stepsOmitted: 0,
          runs: [],
          usage: null,
        },
      },
    ]);
    const answer = screen.getByText("Not deleted.").closest("li")!;
    fireEvent.click(within(answer).getByRole("button", { name: /^2 steps · / }));
    const list = within(answer).getByRole("list", { name: "Steps of the answer" });
    expect(
      within(list)
        .getAllByRole("button", { expanded: false })
        .map((button) => button.textContent),
    ).toEqual(["Get node", "Get service"]);
    expect(within(list).queryByText(/^model /)).toBeNull();
    expect(list).not.toHaveTextContent(/\d ms|\d s\b/);
  });

  test("says the arguments the agent left out of the history", async () => {
    await reload([
      prompt,
      {
        ...last,
        history: {
          steps: [
            step("call-1", "update_form", null, T0 + 400, T0 + 700, { argumentsOmitted: true }),
          ],
          stepsOmitted: 0,
          runs: [],
          usage: null,
        },
      },
    ]);
    const answer = screen.getByText("Not deleted.").closest("li")!;
    fireEvent.click(within(answer).getByRole("button", { name: /^1 step · / }));
    const list = within(answer).getByRole("list", { name: "Steps of the answer" });
    fireEvent.click(within(list).getByRole("button", { expanded: false }));
    expect(
      within(list).getByText("Arguments too large to be kept in the history."),
    ).toBeInTheDocument();
    expect(within(list).queryByLabelText("Arguments")).toBeNull();
  });
});

describe("formatDuration", () => {
  test.each([
    [4, "en", "4 ms"],
    [400, "en", "400 ms"],
    [1240, "en", "1.2 s"],
    [12345, "en", "12 s"],
    [65000, "en", "1 min 05 s"],
    [2500, "fr", "2,5 s"],
  ])("%i ms in %s is %s", (ms, language, expected) => {
    expect(formatDuration(ms, language)).toBe(expected);
  });
});

describe("the sentences of the steps", () => {
  // The tools of the agent itself, with the arguments they always take: the
  // other tools are said by their name, made readable.
  const ARGUMENTS: Record<string, string[]> = {
    search_tools: ["query"],
    search_docs: ["query"],
    search_code: ["query"],
    read_resource: ["uri"],
    load_skill: ["skill"],
  };
  const params = (template: string) =>
    [...template.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort();
  const english: Record<string, string> = en.assistant.steps.tool;
  const french: Record<string, string> = fr.assistant.steps.tool;

  test.each(Object.entries(english))(
    "the step of %s names arguments the tool always takes",
    (tool, template) => {
      expect(AGENT_TOOLS.has(tool)).toBe(true);
      for (const param of params(template)) expect(ARGUMENTS[tool]).toContain(param);
    },
  );

  test("says the same in English and in French", () => {
    expect(Object.keys(french).sort()).toEqual(Object.keys(english).sort());
    for (const key of Object.keys(english))
      expect(params(french[key] ?? "")).toEqual(params(english[key] ?? ""));
  });

  test("puts the arguments as text, and falls back to the name when one is missing", () => {
    const step = (tool: string, args: Record<string, unknown> | null): Step => ({
      id: "call-1",
      tool,
      arguments: args,
      startedAt: null,
      endedAt: null,
      status: "completed",
      resultExcerpt: "",
      resultTruncated: false,
      refusal: "",
    });
    expect(
      stepSentence(step("search_docs", { query: "{{uri}} $t(assistant.title)" }), i18n.t, i18n),
    ).toBe("Search the documentation: “{{uri}} $t(assistant.title)”");
    expect(stepSentence(step("search_docs", {}), i18n.t, i18n)).toBe("Search docs");
    expect(stepSentence(step("list_service_actions", null), i18n.t, i18n)).toBe(
      "List service actions",
    );
  });
});
