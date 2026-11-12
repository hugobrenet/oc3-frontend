import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Assistant } from "../Assistant";
import { AskAssistantLink } from "../AskAssistantLink";
import { fakeClient } from "./fake-client";
import { renderWithProviders, stubCollector } from "./render";

const box = () => screen.getByRole("textbox", { name: "Message to the assistant" });
const question = "Analyze the alert “check out of bounds” on par-dev-app02.";

describe("the assistant opened on a question", () => {
  beforeEach(() => {
    stubCollector();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("puts the question in the message box of a new conversation, without sending it", async () => {
    const client = fakeClient([{ id: "existing", title: "Previous diagnostic" }]);
    const taken = vi.fn();
    renderWithProviders(
      <Assistant client={client} initialPrompt={question} onPromptTaken={taken} />,
    );
    await waitFor(() => {
      expect(box()).toHaveValue(question);
    });
    expect(taken).toHaveBeenCalledOnce();
    expect(client.run).not.toHaveBeenCalled();
    expect(client.createConversation).not.toHaveBeenCalled();
    // A new conversation: none of the former ones is opened.
    expect(client.getConversation).not.toHaveBeenCalled();
  });

  test("leaves the message box empty without a question", async () => {
    const client = fakeClient();
    const taken = vi.fn();
    renderWithProviders(<Assistant client={client} onPromptTaken={taken} />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "New conversation" })).toBeEnabled();
    });
    expect(box()).toHaveValue("");
    expect(taken).not.toHaveBeenCalled();
  });
});

describe("the link that opens the assistant", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const stubStatus = (available: boolean) => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ enabled: true, available })),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  test("opens the assistant with the question in its address", async () => {
    stubStatus(true);
    renderWithProviders(<AskAssistantLink prompt={question} />);
    const link = await screen.findByRole("link", { name: "Analyze with the assistant" });
    const href = new URL(link.getAttribute("href") ?? "", window.location.href);
    expect(href.pathname).toBe("/ai");
    expect(href.searchParams.get("prompt")).toBe(question);
  });

  test("is not offered to a user who cannot use the assistant", async () => {
    const fetchMock = stubStatus(false);
    renderWithProviders(<AskAssistantLink prompt={question} />);
    // Once the status is read, and answered: no link.
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole("link", { name: "Analyze with the assistant" })).toBeNull();
  });
});
