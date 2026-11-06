import { useTranslation } from "react-i18next";

const TIPS = ["target", "goal", "scope", "symptom", "oneAction", "limits"] as const;

/** How to word a request to the assistant: a few short tips. */
export function PromptTips() {
  const { t } = useTranslation();
  return (
    <ul aria-label={t("assistant.tips.title")} className="flex flex-col gap-1.5">
      {TIPS.map((tip) => (
        <li key={tip}>
          <span className="font-medium text-ink">{t(`assistant.tips.${tip}.lead`)}</span>{" "}
          <span className="text-ink-muted">{t(`assistant.tips.${tip}.text`)}</span>
        </li>
      ))}
    </ul>
  );
}
