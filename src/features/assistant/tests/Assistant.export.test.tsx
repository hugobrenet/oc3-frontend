import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AssistantError, type MessagePage, type RunResult } from "../assistant-client";
import { completed, fakeClient, started, stored, type FakeClient } from "./fake-client";
import { renderAssistant, stubCollector } from "./render";

const existing = { id: "existing", title: "Previous diagnostic" };

// The history by pages, the most recent first: the transcript shows the last
// one, the export reads them all.
const PAGES: Record<string, MessagePage> = {
  "": {
    messages: [
      stored("turn-2:1", "user", "Per OS?"),
      stored("turn-2:2", "assistant", "Linux mostly.", { modelId: "haiku" }),
    ],
    nextCursor: "1:1",
  },
  "1:1": {
    messages: [
      stored("turn-1:1", "user", "How many nodes?"),
      stored("turn-1:2", "assistant", "There are 484 nodes."),
    ],
    nextCursor: "",
  },
};

/** The text of a blob, which jsdom reads with a FileReader only. */
const textOf = (blob: Blob) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(String(reader.result));
    };
    reader.readAsText(blob);
  });

describe("the export of a conversation of the assistant", () => {
  let client: FakeClient;
  let saved: { name: string; blob: Blob | null }[];
  beforeEach(() => {
    stubCollector();
    client = fakeClient([existing]);
    client.getMessages.mockImplementation((_id, options) =>
      Promise.resolve(PAGES[options?.before ?? ""] ?? { messages: [], nextCursor: "" }),
    );
    saved = [];
    let blob: Blob | null = null;
    URL.createObjectURL = vi.fn((object: Blob | MediaSource) => {
      blob = object as Blob;
      return "blob:export";
    });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      saved.push({ name: this.download, blob });
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const resume = async () => {
    await renderAssistant(client);
    fireEvent.click(screen.getByRole("button", { name: "Previous diagnostic" }));
    await screen.findByText("Linux mostly.");
  };
  const menuButton = () => screen.getByRole("button", { name: "Export the conversation" });
  // Pressing the menu reads the history and makes the print ready; then its entry.
  const openMenu = () => {
    fireEvent.pointerDown(menuButton());
    fireEvent.click(menuButton());
  };
  const exportAs = async (format: "md" | "pdf") => {
    fireEvent.click(menuButton());
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: format === "pdf" ? /in PDF/ : /in Markdown/,
      }),
    );
  };
  const frame = () => document.querySelector<HTMLIFrameElement>('iframe[aria-hidden="true"]');
  const frameReady = async () => {
    await waitFor(() => {
      expect(frame()?.contentDocument?.querySelector(".assistant-print")).toBeTruthy();
    });
    return frame()!;
  };

  test("saves the whole conversation as Markdown, the messages not loaded too", async () => {
    await resume();
    expect(screen.queryByText("There are 484 nodes.")).toBeNull();
    await exportAs("md");
    await waitFor(() => {
      expect(saved).toHaveLength(1);
    });
    expect(client.getMessages).toHaveBeenLastCalledWith(
      "existing",
      expect.objectContaining({ before: "1:1" }),
    );
    const file = saved[0]!;
    expect(file.name).toMatch(/^previous-diagnostic-\d{4}-\d\d-\d\d\.md$/);
    expect(file.blob?.type).toBe("text/markdown;charset=utf-8");
    const text = await textOf(file.blob!);
    expect(text.startsWith(`# Previous diagnostic\n\nCollector: ${window.location.host}`)).toBe(
      true,
    );
    expect(text.indexOf("How many nodes?")).toBeLessThan(text.indexOf("There are 484 nodes."));
    expect(text.indexOf("There are 484 nodes.")).toBeLessThan(text.indexOf("Per OS?"));
    expect(text).toContain("> Linux mostly.\n\n_Model: haiku_\n");
    expect(screen.getByText("The conversation is exported.")).toHaveAttribute("role", "status");
  });

  test("is offered for a conversation holding messages only, not while a turn runs", async () => {
    let finish: (result: RunResult) => void = () => undefined;
    client.run.mockImplementation(
      (_id, _input, options) =>
        new Promise<RunResult>((resolve) => {
          options?.onEvent?.(started());
          finish = resolve;
        }),
    );
    await renderAssistant(client);
    // A new conversation, none created yet: nothing to export.
    expect(screen.queryByRole("button", { name: "Export the conversation" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Previous diagnostic" }));
    await screen.findByText("Linux mostly.");
    fireEvent.change(screen.getByRole("textbox", { name: "Message to the assistant" }), {
      target: { value: "And per version?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(menuButton()).toBeDisabled();
    });
    await act(async () => {
      finish(completed());
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(menuButton()).toBeEnabled();
    });
  });

  test("tells why an export failed, in the words of the page, and lets it be tried again", async () => {
    await resume();
    client.getMessages.mockRejectedValueOnce(new AssistantError("assistant_unreachable", 503));
    await exportAs("md");
    expect(await screen.findByRole("alert")).toHaveTextContent(/./);
    expect(saved).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
    await exportAs("md");
    await waitFor(() => {
      expect(saved).toHaveLength(1);
    });
  });

  test("tells a conversation too long, and one holding no stored turn, without saving", async () => {
    await resume();
    client.getMessages.mockImplementation(() =>
      Promise.resolve({ messages: [stored("turn-1:1", "user", "Again")], nextCursor: "1:1" }),
    );
    await exportAs("md");
    expect(
      await screen.findByText(/The conversation is too long to be exported\./),
    ).toBeInTheDocument();
    client.getMessages.mockImplementation(() => Promise.resolve({ messages: [], nextCursor: "" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await exportAs("md");
    expect(
      await screen.findByText("Nothing to export: no turn of this conversation is stored."),
    ).toBeInTheDocument();
    expect(saved).toHaveLength(0);
  });

  test("prints the whole conversation within the click, made ready as the menu opens, the page as it is", async () => {
    document.documentElement.classList.add("dark");
    document.title = "OpenSVC";
    try {
      client.getMessages.mockImplementation((_id, options) =>
        Promise.resolve(
          options?.before
            ? {
                messages: [
                  stored("turn-1:1", "user", "How many nodes?\n<b>bold</b>"),
                  stored(
                    "turn-1:2",
                    "assistant",
                    "There are **484** nodes. <img src=https://attacker.example> ![x](https://attacker.example/i.png)",
                    {
                      history: {
                        steps: [
                          {
                            id: "c1",
                            tool: "load_skill",
                            arguments: { skill: "morning-check" },
                            startedAt: null,
                            endedAt: null,
                            status: "failed",
                            resultExcerpt: "",
                            resultTruncated: false,
                            refusal: "",
                          },
                        ],
                        stepsOmitted: 0,
                        runs: [{ startedAt: 1, endedAt: 3001 }],
                        usage: null,
                      },
                    },
                  ),
                ],
                nextCursor: "",
              }
            : (PAGES[""] as MessagePage),
        ),
      );
      await resume();
      openMenu();
      const ready = await frameReady();
      const print = vi.spyOn(ready.contentWindow!, "print").mockImplementation(() => undefined);
      fireEvent.click(await screen.findByRole("menuitem", { name: /in PDF/ }));
      // At once, within the click, without reading the history again.
      expect(print).toHaveBeenCalledTimes(1);
      expect(client.getMessages).toHaveBeenCalledTimes(3);
      const sheet = ready.contentDocument!;
      expect(sheet.documentElement).not.toHaveClass("dark");
      expect(sheet.title).toMatch(/^previous-diagnostic-\d{4}-\d\d-\d\d$/);
      const text = sheet.body.textContent ?? "";
      expect(text).toContain("Previous diagnostic");
      expect(text.indexOf("How many nodes?")).toBeLessThan(text.indexOf("Per OS?"));
      // The prompt as text, the answer through the renderer of the transcript.
      expect(text).toContain("<b>bold</b>");
      expect(sheet.body.querySelector("strong")?.textContent).toBe("484");
      // Nothing loads: no image, the html as text; a link of the web is a link,
      // as in the transcript, its address written on paper.
      expect([...sheet.body.querySelectorAll("img, [src]")]).toEqual([]);
      expect(text).toContain("<img src=https://attacker.example>");
      expect(text).toContain("Load the procedure “morning-check” (refused by the tool)");
      expect(text).toContain("Model: haiku");
      // The page is left as it is.
      expect(document.documentElement).toHaveClass("dark");
      expect(document.title).toBe("OpenSVC");
      expect(saved).toHaveLength(0);
    } finally {
      document.documentElement.classList.remove("dark");
    }
  });

  test("offers the print once ready, to a click before the history was read", async () => {
    await resume();
    let release: () => void = () => undefined;
    client.getMessages.mockImplementationOnce(
      (_id, options) =>
        new Promise<MessagePage>((resolve, reject) => {
          release = () => {
            resolve(PAGES["1:1"] as MessagePage);
          };
          options?.signal?.addEventListener(
            "abort",
            () => {
              reject(new DOMException("Canceled", "AbortError"));
            },
            { once: true },
          );
        }),
    );
    openMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: /in PDF/ }));
    await act(async () => {
      release();
      await Promise.resolve();
    });
    const ready = await frameReady();
    const print = vi.spyOn(ready.contentWindow!, "print").mockImplementation(() => undefined);
    expect(print).not.toHaveBeenCalled();
    // Told by the region always there, and shown.
    await waitFor(() => {
      expect(screen.getAllByText("The conversation is ready to be saved as a PDF.")).toHaveLength(
        2,
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "Open the print dialog" }));
    expect(print).toHaveBeenCalledTimes(1);
    expect(screen.queryAllByText("The conversation is ready to be saved as a PDF.")).toHaveLength(
      0,
    );
  });

  test("tells a browser that cannot print", async () => {
    await resume();
    openMenu();
    const ready = await frameReady();
    vi.spyOn(ready.contentWindow!, "print").mockImplementation(() => {
      throw new Error("Not implemented: window.print");
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: /in PDF/ }));
    expect(
      await screen.findByText(/The browser could not open its print dialog/),
    ).toBeInTheDocument();
  });

  test("names the file after the title the conversation has at the export, renamed meanwhile", async () => {
    client.renameConversation.mockResolvedValue({ id: "existing", title: "Renamed diagnostic" });
    await resume();
    openMenu();
    await frameReady();
    // Closed again, by its button.
    fireEvent.click(menuButton());
    fireEvent.click(screen.getByRole("button", { name: "Rename the conversation" }));
    const field = screen.getByRole("textbox", { name: "Conversation title" });
    fireEvent.change(field, { target: { value: "Renamed diagnostic" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await screen.findByRole("heading", { name: "Renamed diagnostic" });
    await exportAs("md");
    await waitFor(() => {
      expect(saved).toHaveLength(1);
    });
    expect(saved[0]?.name).toMatch(/^renamed-diagnostic-/);
    expect(await textOf(saved[0]!.blob!)).toMatch(/^# Renamed diagnostic\n/);
  });

  test("reads the history once for a transcript that did not change", async () => {
    await resume();
    openMenu();
    await frameReady();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(client.getMessages).toHaveBeenCalledTimes(3);
    fireEvent.pointerDown(menuButton());
    expect(client.getMessages).toHaveBeenCalledTimes(3);
  });
});
