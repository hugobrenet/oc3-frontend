import type {
  AIBackend,
  AIMimeType,
  AIResource,
  AIResourceInput,
  AISkill,
  AISkillInput,
} from "./ai-content-api";

/**
 * The bounds the API sets on the texts of the assistant (`ai_content_check.go`):
 * checked here too, so that the form says what is wrong before saving. The API
 * stays the judge, of the YAML of a frontmatter above all, which is only read
 * here as far as its name, description and tools.
 */
export const AI_LIMITS = {
  name: 64,
  title: 128,
  description: 1024,
  body: 65536,
  tools: 24,
} as const;

export const AI_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const TOOL_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;

/** The size of a text as the API counts it: its bytes in UTF-8. */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** What is wrong with a draft: a key of `aiContent.problems`, and its values. */
export interface Problem {
  key: string;
  values?: Record<string, string | number>;
}

function checkName(name: string, problems: Problem[]) {
  if (name === "") problems.push({ key: "nameMissing" });
  else if (byteLength(name) > AI_LIMITS.name)
    problems.push({ key: "nameTooLong", values: { max: AI_LIMITS.name } });
  else if (!AI_NAME_PATTERN.test(name)) problems.push({ key: "nameInvalid" });
}

function checkCommon(backends: AIBackend[], body: string, problems: Problem[]) {
  if (backends.length === 0) problems.push({ key: "backendsMissing" });
  if (body.trim() === "") problems.push({ key: "bodyMissing" });
  else if (byteLength(body) > AI_LIMITS.body)
    problems.push({ key: "bodyTooLong", values: { max: AI_LIMITS.body } });
  if (body.includes("\0")) problems.push({ key: "bodyNul" });
}

// --- Resources --------------------------------------------------------------

/** A resource as its form edits it. */
export interface ResourceDraft {
  name: string;
  title: string;
  description: string;
  mimeType: AIMimeType;
  backends: AIBackend[];
  groupIds: number[];
  body: string;
}

export const EMPTY_RESOURCE: ResourceDraft = {
  name: "",
  title: "",
  description: "",
  mimeType: "text/markdown",
  backends: ["oc3"],
  groupIds: [],
  body: "",
};

export function resourceDraftOf(r: AIResource): ResourceDraft {
  return {
    name: r.name,
    title: r.title,
    description: r.description,
    mimeType: r.mime_type === "text/plain" ? "text/plain" : "text/markdown",
    backends: r.backends,
    groupIds: r.publications ?? [],
    body: r.body,
  };
}

/** The body of the request; the name is only read on a creation. */
export function resourceInputOf(d: ResourceDraft): AIResourceInput {
  return {
    name: d.name.trim(),
    title: d.title.trim(),
    description: d.description.trim(),
    mime_type: d.mimeType,
    backends: d.backends,
    publications: d.groupIds,
    body: d.body,
  };
}

export function checkResource(d: ResourceDraft): Problem[] {
  const problems: Problem[] = [];
  checkName(d.name.trim(), problems);
  const title = d.title.trim();
  if (byteLength(title) > AI_LIMITS.title)
    problems.push({ key: "titleTooLong", values: { max: AI_LIMITS.title } });
  if (/[\r\n]/.test(title)) problems.push({ key: "titleLines" });
  const description = d.description.trim();
  if (description === "") problems.push({ key: "descriptionMissing" });
  else if (byteLength(description) > AI_LIMITS.description)
    problems.push({ key: "descriptionTooLong", values: { max: AI_LIMITS.description } });
  checkCommon(d.backends, d.body, problems);
  return problems;
}

// --- Skills -----------------------------------------------------------------

/** A skill as its form edits it: its SKILL.md as a whole. */
export interface SkillDraft {
  name: string;
  backends: AIBackend[];
  groupIds: number[];
  body: string;
}

/** The SKILL.md a new skill starts from. */
export function skillTemplate(name: string): string {
  return [
    "---",
    `name: ${name}`,
    "description: What the skill is for, and when the assistant should load it.",
    "metadata:",
    '  opensvc/tools: ""',
    "---",
    "",
    "# Steps",
    "",
    "1. ",
    "",
  ].join("\n");
}

export const EMPTY_SKILL: SkillDraft = {
  name: "",
  backends: ["oc3"],
  groupIds: [],
  body: skillTemplate(""),
};

export function skillDraftOf(s: AISkill): SkillDraft {
  return { name: s.name, backends: s.backends, groupIds: s.publications ?? [], body: s.body };
}

export function skillInputOf(d: SkillDraft): AISkillInput {
  return { name: d.name.trim(), backends: d.backends, publications: d.groupIds, body: d.body };
}

/** What the form reads of a frontmatter: its plain strings, and its maps of them. */
export interface Frontmatter {
  values: Record<string, string | Record<string, string>>;
  /** Why it could not be read; the values are then empty. */
  error?: "noStart" | "noEnd";
}

