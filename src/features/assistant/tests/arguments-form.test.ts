import { describe, expect, test } from "vitest";
import {
  argumentsOf,
  compileSchema,
  draftOf,
  fieldKind,
  formFields,
  sameArguments,
} from "../arguments-form";

const schema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  properties: {
    service: { type: "string", minLength: 1, description: "The exact service name." },
    definition: { type: "string", contentMediaType: "application/yaml" },
    count: { type: "integer", minimum: 1 },
    wait: { type: "boolean" },
    tags: { type: "array", items: { type: "string" } },
    mode: { type: "string", enum: ["fast", "safe"] },
    options: { type: "object" },
  },
  required: ["service"],
  additionalProperties: false,
};

describe("the form of the arguments of a call", () => {
  test("takes a control for each property, the undeclared arguments last", () => {
    const fields = formFields(
      schema,
      { service: "web", extra: 1 },
      { definition: "application/yaml" },
    );
    expect(fields.map((field) => [field.name, field.kind, field.required])).toEqual([
      ["service", "string", true],
      ["definition", "text", false],
      ["count", "number", false],
      ["wait", "boolean", false],
      ["tags", "lines", false],
      ["mode", "enum", false],
      ["options", "json", false],
      ["extra", "json", false],
    ]);
    expect(fields[0]?.description).toBe("The exact service name.");
    expect(fields[1]?.mediaType).toBe("application/yaml");
    expect(fieldKind({ type: "string" }, "two\nlines", "")).toBe("text");
    expect(fieldKind({ type: ["null", "integer"] }, 1, "")).toBe("number");
  });

  test("gives back the arguments of the drafts, leaving unset what the call did not set", () => {
    const proposed = { service: "web", tags: ["a"], wait: true };
    const fields = formFields(schema, proposed);
    const drafts = Object.fromEntries(
      fields.map((field) => [
        field.name,
        draftOf(field, proposed[field.name as keyof typeof proposed]),
      ]),
    );
    expect(drafts).toMatchObject({ service: "web", tags: "a", wait: true, count: "", options: "" });
    expect(argumentsOf(fields, drafts, proposed)).toEqual({ args: proposed, errors: {} });
    expect(argumentsOf(fields, { ...drafts, count: "two", options: "{" }, proposed).errors).toEqual(
      { count: "number", options: "json" },
    );
    expect(argumentsOf(fields, { ...drafts, tags: "a\n\nb\n", count: "3" }, proposed).args).toEqual(
      { service: "web", tags: ["a", "b"], wait: true, count: 3 },
    );
  });

  test("checks the arguments against the schema, by field", () => {
    const validate = compileSchema(schema);
    expect(validate).not.toBeNull();
    expect(validate?.({ service: "web", count: 2 })).toEqual({});
    expect(validate?.({ count: 0 })).toEqual({
      service: "required",
      count: { message: expect.stringContaining(">=1") as string },
    });
    expect(Object.keys(validate?.({ service: "web", other: 1 }) ?? {})).toEqual(["other"]);
  });

  test("checks nothing of a schema it cannot read: the agent checks again", () => {
    expect(compileSchema({ type: "object", properties: { a: { $ref: "#/nowhere" } } })).toBeNull();
    expect(compileSchema(undefined)).toBeNull();
  });

  test("compares arguments whatever the order of their keys", () => {
    expect(sameArguments({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 })).toBe(true);
    expect(sameArguments({ a: 1 }, { a: "1" })).toBe(false);
  });
});
