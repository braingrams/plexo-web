// What a custom section type is, and what counts as a valid one. Shared by the API routes (dashboard
// and MCP both go through them) so "valid" lives in one place. Pure — no database, no SDK — so the
// dashboard form can reuse the types and the rules are easy to test.

export type SectionFieldType = "text" | "longtext" | "richtext" | "image" | "link" | "button" | "icon" | "toggle" | "color" | "select" | "list";

export const SECTION_FIELD_TYPES: readonly SectionFieldType[] = ["text", "longtext", "richtext", "image", "link", "button", "icon", "toggle", "color", "select", "list"];
const ITEM_FIELD_TYPES: readonly SectionFieldType[] = ["text", "longtext", "richtext", "image", "link", "button", "icon", "toggle", "color", "select"];

/** The words the dashboard shows for each kind of field (never the internal names). */
export const FIELD_TYPE_LABELS: Record<SectionFieldType, string> = {
  text: "Short text",
  longtext: "Long text",
  richtext: "Formatted text (bold, links, lists)",
  image: "Picture",
  link: "Link",
  button: "Button (text + link)",
  icon: "Icon",
  toggle: "Yes / no",
  color: "Colour",
  select: "Choice from a list",
  list: "Repeating group",
};

export type SectionField = {
  key: string;
  label: string;
  type: SectionFieldType;
  hint?: string;
  /** Faint example shown in an empty box, like "Ada Lovelace". */
  placeholder?: string;
  /** For `select`: [value, label] pairs. */
  options?: Array<[string, string]>;
  /** For `list`: the fields of each row, what to call a row, and how many rows make sense. */
  item?: SectionField[];
  itemName?: string;
  min?: number;
  limit?: number;
};

/** Names the design itself provides — a field can't use them. */
const RESERVED_KEYS = new Set(["tone", "align", "_key", "items_count"]);

export const MAX_HTML_CHARS = 30_000;
export const MAX_FIELDS = 24;

/** "Quote author" → "quote_author". Placeholders in the design use these. */
export function fieldKeyFrom(label: string): string {
  const k = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return /^[0-9]/.test(k) ? `f_${k}` : k;
}

type Result<T> = { value: T } | { error: string };

function normalizeField(raw: unknown, where: string, allowed: readonly SectionFieldType[], seen: Set<string>): Result<SectionField> {
  if (!raw || typeof raw !== "object") return { error: `${where} isn't valid.` };
  const r = raw as Record<string, unknown>;
  const label = typeof r.label === "string" ? r.label.trim().slice(0, 60) : "";
  if (!label) return { error: `${where} needs a name (what the person filling it in will see).` };
  const type = r.type as SectionFieldType;
  if (!allowed.includes(type)) return { error: `"${label}" has a type we don't know. Pick one of: ${allowed.join(", ")}.` };
  const key = typeof r.key === "string" && r.key.trim() ? fieldKeyFrom(r.key) : fieldKeyFrom(label);
  if (!key) return { error: `"${label}" needs at least one letter or number in its name.` };
  if (RESERVED_KEYS.has(key)) return { error: `"${label}" is a name we use ourselves — please choose another.` };
  if (seen.has(key)) return { error: `Two fields are called "${label}". Give each one its own name.` };
  seen.add(key);

  const field: SectionField = { key, label, type };
  if (typeof r.hint === "string" && r.hint.trim()) field.hint = r.hint.trim().slice(0, 200);
  if (typeof r.placeholder === "string" && r.placeholder.trim() && ["text", "longtext", "richtext", "button"].includes(type)) field.placeholder = r.placeholder.trim().slice(0, 100);

  if (type === "select") {
    const options = Array.isArray(r.options)
      ? r.options
          .map((o): [string, string] | null => {
            if (Array.isArray(o) && typeof o[0] === "string") return [o[0], typeof o[1] === "string" && o[1] ? o[1] : o[0]];
            if (typeof o === "string" && o.trim()) return [o.trim(), o.trim()];
            return null;
          })
          .filter((o): o is [string, string] => o !== null && o[0].length > 0)
          .slice(0, 30)
      : [];
    if (options.length < 2) return { error: `"${label}" is a choice, so it needs at least two options.` };
    field.options = options;
  }

  if (type === "list") {
    if (!Array.isArray(r.item) || r.item.length === 0) return { error: `"${label}" repeats, so it needs at least one field inside it (for example a name and a photo).` };
    const innerSeen = new Set<string>();
    const item: SectionField[] = [];
    for (const [i, inner] of r.item.entries()) {
      const out = normalizeField(inner, `Field ${i + 1} inside "${label}"`, ITEM_FIELD_TYPES, innerSeen);
      if ("error" in out) return out;
      item.push(out.value);
    }
    field.item = item;
    field.itemName = typeof r.itemName === "string" && r.itemName.trim() ? r.itemName.trim().slice(0, 30) : "item";
    const min = Number(r.min);
    const limit = Number(r.limit);
    field.min = Number.isFinite(min) ? Math.min(20, Math.max(0, Math.floor(min))) : 1;
    field.limit = Number.isFinite(limit) ? Math.min(60, Math.max(1, Math.floor(limit))) : 24;
    if (field.min > field.limit) field.min = field.limit;
  }
  return { value: field };
}

