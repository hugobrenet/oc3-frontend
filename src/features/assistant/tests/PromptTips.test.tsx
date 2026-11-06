import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fakeClient, stored, type FakeClient } from "./fake-client";
import { renderAssistant, stubCollector } from "./render";

const existing = { id: "existing", title: "Previous diagnostic" };

describe("the tips for writing a request", () => {
  let client: FakeClient;
  beforeEach(() => {
    stubCollector();
    client = fakeClient([existing]);
    client.getMessages.mockResolvedValue({
      messages: [
        stored("turn-1:1", "user", "How many nodes?"),
        stored("turn-1:2", "assistant", "Two nodes."),
      ],
      nextCursor: "",
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const tips = () => screen.queryByRole("region", { name: "Writing a good request" });

  test("greet an empty conversation, and leave one that has messages", async () => {
    await renderAssistant(client);
    expect(
      within(tips()!).getByRole("list", { name: "Writing a good request" }).children,
    ).toHaveLength(6);
    expect(tips()).toHaveTextContent(
      "Name the target: the exact name of the node or of the service",
    );
    fireEvent.click(screen.getByRole("button", { name: "Previous diagnostic" }));
    await screen.findByText("Two nodes.");
    expect(tips()).toBeNull();
  });

  test("open from the header at any time, in a dialog", async () => {
    await renderAssistant(client);
    fireEvent.click(screen.getByRole("button", { name: "Previous diagnostic" }));
    await screen.findByText("Two nodes.");
    fireEvent.click(screen.getByRole("button", { name: "Tips for writing a request" }));
    const dialog = screen.getByRole("dialog", { name: "Writing a good request" });
    expect(within(dialog).getByText("One action at a time.")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("leave the tools of the assistant one button away, read when opened", async () => {
    await renderAssistant(client);
    expect(client.listTools).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "What the assistant can do" }));
    expect(screen.getByRole("dialog", { name: "What the assistant can do" })).toBeInTheDocument();
    expect(client.listTools).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
