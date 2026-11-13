import { useTranslation } from "react-i18next";
import { useAssistantActivity } from "./assistant-chat";

/**
 * What the assistant does while the user looks at another page, beside its entry
 * in the menu: an action waiting for a decision first, then a turn running, then
 * a turn ended meanwhile, answered, stopped or failed. In words for the screen
 * readers, never by a tint alone.
 */
export function AssistantActivityBadge() {
  const { t } = useTranslation();
  const activity = useAssistantActivity();
  if (activity === null) return null;
  const state = activity.waiting
    ? "waiting"
    : activity.answering
      ? "answering"
      : activity.ended
        ? "ended"
        : null;
  if (state === null) return null;
  const dot =
    state === "waiting"
      ? "bg-state-warn"
      : state === "answering"
        ? "animate-pulse bg-accent"
        : "bg-accent";
  const label = t(`assistant.activity.${state}`);
  return (
    <span className="ml-auto flex items-center" title={label}>
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${dot}`} />
      <span className="sr-only">{label}</span>
    </span>
  );
}
