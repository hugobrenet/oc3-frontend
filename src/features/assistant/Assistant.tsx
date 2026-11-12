import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { Markdown } from "@/components/ui/Markdown";
import { Modal } from "@/components/ui/Modal";
import { SearchBox } from "@/components/ui/SearchBox";
import {
  ClockIcon,
  InfoIcon,
  PencilIcon,
  PlusIcon,
  PuzzleIcon,
  SendIcon,
  SidebarIcon,
  SparklesIcon,
  TrashIcon,
} from "@/components/ui/icons";
import { dateTimeFormat } from "@/lib/date-format";
import { AnswerFeedback } from "./AnswerFeedback";
import { MAX_PROMPT_BYTES, type AssistantClient, type Conversation } from "./assistant-client";
import { ConfirmationCard } from "./ConfirmationCard";
import { groupConversations, useConversationsOpen } from "./conversations";
import { errorText } from "./error-text";
import { PromptTips } from "./PromptTips";
import { paramOf } from "./steps";
import { AnswerFooter, AnswerSteps, TARGET_ARGUMENTS, TargetBadge } from "./Steps";
import { ToolsDialog } from "./ToolsDialog";
import { useAssistantChat, type AssistantChat, type ChatMessage } from "./use-assistant-chat";
import { codeSpans, useTargets } from "./use-targets";
import { useToolDocs } from "./use-tool-docs";

/** The questions an empty conversation suggests, keys of `assistant.suggestions`. */
const SUGGESTIONS = ["servicesDown", "criticalAlerts", "silentNodes", "compliance"] as const;

/** The composer grows with its text up to this many lines, then scrolls. */
const MAX_LINES = 8;

const CONVERSATIONS_PANEL = "assistant-conversations-panel";
const PANEL =
  "flex min-h-0 min-w-0 flex-col overflow-hidden rounded-(--radius-panel) border border-line bg-surface-raised";
const ICON_BUTTON =
  "flex h-7 w-7 shrink-0 items-center justify-center rounded-(--radius-control) border border-line text-ink-muted hover:bg-surface-sunken hover:text-ink disabled:opacity-60";
const BUTTON =
  "flex h-8 items-center justify-center gap-1.5 rounded-(--radius-control) border border-line px-3 text-ink hover:bg-surface-sunken disabled:opacity-60";
const SMALL_BUTTON =
  "h-7 rounded-(--radius-control) border border-line px-2 text-ink hover:bg-surface-sunken disabled:opacity-60";

type Dialog = "" | "replace" | "delete";

/**
 * The conversation with the AI assistant: the user's conversations in a column,
 * grouped by day, the one open with its history, and the turn in progress
 * streamed as the agent writes it, with the steps of the tools it calls. Every
 * request goes through the relay of oc3 (`client`), which calls the agent with
 * the user's access token.
 *
 * The message box stays open while a turn runs and while an action waits for a
 * decision: what is sent then is queued, and goes once the turn ends. An action
 * waits on a card with its exact arguments, which the user approves, edits when
 * the tool allows it, or rejects.
 */
