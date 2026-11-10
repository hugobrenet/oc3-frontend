import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import i18n from "@/i18n";
import { parseConfirmation } from "../assistant-client";
import { replayRun } from "./agui-fixtures";
import { fakeClient, type FakeClient } from "./fake-client";
import { renderAssistant, stubCollector } from "./render";

const existing = { id: "existing", title: "Previous diagnostic" };

/** A confirmation as the conversation read gives it after a reload, read by the client. */
const pendingConfirmation = (fields: Record<string, unknown> = {}) =>
  parseConfirmation({
    id: "confirmation-1",
    turn_id: "turn-1",
    tool: { name: "stop_instance", title: "Stop instance", destructive: true },
    arguments: { path: "test/svc/web", node: "dev5n1" },
    argument_types: {},
    editable: false,
    expires_at: "2026-10-26T17:45:00Z",
    ...fields,
  });

describe("the confirmation card", () => {
  let client: FakeClient;
  beforeEach(() => {
    // The golden confirmations expire on 2026-10-09 at 17:45: the page reads
    // them a while before.
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-09T17:00:00Z") });
    stubCollector();
    client = fakeClient([existing]);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  const ask = async (prompt: string) => {
    await renderAssistant(client);
    fireEvent.change(screen.getByRole("textbox", { name: "Message to the assistant" }), {
      target: { value: prompt },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    const card = await screen.findByRole("region", { name: "Action waiting for confirmation" });
    // The card shows before the run ends: its buttons wait for the end.
    await waitFor(() => {
      expect(within(card).getByRole("button", { name: "Reject" })).toBeEnabled();
    });
    return card;
  };
  const reload = async (
    confirmation: ReturnType<typeof parseConfirmation>,
    region = "Action waiting for confirmation",
    newConversation = "New conversation",
  ) => {
    client.getConversation.mockResolvedValue({ conversation: existing, confirmation });
    await renderAssistant(client, newConversation);
    fireEvent.click(screen.getByRole("button", { name: "Previous diagnostic" }));
    return screen.findByRole("region", { name: region });
  };

  test("says an action in the sentence of the MCP, and approves it with the delete look", async () => {
    client.run.mockImplementationOnce(replayRun("confirmation_preview_action"));
    const card = await ask("Stop fs#1 of web on dev5n1");
    expect(within(card).getByText("Stop test/svc/web on dev5n1 (fs#1)")).toBeInTheDocument();
    expect(within(card).queryByRole("table")).not.toBeInTheDocument();
    expect(within(card).getByText(/The call may still be refused/)).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Approve" })).toHaveClass("bg-state-down");
    expect(within(card).getByRole("button", { name: "Reject" })).toHaveClass("border-line");
  });

  test("shows the keys a configuration update changes, the sections it deletes, and hides the secrets", async () => {
    client.run.mockImplementationOnce(replayRun("confirmation_preview_config"));
    const card = await ask("Add b to env.list of web");
    expect(
      within(card).getByText(
        "Update the configuration of test/svc/web: 2 set, 1 unset, 1 sections deleted",
      ),
    ).toBeInTheDocument();
    const rows = within(within(card).getByRole("table")).getAllByRole("row");
    expect(
      within(rows[0]!)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["Key", "Current value", "Operation", "Proposed value*"]);
    const row = (key: string) =>
      rows.find((item) =>
        (within(item).queryByRole("rowheader")?.textContent ?? "").startsWith(key),
      )!;
    const cells = (key: string) =>
      within(row(key))
        .getAllByRole("cell")
        .map((cell) => cell.textContent);
    expect(cells("env.list")).toEqual(["a", "append b", "a b"]);
    expect(row("env.absent")).toHaveTextContent("not set");
    expect(cells("env.absent")).toEqual(["empty", "unset", "empty"]);
    expect(cells("cluster.secret")).toEqual(["hidden", "set to", "hidden"]);
    expect(within(row("cluster.secret")).getByRole("rowheader")).toHaveTextContent(
      "cluster.secretsecret: values not shown",
    );
    expect(within(card).getByText("Deletes the section fs#2 and its 2 keys:")).toBeInTheDocument();
    expect(
      within(within(card).getByRole("list", { name: "fs#2" }))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["fs#2.dev", "fs#2.type"]);
    expect(
      within(card).getByText("1 change on a secret key: its values are not shown."),
    ).toBeInTheDocument();
    expect(within(card).getByText(/Current values read at/)).toBeInTheDocument();
    // The arguments stay at hand, folded.
    expect(within(card).getByText("Arguments of the call").closest("details")).not.toHaveAttribute(
      "open",
    );
  });

  test("numbers the lines of the file a creation writes, without current values", async () => {
    client.run.mockImplementationOnce(replayRun("confirmation_preview_create"));
    const card = await ask("Create new with a flag");
    expect(within(card).getByText("Create test/svc/new, a svc of 2 sections")).toBeInTheDocument();
    const file = within(card).getByRole("group", { name: "File written" });
    expect(
      within(file)
        .getAllByTestId("content-line-number")
        .map((cell) => cell.textContent)
        .slice(0, 5),
    ).toEqual(["1", "2", "3", "4", "5"]);
    expect(file).toHaveTextContent("[fs#1]");
    expect(within(file).getByText("text/x-ini")).toBeInTheDocument();
    expect(
      within(card).queryByRole("columnheader", { name: "Current value" }),
    ).not.toBeInTheDocument();
    expect(within(card).getByRole("row", { name: /env\.a/ })).toHaveTextContent(
      "applied after the configuration file",
    );
  });

  test("says the notes in the language of the page by their keys, an unknown one as the MCP wrote it", async () => {
    await i18n.changeLanguage("fr");
    try {
      const card = await reload(
        pendingConfirmation({
          tool: { name: "update_object_config", title: "Update", destructive: true },
          preview: {
            summary: {
              text: "Update",
              key: "config_update",
              params: { path: "web", sets: "2", unsets: "0", deletes: "1" },
            },
            changes: [
              {
                key: "cluster.secret",
                op: "=",
                after_computed_by_mcp: false,
                note: "secret: values not shown",
                note_keys: ["secret"],
              },
              {
                key: "env.a",
                op: "=",
                value: "1",
                before: "",
                after: "1",
                after_computed_by_mcp: true,
                note: "a new note",
                note_keys: ["new_note"],
              },
            ],
            deleted: [{ section: "cluster", keys: ["cluster.name"], secrets_omitted: 1 }],
          },
        }),
        "Action en attente de confirmation",
        "Nouvelle conversation",
      );
      expect(within(card).getByRole("rowheader", { name: /cluster\.secret/ })).toHaveTextContent(
        "secret : valeurs non affichées",
      );
      expect(within(card).getByRole("rowheader", { name: /env\.a/ })).toHaveTextContent(
        "a new note",
      );
      expect(within(card).getByText("et 1 clé secrète, non nommée.")).toBeInTheDocument();
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  test("folds the arguments, and tells why there is no preview, when the preview failed", async () => {
    client.run.mockImplementationOnce(replayRun("confirmation_preview_error"));
    const card = await ask("Set env.a of web");
    expect(within(card).getByText(/No preview: the preview was refused/)).toBeInTheDocument();
    expect(within(card).getByText("Arguments of the call").closest("details")).not.toHaveAttribute(
      "open",
    );
    expect(within(card).getByText("test/svc/web")).toHaveProperty("tagName", "CODE");
  });

  test("folds the arguments and leaves out the empty ones", async () => {
    const card = await reload(
      pendingConfirmation({
        tool: { name: "unfreeze_node", title: "Unfreeze nodes", destructive: true },
        arguments: { nodes: ["dev2n1"], app: "", tag: "", frozen: false, cluster_id: "" },
        editable: true,
        input_schema: {
          type: "object",
          properties: {
            nodes: { type: "array", items: { type: "string" } },
            app: { type: "string" },
            tag: { type: "string" },
            frozen: { type: "boolean" },
            cluster_id: { type: "string" },
          },
        },
      }),
    );
    const details = within(card).getByText("Arguments of the call").closest("details");
    expect(details).not.toHaveAttribute("open");
    expect(within(card).getByText('["dev2n1"]')).toHaveProperty("tagName", "CODE");
    for (const name of ["app", "tag", "frozen", "cluster_id"])
      expect(within(card).queryByText(name)).not.toBeInTheDocument();
    expect(within(card).getByText("nodes")).toHaveProperty("tagName", "CODE");
  });

  test("keeps a false that means something: a boolean that may be null", async () => {
    const card = await reload(
      pendingConfirmation({
        tool: { name: "ack_service_action", title: "Acknowledge", destructive: true },
        arguments: { acknowledged: false, service: "web" },
        editable: true,
        input_schema: {
          type: "object",
          properties: { acknowledged: { type: ["null", "boolean"] }, service: { type: "string" } },
        },
      }),
    );
    expect(within(card).getByText("acknowledged")).toHaveProperty("tagName", "CODE");
    expect(within(card).getByText("false")).toHaveProperty("tagName", "CODE");
  });

  test("computes the preview again for edited arguments, nothing running", async () => {
    client.run
      .mockImplementationOnce(replayRun("confirmation_preview_config"))
      .mockImplementationOnce(replayRun("resume_preview"));
    const card = await ask("Add b to env.list of web");
    fireEvent.click(within(card).getByRole("button", { name: "Edit" }));
    expect(
      within(card).queryByRole("button", { name: "Recompute the preview" }),
    ).not.toBeInTheDocument();
    fireEvent.change(within(card).getByRole("textbox", { name: /path/ }), {
      target: { value: "test/svc/api" },
    });
    expect(
      within(card).getByText(/The preview is of the arguments before your changes/),
    ).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "Recompute the preview" }));
    await waitFor(() => {
      expect(client.run).toHaveBeenCalledTimes(2);
    });
    expect(client.run).toHaveBeenLastCalledWith(
      "new",
      expect.objectContaining({
        resume: expect.objectContaining({
          interruptId: "confirmation-u",
          preview: true,
          editedArgs: expect.objectContaining({ path: "test/svc/api" }) as unknown,
        }) as unknown,
      }),
      expect.anything(),
    );
    // The call waits again, under the new interrupt, with the preview of the edit.
    const again = await screen.findByText("Update api");
    const region = again.closest("section")!;
    expect(
      within(region).getByText("The preview is of your edited arguments."),
    ).toBeInTheDocument();
    expect(within(region).getByRole("textbox", { name: /path/ })).toHaveValue("api");
    await waitFor(() => {
      expect(within(region).getByRole("button", { name: "Approve with my changes" })).toBeEnabled();
    });
  });

  test("gives an action that destroys nothing the accent look, and its sentence as text", async () => {
    const card = await reload(
      pendingConfirmation({
        tool: { name: "freeze_service", title: "Freeze service", destructive: false },
        preview: {
          summary: {
            text: "Freeze <img src=x onerror=alert(1)> **web**",
            key: "freeze_service",
            params: { path: "**web**" },
          },
        },
      }),
    );
    expect(within(card).getByText("Action to confirm")).toBeInTheDocument();
    expect(
      within(card).getByText("Freeze <img src=x onerror=alert(1)> **web**"),
    ).toBeInTheDocument();
    expect(card.querySelector("img")).toBeNull();
    expect(within(card).getByRole("button", { name: "Approve" })).toHaveClass("bg-accent");
  });

  test("shows the card as before when the agent gives no preview", async () => {
    const card = await reload(pendingConfirmation());
    expect(within(card).getByText("Stop instance")).toBeInTheDocument();
    expect(within(card).queryByText(/The call may still be refused/)).not.toBeInTheDocument();
    expect(within(card).getByText("dev5n1")).toHaveProperty("tagName", "CODE");
  });

  test("tells on hover what the tool does and what each argument is, from the tools of the agent", async () => {
    client.listTools.mockResolvedValue([
      {
        name: "stop_instance",
        title: "Stop instance",
        summary: "Stop the instance on one node.",
        readOnly: false,
        needsConfirmation: true,
        description: "Stop the instance on one node.\n**Not** the object.",
        arguments: { node: "the exact node name" },
      },
    ]);
    const card = await reload(pendingConfirmation());
    // From the MCP: a title attribute, plain text, never markup.
    await waitFor(() => {
      expect(within(card).getByText("stop_instance")).toHaveAttribute(
        "title",
        "Stop the instance on one node.\n**Not** the object.",
      );
    });
    expect(within(card).getByText("node")).toHaveAttribute("title", "the exact node name");
    expect(within(card).getByText("path")).not.toHaveAttribute("title");
    expect(client.listTools).toHaveBeenCalledTimes(1);
  });

  test("shows the card without hover text when the tools of the agent cannot be read", async () => {
    client.listTools.mockRejectedValue(new Error("tools_unlisted"));
    const card = await reload(pendingConfirmation());
    await waitFor(() => {
      expect(client.listTools).toHaveBeenCalled();
    });
    expect(within(card).getByText("stop_instance")).not.toHaveAttribute("title");
    expect(within(card).getByRole("button", { name: "Approve" })).toBeInTheDocument();
  });

  test("names the tool called, labeled and in bold, apart from its title", async () => {
    const card = await reload(pendingConfirmation());
    expect(within(card).getByText(/Tool:/)).toBeInTheDocument();
    const name = within(card).getByText("stop_instance");
    expect(name).toHaveProperty("tagName", "CODE");
    expect(name).toHaveClass("font-semibold");
  });

  test("says when the request expires, live", async () => {
    const card = await reload(pendingConfirmation());
    expect(within(card).getByText(/This request expires in 2 weeks/)).toBeInTheDocument();
  });
});
