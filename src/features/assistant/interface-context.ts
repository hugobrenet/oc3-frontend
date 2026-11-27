import { isPeekStep } from "@/components/opensvc/panel-trail";
import { NAV_CATEGORIES, NAV_TOP } from "@/app/layout/navigation";
import { currentIndex, parseTrail } from "@/lib/peek-trail";
import { isInverted } from "@/lib/column-filters";
import type { CheckedRows } from "./checked-rows";
import type { ListFilters } from "./list-filters";

/**
 * The context of the interface a prompt goes with (AG-UI `context`): what the page
 * under the dock shows, so that a question such as "why is it down?" needs no name.
 * The vocabulary is the agent's (its `docs/webapp.md`), the same as the webapp of a
 * cluster writes.
 *
 * Read from the URL, as `list-search.ts` keeps it: the page, the row open in its
 * panel or the record looked at over it, and their tab. Never the text of a record,
 * an alert or a log line: other people wrote it, and the agent must not take it as
 * the user's word. The URL may come from a link someone else wrote, too: only
 * values shaped as what they name go, a page of the menu, an id of the shape of its
 * kind (a uuid, a number, a short name) or the name of a tab, and the others are
 * left out.
 *
 * With them, what the user did or set in their session, never the content of a
 * record: the filters of the list on display, as the list applies them
 * (`list-filters.ts`), the rows they ticked there (`checked-rows.ts`), which a link
 * cannot tick, and their time zone and clock, for "an hour ago" or "at 2 pm".
 *
 * On the page of the assistant nothing is under the conversation: the session only.
 */
export interface InterfaceEntry {
  description: string;
  value: string;
}

/** The bounds of the agent: past them, it refuses the run (`invalid_context`). */
export const MAX_CONTEXT_ENTRIES = 8;
const MAX_DESCRIPTION_BYTES = 128;
const MAX_VALUE_BYTES = 2048;
const MAX_CONTEXT_BYTES = 4096;

/**
 * The shapes of the ids of the collector, an address reading only what is shaped
 * as one: a sentence written with dashes or dots, from a link someone else wrote,
 * is no id. Nodes, services and clusters by uuid (`char(36)`), most records by
 * number, an instance by its service and node (`instance-id.ts`), and the others,
 * such as an app or a disk, by a short name.
 */
