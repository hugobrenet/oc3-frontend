import { act, renderHook } from "@testing-library/react";
import type { TFunction } from "i18next";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useTabNotice } from "../use-tab-notice";

const words: Record<string, string> = {
  "assistant.endNotice.tab.ended": "Done",
  "assistant.endNotice.tab.failed": "Failed",
  "assistant.endNotice.tab.waiting": "Waiting",
};
const t = ((key: string) => words[key] ?? key) as unknown as TFunction;

describe("the title of a hidden tab", () => {
  let visibility: DocumentVisibilityState;
  beforeEach(() => {
    visibility = "hidden";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
    document.title = "OpenSVC";
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  const show = () => {
    act(() => {
      visibility = "visible";
      document.dispatchEvent(new Event("visibilitychange"));
    });
  };

  test("tells one notice at a time, without stacking the words, until the tab is shown", () => {
    const { result } = renderHook(() => useTabNotice(t));
    result.current.tell("failed");
    expect(document.title).toBe("Failed · OpenSVC");
    result.current.tell("waiting");
    expect(document.title).toBe("Waiting · OpenSVC");
    show();
    expect(document.title).toBe("OpenSVC");
  });

  test("tells nothing while the tab is shown", () => {
    visibility = "visible";
    const { result } = renderHook(() => useTabNotice(t));
    result.current.tell("ended");
    expect(document.title).toBe("OpenSVC");
  });

  test("gives the title back once what it told is over, the waiting only for the end of the wait", () => {
    const { result } = renderHook(() => useTabNotice(t));
    result.current.tell("ended");
    result.current.clear("waiting");
    expect(document.title).toBe("Done · OpenSVC");
    result.current.clear();
    expect(document.title).toBe("OpenSVC");
    result.current.tell("waiting");
    result.current.clear("waiting");
    expect(document.title).toBe("OpenSVC");
  });

  test("keeps a title the page set meanwhile, and gives the title back once unmounted", () => {
    const view = renderHook(() => useTabNotice(t));
    view.result.current.tell("ended");
    document.title = "Another page";
    show();
    expect(document.title).toBe("Another page");
    visibility = "hidden";
    view.result.current.tell("ended");
    expect(document.title).toBe("Done · Another page");
    view.unmount();
    expect(document.title).toBe("Another page");
  });

  test("gives back an empty title, as the browser reads it", () => {
    document.title = "";
    const { result } = renderHook(() => useTabNotice(t));
    result.current.tell("ended");
    result.current.tell("ended");
    expect(document.title).toBe("Done ·");
    show();
    expect(document.title).toBe("");
  });
});
