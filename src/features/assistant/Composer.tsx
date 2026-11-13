import {
  useEffect,
  useId,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "@/components/ui/Modal";
import { ClockIcon, SendIcon } from "@/components/ui/icons";
import { MAX_PROMPT_BYTES } from "./assistant-client";
import { useSharedAssistantChat } from "./assistant-chat";
import { errorText } from "./error-text";

/** The composer grows with its text up to this many lines, then scrolls. */
const MAX_LINES = 8;

const BUTTON =
  "flex h-8 items-center justify-center gap-1.5 rounded-(--radius-control) border border-line px-3 text-ink hover:bg-surface-sunken disabled:opacity-60";
const SMALL_BUTTON =
  "h-7 rounded-(--radius-control) border border-line px-2 text-ink hover:bg-surface-sunken disabled:opacity-60";

/**
 * The message box of the assistant, as the page and the dock show it: the
 * message typed, held by the provider so that it goes from one to the other,
 * the message queued while a turn runs or an action waits, and the question
 * another page opened the chat with, put in the box of a new conversation,
 * never sent: the user reads it first.
 */
export function Composer({
  inputRef,
  compact = false,
  onReplacingChange,
}: {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  /** The dock: a shorter hint, the width of the dock. */
  compact?: boolean;
  /** Told while the dialog replacing the message queued is open. */
  onReplacingChange?: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const shared = useSharedAssistantChat();
  if (shared === null) throw new Error("Composer needs an AssistantChatProvider");
  const { chat, draft, setDraft } = shared;
  const composerId = useId();
  const hintId = useId();
  // The text that would replace the message queued, while the dialog asks.
  const [replacement, setReplacement] = useState<string | null>(null);

  const busy = chat.pending !== "";
  const waiting = chat.confirmation !== null;
  const promptTooLarge = new TextEncoder().encode(draft).length > MAX_PROMPT_BYTES;
  // A run resumed after an approval is the rest of its turn: the action runs,
  // then the model goes on, at times for long. The message box closes for the
  // short operations only: loading, resuming, renaming, deleting, previewing.
  const answering = chat.pending === "turn" || chat.pending === "confirming";
  const queueing = answering || (waiting && !busy);
  const composerClosed = !chat.historyReady || (busy && !answering);

  useEffect(() => {
    onReplacingChange?.(replacement !== null);
  }, [replacement, onReplacingChange]);

  // The message the dialog would replace went meanwhile: there is nothing left
  // to replace, and what the user typed stays in the box.
  useEffect(() => {
    if (replacement !== null && chat.queued === null) setReplacement(null);
  }, [replacement, chat.queued]);

  // The question another page opened the chat with, once the conversations are
  // read and no operation runs: a conversation on display is left for a new one,
  // whose box takes the question. One asked while a turn ran or an action waited
  // was dropped by the provider, which says so.
  useEffect(() => {
    const prompt = shared.prompt;
    if (prompt === null) return;
    if (!chat.historyReady || chat.pending !== "" || chat.confirmation !== null) return;
    if (chat.conversation !== null) {
      chat.startConversation();
      return;
    }
    setDraft(prompt);
    shared.takePrompt();
    inputRef.current?.focus();
    // On the question, the history, the operation, the action waiting and the
    // conversation shown only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shared.prompt, chat.historyReady, chat.pending, chat.confirmation, chat.conversation]);

  // The composer fits its text, up to MAX_LINES.
  useEffect(() => {
    const input = inputRef.current;
    if (input === null) return;
    input.style.height = "auto";
    const lineHeight = parseFloat(getComputedStyle(input).lineHeight) || 20;
    input.style.height = `${String(Math.min(input.scrollHeight, lineHeight * MAX_LINES + 16))}px`;
  }, [draft, inputRef]);

  function submit() {
    if (composerClosed || draft.trim() === "" || promptTooLarge) return;
    if (queueing) {
      // One message queued at most: replacing it is asked first.
      if (chat.queued !== null) {
        setReplacement(draft);
        return;
      }
      if (chat.queue(draft)) setDraft("");
      inputRef.current?.focus();
      return;
    }
    const prompt = draft;
    setDraft("");
    void chat.send(prompt);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter breaks the line; a composition in progress is left alone.
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing ||
      event.nativeEvent.keyCode === 229
    )
      return;
    event.preventDefault();
    submit();
  }

  // After a stop or a failure, nothing goes alone: the user sends the queued
  // message again, or takes it back.
  function resend() {
    const text = chat.takeQueued();
    if (text !== null) void chat.send(text);
  }

  function replace() {
    if (replacement !== null && chat.queue(replacement)) setDraft("");
    setReplacement(null);
    inputRef.current?.focus();
  }

  return (
    <>
      {shared.promptDropped && (
        <p role="status" className="mx-3 mb-2 text-ink-muted">
          {t("assistant.promptDropped")}
        </p>
      )}
      <form
        onSubmit={onSubmit}
        className={`flex flex-col gap-2 border-t border-line bg-surface ${compact ? "p-2" : "p-3"}`}
      >
        {/* Always there, so that the first message queued is announced too. */}
        <p aria-live="polite" className="sr-only">
          {chat.queued !== null ? t("assistant.queue.announce", { text: chat.queued.text }) : ""}
        </p>
        {chat.queued !== null && (
          <div
            role="group"
            aria-label={t("assistant.queue.label")}
            className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-2 rounded-(--radius-control) border border-line bg-surface-sunken px-2 py-1"
          >
            <ClockIcon className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
            <span className="text-ink-muted">{t("assistant.queue.label")}</span>
            {/* The text of the user, as typed. */}
            <span className="min-w-0 flex-1 truncate">{chat.queued.text}</span>
            {!queueing && !busy && (
              <button
                type="button"
                disabled={!chat.historyReady}
                onClick={resend}
                className={SMALL_BUTTON}
              >
                {t("assistant.queue.resend")}
              </button>
            )}
            <button
              type="button"
              // Never over what the user types.
              disabled={draft.trim() !== ""}
              onClick={() => {
                setDraft(chat.takeQueued() ?? "");
                inputRef.current?.focus();
              }}
              className={SMALL_BUTTON}
            >
              {t("assistant.queue.edit")}
            </button>
            <button type="button" onClick={chat.unqueue} className={SMALL_BUTTON}>
              {t("assistant.queue.remove")}
            </button>
          </div>
        )}
        <div className="mx-auto w-full max-w-3xl">
          <label htmlFor={composerId} className="sr-only">
            {t("assistant.composer.label")}
          </label>
          <div className="flex items-end gap-2 rounded-(--radius-panel) border border-line bg-surface-raised p-2 focus-within:border-accent">
            <textarea
              id={composerId}
              ref={inputRef}
              rows={1}
              value={draft}
              disabled={composerClosed}
              placeholder={t("assistant.composer.placeholder")}
              aria-describedby={hintId}
              aria-invalid={promptTooLarge || undefined}
              onChange={(event) => {
                setDraft(event.target.value);
                shared.clearPromptDropped();
              }}
              onKeyDown={onKeyDown}
              className="max-h-56 min-h-8 flex-1 resize-none bg-transparent px-1 py-1 leading-6 text-ink outline-none placeholder:text-ink-muted disabled:opacity-60"
            />
            {/* A turn only: after an approval the action runs on the agent, which
                a stop would not cancel; its result is what to see. */}
            {chat.pending === "turn" && (
              <button
                type="button"
                onClick={chat.stop}
                aria-label={t("assistant.composer.stop")}
                title={t("assistant.composer.stop")}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line text-ink hover:bg-surface-sunken"
              >
                <span aria-hidden="true" className="h-3 w-3 rounded-sm bg-current" />
              </button>
            )}
            <button
              type="submit"
              disabled={composerClosed || draft.trim() === "" || promptTooLarge}
              aria-label={queueing ? t("assistant.composer.queue") : t("assistant.composer.send")}
              title={queueing ? t("assistant.composer.queue") : t("assistant.composer.send")}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink disabled:opacity-40"
            >
              {queueing ? <ClockIcon className="h-4 w-4" /> : <SendIcon className="h-4 w-4" />}
            </button>
          </div>
          <p
            id={hintId}
            className={`mt-1.5 flex flex-wrap justify-between gap-x-4 gap-y-1 ${promptTooLarge ? "text-state-down" : "text-ink-muted"}`}
          >
            {promptTooLarge ? (
              <span>{t("assistant.composer.tooLarge")}</span>
            ) : waiting && !busy ? (
              <span>{t("assistant.composer.queuedDuringConfirmation")}</span>
            ) : answering ? (
              <span>{t("assistant.composer.queuedHint")}</span>
            ) : compact ? (
              <span>{t("assistant.composer.keys")}</span>
            ) : (
              <>
                <span>{t("assistant.composer.scope")}</span>
                <span>{t("assistant.composer.keys")}</span>
              </>
            )}
          </p>
        </div>
      </form>
      {replacement !== null && (
        <Modal
          title={t("assistant.dialog.replaceTitle")}
          closeLabel={t("detail.close")}
          className="max-w-md"
          onClose={() => {
            setReplacement(null);
          }}
        >
          <div className="flex flex-col gap-3">
            <p>{t("assistant.dialog.replaceText")}</p>
            {chat.error !== null && (
              <p role="alert" className="text-state-down">
                ■ {errorText(t, chat.error)}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setReplacement(null);
                }}
                className={BUTTON}
              >
                {t("detail.cancel")}
              </button>
              <button
                type="button"
                onClick={replace}
                className="h-8 rounded-(--radius-control) bg-accent px-3 font-medium text-accent-ink disabled:opacity-60"
              >
                {t("assistant.dialog.replace")}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
