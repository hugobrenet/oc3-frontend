import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { EventType } from "@ag-ui/core";
import { completed, fakeClient, stored, type FakeClient } from "./fake-client";
import { renderAssistant, stubCollector } from "./render";

const existing = { id: "existing", title: "Previous diagnostic" };

describe("the feedback on the answers", () => {
  let client: FakeClient;
  beforeEach(() => {
    stubCollector();
    client = fakeClient([existing]);
    client.getMessages.mockResolvedValue({
      messages: [
        stored("turn-1:1", "user", "How many nodes?"),
        stored("turn-1:2", "assistant", "Looking."),
        stored("turn-1:4", "assistant", "There are 484 nodes."),
        stored("turn-2:1", "user", "Per OS?"),
        stored("turn-2:2", "assistant", "Linux mostly.", {
          feedback: { rating: "up", reasons: [], expected: "" },
        }),
      ],
      nextCursor: "",
    });
    client.run.mockImplementation((_id, _input, options) => {
      options?.onEvent?.({ type: EventType.TEXT_MESSAGE_START, messageId: "turn-live:2" });
      options?.onEvent?.({
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: "turn-live:2",
        delta: "Streamed answer.",
      });
      return Promise.resolve(completed("turn-live"));
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const resume = async () => {
    await renderAssistant(client);
    fireEvent.click(screen.getByRole("button", { name: "Previous diagnostic" }));
    await screen.findByText("There are 484 nodes.");
  };
  const answer = (text: string) => screen.getByText(text).closest("li")!;
  const rating = "Was this answer helpful?";

  test("offers the rating under the last answer of each turn only", async () => {
    await resume();
    expect(screen.getAllByRole("group", { name: rating })).toHaveLength(2);
    // The answers of a turn are one message, as the stream shows them: rated once.
    expect(answer("Looking.")).toBe(answer("There are 484 nodes."));
    expect(within(answer("Looking.")).getAllByRole("group", { name: rating })).toHaveLength(1);
    const rated = within(answer("Linux mostly."));
    expect(rated.getByRole("button", { name: "Helpful" })).toHaveAttribute("aria-pressed", "true");
    expect(rated.getByText("Thanks for your feedback.")).toBeInTheDocument();
  });

  test("sends a helpful rating at once, and withdraws it on a second press", async () => {
    await resume();
    const turn = within(answer("There are 484 nodes."));
    fireEvent.click(turn.getByRole("button", { name: "Helpful" }));
    await waitFor(() => {
      expect(turn.getByRole("button", { name: "Helpful" })).toHaveAttribute("aria-pressed", "true");
    });
    expect(client.setFeedback).toHaveBeenCalledWith(
      "existing",
      "turn-1",
      { rating: "up" },
      expect.any(Object),
    );
    fireEvent.click(turn.getByRole("button", { name: "Helpful" }));
    await waitFor(() => {
      expect(client.deleteFeedback).toHaveBeenCalledWith("existing", "turn-1", expect.any(Object));
    });
    await waitFor(() => {
      expect(turn.getByRole("button", { name: "Helpful" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });
  });

  test("sends a negative rating at once, then its optional reasons and expectation", async () => {
    await resume();
    const turn = within(answer("There are 484 nodes."));
    fireEvent.click(turn.getByRole("button", { name: "Not helpful" }));
    await waitFor(() => {
      expect(client.setFeedback).toHaveBeenCalledWith(
        "existing",
        "turn-1",
        { rating: "down" },
        expect.any(Object),
      );
    });
    const form = within(turn.getByRole("form", { name: "Feedback details" }));
    expect(form.getByText(/without your identity/)).toBeInTheDocument();
    await waitFor(() => {
      expect(form.getByRole("checkbox", { name: "Information is missing" })).toBeEnabled();
    });
    fireEvent.click(form.getByRole("checkbox", { name: "Information is missing" }));
    fireEvent.change(form.getByRole("textbox", { name: /What did you expect/ }), {
      target: { value: "The count per OS" },
    });
    fireEvent.click(form.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(client.setFeedback).toHaveBeenLastCalledWith(
        "existing",
        "turn-1",
        { rating: "down", reasons: ["missing_information"], expected: "The count per OS" },
        expect.any(Object),
      );
    });
    await waitFor(() => {
      expect(turn.queryByRole("form", { name: "Feedback details" })).toBeNull();
    });
    expect(turn.getByRole("button", { name: "Not helpful" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(turn.getByRole("button", { name: "Edit the details" }));
    expect(
      within(turn.getByRole("form", { name: "Feedback details" })).getByRole("checkbox", {
        name: "Information is missing",
      }),
    ).toBeChecked();
  });

  test("refuses an expectation over 1000 characters, and closes without sending it", async () => {
    await resume();
    const turn = within(answer("There are 484 nodes."));
    fireEvent.click(turn.getByRole("button", { name: "Not helpful" }));
    const form = within(turn.getByRole("form", { name: "Feedback details" }));
    await waitFor(() => {
      expect(client.setFeedback).toHaveBeenCalledTimes(1);
    });
    fireEvent.change(form.getByRole("textbox", { name: /What did you expect/ }), {
      target: { value: "x".repeat(1001) },
    });
    expect(form.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(form.getByText("At most 1000 characters.")).toBeInTheDocument();
    fireEvent.click(form.getByRole("button", { name: "Not now" }));
    expect(turn.queryByRole("form", { name: "Feedback details" })).toBeNull();
    expect(client.setFeedback).toHaveBeenCalledTimes(1);
  });

  test("rates an answer just streamed with the turn of its end", async () => {
    await renderAssistant(client);
    fireEvent.change(screen.getByRole("textbox", { name: "Message to the assistant" }), {
      target: { value: "hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("Streamed answer.");
    fireEvent.click(
      await within(answer("Streamed answer.")).findByRole("button", { name: "Helpful" }),
    );
    await waitFor(() => {
      expect(client.setFeedback).toHaveBeenCalledWith(
        "new",
        "turn-live",
        { rating: "up" },
        expect.any(Object),
      );
    });
  });

  test("says a failure to save under the answer", async () => {
    client.setFeedback.mockRejectedValueOnce(new Error("boom"));
    await resume();
    const turn = within(answer("There are 484 nodes."));
    fireEvent.click(turn.getByRole("button", { name: "Helpful" }));
    expect(await turn.findByRole("alert")).toHaveTextContent(
      "The feedback could not be saved: The request to the assistant failed.",
    );
  });
});
