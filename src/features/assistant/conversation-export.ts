import type { i18n as I18n, TFunction } from "i18next";
import type { AssistantClient, Step, StoredMessage } from "./assistant-client";
import { answerDuration, formatDuration, stepSentence } from "./steps";

/**
 * A conversation of the assistant as a document, to keep, attach to a ticket
 * or pass along: its title, the collector, when it was exported and in which
 * time zone, then each prompt and its answer as the agent stored them. Under
 * an answer, its steps, as the transcript says them, with the model, the time
 * and the duration of its turn. Never what a call read, nor its arguments but
 * the target the sentence of its step names.
 *
 * In Markdown, what the user and the model wrote cannot pass for the document:
 * a prompt is a code block, as the transcript shows it, plain; an answer is
 * quoted, its code blocks fenced again, its inline markup escaped: nothing in
 * it loads or leads anywhere, no image, no html, no link but the addresses it
 * writes. The other values, the title, the collector, the step sentences and
 * the model, are text, their invisible characters dropped.
 *
 * The agent stores the turns that ended: an answer stopped or failed is not
 * in the history, nor in the export, which says so.
 */

/** The messages of a page of the history the agent gives at most. */
const PAGE = 100;
/** The pages read at most: past them, the conversation is too long to export. */
const MAX_PAGES = 64;

export class ExportTooLong extends Error {}

/** What an export holds: the conversation, read whole. */
export interface ExportDocument {
  title: string;
  /** The collector the conversation is held on, as its address names it. */
  collector: string;
  messages: StoredMessage[];
  exportedAt: Date;
  /** The time zone of the dates, the user's when left out. */
  timeZone?: string;
  /** The address the paths of the collector an answer links are read from. */
  origin?: string;
}

/**
 * All the stored messages of a conversation, the oldest first, read page by
 * page from the most recent, as the transcript loads them.
 */
export async function wholeHistory(
  client: AssistantClient,
  id: string,
  { signal }: { signal?: AbortSignal } = {},
): Promise<StoredMessage[]> {
  const pages: StoredMessage[][] = [];
  let before = "";
  for (let read = 0; read < MAX_PAGES; read++) {
    const page = await client.getMessages(id, { limit: PAGE, before, signal });
    pages.unshift(page.messages);
    if (page.nextCursor === "") return pages.flat();
    before = page.nextCursor;
  }
  throw new ExportTooLong("The conversation is too long to be exported.");
}

/** A prompt and its answer. */
export interface ExportTurn {
  id: string;
  prompt: StoredMessage | null;
  answer: StoredMessage | null;
}

/**
 * The turns of the messages: a prompt and its answer, the texts of the
 * assistant messages of a turn as paragraphs, the steps and the model of the
 * last one, which carries them.
 */
export function turnsOf(messages: StoredMessage[]): ExportTurn[] {
  const turns: ExportTurn[] = [];
  for (const message of messages) {
    const last = turns.at(-1);
    if (message.role === "user") {
      turns.push({ id: message.turnId, prompt: message, answer: null });
    } else if (last !== undefined && last.id === message.turnId) {
      last.answer =
        last.answer === null
          ? message
          : {
              ...last.answer,
              ...message,
              text: [last.answer.text, message.text].filter((text) => text !== "").join("\n\n"),
            };
    } else {
      turns.push({ id: message.turnId, prompt: null, answer: message });
    }
  }
  return turns;
}

// The characters a reader does not see: controls, formats such as the marks
// of direction, and the separators of lines and paragraphs.
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

/** A value of the document as it reads, on one line, its invisible characters dropped. */
export const visibleText = (text: string) => text.replace(/\s+/g, " ").replace(INVISIBLE, "");

// A value as text of the Markdown, on one line: no link, emphasis,
// strikethrough nor html of its own.
const escapeInline = (text: string) =>
  visibleText(text).replace(/[\\`*_~[\]<>|]/g, (character) => `\\${character}`);

const linesOf = (text: string) => text.replace(/\r\n?/g, "\n").split("\n");
const trimBlock = (text: string) => text.replace(/^(?:[ \t]*\r?\n)+|\s+$/g, "");

/** A prompt as the transcript shows it: plain, in a code block no line of it closes. */
function promptBlock(text: string): string[] {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return [fence, ...linesOf(trimBlock(text)), fence];
}

// The characters that make the inline markup of Markdown, and the html:
// links, images, autolinks, link definitions, code spans, emphasis,
// strikethrough, tables. Escaped, the answer cannot load anything, nor lead
// anywhere but where it writes an address, nor cut its quote; its blocks,
// paragraphs, lists, headings in the quote, stay.
const escapeMarkup = (text: string) =>
  text.replace(/[\\`*_[\]<>~|]/g, (character) => `\\${character}`);

