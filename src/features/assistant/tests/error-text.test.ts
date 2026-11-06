import { describe, expect, test } from "vitest";
import i18n from "@/i18n";
import { AssistantError } from "../assistant-client";
import { errorText } from "../error-text";

describe("the failures of the assistant, in words", () => {
  test.each([
    [
      new AssistantError("assistant_unreachable", 502),
      "The AI agent cannot be reached. Try again later.",
    ],
    [new AssistantError("conversation_quota", 409), "Your conversation quota is reached"],
    [new AssistantError("http_error", 410), "This conversation has expired."],
    [new AssistantError("http_error", 418), "The assistant refused the request."],
    [new AssistantError("some_code_of_the_agent", 400), "The assistant refused the request."],
    [new Error("a secret of the exception"), "The request to the assistant failed."],
  ])("says %s in the words of the page", (error, words) => {
    expect(errorText(i18n.t, error)).toContain(words);
  });

  test("says them in French too", async () => {
    await i18n.changeLanguage("fr");
    try {
      expect(errorText(i18n.t, new AssistantError("confirmation_expired", 410))).toBe(
        "La demande de confirmation a expiré. L'action n'a pas été exécutée.",
      );
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});
