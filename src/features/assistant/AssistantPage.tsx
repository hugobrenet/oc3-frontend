import { useNavigate, useSearch } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ObjectIcon } from "@/components/opensvc/ObjectIcon";
import { SparklesIcon } from "@/components/ui/icons";
import { useCredentials } from "@/lib/api/auth";
import { useImpersonation } from "@/lib/api/impersonation";
import { Assistant } from "./Assistant";
import { assistantClient } from "./assistant-client";
import { useAssistantStatus } from "./assistant-status";

/**
 * The page of the AI assistant. oc3 relays every request to the agent with the
 * user's access token (`/api/assistant/...`): nothing goes from the browser to
 * the agent directly. The assistant answers from what the user may see, and asks
 * in this page before any action.
 */
export function AssistantPage() {
  const { t } = useTranslation();
  const status = useAssistantStatus();
  const available = status.data?.available === true;
  // A conversation belongs to an identity: another one, by a sign-in or an
  // impersonation, starts the view afresh, its stream stopped and its queue lost.
  const user = useCredentials()?.user ?? "";
  const impersonated = useImpersonation()?.userId ?? null;
  // A question another page opened the assistant with (AskAssistantLink): put in
  // the message box of a new conversation, then taken out of the address, so that
  // a reload or a return to the page does not put it there again.
  // Read without naming the route, the page rendered under any.
  const search: { prompt?: unknown } = useSearch({ strict: false });
  const prompt = typeof search.prompt === "string" ? search.prompt : undefined;
  const navigate = useNavigate();

  return (
    <section className="flex h-[calc(100dvh-2.75rem-2rem)] flex-col gap-3">
      <div className="flex min-h-7 items-center gap-3">
        <h1 className="flex items-center gap-2 text-title font-semibold">
          <ObjectIcon kind="ai" className="h-5 w-5" />
          {t("assistant.title")}
        </h1>
      </div>
      {status.isPending ? (
        <p className="text-ink-muted">{t("detail.loading")}</p>
      ) : !available ? (
        <Unavailable reason={status.data?.reason ?? "disabled"} />
      ) : (
        <Assistant
          key={JSON.stringify([user, impersonated])}
          client={assistantClient}
          initialPrompt={prompt}
          onPromptTaken={() => {
            void navigate({ to: ".", search: {}, replace: true });
          }}
        />
      )}
    </section>
  );
}

/** Why the assistant cannot be used, in the frame the conversation would take. */
function Unavailable({ reason }: { reason: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-(--radius-panel) border border-line bg-surface-raised p-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent">
        <SparklesIcon className="h-6 w-6" />
      </div>
      <p role="status" className="max-w-prose text-ink-muted">
        <span aria-hidden="true">○ </span>
        {t(`assistant.unavailable.${reason}`)}
      </p>
    </div>
  );
}
