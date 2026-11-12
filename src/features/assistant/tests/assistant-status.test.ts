import { describe, expect, test } from "vitest";
import { MAX_LINK_PROMPT, parseAssistantSearch } from "../assistant-status";

describe("the search of the page of the assistant", () => {
  test("keeps a question, trimmed", () => {
    expect(parseAssistantSearch({ prompt: "  Review the node dev2n1.  " })).toEqual({
      prompt: "Review the node dev2n1.",
    });
  });

  test("bounds a question any link may carry", () => {
    const long = "a".repeat(MAX_LINK_PROMPT + 100);
    expect(parseAssistantSearch({ prompt: long }).prompt).toHaveLength(MAX_LINK_PROMPT);
    expect(MAX_LINK_PROMPT).toBe(500);
  });

  test("has no question when it is empty or not a text", () => {
    expect(parseAssistantSearch({})).toEqual({});
    expect(parseAssistantSearch({ prompt: "   " })).toEqual({});
    expect(parseAssistantSearch({ prompt: 42 })).toEqual({});
  });
});