export function Assistant({
  client,
  initialPrompt,
  onPromptTaken,
}: {
  client: AssistantClient;
  /** A question to put in the message box of a new conversation, not sent. */
  initialPrompt?: string;
  /** Called once the question is in the message box. */
  onPromptTaken?: () => void;
}) {
  const { t } = useTranslation();
  const chat = useAssistantChat(client);
  const toolDocs = useToolDocs(client, chat.confirmation !== null);
  const panel = useConversationsOpen();
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [dialog, setDialog] = useState<Dialog>("");
  const [tipsOpen, setTipsOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  // The conversation the delete dialog asks about.
  const [deleting, setDeleting] = useState<Conversation | null>(null);
  // The text that would replace the message queued, while the dialog asks.
  const [replacement, setReplacement] = useState("");
  // The title edited in place of the heading, while renaming; set once saved or
  // canceled, so that the blur that follows does nothing more.
  const [title, setTitle] = useState("");
  const [renaming, setRenaming] = useState(false);
  const renameEnded = useRef(false);
  const transcript = useRef<HTMLDivElement>(null);
  const scrollAnchor = useRef<{
    conversationId: string | undefined;
    top: number;
    height: number;
  } | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const shownConversation = useRef<string | null>(null);
  const composerId = useId();
  const hintId = useId();

  const busy = chat.pending !== "";
  const waiting = chat.confirmation !== null;
  const promptTooLarge = new TextEncoder().encode(draft).length > MAX_PROMPT_BYTES;
  // A run resumed after an approval is the rest of its turn: the action runs,
  // then the model goes on, at times for long. The message box closes for the
  // short operations only: loading, resuming, renaming, deleting, previewing.
  const answering = chat.pending === "turn" || chat.pending === "confirming";
  const queueing = answering || (waiting && !busy);
  const composerClosed = !chat.historyReady || (busy && !answering);
  const titleOf = (conversation: Conversation) =>
    conversation.title !== "" ? conversation.title : t("assistant.untitled");
  // The search runs on the titles of the conversations loaded: the agent has none.
  const needle = search.trim().toLocaleLowerCase();
  const groups = groupConversations(
    needle === ""
      ? chat.conversations
      : chat.conversations.filter((conversation) =>
          titleOf(conversation).toLocaleLowerCase().includes(needle),
        ),
  );

  // Another conversation on display: the message box starts from the message
  // queued, given back, or empty. The conversation the first turn creates is the
  // one on display: what the user types meanwhile stays. One being resumed passes
  // through none, its history not read: only the one it goes to counts. At the
  // commit, before any click on what it shows, so that a dialog opened right
  // after is not closed by it.
  const conversationKey = chat.conversation?.id ?? "";
  useLayoutEffect(() => {
    if (!chat.historyReady) return;
    const previous = shownConversation.current;
    if (previous === conversationKey) return;
    shownConversation.current = conversationKey;
    if (chat.pending === "turn" && previous === "") return;
    setDraft(chat.takeQueued() ?? "");
    setDialog("");
    setTitle("");
    setRenaming(false);
    // The conversation shown only: the queue is read when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationKey, chat.pending, chat.historyReady]);

  // A question another page opened the assistant with, read once: the assistant
  // opens on no conversation, so the question goes in the message box of a new
  // one, once ready and after the effect above emptied the box. It is put there,
  // never sent: the user reads it first.
  const pendingPrompt = useRef(initialPrompt ?? "");
  useEffect(() => {
    if (pendingPrompt.current === "" || !chat.historyReady) return;
    setDraft(pendingPrompt.current);
    pendingPrompt.current = "";
    composer.current?.focus();
    onPromptTaken?.();
    // Once the history is ready only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.historyReady]);

  // The message the dialog would replace went meanwhile: there is nothing left
  // to replace, and what the user typed stays in the box.
  useEffect(() => {
    if (dialog === "replace" && chat.queued === null) setDialog("");
  }, [dialog, chat.queued]);

  // Before paint: the latest message stays in sight, and older messages put
  // before keep the reading position without a jump.
  useLayoutEffect(() => {
    const log = transcript.current;
    if (log === null) return;
    const anchor = scrollAnchor.current;
    log.scrollTop =
      anchor !== null && anchor.conversationId === chat.conversation?.id
        ? anchor.top + log.scrollHeight - anchor.height
        : log.scrollHeight;
    scrollAnchor.current = null;
    // The messages only: the position is kept otherwise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.messages]);

  useEffect(() => {
    if (chat.pending !== "history") scrollAnchor.current = null;
  }, [chat.pending]);

  // The composer fits its text, up to MAX_LINES.
  useEffect(() => {
    const input = composer.current;
    if (input === null) return;
    input.style.height = "auto";
    const lineHeight = parseFloat(getComputedStyle(input).lineHeight) || 20;
    input.style.height = `${String(Math.min(input.scrollHeight, lineHeight * MAX_LINES + 16))}px`;
  }, [draft]);

  function loadOlder() {
    const log = transcript.current;
    if (busy || log === null) return;
    scrollAnchor.current = {
      conversationId: chat.conversation?.id,
      top: log.scrollTop,
      height: log.scrollHeight,
    };
    void chat.loadOlderMessages();
  }

  function submit() {
    if (composerClosed || draft.trim() === "" || promptTooLarge) return;
    if (queueing) {
      // One message queued at most: replacing it is asked first.
      if (chat.queued !== null) {
        setReplacement(draft);
        setDialog("replace");
        return;
      }
      if (chat.queue(draft)) setDraft("");
      composer.current?.focus();
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

  async function confirmDialog() {
    if (dialog === "replace") {
      if (chat.queue(replacement)) setDraft("");
      setReplacement("");
      setDialog("");
      composer.current?.focus();
      return;
    }
    const result = await chat.deleteConversation(deleting?.id);
    if (result !== undefined) setDialog("");
  }

  function startRenaming() {
    renameEnded.current = false;
    setTitle(chat.conversation?.title ?? "");
    setRenaming(true);
  }

  // Enter or leaving the field saves the title, without a confirmation; Escape,
  // an empty or an unchanged title keeps the one there was.
  function endRenaming(save: boolean) {
    if (renameEnded.current) return;
    renameEnded.current = true;
    setRenaming(false);
    const next = title.trim();
    if (save && next !== "" && next !== (chat.conversation?.title ?? ""))
      void chat.renameConversation(next);
  }

  // The replacement of the queued message is asked while a turn runs.
  const dialogBusy = dialog !== "replace" && busy;
  const time = dateTimeFormat({ hour: "2-digit", minute: "2-digit" });
  const empty = chat.messages.length === 0 && chat.historyReady && chat.pending !== "resuming";

  return (
    <div
      className={`grid min-h-0 flex-1 gap-3 ${
        panel.open
          ? "grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[15rem_minmax(0,1fr)] md:grid-rows-1"
          : "grid-rows-1"
      }`}
    >
      <section
        id={CONVERSATIONS_PANEL}
        aria-labelledby={`${CONVERSATIONS_PANEL}-title`}
        hidden={!panel.open}
        className={`${PANEL} max-md:max-h-[40dvh]`}
      >
        <div className="flex flex-col gap-2 p-2">
          <h2 id={`${CONVERSATIONS_PANEL}-title`} className="sr-only">
            {t("assistant.conversations.title")}
          </h2>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              panel.fold();
              chat.startConversation();
            }}
            className={BUTTON}
          >
            <SparklesIcon className="h-3.5 w-3.5 text-accent" />
            {t("assistant.conversations.new")}
          </button>
          {chat.conversations.length > 0 && (
            <SearchBox
              value={search}
              onChange={setSearch}
              label={t("assistant.conversations.search")}
              className="w-full"
            />
          )}
          {chat.pending === "loading" && (
            <p role="status" className="px-2 text-ink-muted">
              {t("assistant.conversations.loading")}
            </p>
          )}
          {chat.conversations.length === 0 && !busy && (
            <p className="px-2 text-ink-muted">{t("assistant.conversations.empty")}</p>
          )}
          {chat.conversations.length > 0 && groups.length === 0 && (
            <p className="px-2 text-ink-muted">{t("assistant.conversations.noMatch")}</p>
          )}
        </div>
        <div className="relative flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-2 pb-2">
          {groups.map((group) => (
            <div key={group.key}>
              <h3
                id={`${CONVERSATIONS_PANEL}-${group.key}`}
                className="mb-1 px-2 font-semibold text-ink-muted"
              >
                {t(`assistant.conversations.groups.${group.key}`)}
              </h3>
              <ul
                aria-labelledby={`${CONVERSATIONS_PANEL}-${group.key}`}
                className="flex flex-col gap-0.5"
              >
                {group.items.map((conversation) => (
                  <li key={conversation.id} className="flex items-start gap-1">
                    <button
                      type="button"
                      aria-current={conversation.id === chat.conversation?.id ? "true" : undefined}
                      disabled={busy}
                      onClick={() => {
                        panel.fold();
                        void chat.resumeConversation(conversation.id);
                      }}
                      className="flex min-w-0 flex-1 flex-col items-start rounded-(--radius-control) px-2 py-1.5 text-left hover:bg-surface-sunken disabled:opacity-60 aria-[current=true]:bg-accent-soft"
                    >
                      <span className="w-full [overflow-wrap:anywhere]">
                        {titleOf(conversation)}
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={t("assistant.conversations.delete", {
                        title: titleOf(conversation),
                      })}
                      title={t("assistant.conversations.delete", { title: titleOf(conversation) })}
                      disabled={busy}
                      onClick={() => {
                        setDeleting(conversation);
                        setDialog("delete");
                      }}
                      className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-(--radius-control) text-ink-muted hover:bg-surface-sunken hover:text-state-down disabled:opacity-60"
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby={`${CONVERSATIONS_PANEL}-transcript`} className={PANEL}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <button
            type="button"
            aria-label={
              panel.open ? t("assistant.conversations.hide") : t("assistant.conversations.show")
            }
            title={
              panel.open ? t("assistant.conversations.hide") : t("assistant.conversations.show")
            }
            aria-expanded={panel.open}
            aria-controls={CONVERSATIONS_PANEL}
            onClick={panel.toggle}
            className={ICON_BUTTON}
          >
            <SidebarIcon open={panel.open} className="h-3.5 w-3.5" />
          </button>
          <h2
            id={`${CONVERSATIONS_PANEL}-transcript`}
            className={`min-w-0 font-semibold [overflow-wrap:anywhere] ${renaming ? "sr-only" : ""}`}
          >
            {chat.conversation !== null
              ? titleOf(chat.conversation)
              : t("assistant.transcript.start")}
          </h2>
          {renaming && chat.conversation !== null ? (
            <input
              autoFocus
              aria-label={t("assistant.transcript.titleLabel")}
              value={title}
              onFocus={(event) => {
                event.target.select();
              }}
              onChange={(event) => {
                setTitle(event.target.value);
              }}
              onBlur={() => {
                endRenaming(true);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  endRenaming(true);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  endRenaming(false);
                }
              }}
              className="h-7 max-w-sm min-w-0 flex-1 rounded-(--radius-control) border border-line bg-surface px-2 font-semibold"
            />
          ) : (
            chat.conversation !== null && (
              <button
                type="button"
                aria-label={t("assistant.transcript.rename")}
                title={t("assistant.transcript.rename")}
                disabled={busy}
                onClick={startRenaming}
                className={ICON_BUTTON}
              >
                <PencilIcon className="h-3 w-3" />
              </button>
            )
          )}
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              aria-label={t("assistant.tips.open")}
              title={t("assistant.tips.open")}
              onClick={() => {
                setTipsOpen(true);
              }}
              className={ICON_BUTTON}
            >
              <InfoIcon className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label={t("assistant.tools.open")}
              title={t("assistant.tools.open")}
              onClick={() => {
                setToolsOpen(true);
              }}
              className={ICON_BUTTON}
            >
              <PuzzleIcon className="h-3.5 w-3.5" />
            </button>
            {/* Folded, the panel still lets a conversation start from here. */}
            {!panel.open && (
              <button
                type="button"
                disabled={busy}
                onClick={chat.startConversation}
                className={`${SMALL_BUTTON} flex items-center gap-1`}
              >
                <PlusIcon className="h-3 w-3" />
                {t("assistant.conversations.new")}
              </button>
            )}
          </div>
        </div>

        <div
          ref={transcript}
          role="log"
          aria-label={t("assistant.transcript.log")}
          aria-live="polite"
          aria-relevant="additions text"
          aria-busy={answering}
          // Relative: the containing block of the hidden labels (sr-only) of the
          // steps, which are absolute. Without it, a step opened far down the
          // conversation placed them against the page, which grew and scrolled.
          className="relative min-h-48 flex-1 overflow-y-auto"
        >
          {chat.historyCursor !== "" && (
            <div className="px-4 pt-3">
              <button type="button" disabled={busy} onClick={loadOlder} className={SMALL_BUTTON}>
                {chat.pending === "history"
                  ? t("assistant.transcript.loadingEarlier")
                  : t("assistant.transcript.loadEarlier")}
              </button>
            </div>
          )}
          {chat.messages.length === 0 && !empty && (
            <p className="p-4 text-ink-muted">
              {chat.pending === "resuming"
                ? t("assistant.transcript.loadingSaved")
                : t("assistant.transcript.reselect")}
            </p>
          )}
          {empty && (
            <EmptyState
              onPick={(text) => {
                setDraft(text);
                composer.current?.focus();
              }}
            />
          )}
          {chat.messages.length > 0 && (
            <ol className="flex flex-col gap-3 px-4 py-6">
              {chat.messages.map((message, index) => {
                if (message.role === "user")
                  return <UserMessage key={message.id} message={message} time={time} />;
                // The answer of a turn is its last assistant message, once completed.
                const next = chat.messages[index + 1];
                const rateable =
                  message.status === "completed" &&
                  message.turnId !== undefined &&
                  !(next?.role === "assistant" && next.turnId === message.turnId);
                return (
                  <Answer key={message.id} message={message} chat={chat} rateable={rateable} />
                );
              })}
            </ol>
          )}
        </div>

        {chat.confirmation !== null && (
          <ConfirmationCard
            // A new confirmation, such as a preview asked again, takes a card of its own.
            key={chat.confirmation.id}
            confirmation={chat.confirmation}
            doc={toolDocs?.get(chat.confirmation.tool.name)}
            busy={busy}
            previewing={chat.pending === "previewing"}
            queued={chat.queued !== null}
            onApprove={(editedArgs) => {
              void chat.approve(editedArgs);
            }}
            onReject={() => {
              void chat.reject();
            }}
            onPreview={(editedArgs) => {
              void chat.previewAgain(editedArgs);
            }}
          />
        )}
        {chat.error !== null && dialog === "" && (
          <p role="alert" className="mx-3 mb-2 text-state-down">
            ■ {errorText(t, chat.error)}
          </p>
        )}
        {chat.notice !== "" && (
          <p role="status" className="mx-3 mb-2 text-ink-muted">
            {t(`assistant.notice.${chat.notice}`)}
          </p>
        )}

        <form
          onSubmit={onSubmit}
          className="flex flex-col gap-2 border-t border-line bg-surface p-3"
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
                  composer.current?.focus();
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
                ref={composer}
                rows={1}
                value={draft}
                disabled={composerClosed}
                placeholder={t("assistant.composer.placeholder")}
                aria-describedby={hintId}
                aria-invalid={promptTooLarge || undefined}
                onChange={(event) => {
                  setDraft(event.target.value);
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
              ) : (
                <>
                  <span>{t("assistant.composer.scope")}</span>
                  <span>{t("assistant.composer.keys")}</span>
                </>
              )}
            </p>
          </div>
        </form>
      </section>

      {dialog !== "" && (
        <Modal
          title={
            dialog === "replace"
              ? t("assistant.dialog.replaceTitle")
              : t("assistant.dialog.deleteTitle")
          }
          closeLabel={t("detail.close")}
          className="max-w-md"
          onClose={() => {
            if (!dialogBusy) setDialog("");
          }}
        >
          <div className="flex flex-col gap-3">
            <p>
              {dialog === "replace"
                ? t("assistant.dialog.replaceText")
                : t("assistant.dialog.deleteText", {
                    title: deleting !== null ? titleOf(deleting) : "",
                  })}
            </p>
            {chat.error !== null && (
              <p role="alert" className="text-state-down">
                ■ {errorText(t, chat.error)}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={dialogBusy}
                onClick={() => {
                  setDialog("");
                }}
                className={BUTTON}
              >
                {t("detail.cancel")}
              </button>
              <button
                type="button"
                disabled={dialogBusy}
                onClick={() => {
                  void confirmDialog();
                }}
                className={`h-8 rounded-(--radius-control) px-3 font-medium text-accent-ink disabled:opacity-60 ${dialog === "replace" ? "bg-accent" : "bg-state-down"}`}
              >
                {dialog === "replace"
                  ? t("assistant.dialog.replace")
                  : t("assistant.dialog.confirmDelete")}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {tipsOpen && (
        <Modal
          title={t("assistant.tips.title")}
          closeLabel={t("detail.close")}
          className="max-w-xl"
          onClose={() => {
            setTipsOpen(false);
          }}
        >
          <PromptTips />
        </Modal>
      )}
      {toolsOpen && (
        <ToolsDialog
          client={client}
          onClose={() => {
            setToolsOpen(false);
          }}
        />
      )}
    </div>
  );
}

/** An empty conversation: what the assistant answers from, questions to start with, and how to ask. */
function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  const { t } = useTranslation();
  const tipsId = useId();
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-6 px-4 py-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent">
        <SparklesIcon className="h-6 w-6" />
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-title font-semibold text-balance">{t("assistant.empty.title")}</h3>
        <p className="max-w-prose text-ink-muted">{t("assistant.empty.intro")}</p>
      </div>
      <ul
        className="grid w-full gap-2 sm:grid-cols-2"
        aria-label={t("assistant.empty.suggestions")}
      >
        {SUGGESTIONS.map((key) => (
          <li key={key}>
            <button
              type="button"
              onClick={() => {
                onPick(t(`assistant.suggestions.${key}`));
              }}
              className="h-full w-full rounded-(--radius-panel) border border-line bg-surface px-3 py-2.5 text-left text-ink transition-colors hover:border-accent hover:bg-accent-soft focus-visible:border-accent"
            >
              {t(`assistant.suggestions.${key}`)}
            </button>
          </li>
        ))}
      </ul>
      <section
        aria-labelledby={tipsId}
        className="w-full rounded-(--radius-panel) bg-surface-sunken p-3 text-left"
      >
        <h4 id={tipsId} className="mb-1.5 font-semibold">
          {t("assistant.tips.title")}
        </h4>
        <PromptTips />
      </section>
    </div>
  );
}

/**
 * A message of the transcript, as in the om3 webapp: a card of its own, its
 * author named on top, the user's against the right edge of the transcript on a
 * sunken ground, the assistant's against the left one, neither wider than 85%
 * of it: where one message ends and the next starts shows.
 */
const MESSAGE = "w-fit max-w-[85%] min-w-0 rounded-(--radius-control) border border-line px-3 py-2";
const MESSAGE_LABEL = "text-data font-semibold text-ink-muted";

function UserMessage({ message, time }: { message: ChatMessage; time: Intl.DateTimeFormat }) {
  const { t } = useTranslation();
  const date = new Date(message.createdAt ?? "");
  return (
    <li className={`${MESSAGE} self-end bg-surface-sunken`}>
      <p className={MESSAGE_LABEL}>
        <span aria-hidden="true">{t("assistant.message.you")}</span>
        <span className="sr-only">{t("assistant.you")}</span>
      </p>
      <p className="[overflow-wrap:anywhere] whitespace-pre-wrap text-ink">{message.text}</p>
      {!Number.isNaN(date.getTime()) && (
        <time
          dateTime={date.toISOString()}
          className="mt-1 block text-right text-data text-ink-muted"
        >
          {time.format(date)}
        </time>
      )}
    </li>
  );
}

/** An answer of the assistant: its steps, its text, how it ended, and the feedback of its turn. */
function Answer({
  message,
  chat,
  rateable,
}: {
  message: ChatMessage;
  chat: AssistantChat;
  rateable: boolean;
}) {
  const { t } = useTranslation();
  // The nodes and services the answer and its steps name, as the collector holds
  // them: asked once the answer is over, not at each span the stream completes.
  const targets = useTargets(
    message.status === "running"
      ? []
      : [
          ...codeSpans(message.text),
          ...message.steps.flatMap((step) =>
            TARGET_ARGUMENTS.flatMap((name) => {
              const value = paramOf(step.arguments?.[name]);
              return value === undefined ? [] : [value];
            }),
          ),
        ],
  );
  const turnId = message.turnId;
  return (
    <AssistantMessage>
      <AnswerSteps message={message} targets={targets} />
      {message.text !== "" && (
        <Markdown
          text={message.text}
          renderCode={(code) =>
            targets.has(code) ? <TargetBadge value={code} targets={targets} /> : undefined
          }
        />
      )}
      {message.status === "awaiting_confirmation" && (
        <p className="text-state-warn">{t("assistant.message.awaiting")}</p>
      )}
      {(message.status === "stopped" || message.status === "failed") && (
        <p className="text-state-warn">{t(`assistant.message.${message.status}`)}</p>
      )}
      {message.status !== "running" && <AnswerFooter message={message} />}
      {rateable && turnId !== undefined && (
        <AnswerFeedback
          rating={chat.ratings[turnId]}
          onRate={(feedback) => chat.rate(turnId, feedback)}
          onUnrate={() => chat.unrate(turnId)}
        />
      )}
    </AssistantMessage>
  );
}

function AssistantMessage({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <li className={`${MESSAGE} flex flex-col gap-2 self-start bg-surface`}>
      <p className={MESSAGE_LABEL}>{t("assistant.name")}</p>
      {children}
    </li>
  );
}
