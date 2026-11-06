import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { AssistantError, type AssistantClient, type ToolDoc } from "../assistant-client";
import { ToolsDialog } from "../ToolsDialog";
import { fakeClient } from "./fake-client";

const tools: ToolDoc[] = [
  {
    name: "delete_service",
    title: "Delete service",
    summary: "Delete one service of the collector.",
    description: "Delete one service of the collector.\nIts instances go with it.",
    arguments: { service: "the exact service name", cluster: "the cluster of the service" },
    readOnly: false,
    needsConfirmation: true,
  },
  {
    name: "get_node",
    title: "Get node",
    summary: "Read one node.",
    description: "",
    arguments: {},
    readOnly: true,
    needsConfirmation: false,
  },
  {
    name: "list_nodes",
    title: "List nodes",
    summary: "List the nodes.",
    description: "",
    arguments: {},
    readOnly: true,
    needsConfirmation: false,
  },
  {
    name: "ack_alert",
    title: "Acknowledge alert",
    summary: "Acknowledge an alert.",
    description: "",
    arguments: {},
    readOnly: false,
    needsConfirmation: false,
  },
];

const open = (client: AssistantClient) => render(<ToolsDialog client={client} onClose={vi.fn()} />);

describe("what the assistant can do", () => {
  test("lists the tools by what they do, sorted, and filters them", async () => {
    const client = fakeClient();
    client.listTools.mockResolvedValue(tools);
    open(client);
    const dialog = screen.getByRole("dialog", { name: "What the assistant can do" });
    await within(dialog).findByText("4 tools");
    const group = (name: string) => within(dialog).getByRole("region", { name });
    expect(
      within(group("Read"))
        .getAllByRole("listitem")
        .map((item) => item.querySelector("code")?.textContent),
    ).toEqual(["get_node", "list_nodes"]);
    expect(
      within(group("Act, after your confirmation")).getByText("Delete service"),
    ).toBeInTheDocument();
    expect(within(group("Act")).getByText("Acknowledge alert")).toBeInTheDocument();
    // A tool with more to tell unfolds in place: the rest of its description
    // and its arguments, several at once; the others do not.
    const deletion = within(dialog).getByText("delete_service").closest("details")!;
    expect(deletion).not.toHaveAttribute("open");
    fireEvent.click(within(deletion).getByText("Delete service"));
    expect(deletion).toHaveAttribute("open");
    expect(within(deletion).getByText("Its instances go with it.")).toBeInTheDocument();
    expect(
      within(deletion)
        .getAllByRole("term")
        .map((term) => term.textContent),
    ).toEqual(["cluster", "service"]);
    expect(within(deletion).getByText("the exact service name")).toBeInTheDocument();
    expect(within(dialog).getByText("ack_alert").closest("details")).toBeNull();
    fireEvent.change(within(dialog).getByRole("searchbox", { name: "Filter the tools" }), {
      target: { value: "NODE réad" },
    });
    expect(within(dialog).getByText("1 tool")).toBeInTheDocument();
    expect(within(dialog).queryByRole("region", { name: "Act" })).toBeNull();
    expect(within(group("Read")).getByText("Get node")).toBeInTheDocument();
  });

  test.each([
    ["tools_unavailable", 502, "The agent could not read its tools. Try again later."],
    ["tools_unlisted", 404, "The assistant does not list its tools on this collector."],
    ["network_error", null, "The tools could not be read."],
  ])("says why the tools cannot be read: %s", async (code, status, message) => {
    const client = fakeClient();
    client.listTools.mockRejectedValue(new AssistantError(code, status));
    open(client);
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
  });

  test("stops reading once closed", () => {
    const client = fakeClient();
    client.listTools.mockImplementation(() => new Promise(() => undefined));
    const { unmount } = open(client);
    const signal = client.listTools.mock.calls[0]?.[0]?.signal;
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
  });
});