export function normalizeSectionFields(raw: unknown): Result<SectionField[]> {
  if (!Array.isArray(raw) || raw.length === 0) return { error: "Add at least one thing for people to fill in (for example a heading or a repeating group)." };
  if (raw.length > MAX_FIELDS) return { error: `That's a lot of fields — please keep it to ${MAX_FIELDS} or fewer.` };
  const seen = new Set<string>();
  const fields: SectionField[] = [];
  for (const [i, f] of raw.entries()) {
    const out = normalizeField(f, `Field ${i + 1}`, SECTION_FIELD_TYPES, seen);
    if ("error" in out) return out;
    fields.push(out.value);
  }
  // A formatted-text field's value goes into the design as ready-made markup, so no other field (at any level) may share its
  // name — otherwise plain text with that name could be treated as markup too.
  const all: Array<{ key: string; rich: boolean; label: string }> = [];
  const gather = (fs: SectionField[]) => fs.forEach((f) => { all.push({ key: f.key, rich: f.type === "richtext", label: f.label }); if (f.item) gather(f.item); });
  gather(fields);
  for (const a of all) {
    if (a.rich && all.some((b) => b !== a && b.key === a.key)) return { error: `"${a.label}" shares its name with another field. Give formatted-text fields a name no other field uses.` };
  }
  return { value: fields };
}

