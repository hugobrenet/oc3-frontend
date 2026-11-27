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
import { AlertTriangleIcon, ClockIcon, CloseIcon, SendIcon, StopIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { MAX_PROMPT_BYTES } from "./assistant-client";
import { useSharedAssistantChat } from "./assistant-chat";
import { promptOf } from "./use-assistant-chat";
import { ModelSelect } from "./ModelSelect";
import { errorText } from "./error-text";

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
 *
 * Where the agent serves skills (`chat.skills`), a `/` that starts the message
 * box lists them, filtered by what follows it: chosen with the arrows and Enter
 * or Tab, or a click, the skill is a tag over the box, the words typed after it
 * the message, and goes with it, the agent loading it first
 * (`forwardedProps.skill`). Sent without words, the message is the `/` and its
 * name, as the conversation shows it. Escape closes the list; a `/` elsewhere is
 * text.
 */
export function Composer({
  inputRef,
  compact = false,
  onReplacingChange,
}: {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  /** The dock: a message box a line shorter, the width of the dock. */
  compact?: boolean;
  /** Told while the dialog replacing the message queued is open. */
  onReplacingChange?: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const shared = useSharedAssistantChat();
  if (shared === null) throw new Error("Composer needs an AssistantChatProvider");
  const { chat, draft, setDraft, draftSkill, setDraftSkill, skillGone, setSkillGone } = shared;
  const composerId = useId();
  const hintId = useId();
  const listId = useId();
  // The message that would replace the message queued, its words and its skill
  // apart, while the dialog asks.
  const [replacement, setReplacement] = useState<{ text: string; skill?: string } | null>(null);

  const busy = chat.pending !== "";
  const waiting = chat.confirmation !== null;
  const promptTooLarge = new TextEncoder().encode(draft).length > MAX_PROMPT_BYTES;
  // A run resumed after an approval is the rest of its turn: the action runs,
  // then the model goes on, at times for long. The message box closes for the
  // short operations only: loading, resuming, renaming, deleting, previewing.
  const answering = chat.pending === "turn" || chat.pending === "confirming";
  const queueing = answering || (waiting && !busy);
  const composerClosed = !chat.historyReady || (busy && !answering);

  // A skill named whole at the start of the box, `/name` then a space or
  // nothing, is that skill, the rest the words: as if it was chosen.
  const named = (text: string) => {
    const match =
      draftSkill === null && chat.skills !== null
        ? /^\/([a-z0-9-]+)(?:\s+([\s\S]*))?$/.exec(text)
        : null;
    if (match === null) return null;
    const name = match[1] ?? "";
    return chat.skills?.some((skill) => skill.name === name) === true
      ? { skill: name, words: match[2] ?? "" }
      : null;
  };
  // The skill and the words the box sends, and its prompt: the words typed, or
  // the skill alone named.
  const asked = named(draft);
  const skill = draftSkill ?? asked?.skill ?? null;
  const words = asked !== null ? asked.words : draft;
  const message = promptOf(words, skill);

  // The skills a / at the start of the box lists, the one named whole first,
  // then those whose name begins with what follows it, then those holding it;
  // none once a skill is chosen, a space typed, Escape pressed on what is typed
  // or the box left.
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(0);
  const typed = draft.toLowerCase();
  const query =
    draftSkill === null && chat.skills !== null && /^\/[a-z0-9-]*$/.test(typed)
      ? typed.slice(1)
      : null;
  const matches =
    query === null || chat.skills === null
      ? []
      : [
          ...chat.skills.filter((item) => item.name === query),
          ...chat.skills.filter((item) => item.name !== query && item.name.startsWith(query)),
          ...chat.skills.filter(
            (item) => !item.name.startsWith(query) && item.name.includes(query),
          ),
        ];
  const listOpen = matches.length > 0 && !dismissed && !composerClosed;
  const activeIndex = Math.min(active, matches.length - 1);
  const choose = (name: string, rest = "") => {
    setSkillGone(null);
    setDraftSkill(name);
    setDraft(rest);
    setActive(0);
    inputRef.current?.focus();
  };
  const clearMessage = () => {
    setDraft("");
    setDraftSkill(null);
  };
  // The option the arrows reach stays in sight.
  useEffect(() => {
    if (!listOpen) return;
    document.getElementById(`${listId}-${String(activeIndex)}`)?.scrollIntoView?.({
      block: "nearest",
    });
  }, [listOpen, activeIndex, listId]);
  // A skill chosen that the list read again no longer holds goes, said so: the
  // provider holds the notice, gone with the identity it was for.
  useEffect(() => {
    if (
      draftSkill === null ||
      chat.skills === null ||
      chat.skills.some((item) => item.name === draftSkill)
    )
      return;
    setSkillGone(draftSkill);
    setDraftSkill(null);
  }, [draftSkill, chat.skills, setDraftSkill, setSkillGone]);

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
    setDraftSkill(null);
    shared.takePrompt();
    inputRef.current?.focus();
    // On the question, the history, the operation, the action waiting and the
    // conversation shown only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shared.prompt, chat.historyReady, chat.pending, chat.confirmation, chat.conversation]);

  function submit() {
    if (composerClosed || message.trim() === "" || promptTooLarge) return;
    setSkillGone(null);
    const sentSkill = skill ?? undefined;
    if (queueing) {
      // One message queued at most: replacing it is asked first. The queue
      // keeps the words and the skill apart.
      if (chat.queued !== null) {
        setReplacement({ text: words, ...(sentSkill !== undefined ? { skill: sentSkill } : {}) });
        return;
      }
      if (chat.queue(words, sentSkill)) clearMessage();
      inputRef.current?.focus();
      return;
    }
    clearMessage();
    void chat.send(message, undefined, undefined, sentSkill);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const composing = event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
    const chosen = matches[activeIndex];
    if (listOpen && !composing && chosen !== undefined) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActive((activeIndex + step + matches.length) % matches.length);
        return;
      }
      if (!event.shiftKey && (event.key === "Enter" || event.key === "Tab")) {
        event.preventDefault();
        choose(chosen.name);
        return;
      }
      if (event.key === "Escape") {
        // The list closes; the dock stays open.
        event.preventDefault();
        event.stopPropagation();
        setDismissed(true);
        return;
      }
    }
    // Backspace in an empty box takes the skill back.
    if (
      event.key === "Backspace" &&
      !event.repeat &&
      !composing &&
      draft === "" &&
      draftSkill !== null
    ) {
      event.preventDefault();
      setDraftSkill(null);
      return;
    }
    // Enter sends, Shift+Enter breaks the line; a composition in progress is left alone.
    if (event.key !== "Enter" || event.shiftKey || composing) return;
    event.preventDefault();
    submit();
  }

  // After a stop or a failure, nothing goes alone: the user sends the queued
  // message again, or takes it back.
  // Sent again, it goes with the page it was asked from, and the model it was
  // queued with; the one chosen now if none.
  function resend() {
    const context = chat.queued?.context;
    const model = chat.queued?.model;
    const queuedSkill = chat.queued?.skill;
    const prompt = promptOf(chat.takeQueued() ?? "", queuedSkill);
    if (prompt !== "") void chat.send(prompt, context, model, queuedSkill);
  }

  function replace() {
    if (replacement !== null && chat.queue(replacement.text, replacement.skill)) clearMessage();
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
        className={`flex flex-col gap-2 border-t border-line ${compact ? "p-2" : "p-3"}`}
      >
        {/* Always there, so that the first message queued is announced too. */}
        <p aria-live="polite" className="sr-only">
          {chat.queued !== null
            ? t("assistant.queue.announce", {
                text: [
                  chat.queued.skill !== undefined ? `/${chat.queued.skill}` : "",
                  chat.queued.text,
                ]
                  .filter((part) => part !== "")
                  .join(" "),
              })
            : ""}
        </p>
        {/* The skill chosen, or gone, told as it is: always there, so that it
            is announced. */}
        <p aria-live="polite" className="sr-only">
          {draftSkill !== null
            ? t("assistant.skills.chosen", { skill: draftSkill })
            : skillGone !== null
              ? t("assistant.skills.gone", { skill: skillGone })
              : ""}
        </p>
        {skillGone !== null && (
          <p aria-hidden="true" className="text-ink-muted">
            {t("assistant.skills.gone", { skill: skillGone })}
          </p>
        )}
        {chat.queued !== null && (
          <div
            role="group"
            aria-label={t("assistant.queue.label")}
            className="flex flex-wrap items-center gap-2 rounded-(--radius-control) border border-line bg-surface-sunken px-2 py-1 text-data"
          >
            <ClockIcon className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
            <span className="text-ink-muted">{t("assistant.queue.label")}</span>
            {/* The skill asked, then the text of the user, as typed. */}
            <span className="min-w-0 flex-1 truncate">
              {chat.queued.skill !== undefined && (
                <span className="mr-1 font-mono">/{chat.queued.skill}</span>
              )}
              {chat.queued.text}
            </span>
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
              disabled={draft.trim() !== "" || draftSkill !== null}
              onClick={() => {
                const queuedSkill = chat.queued?.skill ?? null;
                setDraft(chat.takeQueued() ?? "");
                setDraftSkill(queuedSkill);
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
        {draftSkill !== null && (
          <div className="flex items-center gap-2 text-data">
            <span className="text-ink-muted">{t("assistant.skills.tag")}</span>
            <span className="inline-flex min-w-0 items-center gap-1 rounded-(--radius-control) border border-line bg-surface-sunken py-0.5 pr-0.5 pl-2 font-mono">
              <span className="truncate">/{draftSkill}</span>
              <button
                type="button"
                aria-label={t("assistant.skills.remove", { skill: draftSkill })}
                title={t("assistant.skills.remove", { skill: draftSkill })}
                disabled={composerClosed}
                onClick={() => {
                  setDraftSkill(null);
                  inputRef.current?.focus();
                }}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-(--radius-control) text-ink-muted hover:bg-surface-raised hover:text-ink"
              >
                <CloseIcon className="h-3 w-3" />
              </button>
            </span>
          </div>
        )}
        {listOpen && (
          <ul
            id={listId}
            role="listbox"
            aria-label={t("assistant.skills.list")}
            className="max-h-48 overflow-y-auto rounded-(--radius-control) border border-line bg-surface-raised py-1 shadow-md"
          >
            {matches.map((item, index) => (
              <li
                key={item.name}
                id={`${listId}-${String(index)}`}
                role="option"
                aria-selected={index === activeIndex}
                // The box keeps the focus.
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                onClick={() => {
                  choose(item.name);
                }}
                className={cn(
                  "flex cursor-pointer flex-col px-2 py-1",
                  index === activeIndex && "bg-surface-sunken",
                )}
              >
                <span className="font-mono">/{item.name}</span>
                {/* Written by the authors of the skills, shown as text. */}
                {item.description !== "" && (
                  <span className="line-clamp-2 [overflow-wrap:anywhere] text-ink-muted">
                    {item.description}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {/* As the om3 webapp: the label above the box, the hint or the error
            under it, then the model and the buttons. */}
        <div>
          <label htmlFor={composerId} className="mb-1 block font-medium">
            {t("assistant.composer.label")}
          </label>
          <textarea
            id={composerId}
            ref={inputRef}
            rows={compact ? 2 : 3}
            value={draft}
            disabled={composerClosed}
            placeholder={t("assistant.composer.placeholder")}
            aria-describedby={hintId}
            aria-invalid={promptTooLarge || undefined}
            {...(chat.skills !== null
              ? {
                  "aria-autocomplete": "list" as const,
                  "aria-controls": listOpen ? listId : undefined,
                  "aria-activedescendant": listOpen
                    ? `${listId}-${String(activeIndex)}`
                    : undefined,
                }
              : {})}
            onChange={(event) => {
              const value = event.target.value;
              setActive(0);
              setDismissed(false);
              shared.clearPromptDropped();
              // A skill named whole, then a space: chosen.
              const whole = /\s$/.test(value) ? named(value) : null;
              if (whole !== null) choose(whole.skill, whole.words);
              else setDraft(value);
            }}
            onBlur={() => {
              setDismissed(true);
            }}
            onFocus={() => {
              setDismissed(false);
            }}
            onKeyDown={onKeyDown}
            className={`w-full resize-y rounded-(--radius-control) border border-line bg-surface px-2 py-1 text-ink placeholder:text-ink-muted disabled:opacity-60 aria-invalid:border-state-down ${compact ? "max-h-32" : "max-h-48"}`}
          />
          {promptTooLarge ? (
            <p id={hintId} className="mt-1 flex items-center gap-1 text-data text-state-down">
              <AlertTriangleIcon className="shrink-0" />
              {t("assistant.composer.tooLarge")}
            </p>
          ) : (
            <p id={hintId} className="mt-1 text-data text-ink-muted">
              {waiting && !busy
                ? t("assistant.composer.queuedDuringConfirmation")
                : answering
                  ? t("assistant.composer.queuedHint")
                  : chat.skills !== null && draftSkill === null
                    ? `${t("assistant.composer.keys")} · ${t("assistant.composer.skillsHint")}`
                    : t("assistant.composer.keys")}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {chat.models !== null && (
            <div className="mr-auto min-w-0">
              <ModelSelect chat={chat} disabled={composerClosed} />
            </div>
          )}
          {/* A turn only: after an approval the action runs on the agent, which
              a stop would not cancel; its result is what to see. */}
          {chat.pending === "turn" && (
            <button type="button" onClick={chat.stop} className={`${BUTTON} font-medium`}>
              <StopIcon className="h-3.5 w-3.5" />
              {t("assistant.composer.stop")}
            </button>
          )}
          <button
            type="submit"
            disabled={composerClosed || message.trim() === "" || promptTooLarge}
            className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-(--radius-control) bg-accent px-3 font-medium whitespace-nowrap text-accent-ink hover:brightness-110 disabled:pointer-events-none disabled:opacity-60"
          >
            {queueing ? (
              <ClockIcon className="h-3.5 w-3.5" />
            ) : (
              <SendIcon className="h-3.5 w-3.5" />
            )}
            {queueing ? t("assistant.composer.queue") : t("assistant.composer.send")}
          </button>
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
