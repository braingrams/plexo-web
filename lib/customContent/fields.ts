import { randomUUID } from "node:crypto";
import { slugify } from "@/lib/slugUtils";
import type { CustomContentField, CustomContentFieldType } from "@/lib/db/customContentEntities";

// Shared by the content-types and entries API routes (app/api/v1/templates/[id]/content-types/**)
// so "what counts as a valid field schema" and "what counts as valid data against that schema"
// live in exactly one place, not duplicated across POST/PATCH handlers for both entities.

export const CUSTOM_CONTENT_FIELD_TYPES: readonly CustomContentFieldType[] = [
  "text",
  "textarea",
  "richtext",
  "number",
  "boolean",
  "date",
  "image_url",
  "url",
];

function isFieldType(value: unknown): value is CustomContentFieldType {
  return typeof value === "string" && (CUSTOM_CONTENT_FIELD_TYPES as readonly string[]).includes(value);
}

/**
 * Validates + normalizes a content type's submitted `fields` array (from the dashboard's field
 * builder or an API caller). Assigns a stable `id` to each field (reused if the caller already
 * supplied one, e.g. editing an existing type — new otherwise), derives `key` from `name` via
 * the same slugify() every other slug in this app uses when the caller didn't supply one, and
 * rejects duplicate keys outright (a v1 content type schema has no way to disambiguate two data
 * values sharing a key, so this is caught at definition time rather than surfacing as silent
 * data loss later).
 */
export function normalizeFieldsInput(raw: unknown): { fields: CustomContentField[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: "fields must be a non-empty array." };
  }

  const fields: CustomContentField[] = [];
  const seenKeys = new Set<string>();

  for (const [index, item] of raw.entries()) {
    if (!item || typeof item !== "object") {
      return { error: `Field ${index + 1} is invalid.` };
    }
    const raw_ = item as Record<string, unknown>;

    const name = typeof raw_.name === "string" ? raw_.name.trim() : "";
    if (!name) {
      return { error: `Field ${index + 1} needs a name.` };
    }

    if (!isFieldType(raw_.type)) {
      return { error: `Field "${name}" has an invalid type. Must be one of: ${CUSTOM_CONTENT_FIELD_TYPES.join(", ")}.` };
    }

    const explicitKey = typeof raw_.key === "string" ? slugify(raw_.key) : "";
    const key = explicitKey || slugify(name);
    if (!key) {
      return { error: `Field "${name}" resolved to an empty key — use a name with at least one letter or number.` };
    }
    if (seenKeys.has(key)) {
      return { error: `Duplicate field key "${key}" — every field needs a unique key.` };
    }
    seenKeys.add(key);

    const id = typeof raw_.id === "string" && raw_.id ? raw_.id : randomUUID();
    const required = raw_.required === true;

    fields.push({ id, name, key, type: raw_.type, required });
  }

  return { fields };
}

/**
 * Validates a submitted entry `data` object against its content type's own `fields` schema:
 * rejects unknown keys, enforces `required`, and coerces/validates each present value against
 * its field's type. Returns a sanitized object containing only the keys the schema declares
 * (any field the caller omitted simply isn't in the output — entries aren't required to set
 * every optional field).
 */
export function validateEntryData(
  fields: CustomContentField[],
  raw: unknown,
): { data: Record<string, unknown> } | { error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { error: "data must be an object keyed by field key." };
  }
  const input = raw as Record<string, unknown>;
  const fieldByKey = new Map(fields.map((f) => [f.key, f]));

  const unknownKeys = Object.keys(input).filter((k) => !fieldByKey.has(k));
  if (unknownKeys.length > 0) {
    return { error: `Unknown field key(s): ${unknownKeys.join(", ")}.` };
  }

  const data: Record<string, unknown> = {};
  for (const field of fields) {
    const value = input[field.key];
    const isEmpty =
      value === undefined ||
      value === null ||
      (typeof value === "string" && value.trim() === "");

    if (field.required && isEmpty) {
      return { error: `"${field.name}" is required.` };
    }
    if (value === undefined) continue;
    if (value === null) {
      data[field.key] = null;
      continue;
    }

    switch (field.type) {
      case "number": {
        const num = typeof value === "number" ? value : Number(value);
        if (typeof value !== "number" && typeof value !== "string") {
          return { error: `"${field.name}" must be a number.` };
        }
        if (!Number.isFinite(num)) {
          return { error: `"${field.name}" must be a number.` };
        }
        data[field.key] = num;
        break;
      }
      case "boolean": {
        if (typeof value !== "boolean") {
          return { error: `"${field.name}" must be true or false.` };
        }
        data[field.key] = value;
        break;
      }
      // text/textarea/richtext/date/image_url/url are all plain-string values in v1 — richtext
      // deliberately stores plain/simple-HTML text, not a structured document (no WYSIWYG, per
      // scope); image_url/url are pasted strings, not uploads.
      case "text":
      case "textarea":
      case "richtext":
      case "date":
      case "image_url":
      case "url":
      default: {
        if (typeof value !== "string") {
          return { error: `"${field.name}" must be a string.` };
        }
        data[field.key] = value;
        break;
      }
    }
  }

  return { data };
}
