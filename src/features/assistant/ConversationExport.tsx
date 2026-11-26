import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { MenuButton } from "@/components/ui/MenuButton";
import { DownloadIcon, FileMarkdownIcon, FilePdfIcon } from "@/components/ui/icons";
import { download } from "@/lib/export/table";
import { useSharedAssistantChat } from "./assistant-chat";
import {
  conversationMarkdown,
  ExportTooLong,
  exportFileName,
  wholeHistory,
  type ExportDocument,
} from "./conversation-export";
import { errorText } from "./error-text";
import { PrintView } from "./PrintView";

const SMALL_BUTTON =
  "h-7 rounded-(--radius-control) border border-line px-2 text-ink hover:bg-surface-sunken disabled:opacity-60";

/** What an export tells the user: a failure, nothing to export, or the print ready. */
type ExportNotice = { tone: "error" | "info"; text: string } | null;

/**
 * The export of the conversation on display: in Markdown, to paste in a ticket
 * or edit, or in PDF, through the print dialog of the browser. Gives the menu
 * for the header of the transcript, what an export tells under it, and the
 * frame the print is made ready in.
 *
 * Both read the whole history again from the agent, the earlier messages not
 * loaded included, once per state of the transcript; offered once the
 * conversation holds a message and nothing runs nor waits, the turn of the
 * moment not stored yet. Pressing the menu reads it, and makes the print
 * ready: Safari prints only on a click of the user, the click on the entry. A
 * click before the history is read offers the print once it is ready.
 */