/** The longest run of backticks in a text, to fence it with a longer one. */
const longestBackticks = (lines: string[]) =>
  Math.max(
    0,
    ...lines.flatMap((line) => [...line.matchAll(/`+/g)].map((match) => match[0].length)),
  );

// The opening of a fenced code block as CommonMark takes it: indented by three
// spaces at most, its language a word.
const OPENING = /^ {0,3}(`{3,}|~{3,})\s*([\w+#.-]*)[^`]*$/;

/**
 * An answer, quoted: its fenced code blocks written again, as written, in a
 * fence of their own that no line of them closes, one left open closed; the
 * rest, its inline markup escaped. The paths of the collector its links name
 * are written as addresses of `origin`, to be read out of it. Nothing it holds
 * passes for a heading, a step or a prompt of the document.
 */
function answerBlock(text: string, origin: string): string[] {
  const out: string[] = [];
  const lines = linesOf(trimBlock(text));
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    const opening = OPENING.exec(line);
    if (opening === null) {
      const absolute = origin === "" ? line : line.replace(/\]\(\/(?!\/)/g, `](${origin}/`);
      out.push(escapeMarkup(absolute));
      continue;
    }
    const marker = opening[1] ?? "```";
    const language = opening[2] ?? "";
    const body: string[] = [];
    for (index++; index < lines.length; index++) {
      const inner = lines[index] ?? "";
      const closing = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(inner)?.[1];
      if (closing !== undefined && closing[0] === marker[0] && closing.length >= marker.length)
        break;
      body.push(inner);
    }
    const fence = "`".repeat(Math.max(3, longestBackticks(body) + 1));
    out.push(`${fence}${language}`, ...body, fence);
  }
  return out.map((line) => (line === "" ? ">" : `> ${line}`));
}

/**
 * A step as the export says it, plain text: the sentence of the call as it
 * ran, with the changes of the user when they made some, and how it ended
 * when it did not complete.
 */
export function stepText(step: Step, t: TFunction, i18n: I18n): string {
  const sentence = stepSentence({ ...step, arguments: step.editedArgs ?? step.arguments }, t, i18n);
  const edited = step.editedArgs !== undefined ? ` ${t("assistant.steps.withChanges")}` : "";
  const status = ["failed", "rejected", "interrupted"].includes(step.status)
    ? ` (${t(`assistant.steps.status.${step.status}`)})`
    : "";
  return `${sentence}${edited}${status}`;
}

/** The dates of an export, in the language of the user and the time zone given, the user's by default. */
export interface ExportDates {
  language: string;
  format: (date: Date) => string;
  zone: string;
}

export function exportDates(i18n: I18n, timeZone?: string): ExportDates {
  const language = i18n.resolvedLanguage ?? i18n.language;
  const format = new Intl.DateTimeFormat(language, {
    dateStyle: "medium",
    timeStyle: "short",
    ...(timeZone !== undefined ? { timeZone } : {}),
  });
  return {
    language,
    format: (date) => format.format(date),
    zone: format.resolvedOptions().timeZone,
  };
}

/** The words over a message: who, when, and for an answer the duration of its turn. */
export function messageMeta(who: string, message: StoredMessage, dates: ExportDates): string {
  const at = Date.parse(message.createdAt);
  const time = Number.isFinite(at) ? dates.format(new Date(at)) : "";
  const duration = message.role === "assistant" ? answerDuration(message.history?.runs ?? []) : 0;
  return [who, time, duration > 0 ? formatDuration(duration, dates.language) : ""]
    .filter((part) => part !== "")
    .join(" · ");
}

/** The Markdown of a conversation. */
export function conversationMarkdown(doc: ExportDocument, t: TFunction, i18n: I18n): string {
  const dates = exportDates(i18n, doc.timeZone);
  const out: string[] = [];
  // A blank line between blocks, one only: the lines of the messages stay as they are.
  const blank = () => {
    if (out.length > 0 && out.at(-1) !== "") out.push("");
  };
  out.push(`# ${escapeInline(doc.title).trim() || t("assistant.untitled")}`);
  blank();
  const about: string[] = [];
  if (doc.collector !== "")
    about.push(t("assistant.export.collector", { name: escapeInline(doc.collector) }));
  about.push(t("assistant.export.exportedAt", { date: dates.format(doc.exportedAt) }));
  about.push(t("assistant.export.timeZone", { zone: dates.zone }));
  out.push(about.join(" · "));
  for (const turn of turnsOf(doc.messages)) {
    blank();
    out.push("---");
    blank();
    if (turn.prompt !== null) {
      out.push(`### ${messageMeta(t("assistant.message.you"), turn.prompt, dates)}`);
      blank();
      out.push(...promptBlock(turn.prompt.text));
      blank();
    }
    const answer = turn.answer;
    if (answer === null) continue;
    out.push(`### ${messageMeta(t("assistant.name"), answer, dates)}`);
    blank();
    if (answer.text.trim() !== "") {
      out.push(...answerBlock(answer.text, doc.origin ?? ""));
      blank();
    }
    const steps = answer.history?.steps ?? [];
    const omitted = answer.history?.stepsOmitted ?? 0;
    if (steps.length > 0 || omitted > 0) {
      out.push(`**${t("assistant.export.steps")}**`);
      blank();
      for (const step of steps) out.push(`- ${escapeInline(stepText(step, t, i18n))}`);
      if (omitted > 0) out.push(`- ${t("assistant.export.stepsOmitted", { count: omitted })}`);
      blank();
    }
    if (answer.modelId !== undefined)
      out.push(`_${t("assistant.export.model", { model: escapeInline(answer.modelId) })}_`);
  }
  blank();
  out.push("---");
  blank();
  out.push(`_${t("assistant.export.unstored")}_`);
  return `${out.join("\n")}\n`;
}

// The letters NFKD does not take apart, as their base letters.
const LIGATURES: Record<string, string> = {
  œ: "oe",
  æ: "ae",
  ß: "ss",
  ø: "o",
  ł: "l",
  đ: "d",
  ð: "d",
  þ: "th",
};

/**
 * The name of the file of a conversation: its title, its letters without
 * accents, the other characters as dashes, and the date of the export; with
 * `extension`, or none.
 */
export function exportFileName(title: string, exportedAt: Date, extension = "md"): string {
  const name =
    title
      .toLowerCase()
      .replace(/[œæßøłđðþ]/g, (letter) => LIGATURES[letter] ?? letter)
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/, "") || "conversation";
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${String(exportedAt.getFullYear())}-${pad(exportedAt.getMonth() + 1)}-${pad(exportedAt.getDate())}`;
  return extension !== "" ? `${name}-${day}.${extension}` : `${name}-${day}`;
}