function unquote(value: string): string {
  const v = value.trim();
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"'))
    return v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'"))
    return v.slice(1, -1).replace(/''/g, "'");
  return v;
}

const KEY = /^([^\s#:][^:]*):(?:\s+(.*))?$/;

/**
 * The frontmatter of a SKILL.md, read as far as the form needs: the keys at the
 * top, their plain, quoted or block values, and the maps of them on one level.
 * Not a YAML parser: what it cannot read, the API will say.
 */
export function readFrontmatter(body: string): Frontmatter {
  const lines = body.split("\n").map((line) => line.replace(/\r$/, ""));
  if (lines[0] !== "---") return { values: {}, error: "noStart" };
  const end = lines.indexOf("---", 1);
  if (end < 0) return { values: {}, error: "noEnd" };
  const values: Frontmatter["values"] = {};
  let i = 1;
  while (i < end) {
    const line = lines[i] ?? "";
    const match = KEY.exec(line);
    i++;
    if (match === null) continue;
    const key = (match[1] ?? "").trim();
    const raw = (match[2] ?? "").trim();
    // The lines under the key, indented: a block, or a map.
    const nested: string[] = [];
    while (i < end && (/^\s/.test(lines[i] ?? "") || (lines[i] ?? "") === "")) {
      nested.push(lines[i] ?? "");
      i++;
    }
    if (raw.startsWith("|") || raw.startsWith(">")) {
      const indent = Math.min(
        ...nested.filter((l) => l.trim() !== "").map((l) => l.length - l.trimStart().length),
      );
      const text = nested.map((l) => l.slice(Number.isFinite(indent) ? indent : 0));
      values[key] = (
        raw.startsWith("|") ? text.join("\n") : text.join(" ").replace(/ +/g, " ")
      ).trim();
    } else if (raw === "") {
      const map: Record<string, string> = {};
      for (const l of nested) {
        const sub = KEY.exec(l.trim());
        if (sub !== null) map[(sub[1] ?? "").trim()] = unquote(sub[2] ?? "");
      }
      values[key] = map;
    } else {
      values[key] = unquote(raw);
    }
  }
  return { values };
}

/** The tools a frontmatter names, in metadata.opensvc/tools, apart by spaces. */
export function toolsOf(frontmatter: Frontmatter["values"]): string[] {
  const metadata: unknown = frontmatter.metadata;
  const tools =
    metadata !== null && typeof metadata === "object"
      ? (metadata as Record<string, unknown>)["opensvc/tools"]
      : undefined;
  return typeof tools === "string" ? tools.split(/\s+/).filter((t) => t !== "") : [];
}

export function checkSkill(d: SkillDraft): Problem[] {
  const problems: Problem[] = [];
  const name = d.name.trim();
  checkName(name, problems);
  checkCommon(d.backends, d.body, problems);
  const frontmatter = readFrontmatter(d.body);
  if (frontmatter.error !== undefined) {
    problems.push({ key: `frontmatter.${frontmatter.error}` });
    return problems;
  }
  const fmName = frontmatter.values.name;
  if (typeof fmName !== "string" || fmName !== name)
    problems.push({
      key: "frontmatter.name",
      values: { found: typeof fmName === "string" ? fmName : "", name },
    });
  const description = frontmatter.values.description;
  if (typeof description !== "string" || description.trim() === "")
    problems.push({ key: "frontmatter.description" });
  else if (byteLength(description) > AI_LIMITS.description)
    problems.push({
      key: "frontmatter.descriptionTooLong",
      values: { max: AI_LIMITS.description },
    });
  const tools = toolsOf(frontmatter.values);
  if (tools.length > AI_LIMITS.tools)
    problems.push({ key: "frontmatter.tooManyTools", values: { max: AI_LIMITS.tools } });
  const bad = tools.find((tool) => !TOOL_PATTERN.test(tool));
  if (bad !== undefined) problems.push({ key: "frontmatter.badTool", values: { tool: bad } });
  return problems;
}

/**
 * The SKILL.md with the name of its frontmatter changed, from one name to the
 * other: while a new skill is named, its frontmatter follows. Unchanged when the
 * frontmatter has another name, which the user then chose.
 */
export function renameFrontmatter(body: string, from: string, to: string): string {
  const lines = body.split("\n");
  if (lines[0]?.replace(/\r$/, "") !== "---") return body;
  const end = lines.findIndex((line, i) => i > 0 && line.replace(/\r$/, "") === "---");
  for (let i = 1; i < (end < 0 ? 0 : end); i++) {
    const match = /^name:\s*(.*?)\s*$/.exec(lines[i]?.replace(/\r$/, "") ?? "");
    if (match === null) continue;
    if (unquote(match[1] ?? "") !== from) return body;
    lines[i] = to === "" ? "name:" : `name: ${to}`;
    return lines.join("\n");
  }
  return body;
}