const PLACEHOLDER = /\{\{\{?\s*[#^/]?\s*([\w.@]+)\s*\}?\}\}/g;
const BUILT_IN = new Set(["tone", "align", ".", "@index", "@number", "@first", "@last"]);

/**
 * The design (HTML) must only mention fields that exist, and every {{#list}} must be closed — otherwise the section would
 * quietly show nothing where the owner expected something. Returns a plain-words problem, or null.
 */
export function checkSectionHtml(html: string, fields: SectionField[]): string | null {
  const text = html.trim();
  if (!text) return "Describe how the section should look — it can't be empty.";
  if (text.length > MAX_HTML_CHARS) return `The design is too long (over ${MAX_HTML_CHARS.toLocaleString("en")} characters). Try a simpler layout.`;
  const known = new Set<string>();
  const add = (fs: SectionField[]) => {
    for (const f of fs) {
      known.add(f.key);
      if (f.item) add(f.item);
    }
  };
  add(fields);
  const open: string[] = [];
  for (const m of text.matchAll(/\{\{\s*([#^/])\s*([\w.@]+)\s*\}\}/g)) {
    if (m[1] === "/") {
      if (open.pop() !== m[2]) return `"{{/${m[2]}}}" doesn't match an opening "{{#${m[2]}}}". Every repeating part needs a start and an end.`;
    } else open.push(m[2]);
  }
  if (open.length) return `"{{#${open[open.length - 1]}}}" is never closed with "{{/${open[open.length - 1]}}}".`;
  for (const m of text.matchAll(PLACEHOLDER)) {
    const name = m[1];
    const head = name.split(".")[0];
    if (BUILT_IN.has(name) || BUILT_IN.has(head)) continue;
    if (!known.has(head)) return `Your design mentions {{${name}}}, but there's no field with that name. Add the field, or fix the spelling.`;
  }
  return null;
}

/** Believable starting words for every field, so a brand-new section looks finished before anyone types a thing. */
export function sampleDefaults(fields: SectionField[], rows = 3): Record<string, unknown> {
  const one = (f: SectionField, n: number): unknown => {
    switch (f.type) {
      case "text": return f.placeholder?.replace(/^e\.g\.\s*/i, "") || (n === 0 && /head|title/i.test(f.label) ? f.label : `${f.label} ${n + 1}`);
      case "longtext": return "A few friendly words go here. Replace them with your own.";
      case "richtext": return "<p>A few friendly words go here. You can make some <strong>bold</strong> or add a link.</p>";
      case "image": return samplePicture(n);
      case "link": return "#";
      case "button": return { label: f.label, href: "#" };
      case "toggle": return false;
      case "color": return "";
      case "select": return f.options?.[0]?.[0] ?? "";
      case "icon": return "star";
      case "list": return Array.from({ length: Math.min(rows, f.limit ?? rows) }, (_, i) => Object.fromEntries((f.item ?? []).map((x) => [x.key, one(x, i)])));
      default: return "";
    }
  };
  return Object.fromEntries(fields.map((f) => [f.key, one(f, 0)]));
}

const PICTURE_TINTS: Array<[string, string]> = [["#dbeafe", "#bfdbfe"], ["#fce7f3", "#fbcfe8"], ["#dcfce7", "#bbf7d0"], ["#fef3c7", "#fde68a"]];
/** A soft, tasteful placeholder picture (an inline image, so it needs no upload and works everywhere) until the owner adds their own. */
export function samplePicture(n = 0): string {
  const [a, b] = PICTURE_TINTS[n % PICTURE_TINTS.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="800" height="600" fill="url(#g)"/><circle cx="400" cy="250" r="70" fill="#fff" fill-opacity=".7"/><path d="M190 520c20-110 110-160 210-160s190 50 210 160z" fill="#fff" fill-opacity=".7"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export type SectionTypeInput = {
  name: string;
  description?: string;
  fields: SectionField[];
  html: string;
  defaults?: Record<string, unknown>;
};

/** Cleans and checks the body of a create/update request. */
export function normalizeSectionTypeInput(body: Record<string, unknown>, existing?: { name: string; description?: string; fields: SectionField[]; html: string; defaults?: unknown }): Result<SectionTypeInput> {
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : (existing?.name ?? "");
  if (!name) return { error: "What are you creating? Give it a name, like “Testimonials” or “Team members”." };

  const fieldsOut = body.fields !== undefined ? normalizeSectionFields(body.fields) : existing ? { value: existing.fields } : normalizeSectionFields(undefined);
  if ("error" in fieldsOut) return fieldsOut;

  const html = typeof body.html === "string" ? body.html : (existing?.html ?? "");
  const problem = checkSectionHtml(html, fieldsOut.value);
  if (problem) return { error: problem };

  const description = typeof body.description === "string" ? body.description.trim().slice(0, 160) : existing?.description;
  let defaults: Record<string, unknown> | undefined;
  if (body.defaults !== undefined) {
    if (body.defaults !== null && (typeof body.defaults !== "object" || Array.isArray(body.defaults))) return { error: "The starting content must be an object with a value for each field." };
    defaults = (body.defaults as Record<string, unknown> | null) ?? undefined;
  } else if (existing?.defaults && typeof existing.defaults === "object") defaults = existing.defaults as Record<string, unknown>;
  if (!defaults) defaults = sampleDefaults(fieldsOut.value);
  if (defaults && JSON.stringify(defaults).length > 40_000) return { error: "The starting content is too long." };

  return { value: { name, ...(description ? { description } : {}), fields: fieldsOut.value, html: html.trim(), ...(defaults ? { defaults } : {}) } };
}

export const newSectionTypeId = (): string => globalThis.crypto.randomUUID();
