import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Markdown } from "@/components/ui/Markdown";
import { Modal } from "@/components/ui/Modal";
import { SearchBox } from "@/components/ui/SearchBox";
import {
  InfoIcon,
  PencilIcon,
  PlusIcon,
  PuzzleIcon,
  SidebarIcon,
  SparklesIcon,
  TrashIcon,
} from "@/components/ui/icons";
import { dateTimeFormat } from "@/lib/date-format";
import { AnswerFeedback } from "./AnswerFeedback";
import { type AssistantClient, type Conversation } from "./assistant-client";
import { Composer } from "./Composer";
import { ConfirmationCard } from "./ConfirmationCard";
import { groupConversations, useConversationsOpen } from "./conversations";
import { errorText } from "./error-text";
import { PromptTips } from "./PromptTips";
import { paramOf } from "./steps";
import { AnswerFooter, AnswerSteps, TARGET_ARGUMENTS, TargetBadge } from "./Steps";
import { ToolsDialog } from "./ToolsDialog";
import { AssistantChatProvider } from "./assistant-chat-context";
import { useSharedAssistantChat } from "./assistant-chat";
import { type AssistantChat, type ChatMessage } from "./use-assistant-chat";
import { codeSpans, useTargets } from "./use-targets";
import { useToolDocs } from "./use-tool-docs";

/** The questions an empty conversation suggests, keys of `assistant.suggestions`. */
const SUGGESTIONS = ["servicesDown", "criticalAlerts", "silentNodes", "compliance"] as const;

const CONVERSATIONS_PANEL = "assistant-conversations-panel";
const PANEL =
  "flex min-h-0 min-w-0 flex-col overflow-hidden rounded-(--radius-panel) border border-line bg-surface-raised";
const ICON_BUTTON =
  "flex h-7 w-7 shrink-0 items-center justify-center rounded-(--radius-control) border border-line text-ink-muted hover:bg-surface-sunken hover:text-ink disabled:opacity-60";
const BUTTON =
  "flex h-8 items-center justify-center gap-1.5 rounded-(--radius-control) border border-line px-3 text-ink hover:bg-surface-sunken disabled:opacity-60";
const SMALL_BUTTON =
  "h-7 rounded-(--radius-control) border border-line px-2 text-ink hover:bg-surface-sunken disabled:opacity-60";

type Dialog = "" | "delete";

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
export function Assistant(props: AssistantProps) {
  // The chat the application holds, so that a turn goes on while the user looks
  // at another page; without one, as in a test, a chat of this page alone.
  if (useSharedAssistantChat() === null)
    return (
      <AssistantChatProvider client={props.client}>
        <AssistantView {...props} />
      </AssistantChatProvider>
    );
  return <AssistantView {...props} />;
}

interface AssistantProps {
  client: AssistantClient;
  /** A question to put in the message box of a new conversation, not sent. */
  initialPrompt?: string;
  /** Called once the question is asked of the chat. */
  onPromptTaken?: () => void;
}

function AssistantView({ client, initialPrompt, onPromptTaken }: AssistantProps) {
  const { t } = useTranslation();
  const shared = useSharedAssistantChat();
  if (shared === null) throw new Error("AssistantView needs an AssistantChatProvider");
  const chat = shared.chat;
  // The page on display: the turns that end now are read, not left unread.
  const { attach } = shared;
  useEffect(() => attach(), [attach]);
  const toolDocs = useToolDocs(client, chat.confirmation !== null);
  const panel = useConversationsOpen();
  const [search, setSearch] = useState("");
  const { setDraft } = shared;
  const [dialog, setDialog] = useState<Dialog>("");
  // The dialog of the composer replacing the message queued is open.
  const [replacing, setReplacing] = useState(false);
  const [tipsOpen, setTipsOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  // The conversation the delete dialog asks about.
  const [deleting, setDeleting] = useState<Conversation | null>(null);
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

  const busy = chat.pending !== "";
  const answering = chat.pending === "turn" || chat.pending === "confirming";
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

  // Another conversation on display: the dialogs and the renaming of the former
  // one end. The message box is the provider's, which starts it again.
  const conversationKey = chat.conversation?.id ?? "";
  useLayoutEffect(() => {
    if (!chat.historyReady) return;
    const previous = shownConversation.current;
    if (previous === conversationKey) return;
    shownConversation.current = conversationKey;
    if (chat.pending === "turn" && previous === "") return;
    setDialog("");
    setTitle("");
    setRenaming(false);
  }, [conversationKey, chat.pending, chat.historyReady]);

  // A question another page opened the assistant with, asked of the chat once,
  // when the view mounts: the composer puts it in the message box of a new
  // conversation, or the chat drops it, and says so, when a turn runs or an
  // action waits. The links that give one are on other pages; a link in this
  // page would need an effect on initialPrompt.
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current || initialPrompt === undefined || initialPrompt === "") return;
    asked.current = true;
    shared.ask(initialPrompt);
    onPromptTaken?.();
    // Once, when the view mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  async function confirmDialog() {
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

  const dialogBusy = busy;
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
        {chat.error !== null && dialog === "" && !replacing && (
          <p role="alert" className="mx-3 mb-2 text-state-down">
            ■ {errorText(t, chat.error)}
          </p>
        )}
        {chat.notice !== "" && (
          <p role="status" className="mx-3 mb-2 text-ink-muted">
            {t(`assistant.notice.${chat.notice}`)}
          </p>
        )}
        <Composer inputRef={composer} onReplacingChange={setReplacing} />
      </section>

      {dialog !== "" && (
        <Modal
          title={t("assistant.dialog.deleteTitle")}
          closeLabel={t("detail.close")}
          className="max-w-md"
          onClose={() => {
            if (!dialogBusy) setDialog("");
          }}
        >
          <div className="flex flex-col gap-3">
            <p>
              {t("assistant.dialog.deleteText", {
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
                className="h-8 rounded-(--radius-control) bg-state-down px-3 font-medium text-accent-ink disabled:opacity-60"
              >
                {t("assistant.dialog.confirmDelete")}
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

export function UserMessage({
  message,
  time,
}: {
  message: ChatMessage;
  time: Intl.DateTimeFormat;
}) {
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
export function Answer({
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
