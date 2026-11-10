import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AssistantPage } from "../AssistantPage";
import { renderWithProviders } from "./render";

/** The collector, answering the status of the assistant as given, and no conversation. */
function stubRelay(status: Record<string, unknown>) {
  const fetchMock = vi.fn<typeof fetch>((input) => {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
    if (url.pathname === "/api/assistant/status") return Promise.resolve(Response.json(status));
    if (url.pathname === "/api/assistant/conversations")
      return Promise.resolve(Response.json({ conversations: [] }));
    return Promise.resolve(Response.json({}, { status: 404 }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const paths = (fetchMock: ReturnType<typeof stubRelay>) =>
  fetchMock.mock.calls.map(([input]) => new URL((input as Request).url).pathname);

describe("the page of the assistant", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test.each([
    ["disabled", /not configured on this collector/],
    ["password_sign_in", /Sign in with single sign-on/],
    ["token_unavailable", /holds no access token/],
    ["impersonating", /while impersonating another user/],
  ])("does not reach the agent when %s, and tells why", async (reason, why) => {
    const fetchMock = stubRelay({ enabled: reason !== "disabled", available: false, reason });
    renderWithProviders(<AssistantPage />);
    expect(await screen.findByRole("status")).toHaveTextContent(why);
    expect(screen.queryByRole("textbox", { name: "Message to the assistant" })).toBeNull();
    expect(paths(fetchMock)).toEqual(["/api/assistant/status"]);
  });

  test("opens the conversations once the assistant is available", async () => {
    const fetchMock = stubRelay({ enabled: true, available: true });
    renderWithProviders(<AssistantPage />);
    expect(await screen.findByRole("heading", { name: "AI assistant" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("No conversation yet.")).toBeInTheDocument();
    });
    expect(screen.getByRole("textbox", { name: "Message to the assistant" })).toBeEnabled();
    expect(paths(fetchMock)).toEqual(["/api/assistant/status", "/api/assistant/conversations"]);
  });
});
