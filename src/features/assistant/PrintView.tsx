import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Markdown } from "@/components/ui/Markdown";
import type { TurnHistory } from "./assistant-client";
import {
  exportDates,
  exportFileName,
  messageMeta,
  stepText,
  turnsOf,
  visibleText,
  type ExportDocument,
} from "./conversation-export";

/** The blank document the frame loads, after it is inserted. */
const FRAME_DOCUMENT = "<!DOCTYPE html><html><head></head><body></body></html>";

/**
 * A conversation of the assistant made ready to print, to save it as a PDF:
 * the same document as the Markdown export, drawn by the components of the
 * transcript, in a frame of its own out of sight. An answer goes through
 * Markdown, which shows no html, no image and links to the web only; a prompt
 * is plain text, as the transcript shows it.
 *
 * The frame takes the styles of the page and not its dark theme, and the name
 * of the file as its title: printing it leaves the page as it is. Safari
 * prints only on a click of the user: the frame is made beforehand, and
 * `onReady` gives its window once the document is in it, for the click to
 * print it at once (`window.print()`).
 */
export function PrintView({
  doc,
  onReady,
}: {
  doc: ExportDocument;
  onReady: (frame: Window) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [body, setBody] = useState<HTMLElement | null>(null);
  const ready = useRef(onReady);
  ready.current = onReady;

  // The document of the frame, once loaded: the styles of the page, its
  // language, the light theme, its title the name of the file. A frame without
  // a source loads as it is inserted, before an effect could listen: it is
  // given a document of its own, loaded after, and the load is listened to from
  // its creation (onLoad). The style sheets the page links load in it again:
  // the sheet is drawn once they did, or failed, a print never unstyled.
  const take = () => {
    const frameDocument = frame.current?.contentDocument;
    if (!frameDocument?.body || frameDocument.body === body) return;
    frameDocument.documentElement.lang = document.documentElement.lang;
    const styles = [...document.querySelectorAll('style, link[rel="stylesheet"]')].map((style) => {
      const copy = style.cloneNode(true) as HTMLElement;
      if (style instanceof HTMLLinkElement) copy.setAttribute("href", style.href);
      return copy;
    });
    frameDocument.head.replaceChildren(...styles);
    const loads = styles
      .filter((style) => style.tagName === "LINK")
      .map(
        (link) =>
          new Promise<void>((resolve) => {
            link.addEventListener("load", () => resolve(), { once: true });
            link.addEventListener("error", () => resolve(), { once: true });
            window.setTimeout(resolve, 3000);
          }),
      );
    const target = frameDocument.body;
    void Promise.all(loads).then(() => {
      setBody(target);
    });
  };

  useEffect(() => {
    const frameDocument = body?.ownerDocument;
    const view = frameDocument?.defaultView;
    if (!frameDocument || !view) return;
    frameDocument.title = exportFileName(visibleText(doc.title), doc.exportedAt, "");
    ready.current(view);
  }, [body, doc]);

  // The sheet before the frame: it goes first, while its document holds it.
  return (
    <>
      {body !== null && createPortal(<PrintSheet doc={doc} />, body)}
      {createPortal(
        <iframe
          ref={frame}
          srcDoc={FRAME_DOCUMENT}
          onLoad={take}
          title={doc.title}
          aria-hidden="true"
          tabIndex={-1}
          // Out of sight, but laid out: a frame not displayed prints nothing.
          className="pointer-events-none fixed top-0 -left-[10000px] h-[297mm] w-[210mm] border-0"
        />,
        document.body,
      )}
    </>
  );
}

/** The document printed. */
function PrintSheet({ doc }: { doc: ExportDocument }) {
  const { t, i18n } = useTranslation();
  const dates = exportDates(i18n, doc.timeZone);
  const about: string[] = [];
  if (doc.collector !== "")
    about.push(t("assistant.export.collector", { name: visibleText(doc.collector) }));
  about.push(t("assistant.export.exportedAt", { date: dates.format(doc.exportedAt) }));
  about.push(t("assistant.export.timeZone", { zone: dates.zone }));
  return (
    <article
      className="assistant-print text-ink"
      // The address the paths of the collector its links name are printed with.
      style={{ "--print-origin": JSON.stringify(window.location.origin) } as CSSProperties}
    >
      <h1 className="mb-1 text-title font-semibold">
        {visibleText(doc.title).trim() || t("assistant.untitled")}
      </h1>
      <p className="mb-4 text-ink-muted">{about.join(" · ")}</p>
      {turnsOf(doc.messages).map((turn, index) => (
        <section key={turn.id !== "" ? turn.id : index} className="border-t border-line pt-3 pb-1">
          {turn.prompt !== null && (
            <>
              <h2 className="assistant-print-meta mb-1 font-semibold">
                {messageMeta(t("assistant.message.you"), turn.prompt, dates)}
              </h2>
              <p className="mb-3 rounded-(--radius-control) border border-line bg-surface-sunken px-3 py-2 [overflow-wrap:anywhere] whitespace-pre-wrap">
                {turn.prompt.text.trim()}
              </p>
            </>
          )}
          {turn.answer !== null && (
            <>
              <h2 className="assistant-print-meta mb-1 font-semibold">
                {messageMeta(t("assistant.name"), turn.answer, dates)}
              </h2>
              {turn.answer.text.trim() !== "" && <Markdown text={turn.answer.text} />}
              <PrintSteps history={turn.answer.history} />
              {turn.answer.modelId !== undefined && (
                <p className="mt-2 mb-2 text-data text-ink-muted italic">
                  {t("assistant.export.model", { model: visibleText(turn.answer.modelId) })}
                </p>
              )}
            </>
          )}
        </section>
      ))}
      <p className="mt-3 border-t border-line pt-3 text-data text-ink-muted italic">
        {t("assistant.export.unstored")}
      </p>
    </article>
  );
}

/** The steps of an answer, as the Markdown export lists them. */
function PrintSteps({ history }: { history: TurnHistory | undefined }) {
  const { t, i18n } = useTranslation();
  const steps = history?.steps ?? [];
  const omitted = history?.stepsOmitted ?? 0;
  if (steps.length === 0 && omitted === 0) return null;
  return (
    <div className="mt-2 mb-2">
      <p className="font-semibold">{t("assistant.export.steps")}</p>
      <ul className="ml-5 list-disc">
        {steps.map((step) => (
          <li key={step.id}>{visibleText(stepText(step, t, i18n))}</li>
        ))}
        {omitted > 0 && <li>{t("assistant.export.stepsOmitted", { count: omitted })}</li>}
      </ul>
    </div>
  );
}
