import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ThumbsDownIcon, ThumbsUpIcon } from "@/components/ui/icons";
import {
  FEEDBACK_REASONS,
  MAX_FEEDBACK_EXPECTED_CHARACTERS,
  type FeedbackInput,
  type FeedbackReason,
} from "./assistant-client";
import { errorText } from "./error-text";
import type { Rating } from "./use-assistant-chat";

/**
 * The feedback of the user on the answer of a turn, under it: helpful or not.
 * A thumb down is sent at once, then the reasons and what was expected may
 * follow, sent as a second, complete feedback, and edited later; pressing the
 * chosen thumb again withdraws the feedback. The agent keeps the feedback
 * without the identity of the user.
 */
export function AnswerFeedback({
  rating,
  onRate,
  onUnrate,
}: {
  rating: Rating | undefined;
  onRate: (feedback: FeedbackInput) => Promise<boolean>;
  onUnrate: () => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const id = useId();
  const current = rating?.feedback ?? null;
  const pending = rating?.pending === true;
  const [form, setForm] = useState<{ reasons: FeedbackReason[]; expected: string } | null>(null);
  // The agent counts Unicode characters, not UTF-16 units.
  const expectedLength = form === null ? 0 : Array.from(form.expected.trim()).length;
  const tooLong = expectedLength > MAX_FEEDBACK_EXPECTED_CHARACTERS;

  const openForm = () => {
    setForm({
      reasons: current?.rating === "down" ? current.reasons : [],
      expected: current?.rating === "down" ? current.expected : "",
    });
  };

  function up() {
    setForm(null);
    void (current?.rating === "up" ? onUnrate() : onRate({ rating: "up" }));
  }

  function down() {
    if (current?.rating === "down") {
      // The chosen thumb again: the feedback is withdrawn.
      setForm(null);
      void onUnrate();
      return;
    }
    openForm();
    void onRate({ rating: "down" });
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form === null || tooLong || pending) return;
    if (await onRate({ rating: "down", reasons: form.reasons, expected: form.expected }))
      setForm(null);
  }

  const thumb =
    "flex h-7 w-7 items-center justify-center rounded-(--radius-control) border border-line text-ink-muted hover:bg-surface-sunken hover:text-ink aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-ink disabled:opacity-60";

  return (
    <div className="flex flex-col gap-2">
      <div role="group" aria-labelledby={`${id}-q`} className="flex flex-wrap items-center gap-1.5">
        <span id={`${id}-q`} className="mr-1 text-ink-muted">
          {t("assistant.feedback.question")}
        </span>
        <button
          type="button"
          aria-pressed={current?.rating === "up"}
          disabled={pending}
          onClick={up}
          title={
            current?.rating === "up" ? t("assistant.feedback.withdraw") : t("assistant.feedback.up")
          }
          className={thumb}
        >
          <ThumbsUpIcon className="h-3.5 w-3.5" />
          <span className="sr-only">{t("assistant.feedback.up")}</span>
        </button>
        <button
          type="button"
          aria-pressed={current?.rating === "down"}
          aria-expanded={form !== null}
          disabled={pending}
          onClick={down}
          title={
            current?.rating === "down"
              ? t("assistant.feedback.withdraw")
              : t("assistant.feedback.down")
          }
          className={thumb}
        >
          <ThumbsDownIcon className="h-3.5 w-3.5" />
          <span className="sr-only">{t("assistant.feedback.down")}</span>
        </button>
        {current?.rating === "down" && form === null && (
          <button
            type="button"
            disabled={pending}
            onClick={openForm}
            className="text-accent underline-offset-2 hover:underline disabled:opacity-60"
          >
            {current.reasons.length > 0 || current.expected !== ""
              ? t("assistant.feedback.edit")
              : t("assistant.feedback.tellMore")}
          </button>
        )}
        <span role="status" className="text-ink-muted">
          {pending
            ? t("assistant.feedback.saving")
            : current !== null && form === null
              ? t("assistant.feedback.thanks")
              : ""}
        </span>
      </div>
      {rating !== undefined && rating.error !== null && (
        <p role="alert" className="text-state-down">
          ■ {t("assistant.feedback.failed", { message: errorText(t, rating.error) })}
        </p>
      )}
      {form !== null && (
        <form
          aria-label={t("assistant.feedback.details")}
          onSubmit={(event) => {
            void send(event);
          }}
          className="flex max-w-xl flex-col gap-2 rounded-(--radius-panel) border border-line p-3"
        >
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 font-medium">{t("assistant.feedback.why")}</legend>
            {FEEDBACK_REASONS.map((reason) => (
              <label key={reason} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.reasons.includes(reason)}
                  disabled={pending}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setForm((previous) =>
                      previous === null
                        ? previous
                        : {
                            ...previous,
                            reasons: checked
                              ? [...previous.reasons, reason]
                              : previous.reasons.filter((item) => item !== reason),
                          },
                    );
                  }}
                />
                {t(`assistant.feedback.reasons.${reason}`)}
              </label>
            ))}
          </fieldset>
          <label htmlFor={`${id}-expected`} className="mt-1 font-medium">
            {t("assistant.feedback.expected")}
          </label>
          <textarea
            id={`${id}-expected`}
            value={form.expected}
            rows={3}
            disabled={pending}
            aria-invalid={tooLong || undefined}
            aria-describedby={`${id}-count`}
            onChange={(event) => {
              const expected = event.target.value;
              setForm((previous) => (previous === null ? previous : { ...previous, expected }));
            }}
            className="resize-y rounded-(--radius-control) border border-line bg-surface px-2 py-1"
          />
          <span
            id={`${id}-count`}
            className={tooLong ? "text-state-down" : "text-right text-ink-muted"}
          >
            {tooLong
              ? t("assistant.feedback.tooLong", { max: MAX_FEEDBACK_EXPECTED_CHARACTERS })
              : t("assistant.feedback.count", {
                  count: expectedLength,
                  max: MAX_FEEDBACK_EXPECTED_CHARACTERS,
                })}
          </span>
          <p className="text-ink-muted">{t("assistant.feedback.privacy")}</p>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setForm(null);
              }}
              className="h-8 rounded-(--radius-control) border border-line px-3 text-ink hover:bg-surface-sunken disabled:opacity-60"
            >
              {t("assistant.feedback.later")}
            </button>
            <button
              type="submit"
              disabled={
                pending || tooLong || (form.reasons.length === 0 && form.expected.trim() === "")
              }
              className="h-8 rounded-(--radius-control) bg-accent px-3 font-medium text-accent-ink disabled:opacity-60"
            >
              {t("assistant.feedback.send")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
