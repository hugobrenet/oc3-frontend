import { useTranslation } from "react-i18next";
import type { AssistantChat } from "./use-assistant-chat";

/**
 * The choice of the model of the messages sent, among those the agent
 * offers, shown when it offers two or more and the user can run on one. A
 * model the user cannot run on is shown, not offered. The labels are the
 * operator's, shown as text. The choice stays open while a run streams: it
 * goes with the messages sent or queued from then on, a message already
 * queued keeping the model it was queued with, a run the model it started on.
 */
export function ModelSelect({
  chat,
  disabled,
}: {
  chat: Pick<AssistantChat, "models" | "model" | "selectModel">;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  if (chat.models === null || chat.model === null) return null;
  return (
    <select
      aria-label={t("assistant.composer.model")}
      title={t("assistant.composer.modelHint")}
      value={chat.model}
      disabled={disabled}
      onChange={(event) => {
        chat.selectModel(event.target.value);
      }}
      className="h-8 max-w-56 rounded-(--radius-control) border border-line bg-surface px-1 text-data text-ink disabled:opacity-60"
    >
      {chat.models.map((model) => (
        <option key={model.id} value={model.id} disabled={!model.ready}>
          {model.label}
        </option>
      ))}
    </select>
  );
}
