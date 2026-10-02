import { randomUUID } from "node:crypto";

/**
 * A site owner's own extra checkout questions (CommerceSettings.checkoutFields) — e.g.
 * "Gift message", "Preferred delivery date", "Landmark near your address". Rendered by
 * public/commerce.js's checkout_flow/booking blocks under "Additional information", and
 * answered values are snapshotted onto CommerceOrder.customFields WITH their label, so
 * renaming or deleting a question later never rewrites what an existing order says.
 */
export type CheckoutFieldType = "text" | "textarea" | "select" | "date" | "phone";

export type CheckoutField = {
  id: string;
  label: string;
  type: CheckoutFieldType;
  required: boolean;
  options?: string[];
  placeholder?: string;
};

export type CheckoutFieldAnswer = { id: string; label: string; value: string };

export const CHECKOUT_FIELD_TYPES: CheckoutFieldType[] = ["text", "textarea", "select", "date", "phone"];
export const MAX_CHECKOUT_FIELDS = 20;
const MAX_LABEL = 80;
const MAX_ANSWER = 1000;

export class CheckoutFieldsError extends Error {}

/** Reads whatever is stored (an `any` attribute) back as a clean list — tolerant of a
 * malformed row so one bad write can never break checkout for every visitor. */
export function readCheckoutFields(raw: unknown): CheckoutField[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (f): f is CheckoutField =>
      Boolean(f) && typeof f.id === "string" && typeof f.label === "string" && CHECKOUT_FIELD_TYPES.includes(f.type),
  );
}

/** Validates the owner's edited question list (dashboard PUT / MCP). Throws a
 * CheckoutFieldsError with a message a non-technical site owner can act on. */
export function normalizeCheckoutFields(raw: unknown): CheckoutField[] {
  if (!Array.isArray(raw)) throw new CheckoutFieldsError("checkoutFields must be a list of questions.");
  if (raw.length > MAX_CHECKOUT_FIELDS) throw new CheckoutFieldsError(`You can ask up to ${MAX_CHECKOUT_FIELDS} checkout questions.`);
  const seen = new Set<string>();
  return raw.map((item, index) => {
    const f = (item ?? {}) as Record<string, unknown>;
    const label = typeof f.label === "string" ? f.label.trim() : "";
    if (!label) throw new CheckoutFieldsError(`Question ${index + 1} needs a label.`);
    if (label.length > MAX_LABEL) throw new CheckoutFieldsError(`"${label.slice(0, 30)}…" is too long — keep labels under ${MAX_LABEL} characters.`);
    const type = (typeof f.type === "string" ? f.type : "text") as CheckoutFieldType;
    if (!CHECKOUT_FIELD_TYPES.includes(type)) {
      throw new CheckoutFieldsError(`"${label}" has an unknown answer type — use one of: ${CHECKOUT_FIELD_TYPES.join(", ")}.`);
    }
    let options: string[] | undefined;
    if (type === "select") {
      options = Array.isArray(f.options)
        ? Array.from(new Set(f.options.filter((o): o is string => typeof o === "string").map((o) => o.trim()).filter(Boolean)))
        : [];
      if (options.length < 2) throw new CheckoutFieldsError(`"${label}" is a dropdown — give it at least 2 choices.`);
    }
    let id = typeof f.id === "string" && f.id.trim() ? f.id.trim() : randomUUID();
    if (seen.has(id)) id = randomUUID();
    seen.add(id);
    const placeholder = typeof f.placeholder === "string" && f.placeholder.trim() ? f.placeholder.trim().slice(0, MAX_LABEL) : undefined;
    return { id, label, type, required: f.required === true, ...(options ? { options } : {}), ...(placeholder ? { placeholder } : {}) };
  });
}

/**
 * Validates a customer's answers at checkout against the site's CURRENT questions —
 * never trusting a client-supplied label (it's always re-read from the field definition).
 * `raw` is `{ [fieldId]: value }`. Throws CheckoutFieldsError for the storefront to show.
 */
export function resolveCheckoutFieldAnswers(fields: CheckoutField[], raw: unknown): CheckoutFieldAnswer[] {
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const answers: CheckoutFieldAnswer[] = [];
  for (const field of fields) {
    const rawValue = input[field.id];
    const value = typeof rawValue === "string" ? rawValue.trim().slice(0, MAX_ANSWER) : "";
    if (!value) {
      if (field.required) throw new CheckoutFieldsError(`Please answer "${field.label}".`);
      continue;
    }
    if (field.type === "select" && field.options && !field.options.includes(value)) {
      throw new CheckoutFieldsError(`Please pick one of the listed options for "${field.label}".`);
    }
    answers.push({ id: field.id, label: field.label, value });
  }
  return answers;
}

/** The public (storefront-safe) projection — identical today, kept as one function so a
 * future owner-only attribute can't accidentally leak to visitors. */
export function toPublicCheckoutFields(fields: CheckoutField[]): CheckoutField[] {
  return fields.map(({ id, label, type, required, options, placeholder }) => ({ id, label, type, required, ...(options ? { options } : {}), ...(placeholder ? { placeholder } : {}) }));
}
