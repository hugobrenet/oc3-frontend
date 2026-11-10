import { describe, expect, it } from "vitest";
import {
  EMPTY_RESOURCE,
  byteLength,
  checkResource,
  checkSkill,
  readFrontmatter,
  renameFrontmatter,
  skillTemplate,
  toolsOf,
} from "./ai-content-draft";

const keys = (problems: { key: string }[]) => problems.map((p) => p.key);

describe("byteLength", () => {
  it("counts the bytes in UTF-8, as the API", () => {
    expect(byteLength("abc")).toBe(3);
    expect(byteLength("é")).toBe(2);
  });
});

describe("checkResource", () => {
  const valid = { ...EMPTY_RESOURCE, name: "disk-capacity", description: "When.", body: "# Hi" };

  it("accepts a complete resource", () => {
    expect(checkResource(valid)).toEqual([]);
  });

  it("says what is missing", () => {
    expect(keys(checkResource(EMPTY_RESOURCE))).toEqual([
      "nameMissing",
      "descriptionMissing",
      "bodyMissing",
    ]);
    expect(keys(checkResource({ ...valid, backends: [] }))).toEqual(["backendsMissing"]);
  });

  it("checks the name as the API", () => {
    for (const name of ["Disk", "disk--capacity", "-disk", "disk_capacity", "disk-"])
      expect(keys(checkResource({ ...valid, name }))).toEqual(["nameInvalid"]);
    expect(keys(checkResource({ ...valid, name: "a".repeat(65) }))).toEqual(["nameTooLong"]);
  });

  it("bounds the title, the description and the body in bytes", () => {
    expect(keys(checkResource({ ...valid, title: "é".repeat(65) }))).toEqual(["titleTooLong"]);
    expect(keys(checkResource({ ...valid, title: "a\nb" }))).toEqual(["titleLines"]);
    expect(keys(checkResource({ ...valid, description: "a".repeat(1025) }))).toEqual([
      "descriptionTooLong",
    ]);
    expect(keys(checkResource({ ...valid, body: "a".repeat(65537) }))).toEqual(["bodyTooLong"]);
    expect(keys(checkResource({ ...valid, body: "a\0b" }))).toEqual(["bodyNul"]);
  });
});

describe("readFrontmatter", () => {
  it("reads plain, quoted and block values, and maps on one level", () => {
    const body = [
      "---",
      "name: freeze-node",
      "description: >",
      "  Freeze a node",
      "  before a maintenance.",
      "license: 'MIT'",
      "metadata:",
      '  opensvc/tools: "get_node freeze_node"',
      "  author: ops",
      "---",
      "# Steps",
    ].join("\n");
    const fm = readFrontmatter(body);
    expect(fm.error).toBeUndefined();
    expect(fm.values).toEqual({
      name: "freeze-node",
      description: "Freeze a node before a maintenance.",
      license: "MIT",
      metadata: { "opensvc/tools": "get_node freeze_node", author: "ops" },
    });
    expect(toolsOf(fm.values)).toEqual(["get_node", "freeze_node"]);
  });

  it("reads Windows line ends", () => {
    expect(readFrontmatter("---\r\nname: a\r\n---\r\n").values).toEqual({ name: "a" });
  });

  it("needs the two --- lines", () => {
    expect(readFrontmatter("# Steps").error).toBe("noStart");
    expect(readFrontmatter("---\nname: a\n").error).toBe("noEnd");
  });

  it("finds no tools where there are none", () => {
    expect(toolsOf({})).toEqual([]);
    expect(toolsOf({ metadata: "x" })).toEqual([]);
  });
});

describe("checkSkill", () => {
  const valid = { name: "freeze-node", backends: ["oc3" as const], groupIds: [], body: "" };
  valid.body = skillTemplate("freeze-node");

  it("accepts the template, once named", () => {
    expect(checkSkill(valid)).toEqual([]);
  });

  it("wants the name of the frontmatter to be that of the skill", () => {
    expect(checkSkill({ ...valid, name: "thaw-node" })).toEqual([
      { key: "frontmatter.name", values: { found: "freeze-node", name: "thaw-node" } },
    ]);
  });

  it("wants a description, and at most 24 valid tools", () => {
    const body = (description: string, tools: string) =>
      `---\nname: freeze-node\ndescription: ${description}\nmetadata:\n  opensvc/tools: ${tools}\n---\n`;
    expect(keys(checkSkill({ ...valid, body: body('""', "a") }))).toEqual([
      "frontmatter.description",
    ]);
    const many = Array.from({ length: 25 }, (_, i) => `t${String(i)}`).join(" ");
    expect(keys(checkSkill({ ...valid, body: body("x", many) }))).toEqual([
      "frontmatter.tooManyTools",
    ]);
    expect(keys(checkSkill({ ...valid, body: body("x", "get_node a/b") }))).toEqual([
      "frontmatter.badTool",
    ]);
  });

  it("stops at a frontmatter it cannot find", () => {
    expect(keys(checkSkill({ ...valid, body: "# Steps" }))).toEqual(["frontmatter.noStart"]);
  });
});

describe("renameFrontmatter", () => {
  it("follows the name while it is the one of the frontmatter", () => {
    const body = skillTemplate("");
    const once = renameFrontmatter(body, "", "f");
    expect(readFrontmatter(once).values.name).toBe("f");
    const twice = renameFrontmatter(once, "f", "fr");
    expect(readFrontmatter(twice).values.name).toBe("fr");
    expect(renameFrontmatter(twice, "fr", "")).toContain("\nname:\n");
  });

  it("leaves a frontmatter named otherwise", () => {
    const body = skillTemplate("other");
    expect(renameFrontmatter(body, "f", "fr")).toBe(body);
  });
});
