import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";

/**
 * Whether the assistant is configured, and whether the user can use it now: oc3
 * answers it alone. The page of the assistant and the links that open it read it.
 */
export function useAssistantStatus() {
  return useQuery({
    queryKey: ["assistant", "status"],
    // Every detail panel reads it for its link: it changes rarely, and a change of
    // identity clears the cache anyway. As the effective privileges.
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await api.GET("/assistant/status");
      if (error !== undefined) throw new Error("status");
      return data;
    },
  });
}

/**
 * The longest question a link may put in the message box, in characters: the
 * questions of the panels hold under 200, and any link received may open the
 * page with one, which the user must be able to read whole before sending it.
 */
export const MAX_LINK_PROMPT = 500;

/**
 * The search of the page of the assistant: the question a link opens it with,
 * trimmed and bounded, absent when empty.
 */
export function parseAssistantSearch(raw: Record<string, unknown>): { prompt?: string } {
  const prompt = typeof raw.prompt === "string" ? raw.prompt.trim() : "";
  return prompt === "" ? {} : { prompt: prompt.slice(0, MAX_LINK_PROMPT) };
}