const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const SHAPES = {
  uuid: new RegExp(`^${UUID}$`),
  number: /^[0-9]{1,20}$/,
  instance: new RegExp(`^${UUID}@${UUID}(@[A-Za-z0-9][A-Za-z0-9._-]{0,63})?$`),
  name: /^[A-Za-z0-9][A-Za-z0-9._:@#/+-]{0,63}$/,
} as const;
type Shape = keyof typeof SHAPES;

/** What the rows of a list are, by the path of its page: one, several, and the shape of their ids. */
const LISTS: Readonly<Record<string, readonly [string, string, Shape]>> = {
  "/": ["alert", "alerts", "number"],
  "/nodes": ["node", "nodes", "uuid"],
  "/services": ["service", "services", "uuid"],
  "/instances": ["instance", "instances", "instance"],
  "/resources": ["resource", "resources", "number"],
  "/apps": ["app", "apps", "name"],
  "/networks": ["network", "networks", "number"],
  "/checks": ["check", "checks", "number"],
  "/service-actions": ["service action", "service actions", "number"],
  "/clusters": ["cluster", "clusters", "uuid"],
  "/disks": ["disk", "disks", "name"],
  "/arrays": ["array", "arrays", "name"],
  "/tags": ["tag", "tags", "name"],
  "/groups": ["group", "groups", "number"],
  "/users": ["user", "users", "number"],
  "/packages": ["package", "packages", "name"],
};

/** The shape of the id of a record looked at over a page, by its kind. */
const PEEK_SHAPES: Readonly<Record<string, Shape>> = {
  node: "uuid",
  service: "uuid",
  cluster: "uuid",
  instance: "instance",
};

/** What the rows of the list at `pathname` are, plural: `rows` for a list of no known kind. */
export const checkedKind = (pathname: string): string => LISTS[pathname]?.[1] ?? "rows";

const bytes = (text: string) => new TextEncoder().encode(text).length;

/**
 * The pages of the menu, the only ones named: an address out of it, such as one a
 * link made up, names no page.
 */
const PAGES: ReadonlySet<string> = new Set(
  [...NAV_TOP, ...NAV_CATEGORIES.flatMap((category) => category.entries)].map((entry) => entry.to),
);
/** The id of a ticked row, which the page holds: any id the collector gives. */
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@#/+-]{0,255}$/;
/** The name of a tab, or of the category of a tab made of several lists. */
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** An IANA time zone, such as `Europe/Paris`. */
const TIME_ZONE = /^[A-Za-z0-9_+/-]{1,64}$/;

const identifier = (value: string | undefined): value is string =>
  value !== undefined && IDENTIFIER.test(value);
const shaped = (shape: Shape, value: string | undefined): value is string =>
  value !== undefined && SHAPES[shape].test(value);
const name = (value: string | undefined): value is string =>
  value !== undefined && NAME.test(value);

/** What the user did or set in their session, besides the page. */
export interface InterfaceSession {
  /** Their clock, when the question is asked. */
  now?: Date;
  /** Their time zone, as the browser tells it. */
  timeZone?: string;
  /** The filters of the list on display, as the list applies them. */
  listFilters?: ListFilters | null;
  /** The rows ticked in the list on display. */
  checked?: CheckedRows | null;
  /** The filterset of the session, `null` for none, `undefined` while not read. */
  sessionFilterset?: string | null;
}

/** `date` in ISO 8601, to the second, at the offset of the browser: 2026-11-16T15:40:12+01:00. */
export function localTime(date: Date): string {
  const pad = (value: number) => String(Math.trunc(Math.abs(value))).padStart(2, "0");
  const offset = -date.getTimezoneOffset();
  return (
    `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${offset < 0 ? "-" : "+"}${pad(offset / 60)}:${pad(offset % 60)}`
  );
}

/**
 * The rows ticked, all of them or none: a list cut to the bounds would have an
 * action asked of "these" run on a part of them. Past the bounds, or with an id not
 * shaped as one, every row of the list goes as that criterion, when the criterion
 * is known whole (`criterion`: its filters and the filterset of the session read),
 * else their count alone, for the assistant to ask which.
 */
function checkedEntries(checked: CheckedRows, criterion: boolean): InterfaceEntry[] {
  const count = { description: `checked ${checked.kind} count`, value: String(checked.ids.length) };
  const list = checked.ids.join(" ");
  if (
    checked.exact !== false &&
    bytes(list) <= MAX_VALUE_BYTES &&
    checked.ids.every((id) => identifier(id))
  )
    return [{ description: `checked ${checked.kind}`, value: list }, count];
  if (checked.all === true && criterion)
    return [{ description: `checked ${checked.kind}`, value: "all the rows of the list" }, count];
  return [count];
}

/** A prop of a column of a list, as `list-search.ts` keys its filter: `f.status`. */
const PROP = /^[A-Za-z][A-Za-z0-9_.]{0,63}$/;
/** The longest expression of a filter told: a longer one is no filter a user typed. */
const MAX_FILTER_CHARS = 128;
/** Past them, the filters of the list are said narrower than told. */
const MAX_TOLD_FILTERS = 8;
/**
 * A value of a filter told: a word, a number, a date, or a few words, such as the
 * status `In service`, at most 40 characters and 3 words, quoted when it holds a
 * space. A filter may come from a link someone else wrote: a sentence is no value.
 */
const VALUE = /^[\p{L}\p{N}._:@#/+%-]+(?: [\p{L}\p{N}._:@#/+%-]+){0,2}$/u;
/** A regular expression told, `~^dev`: its characters of a pattern, no space. */
const PATTERN = /^[\p{L}\p{N}._:@#/+%^$*?()[\]{}|\\-]+$/u;
const MAX_VALUE_CHARS = 40;
/** A date relative to now, as the collector reads a comparison: `-15m`, `-1d12h`. */
const RELATIVE = /^-(?=\d)(\d+w)?(\d+d)?(\d+h)?(\d+m)?(\d+s)?$/;
/** Past them, the values of an `in:` are given by their count, the criterion not known whole. */
const MAX_LISTED_VALUES = 5;
/** Told when a filter applied is not given: the list is narrower than said. */
export const NOT_LISTED = "other filters not listed";

const shapedValue = (text: string) => text.length <= MAX_VALUE_CHARS && VALUE.test(text);
/** A number, told as it is. */
const NUMBER = /^-?[0-9]+(\.[0-9]+)?$/;
/**
 * A value as told: quoted but a number, so that no value reads as a word of the
 * sentence: `"up or down"` is one value, `"not"` a value, `"empty"` the text, not
 * the absence of one.
 */
const quoted = (text: string) => (NUMBER.test(text) ? text : `"${text}"`);

/**
 * A filter of a column in words, from the expression of the collector API that
 * `column-filters.ts` keeps: `dev` contains, `~^dev` matches, `in:a,b` is one of,
 * `eq:` `ne:` `gte:` `lte:` `gt:` `lt:` compare, a `-15m` among them a date
 * relative to now, `empty`, a leading `!` inverts, keeping the rows without a value
 * too, as the collector does. Said as the webapp of a cluster says its filters:
 * `status is up or warn`, `status is not any of up, warn (or is empty)`,
 * `mem_bytes is at least 8`, `updated is more than 15m ago`. Undefined when a value
 * is not shaped as one; `whole` false when it is told in part, by a count.
 */
function describeFilter(
  prop: string,
  expression: string,
): { said: string; whole: boolean } | undefined {
  const inverted = isInverted(expression);
  const inner = inverted ? expression.slice(1) : expression;
  // The inverse keeps the rows without a value, but that of empty.
  const orEmpty = inverted ? " (or is empty)" : "";
  if (inner === "empty") return { said: `${prop} is ${inverted ? "not " : ""}empty`, whole: true };
  if (inner.startsWith("~")) {
    const pattern = inner.slice(1);
    // A flag of the pattern, such as (?-i), would make the words untrue.
    if (pattern.length > MAX_VALUE_CHARS || !PATTERN.test(pattern) || pattern.includes("(?"))
      return undefined;
    return {
      said: `${prop} ${inverted ? "does not match" : "matches"} /${pattern}/ (any case)${orEmpty}`,
      whole: true,
    };
  }
  if (inner.startsWith("in:")) {
    const values = [...new Set(inner.slice(3).split(","))];
    if (!values.every(shapedValue)) return undefined;
    if (values.length > MAX_LISTED_VALUES)
      return {
        said: `${prop} is ${inverted ? "none" : "one"} of ${String(values.length)} values${orEmpty}`,
        whole: false,
      };
    const told = values.map(quoted);
    if (!inverted) return { said: `${prop} is ${told.join(" or ")}`, whole: true };
    return {
      said:
        told.length === 1
          ? `${prop} is not ${told[0]}${orEmpty}`
          : `${prop} is not any of ${told.join(", ")}${orEmpty}`,
      whole: true,
    };
  }
  // Each comparison, its words, and those of its inverse; a date relative to now
  // in words of time: lt:-15m keeps the dates older than 15 minutes, !gte:-15m too.
  // ne: leaves out the rows without a value, as SQL does, and its inverse keeps
  // them; an equality to a date relative to now is no filter a user means.
  const comparisons: readonly (readonly [string, string, string, string?, string?])[] = [
    ["eq:", "is", "is not"],
    ["ne:", "is not", "is"],
    ["gte:", "is at least", "is less than", "is at most {} ago", "is more than {} ago"],
    ["lte:", "is at most", "is more than", "is at least {} ago", "is less than {} ago"],
    ["gt:", "is more than", "is at most", "is less than {} ago", "is at least {} ago"],
    ["lt:", "is less than", "is at least", "is more than {} ago", "is at most {} ago"],
  ];
  for (const [prefix, word, opposite, ago, oppositeAgo] of comparisons) {
    if (!inner.startsWith(prefix)) continue;
    const value = inner.slice(prefix.length);
    if (RELATIVE.test(value)) {
      if (ago === undefined || oppositeAgo === undefined) return undefined;
      const told = (inverted ? oppositeAgo : ago).replace("{}", value.slice(1));
      return { said: `${prop} ${told}${orEmpty}`, whole: true };
    }
    if (!shapedValue(value)) return undefined;
    const empty =
      prefix === "ne:" ? (inverted ? " (or has no value)" : " (and is not empty)") : orEmpty;
    return {
      said: `${prop} ${inverted ? opposite : word} ${quoted(value)}${empty}`,
      whole: true,
    };
  }
  if (!shapedValue(inner)) return undefined;
  return {
    said: `${prop} ${inverted ? "does not contain" : "contains"} ${quoted(inner)} (any case)${orEmpty}`,
    whole: true,
  };
}

/**
 * The filters the list on display applies, in words, after what the list holds,
 * `null` for none. Only the columns of the list are told of, at most
 * MAX_TOLD_FILTERS; a filter that cannot be told, or past them, is left out and said
 * so, `other filters not listed`, as an entry too long for the agent: the list on
 * display is narrower than told, never wider. `whole`, every filter told whole: the
 * criterion that makes every row ticked a fact; false too when no list tells its
 * filters.
 */
function listFiltersEntry(shared: ListFilters | null | undefined): {
  value: string | null;
  whole: boolean;
} {
  if (!shared) return { value: null, whole: false };
  const told: string[] = [];
  // unlisted, a filter left out, said so; whole, every filter told whole.
  let unlisted = false;
  let whole = true;
  for (const prop of Object.keys(shared.filters).sort()) {
    const expression = shared.filters[prop];
    if (typeof expression !== "string" || expression === "") continue;
    const described =
      told.length < MAX_TOLD_FILTERS &&
      PROP.test(prop) &&
      shared.props.includes(prop) &&
      expression.length <= MAX_FILTER_CHARS &&
      !CONTROL.test(expression)
        ? describeFilter(prop, expression)
        : undefined;
    if (described === undefined) {
      unlisted = true;
      continue;
    }
    told.push(described.said);
    whole &&= described.whole;
  }
  if (unlisted) whole = false;
  if (told.length === 0 && !unlisted) return { value: null, whole };
  // What the list holds, as the list told it with its filters.
  const holds = shared.kind;
  if (unlisted) told.push(NOT_LISTED);
  const value = [holds, ...told].join("; ");
  // Too long for the agent, the entry would be left out, and the list read as not filtered.
  if (bytes(value) > MAX_VALUE_BYTES) return { value: `${holds}; ${NOT_LISTED}`, whole: false };
  return { value, whole };
}

/** The name of a filterset, as the collector gives it. */
// eslint-disable-next-line no-control-regex
const FILTERSET = /^[^\u0000-\u001f\u007f-\u009f]{1,128}$/;

function sessionEntries({ now, timeZone }: InterfaceSession): InterfaceEntry[] {
  const entries: InterfaceEntry[] = [];
  // The clock first, its offset with it: past the bounds, the time zone goes first.
  if (now !== undefined && !Number.isNaN(now.getTime()))
    entries.push({ description: "local time", value: localTime(now) });
  if (timeZone !== undefined && TIME_ZONE.test(timeZone))
    entries.push({ description: "time zone", value: timeZone });
  return entries;
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** An entry the agent takes: printable text within its bounds. */
function valid(entry: InterfaceEntry): boolean {
  return (
    entry.description.trim() !== "" &&
    bytes(entry.description) <= MAX_DESCRIPTION_BYTES &&
    bytes(entry.value) <= MAX_VALUE_BYTES &&
    !CONTROL.test(entry.description) &&
    !CONTROL.test(entry.value)
  );
}

/**
 * The entries an agent takes, in their order: an invalid entry is left out, and
 * those past the bounds of the whole, so that a prompt is never refused for them.
 */
export function boundContext(entries: readonly unknown[]): InterfaceEntry[] {
  const kept: InterfaceEntry[] = [];
  let total = 0;
  for (const raw of entries) {
    if (kept.length === MAX_CONTEXT_ENTRIES) break;
    if (typeof raw !== "object" || raw === null) continue;
    const { description, value } = raw as Partial<InterfaceEntry>;
    if (typeof description !== "string" || typeof value !== "string") continue;
    const entry = { description, value };
    if (!valid(entry)) continue;
    const size = bytes(description) + bytes(value);
    if (total + size > MAX_CONTEXT_BYTES) continue;
    total += size;
    kept.push(entry);
  }
  return kept;
}

/** The entries of the clock of the user, read again when a queued message goes. */
const CLOCK = new Set(["time zone", "local time"]);

/**
 * The context of a message queued, as it goes: the page and the rows of the time it
 * was asked, the clock of now, so that "an hour ago" counts from when it is sent.
 */
export function withClockOf(
  queued: readonly InterfaceEntry[],
  now: readonly InterfaceEntry[],
): InterfaceEntry[] {
  return boundContext([
    ...queued.filter((entry) => !CLOCK.has(entry.description)),
    ...now.filter((entry) => CLOCK.has(entry.description)),
  ]);
}

/**
 * The context of the page at `pathname`, with the parameters of its address as
 * the router parses them (`defaultParseSearch`: a value the router quotes, such as
 * a numeric id, comes back without its quotes), and of the session.
 */
export function interfaceContext(
  pathname: string,
  search: Readonly<Record<string, unknown>>,
  session: InterfaceSession = {},
): InterfaceEntry[] {
  if (pathname === "/ai" || pathname.startsWith("/ai/"))
    return boundContext(sessionEntries(session));
  // As `list-search.ts` reads them: a bare number typed in the address is its string.
  const read = (key: string) => {
    const value = search[key];
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    return typeof value === "string" && value !== "" ? value : undefined;
  };
  const entries: InterfaceEntry[] = [];
  if (PAGES.has(pathname)) entries.push({ description: "page", value: pathname });
  // One drawer at a time: the row panel wins over the record looked at, as
  // `PeekPanel` has it.
  const sel = read("sel");
  let open = false;
  if (sel !== undefined) {
    const list = LISTS[pathname];
    if (shaped(list?.[2] ?? "name", sel)) {
      entries.push({
        description: list === undefined ? "selected record" : `selected ${list[0]}`,
        value: sel,
      });
      open = true;
      const tab = read("tab");
      if (name(tab)) entries.push({ description: "open tab", value: tab });
    }
  } else {
    const trail = parseTrail(read("peek")).filter(isPeekStep);
    const shown = trail[currentIndex(trail, read("peekat"))];
    if (shown !== undefined && shaped(PEEK_SHAPES[shown.kind] ?? "name", shown.id)) {
      entries.push({ description: `open ${shown.kind}`, value: shown.id });
      open = true;
      const tab = read("peektab");
      if (name(tab)) entries.push({ description: "open tab", value: tab });
    }
  }
  // What the list shows: its filters, and the filterset of the session, which
  // narrows every list. Known whole, they make every row ticked a criterion.
  const filters = listFiltersEntry(session.listFilters);
  if (filters.value !== null) entries.push({ description: "list filters", value: filters.value });
  const filterset = session.sessionFilterset;
  const filtersetKnown =
    filterset === null || (typeof filterset === "string" && FILTERSET.test(filterset));
  if (typeof filterset === "string" && filtersetKnown)
    entries.push({ description: "session filterset", value: filterset });
  if (session.checked && session.checked.ids.length > 0)
    entries.push(...checkedEntries(session.checked, filters.whole && filtersetKnown));
  const diff = read("diff");
  if (open && name(diff)) entries.push({ description: "open view", value: diff });
  entries.push(...sessionEntries(session));
  return boundContext(entries);
}
