import { useState } from "react";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Assistant } from "../Assistant";
import { AssistantActivityBadge } from "../AssistantActivityBadge";
import { AssistantChatProvider } from "../assistant-chat-context";
import type { RunResult } from "../assistant-client";
import { completed, fakeClient, started, text } from "./fake-client";
import { renderWithProviders, stubCollector } from "./render";

/**
 * The application as far as the assistant goes: its chat held above the pages,
 * the menu badge, and a switch between the page of the assistant and another.
 */
function App({ client }: { client: ReturnType<typeof fakeClient> }) {
  const [onPage, setOnPage] = useState(true);
  const [identity, setIdentity] = useState("alice");
  const [prompt, setPrompt] = useState<string | undefined>(undefined);
  return (
    <AssistantChatProvider client={client} identity={identity}>
      <nav aria-label="menu">
        <AssistantActivityBadge />
        {/* Some state of another part of the application, outside of the URL. */}
        <input aria-label="menu filter" />
      </nav>
      <button
        type="button"
        onClick={() => {
          setOnPage(!onPage);
        }}
      >
        {onPage ? "leave" : "come back"}
      </button>
      <button
        type="button"
        onClick={() => {
          setPrompt("Analyze the alert on dev2n2.");
          setOnPage(true);
        }}
      >
        ask from another page
      </button>
      <button
        type="button"
        onClick={() => {
          setIdentity("bob");
        }}
      >
        become bob
      </button>
      {onPage ? (
        <Assistant key={identity} client={client} initialPrompt={prompt} />
      ) : (
        <p>another page</p>
      )}
    </AssistantChatProvider>
  );
}

const box = () => screen.getByRole("textbox", { name: "Message to the assistant" });

describe("a turn of the assistant while the user is on another page", () => {
  let finish: (result: RunResult) => void;
  let client: ReturnType<typeof fakeClient>;

  beforeEach(() => {
    stubCollector();
    client = fakeClient();
    // A run that answers when the test says so; its signal tells whether the page
    // stopped it.
    client.run.mockImplementation(
      (_id, _input, options) =>
        new Promise<RunResult>((resolve) => {
          options?.onEvent?.(started());
          finish = (result) => {
            for (const event of text("The node is healthy.")) options?.onEvent?.(event);
            resolve(result);
          };
        }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("goes on, its answer found when the user comes back, unread meanwhile", async () => {
    renderWithProviders(<App client={client} />);
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "New conversation" })[0]).toBeEnabled();
    });
    fireEvent.change(box(), { target: { value: "Review the node dev2n1." } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(client.run).toHaveBeenCalledOnce();
    });
    const signal = client.run.mock.calls[0]?.[2]?.signal;

    // The user leaves: the turn goes on, the menu says so.
    fireEvent.click(screen.getByRole("button", { name: "leave" }));
    expect(screen.getByText("another page")).toBeInTheDocument();
    expect(signal?.aborted).toBe(false);
    expect(screen.getByTitle("The assistant is answering")).toBeInTheDocument();

    // It ends meanwhile: the answer waits, unread.
    await act(async () => {
      finish(completed());
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByTitle("The assistant has finished")).toBeInTheDocument();
    });

    // The user comes back: the answer is there, the badge gone.
    fireEvent.click(screen.getByRole("button", { name: "come back" }));
    expect(await screen.findByText("The node is healthy.")).toBeInTheDocument();
    expect(screen.queryByTitle("The assistant has finished")).not.toBeInTheDocument();
    expect(signal?.aborted).toBe(false);
    expect(client.run).toHaveBeenCalledOnce();
  });

  test("drops a question opened while a turn runs, and says so", async () => {
    renderWithProviders(<App client={client} />);
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "New conversation" })[0]).toBeEnabled();
    });
    fireEvent.change(box(), { target: { value: "Review the node dev2n1." } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(client.run).toHaveBeenCalledOnce();
    });
    fireEvent.click(screen.getByRole("button", { name: "leave" }));
    // A link of another page opens the assistant with a question, the turn running.
    fireEvent.click(screen.getByRole("button", { name: "ask from another page" }));
    expect(
      await screen.findByText(/The question prepared was not taken: a turn runs/),
    ).toBeInTheDocument();
    expect(box()).toHaveValue("");
    expect(client.run.mock.calls[0]?.[2]?.signal?.aborted).toBe(false);
    // Typing clears the notice.
    fireEvent.change(box(), { target: { value: "and dev2n3?" } });
    expect(screen.queryByText(/The question prepared was not taken/)).not.toBeInTheDocument();
  });

  test("starts afresh for another identity, without remounting the application", async () => {
    renderWithProviders(<App client={client} />);
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "New conversation" })[0]).toBeEnabled();
    });
    fireEvent.change(screen.getByRole("textbox", { name: "menu filter" }), {
      target: { value: "nodes" },
    });
    fireEvent.change(box(), { target: { value: "Review the node dev2n1." } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(client.run).toHaveBeenCalledOnce();
    });
    const signal = client.run.mock.calls[0]?.[2]?.signal;

    // The impersonation ends: the turn of the former identity stops.
    fireEvent.click(screen.getByRole("button", { name: "become bob" }));
    await waitFor(() => {
      expect(signal?.aborted).toBe(true);
    });
    // The conversations are read again for the new identity, the page afresh.
    await waitFor(() => {
      expect(client.listConversations).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByText("Review the node dev2n1.")).not.toBeInTheDocument();
    // The rest of the application kept its state.
    expect(screen.getByRole("textbox", { name: "menu filter" })).toHaveValue("nodes");
  });

  test("shows nothing in the menu while the page is on display", async () => {
    renderWithProviders(<App client={client} />);
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "New conversation" })[0]).toBeEnabled();
    });
    fireEvent.change(box(), { target: { value: "Review the node dev2n1." } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(client.run).toHaveBeenCalledOnce();
    });
    expect(screen.queryByTitle("The assistant is answering")).not.toBeInTheDocument();
  });
});
