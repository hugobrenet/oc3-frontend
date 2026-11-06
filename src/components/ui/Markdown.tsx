import { createContext, Fragment, useContext, type ReactNode } from "react";

/**
 * Markdown rendered as React elements, for text written by a language model: the
 * subset such text uses, from CommonMark and GitHub's tables, task lists and
 * strikethrough. Headings, paragraphs, fenced code, quotes, nested lists, tables
 * and rules; code, bold, italic, strikethrough and links inline.
 *
 * Written here rather than imported: a few hundred lines cover that subset, and
 * building elements, never HTML, keeps the text of the model out of the page as
 * markup. Raw HTML in the text shows as text. A link opens only with a web,
 * mail or in-app address, in a new tab. Text still streaming renders as it
 * comes: an unclosed code fence runs to the end.
 *
 * `renderCode` may render an inline code span otherwise, such as a name the page
 * knows as a badge; it gives undefined to keep the span code. Neither a code block
 * nor a code span within a link goes through it: a link holds no control.
 */
export function Markdown({
  text,
  className = "",
  renderCode,
}: {
  text: string;
  className?: string;
  renderCode?: InlineCodeRenderer;
}) {
  return (
    <CodeRenderer.Provider value={renderCode}>
      <div className={`flex flex-col gap-2 text-ink ${className}`}>{blocks(text)}</div>
    </CodeRenderer.Provider>
  );
}

/** Renders the text of an inline code span, or gives undefined to keep it code. */
export type InlineCodeRenderer = (code: string) => ReactNode | undefined;

const CodeRenderer = createContext<InlineCodeRenderer | undefined>(undefined);

/** An inline code span, as `renderCode` renders it, code otherwise. */
function InlineCode({ code }: { code: string }) {
  const render = useContext(CodeRenderer);
  const rendered = render?.(code);
  if (rendered !== undefined) return rendered;
  return (
    <code className="rounded-(--radius-control) bg-surface-sunken px-1 font-mono text-data break-words">
      {code}
    </code>
  );
}

// --- Blocks ----------------------------------------------------------------------

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+-]*)/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^ {0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^ {0,3}>\s?/;
const BULLET = /^(\s*)([-*+])\s+(.*)$/;
const ORDERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
// A paragraph line underlined: "===" makes a heading of level 1, "---" of level 2.
const SETEXT = /^ {0,3}(=+|-+)\s*$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function isBlank(line: string): boolean {
  return line.trim() === "";
}

/** Whether a line starts a block other than a paragraph, which it then ends. */
function startsBlock(line: string, next: string | undefined): boolean {
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    RULE.test(line) ||
    QUOTE.test(line) ||
    BULLET.test(line) ||
    ORDERED.test(line) ||
    (line.includes("|") && next !== undefined && TABLE_SEPARATOR.test(next))
  );
}

