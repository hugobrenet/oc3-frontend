import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";

/**
 * Whether the assistant is configured, and whether the user can use it now: oc3
 * answers it alone. The page of the assistant and the links that open it read it.
 */
export function useAssistantStatus() {
  return useQuery({
    queryKey: ["assistant", "status"],
    queryFn: async () => {
      const { data, error } = await api.GET("/assistant/status");
      if (error !== undefined) throw new Error("status");
      return data;
    },
  });
}

/** The longest question a link may put in the message box, in characters. */
export const MAX_LINK_PROMPT = 2000;