export function useConversationExport(): { menu: ReactNode; notices: ReactNode; frame: ReactNode } {
  const { t, i18n } = useTranslation();
  const shared = useSharedAssistantChat();
  if (shared === null) throw new Error("useConversationExport needs an AssistantChatProvider");
  const { chat, client } = shared;
  const conversation = chat.conversation;

  // The whole history read, {key, doc}, the key that of the transcript it was
  // read for; the one being read.
  const [prepared, setPrepared] = useState<{ key: string; doc: ExportDocument } | null>(null);
  const loading = useRef<{
    key: string;
    run: AbortController;
    promise: Promise<ExportDocument | null>;
  } | null>(null);
  // The frame printing `prepared` once its document is in it, and the key it
  // holds; the offer to print once it is ready, after a click too early.
  const printWindow = useRef<Window | null>(null);
  const [frameKey, setFrameKey] = useState<string | null>(null);
  const [printOffer, setPrintOffer] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const [notice, setNotice] = useState<ExportNotice>(null);

  const last = chat.messages.at(-1);
  const title =
    conversation === null || conversation.title === ""
      ? t("assistant.untitled")
      : conversation.title;
  // What the transcript holds now, its title too: a history read for another is read again.
  const historyKey =
    conversation === null
      ? null
      : JSON.stringify([conversation.id, chat.messages.length, last?.id ?? "", title]);
  // The menu, to give the focus back to once the print dialog closes.
  const menuRoot = useRef<HTMLSpanElement>(null);
  const off = chat.pending !== "" || chat.confirmation !== null || chat.messages.length === 0;

  function loadHistory(): Promise<ExportDocument | null> {
    if (conversation === null || historyKey === null) return Promise.resolve(null);
    const key = historyKey;
    if (prepared?.key === key) return Promise.resolve(prepared.doc);
    if (loading.current?.key === key) return loading.current.promise;
    loading.current?.run.abort();
    const run = new AbortController();
    const promise = (async () => {
      let messages;
      try {
        messages = await wholeHistory(client, conversation.id, { signal: run.signal });
      } catch (error) {
        // Dropped: another conversation, or the page left.
        if (run.signal.aborted) return null;
        throw error;
      }
      if (run.signal.aborted) return null;
      const doc: ExportDocument = {
        title,
        collector: window.location.host,
        origin: window.location.origin,
        messages,
        exportedAt: new Date(),
      };
      setPrepared({ key, doc });
      return doc;
    })();
    loading.current = { key, run, promise };
    const done = () => {
      if (loading.current?.run === run) loading.current = null;
    };
    promise.then(done, done);
    return promise;
  }

  // Pressing the menu reads the history and makes the print ready; a print
  // made ready a while ago is dated again, the date of the export its own.
  function prepare() {
    if (off) return;
    if (prepared?.key === historyKey && Date.now() - prepared.doc.exportedAt.getTime() > 60000) {
      setPrepared({ key: prepared.key, doc: { ...prepared.doc, exportedAt: new Date() } });
      return;
    }
    loadHistory().catch(() => {
      // Told if the user asks for the export.
    });
  }

  // The print of the frame made ready, at once: within the click. The focus
  // goes back to the menu once the dialog closes, out of the frame.
  function printNow() {
    setPrintOffer(false);
    const view = printWindow.current;
    if (view === null) return;
    view.addEventListener(
      "afterprint",
      () => {
        menuRoot.current?.querySelector("button")?.focus();
      },
      { once: true },
    );
    try {
      view.focus();
      view.print();
    } catch {
      setNotice({ tone: "error", text: t("assistant.export.printFailed") });
    }
  }

  async function exportAs(format: "md" | "pdf") {
    if (conversation === null) return;
    const ready = prepared?.key === historyKey && prepared.doc.messages.length > 0;
    if (format === "pdf" && ready && frameKey === historyKey && printWindow.current !== null) {
      printNow();
      return;
    }
    setExporting(true);
    setExported(false);
    setNotice(null);
    setPrintOffer(false);
    try {
      const doc = await loadHistory();
      if (doc === null) return;
      // Its turns stopped or failed only: the agent stored none.
      if (doc.messages.length === 0) {
        setNotice({ tone: "info", text: t("assistant.export.empty") });
        return;
      }
      if (format === "pdf") {
        setPrintOffer(true);
        return;
      }
      const exportedAt = new Date();
      download(
        new Blob([conversationMarkdown({ ...doc, exportedAt }, t, i18n)], {
          type: "text/markdown;charset=utf-8",
        }),
        exportFileName(doc.title, exportedAt),
      );
      setExported(true);
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof ExportTooLong ? t("assistant.export.tooLong") : errorText(t, error),
      });
    } finally {
      setExporting(false);
    }
  }

  // The transcript changed before the print offered was taken: it goes.
  useEffect(() => {
    setPrintOffer(false);
  }, [historyKey]);

  // Another conversation on display, or the page left: the export running, its
  // history and what the last one told go.
  const conversationId = conversation?.id ?? "";
  useEffect(
    () => () => {
      loading.current?.run.abort();
      loading.current = null;
      printWindow.current = null;
      setPrepared(null);
      setFrameKey(null);
      setPrintOffer(false);
      setExporting(false);
      setExported(false);
      setNotice(null);
    },
    [conversationId],
  );

  const menu =
    conversation === null ? null : (
      <span
        ref={menuRoot}
        className="inline-flex"
        onPointerDownCapture={prepare}
        onKeyDownCapture={(event) => {
          if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) prepare();
        }}
      >
        <MenuButton
          label={t("assistant.export.open")}
          iconOnly
          align="end"
          disabled={off}
          icon={
            exporting ? (
              <span
                aria-hidden="true"
                className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line border-t-accent"
              />
            ) : (
              <DownloadIcon className="h-3.5 w-3.5" />
            )
          }
          items={[
            {
              key: "md",
              label: t("assistant.export.markdown"),
              icon: <FileMarkdownIcon className="h-4 w-4" />,
              disabled: exporting,
              onSelect: () => void exportAs("md"),
            },
            {
              key: "pdf",
              label: t("assistant.export.pdf"),
              icon: <FilePdfIcon className="h-4 w-4" />,
              disabled: exporting,
              onSelect: () => void exportAs("pdf"),
            },
          ]}
        />
      </span>
    );

  const notices = (
    <>
      {/* Told by a region always there, the menu keeping the focus while it runs. */}
      <p role="status" className="sr-only">
        {exporting
          ? t("assistant.export.exporting")
          : printOffer && frameKey === historyKey
            ? t("assistant.export.printReady")
            : exported
              ? t("assistant.export.done")
              : ""}
      </p>
      {printOffer && frameKey === historyKey && (
        <div className="mx-3 mb-2 flex flex-wrap items-center gap-2 text-ink-muted">
          <p aria-hidden="true">{t("assistant.export.printReady")}</p>
          <button type="button" onClick={printNow} className={SMALL_BUTTON}>
            {t("assistant.export.print")}
          </button>
        </div>
      )}
      {notice !== null && (
        <div className="mx-3 mb-2 flex flex-wrap items-center gap-2">
          <p
            role={notice.tone === "error" ? "alert" : "status"}
            className={notice.tone === "error" ? "text-state-down" : "text-ink-muted"}
          >
            {notice.tone === "error" ? `■ ${notice.text}` : notice.text}
          </p>
          <button
            type="button"
            onClick={() => {
              setNotice(null);
            }}
            className={SMALL_BUTTON}
          >
            {t("assistant.export.dismiss")}
          </button>
        </div>
      )}
    </>
  );

  const frame =
    prepared !== null && prepared.doc.messages.length > 0 ? (
      <PrintView
        key={prepared.key}
        doc={prepared.doc}
        onReady={(view) => {
          printWindow.current = view;
          setFrameKey(prepared.key);
        }}
      />
    ) : null;

  return { menu, notices, frame };
}
