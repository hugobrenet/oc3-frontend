import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { SparklesIcon } from "@/components/ui/icons";
import { useAssistantStatus } from "./assistant-status";

/**
 * Opens the assistant on a new conversation, the question about the object on
 * display already in the message box: the user reads it, completes it, and sends
 * it. Shown only to a user who can use the assistant now.
 */
export function AskAssistantLink({ prompt }: { prompt: string }) {
  const { t } = useTranslation();
  const status = useAssistantStatus();
  if (status.data?.available !== true || prompt === "") return null;
  return (
    <Link
      to="/ai"
      search={{ prompt }}
      title={prompt}
      className="flex h-7 items-center gap-1.5 rounded-(--radius-control) border border-line px-2 whitespace-nowrap text-ink-muted hover:border-line-strong hover:text-ink"
    >
      <SparklesIcon className="h-3.5 w-3.5 text-accent" />
      {t("assistant.ask")}
    </Link>
  );
}
