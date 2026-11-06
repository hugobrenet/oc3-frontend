import { z } from "zod";
import type { Args } from "./assistant-client";

/**
 * The form of the arguments of a call the user may edit before approving it,
 * built from the input schema of its tool: its labels and descriptions come from
 * the MCP, the text of the model only as the values filled in.
 */

/** The control a property is edited with. */
export type FieldKind = "enum" | "string" | "text" | "number" | "boolean" | "lines" | "json";

export interface FormField {
  name: string;
  kind: FieldKind;
  /** The media type of a text argument, such as application/yaml. */
  mediaType: string;
  required: boolean;
  description: string;
  options: string[];
}

/** What a control holds: its text, or the state of a box. */
export type Draft = string | boolean;

/**
 * Why a value does not hold: no number, no JSON, a value missing, or what the
 * check of the schema says, in English as the schema is.
 */
export type FieldError = "number" | "json" | "required" | { message: string };

type Property = Record<string, unknown>;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const typeOf = (property: Property | undefined): unknown =>
  Array.isArray(property?.type)
    ? (property.type as unknown[]).find((type) => type !== "null")
    : property?.type;

/** The control a property is edited with. */
export function fieldKind(property: Property, value: unknown, mediaType: string): FieldKind {
  const options = property.enum;
  if (
    Array.isArray(options) &&
    options.length > 0 &&
    options.every((item) => typeof item === "string")
  )
    return "enum";
  switch (typeOf(property)) {
    case "string":
      // A text of a media type, such as a YAML, or holding line breaks, keeps
      // its lines and indentation.
      return mediaType !== "" ||
        typeof property.contentMediaType === "string" ||
        (typeof value === "string" && value.includes("\n"))
        ? "text"
        : "string";
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "array":
      return typeOf(isObject(property.items) ? property.items : undefined) === "string"
        ? "lines"
        : "json";
    default:
      return "json";
  }
}

/** The fields of the form: the properties of the schema, in its order, then any argument it does not declare. */
export function formFields(
  schema: Args | undefined,
  args: Args,
  argumentTypes: Record<string, string> = {},
): FormField[] {
  const properties = isObject(schema?.properties) ? schema.properties : {};
  const names = [
    ...Object.keys(properties),
    ...Object.keys(args).filter((name) => !Object.hasOwn(properties, name)),
  ];
  const required = new Set(Array.isArray(schema?.required) ? (schema.required as unknown[]) : []);
  return names.map((name) => {
    const declared = properties[name];
    const property: Property = isObject(declared) ? declared : {};
    const mediaType = Object.hasOwn(argumentTypes, name) ? (argumentTypes[name] ?? "") : "";
    return {
      name,
      kind: fieldKind(property, args[name], mediaType),
      mediaType,
      required: required.has(name),
      description: typeof property.description === "string" ? property.description : "",
      options: Array.isArray(property.enum)
        ? (property.enum as unknown[]).filter((item): item is string => typeof item === "string")
        : [],
    };
  });
}

/** The draft a control shows for a value. */
export function draftOf(field: FormField, value: unknown): Draft {
  if (value === undefined || value === null) return field.kind === "boolean" ? false : "";
  switch (field.kind) {
    case "boolean":
      return value === true;
    case "lines":
      return Array.isArray(value) ? value.join("\n") : JSON.stringify(value);
    case "json":
      return JSON.stringify(value, null, 2);
    case "number":
      return String(value);
    default:
      return typeof value === "string" ? value : JSON.stringify(value);
  }
}

/**
 * The arguments the drafts give, a full replacement of the proposed ones: a field
 * left empty that the call did not set stays unset. It gives the errors of the
 * controls that hold no value of their kind.
 */
export function argumentsOf(
  fields: FormField[],
  drafts: Record<string, Draft>,
  proposed: Args,
): { args: Args; errors: Record<string, FieldError> } {
  const args: Args = {};
  const errors: Record<string, FieldError> = {};
  for (const field of fields) {
    const draft = drafts[field.name];
    const text = typeof draft === "string" ? draft : "";
    const unset = proposed[field.name] === undefined;
    switch (field.kind) {
      case "boolean":
        if (!(unset && draft === false)) args[field.name] = draft === true;
        break;
      case "number":
        if (text.trim() === "") break;
        if (!Number.isFinite(Number(text))) errors[field.name] = "number";
        else args[field.name] = Number(text);
        break;
      case "lines": {
        const lines = text.split("\n").filter((line) => line.trim() !== "");
        if (!(unset && lines.length === 0)) args[field.name] = lines;
        break;
      }
      case "json":
        if (text.trim() === "") break;
        try {
          args[field.name] = JSON.parse(text) as unknown;
        } catch {
          errors[field.name] = "json";
        }
        break;
      default:
        if (!(unset && text === "")) args[field.name] = text;
    }
  }
  return { args, errors };
}

/** A JSON text of a value, its keys sorted, to compare two arguments. */
const canonical = (value: unknown) =>
  JSON.stringify(value, (_key, item: unknown) =>
    isObject(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );

export const sameArguments = (a: unknown, b: unknown) => canonical(a) === canonical(b);

/** A check of arguments against the input schema. */
export type Validator = (args: Args) => Record<string, FieldError>;

/**
 * The check of the input schema, or null when the schema cannot be read: the
 * agent checks the arguments again. The errors go by field, the others under "".
 */
export function compileSchema(schema: Args | undefined): Validator | null {
  if (schema === undefined) return null;
  let type: z.ZodType;
  try {
    // The draft the schema names is left out, which the conversion may not know:
    // the MCP writes the vocabulary common to them.
    const rest = { ...schema };
    delete rest.$schema;
    type = z.fromJSONSchema(rest);
  } catch {
    return null;
  }
  return (args) => {
    const result = type.safeParse(args);
    if (result.success) return {};
    const errors: Record<string, FieldError> = {};
    for (const issue of result.error.issues) {
      const unknownKey = issue.code === "unrecognized_keys" ? (issue.keys[0] ?? "") : undefined;
      const name = unknownKey ?? (typeof issue.path[0] === "string" ? issue.path[0] : "");
      const missing =
        issue.code === "invalid_type" && issue.path.length === 1 && args[name] === undefined;
      errors[name] ??= missing ? "required" : { message: issue.message };
    }
    return errors;
  };
}