function blocks(text: string): ReactNode[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const key = String(out.length);
    if (isBlank(line)) {
      i++;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence !== null) {
      const marker = fence[1] ?? "```";
      const body: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? "").trim().startsWith(marker)) {
        body.push(lines[i] ?? "");
        i++;
      }
      i++; // the closing fence, if any
      out.push(
        <pre
          key={key}
          className="overflow-x-auto rounded-(--radius-control) border border-line bg-surface-sunken px-3 py-2 font-mono text-data"
        >
          <code>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading !== null) {
      out.push(headingBlock((heading[1] ?? "#").length, inline(heading[2] ?? "", key), key));
      i++;
      continue;
    }

    if (RULE.test(line)) {
      out.push(<hr key={key} className="border-line" />);
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i] ?? "")) {
        body.push((lines[i] ?? "").replace(QUOTE, ""));
        i++;
      }
      out.push(
        <blockquote
          key={key}
          className="flex flex-col gap-2 border-l-2 border-line pl-3 text-ink-muted"
        >
          {blocks(body.join("\n"))}
        </blockquote>,
      );
      continue;
    }

    if (BULLET.test(line) || ORDERED.test(line)) {
      // The items, their indented lines, and the blank lines between them.
      // An item of the other kind at the same level starts another list.
      const start = i;
      const indent = line.search(/\S/);
      const ordered = !BULLET.test(line);
      const otherKind = (l: string) =>
        l.search(/\S/) <= indent && (ordered ? BULLET.test(l) : ORDERED.test(l) && !BULLET.test(l));
      const inList = (l: string) =>
        !otherKind(l) && (BULLET.test(l) || ORDERED.test(l) || /^\s+\S/.test(l));
      while (i < lines.length) {
        const current = lines[i] ?? "";
        if (inList(current) || (isBlank(current) && inList(lines[i + 1] ?? ""))) {
          i++;
          continue;
        }
        break;
      }
      out.push(<Fragment key={key}>{list(lines.slice(start, i), key)}</Fragment>);
      continue;
    }

    if (line.includes("|") && TABLE_SEPARATOR.test(lines[i + 1] ?? "")) {
      const header = cells(line);
      const align = cells(lines[i + 1] ?? "").map((c) =>
        c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : "left",
      );
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && (lines[i] ?? "").includes("|") && !isBlank(lines[i] ?? "")) {
        rows.push(cells(lines[i] ?? ""));
        i++;
      }
      out.push(
        <div key={key} className="overflow-x-auto">
          <table className="border-collapse text-data">
            <thead>
              <tr>
                {header.map((h, c) => (
                  <th
                    key={c}
                    style={{ textAlign: align[c] as "left" | "right" | "center" }}
                    className="border border-line bg-surface-sunken px-2 py-1 font-semibold"
                  >
                    {inline(h, `${key}h${String(c)}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>
                  {header.map((_, c) => (
                    <td
                      key={c}
                      style={{ textAlign: align[c] as "left" | "right" | "center" }}
                      className="border border-line px-2 py-1 align-top"
                    >
                      {inline(row[c] ?? "", `${key}r${String(r)}c${String(c)}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // A paragraph: lines up to a blank one or the start of another block.
    const body: string[] = [line.trim()];
    i++;
    while (
      i < lines.length &&
      !isBlank(lines[i] ?? "") &&
      !SETEXT.test(lines[i] ?? "") &&
      !startsBlock(lines[i] ?? "", lines[i + 1])
    ) {
      body.push((lines[i] ?? "").trim());
      i++;
    }
    const underline = SETEXT.exec(lines[i] ?? "");
    if (underline !== null) {
      const level = (underline[1] ?? "=").startsWith("=") ? 1 : 2;
      out.push(headingBlock(level, inline(body.join(" "), key), key));
      i++;
      continue;
    }
    out.push(
      <p key={key} className="break-words">
        {lineBreaks(body, key)}
      </p>,
    );
  }
  return out;
}

/** A heading: within a message or a note, headings stay modest, weight before size. */
function headingBlock(level: number, content: ReactNode[], key: string): ReactNode {
  return level <= 2 ? (
    <h3 key={key} className="mt-1 text-title font-semibold">
      {content}
    </h3>
  ) : (
    <h4 key={key} className="mt-1 font-semibold">
      {content}
    </h4>
  );
}

/** The lines of a paragraph: two trailing spaces or a backslash break a line. */
function lineBreaks(lines: string[], key: string): ReactNode[] {
  const out: ReactNode[] = [];
  lines.forEach((raw, n) => {
    const hard = n < lines.length - 1 && (/ {2,}$/.test(raw) || raw.endsWith("\\"));
    const text = raw.replace(/(\s{2,}|\\)$/, "");
    out.push(<Fragment key={n}>{inline(text, `${key}l${String(n)}`)}</Fragment>);
    if (n < lines.length - 1) out.push(hard ? <br key={`${String(n)}b`} /> : " ");
  });
  return out;
}

/** The cells of a table row, its outer pipes dropped, escaped pipes kept. */
function cells(row: string): string[] {
  const trimmed = row
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "");
  return trimmed.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

interface Item {
  ordered: boolean;
  start: number;
  indent: number;
  lines: string[];
}

/** A list and its nested lists, from the lines it spans. */
function list(lines: string[], key: string): ReactNode {
  const items: Item[] = [];
  let baseIndent = -1;
  for (const raw of lines) {
    const bullet = BULLET.exec(raw);
    const ordered = ORDERED.exec(raw);
    const marker = bullet ?? ordered;
    const indent = marker === null ? -1 : (marker[1] ?? "").length;
    if (marker !== null && (baseIndent < 0 || indent <= baseIndent)) {
      baseIndent = indent;
      items.push({
        ordered: ordered !== null && bullet === null,
        start: ordered !== null && bullet === null ? Number(ordered[2]) : 1,
        indent,
        lines: [marker[3] ?? ""],
      });
      continue;
    }
    // A nested item or a continuation line of the item above, its indent removed.
    items[items.length - 1]?.lines.push(raw.slice(Math.min(baseIndent + 2, raw.search(/\S|$/))));
  }
  const ordered = items[0]?.ordered ?? false;
  const children = items.map((item, n) => {
    const [first = "", ...rest] = item.lines;
    const task = /^\[([ xX])\]\s+/.exec(first);
    const head = task === null ? first : first.slice(task[0].length);
    const nested = rest.join("\n");
    return (
      <li key={n} className="break-words">
        {task !== null && (
          <span aria-hidden="true" className="mr-1 font-mono">
            {task[1] === " " ? "☐" : "☑"}
          </span>
        )}
        {task !== null && <span className="sr-only">{task[1] === " " ? "[ ] " : "[x] "}</span>}
        {inline(head, `${key}i${String(n)}`)}
        {nested.trim() !== "" && <div className="mt-1 flex flex-col gap-1">{blocks(nested)}</div>}
      </li>
    );
  });
  return ordered ? (
    <ol start={items[0]?.start ?? 1} className="flex list-decimal flex-col gap-1 pl-6">
      {children}
    </ol>
  ) : (
    <ul className="flex list-disc flex-col gap-1 pl-6">{children}</ul>
  );
}

// --- Inline ------------------------------------------------------------------------

/** An address a link may open: the web, mail, or a path of the application. */
function safeHref(url: string): string | null {
  const u = url.trim();
  if (/^(https?:|mailto:)/i.test(u)) return u;
  if (u.startsWith("/") && !u.startsWith("//")) return u;
  return null;
}

const INLINE =
  /(\\[\\`*_{}[\]()#+\-.!~|>])|(`+)([\s\S]*?[^`])\2(?!`)|\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|<(https?:\/\/[^\s>]+)>|(?<!\w)(\*\*|__)(?=\S)([\s\S]*?\S)\7(?!\w)|(~~)(?=\S)([\s\S]*?\S)~~|(?<![\w*])(\*|_)(?=\S)([\s\S]*?\S)\11(?![\w*])/;

/** The inline marks of a run of text, as elements. */
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let n = 0;
  while (rest !== "") {
    const m = INLINE.exec(rest);
    if (m === null) {
      out.push(rest);
      break;
    }
    if (m.index > 0) out.push(rest.slice(0, m.index));
    const k = `${key}-${String(n++)}`;
    const [whole, escaped, , code, linkText, linkUrl, autolink, , strong, , strike, , em] = m;
    if (escaped !== undefined) {
      out.push(escaped.slice(1));
    } else if (code !== undefined) {
      out.push(<InlineCode key={k} code={code.replace(/^ (.*) $/, "$1")} />);
    } else if (linkUrl !== undefined || autolink !== undefined) {
      const href = safeHref(linkUrl ?? autolink ?? "");
      const label = linkText ?? autolink ?? "";
      out.push(
        href === null ? (
          <Fragment key={k}>{inline(label, k)}</Fragment>
        ) : (
          <a
            key={k}
            href={href}
            target={href.startsWith("/") ? undefined : "_blank"}
            rel="noopener noreferrer"
            className="text-accent underline underline-offset-2 hover:no-underline"
          >
            <CodeRenderer.Provider value={undefined}>{inline(label, k)}</CodeRenderer.Provider>
          </a>
        ),
      );
    } else if (strong !== undefined) {
      out.push(
        <strong key={k} className="font-semibold">
          {inline(strong, k)}
        </strong>,
      );
    } else if (strike !== undefined) {
      out.push(<del key={k}>{inline(strike, k)}</del>);
    } else if (em !== undefined) {
      out.push(<em key={k}>{inline(em, k)}</em>);
    } else {
      out.push(whole);
    }
    rest = rest.slice(m.index + whole.length);
  }
  return out;
}
