import { render, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { PrintView } from "../PrintView";
import type { ExportDocument } from "../conversation-export";

const doc: ExportDocument = {
  title: "Why is web down",
  collector: "collector.example.com",
  messages: [
    { id: "t1:1", turnId: "t1", role: "user", text: "Why?", createdAt: "2026-11-26T09:00:00Z" },
    {
      id: "t1:2",
      turnId: "t1",
      role: "assistant",
      text: "See [docs](https://docs.example) and [the node](/nodes/n1).",
      createdAt: "2026-11-26T09:00:10Z",
    },
  ],
  exportedAt: new Date("2026-11-26T10:00:00Z"),
  timeZone: "UTC",
};

describe("the print of a conversation", () => {
  afterEach(() => {
    document.documentElement.classList.remove("dark");
  });

  test("makes the sheet ready in a frame of its own, in the light theme, under StrictMode, the page as it is", async () => {
    document.documentElement.classList.add("dark");
    document.title = "OpenSVC";
    const onReady = vi.fn();
    const view = render(
      <StrictMode>
        <PrintView doc={doc} onReady={onReady} />
      </StrictMode>,
    );
    await waitFor(() => {
      expect(onReady).toHaveBeenCalled();
    });
    const frame = document.querySelector<HTMLIFrameElement>('iframe[aria-hidden="true"]')!;
    expect(onReady).toHaveBeenLastCalledWith(frame.contentWindow);
    const sheet = frame.contentDocument!;
    expect(sheet.title).toBe("why-is-web-down-2026-11-26");
    expect(sheet.documentElement).not.toHaveClass("dark");
    expect(sheet.body.querySelectorAll(".assistant-print")).toHaveLength(1);
    expect(sheet.body.textContent).toContain("Why?");
    // The paths of the collector are printed with its address.
    const article = sheet.body.querySelector<HTMLElement>(".assistant-print")!;
    expect(article.style.getPropertyValue("--print-origin")).toBe(
      JSON.stringify(window.location.origin),
    );
    // The page is not touched.
    expect(document.documentElement).toHaveClass("dark");
    expect(document.title).toBe("OpenSVC");
    view.unmount();
    expect(document.querySelector('iframe[aria-hidden="true"]')).toBeNull();
  });
});
