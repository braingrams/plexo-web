/**
 * The words of a new-editor (V2) design as "slots" SOL can rewrite, and putting SOL's words back, all on the design's own JSON.
 *
 * The design JSON is the source of truth: the editor, every recompile and every publish read it, and HTML is only ever compiled from it.
 * So when SOL tailors a marketplace design to a business it edits THAT, never a compiled page:
 *  - a slot is one visible piece of text, addressed by where it lives in the JSON (a path), so it can always be put back exactly there;
 *  - a field that holds rich text ("Build <em>strong</em> habits") gives one slot per stretch of text between its inline tags, so SOL's
 *    new words keep the emphasis and the markup is never shown to SOL or written by it;
 *  - the same text repeated ("Learn more" x3) is simply three slots, each with its own address, so nothing is ever ambiguous;
 *  - the site's shared header and footer are separate designs: pass them as further docs and their slots are addressed the same way;
 *  - nothing SOL says can be "unmatched": a slot id either exists in the design or the entry is ignored.
 * Adding and removing is limited to two safe, schema-valid moves: filling a text field the design leaves blank (an empty tagline),
 * and removing a whole optional section (testimonials, a logo strip) that cannot be filled in truthfully. Anything riskier stays text-only.
 *
 * Pure and dependency-free (no SDK, no database), so it is unit tested on its own. Validation (parseV2Design) is the caller's job.
 */
import { decode } from "./designTextSync";

export type SlotRole = "page" | "header" | "footer";
export type SlotDoc<T = unknown> = { role: SlotRole; design: T };
export type Path = Array<string | number>;

export type Slot = {
  /** Stable for a given design: the doc, the JSON path and (for rich text) which stretch of text. */
  id: string;
  /** The visible words (entities decoded, inline tags removed). "" for a blank field SOL may fill. */
  text: string;
  empty?: boolean;
  role: SlotRole;
  /** Which of the docs it is in. */
  doc: number;
  path: Path;
  /** For rich text: the index of this stretch among the pieces of the field split by its inline tags. */
  part?: number;
  /** The JSON key that holds it ("headline", "label"...). */
  key: string;
  /** The block (section) kind it sits in ("hero", "header"...), when it is inside one. */
  blockKind?: string;
  /** The JSON path of the object that holds it, so slots of one block can be told apart from another's. */
  holder: string;
};

// ---------------------------------------------------------------- what counts as words

/** Objects whose strings are styling or settings, never words a reader sees. */
const SKIP_OBJECTS = new Set(["style", "styles", "css", "tokens", "designSystem", "designSystemRef", "designSystemUrl", "customJs", "responsive", "animation", "animations", "theme", "spacing", "typography"]);
/** Keys that are always words when they hold text. */
const TEXT_KEYS = new Set([
  "headline", "heading", "title", "subtitle", "sub", "subheadline", "subhead", "text", "body", "label", "description", "caption", "quote", "eyebrow", "kicker", "tagline",
  "cta", "button", "buttontext", "copy", "content", "paragraph", "name", "role", "author", "question", "answer", "price", "note", "message", "copyright", "about", "brand",
  "placeholder", "value", "unit", "period", "badge", "tag", "company", "location", "address", "phone", "email", "hours", "summary", "intro", "lead", "stat", "metric", "term",
]);
/** Keys of fields a design may leave blank and SOL may fill (an optional line under a heading). */
const FILLABLE_KEYS = new Set(["eyebrow", "kicker", "tagline", "subtitle", "subheadline", "subhead", "sub", "description", "caption", "note", "intro", "lead"]);
/** Structure, addresses and styling: never words. */
const TECH_KEY = /^(id|type|kind|format|slug|href|url|link|src|srcset|image|img|photo|picture|poster|video|icon|iconname|logo|favicon|color|colour|bg|background|font|fontfamily|align|alignment|justify|variant|tone|size|width|height|ratio|layout|mode|position|direction|target|rel|method|action|class|classname|component|ref|anchor|fieldtype|inputtype|pattern|key|alt|required|columns|order|currency|lang|locale)$/i;
const TECH_SUFFIX = /(Id|Url|Href|Src|Image|Icon|Color|Colour|Class|Ref|Key|Slug|Anchor)$/;
/** A "name" is a person's or a product's name, unless it sits in a form field (which also has a type or is required). */
const FIELD_HINTS = ["type", "inputType", "fieldType", "required", "placeholder"];

const HAS_LETTER = /[\p{L}\p{N}]/u;
const LOOKS_LIKE_ADDRESS = /^(?:https?:\/\/|\/|#|mailto:|tel:|data:|\.\.?\/)/i;
const LOOKS_LIKE_COLOUR = /^#?[0-9a-f]{3,8}$/i;
const LOOKS_LIKE_TOKEN = /^[a-z0-9]+(?:[-_.:/][a-z0-9]+)+$/;

const MAX_NODE_CHARS = 220;
const MAX_TOTAL_CHARS = 14_000;
/** The most slots SOL is shown (the same limit as the page's words had), and the most blank ones among them. */
export const MAX_SLOTS = 260;
const MAX_EMPTY_SLOTS = 12;
const MAX_REPLACEMENT_CHARS = 600;

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isRich = (s: string) => /<[a-z!/][^>]*>/i.test(s) || /&(?:[a-z]{2,8}|#\d{1,6}|#x[0-9a-f]{1,6});/i.test(s);
const encodeText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

function isWords(key: string, value: string, holder: Record<string, unknown>): boolean {
  const lower = key.toLowerCase();
  if (TECH_SUFFIX.test(key) && !TEXT_KEYS.has(lower)) return false;
  if (TECH_KEY.test(key)) return false;
  if (lower === "name" && FIELD_HINTS.some((h) => h in holder)) return false;
  const v = value.trim();
  if (v.length < 2 || !HAS_LETTER.test(v) || LOOKS_LIKE_ADDRESS.test(v) || LOOKS_LIKE_COLOUR.test(v)) return false;
  if (TEXT_KEYS.has(lower)) return !LOOKS_LIKE_TOKEN.test(v) || /\s/.test(v);
  // Any other key: only text that reads like words (a capital, or more than one word), not a lone lowercase setting ("primary", "left").
  return /\s/.test(v) || /^\p{Lu}/u.test(v) ? !LOOKS_LIKE_TOKEN.test(v) : false;
}

const pathKey = (path: Path) => path.join(".");

function rootOf(design: unknown): unknown {
  const pages = (design as { pages?: unknown[] } | null)?.pages;
  return Array.isArray(pages) ? (pages[0] as { rootNode?: unknown } | undefined)?.rootNode : undefined;
}
const ROOT_PATH: Path = ["pages", 0, "rootNode"];

/** Every slot of every doc, in reading order (page sections in order, header before the page and footer after it when passed in that order). */
export function listSlots(docs: SlotDoc[]): Slot[] {
  const out: Slot[] = [];
  docs.forEach((d, doc) => {
    const visit = (value: unknown, path: Path, holder: Record<string, unknown> | null, key: string, blockKind: string | undefined, holderPath: string): void => {
      if (typeof value === "string") {
        if (!holder) return;
        const inBlock = path.includes("block");
        if (value.trim() === "" && inBlock && path.includes("content") && FILLABLE_KEYS.has(key.toLowerCase())) {
          out.push({ id: `${d.role}${doc}|${pathKey(path)}`, text: "", empty: true, role: d.role, doc, path, key, blockKind, holder: holderPath });
          return;
        }
        if (!isWords(key, value, holder)) return;
        if (isRich(value)) {
          value.split(/(<[^>]*>)/).forEach((piece, idx) => {
            if (idx % 2 === 1) return;
            const text = decode(piece).replace(/\s+/g, " ").trim();
            if (text && HAS_LETTER.test(text)) out.push({ id: `${d.role}${doc}|${pathKey(path)}~${idx}`, text, role: d.role, doc, path, part: idx, key, blockKind, holder: holderPath });
          });
        } else {
          out.push({ id: `${d.role}${doc}|${pathKey(path)}`, text: squash(value), role: d.role, doc, path, key, blockKind, holder: holderPath });
        }
        return;
      }
      if (Array.isArray(value)) {
        value.forEach((v, i) => visit(v, [...path, i], holder, key, blockKind, holderPath));
        return;
      }
      if (!isRecord(value)) return;
      const kind = isRecord(value.block) && typeof value.block.kind === "string" ? value.block.kind : undefined;
      for (const [k, v] of Object.entries(value)) {
        if (SKIP_OBJECTS.has(k) && !(typeof v === "string")) continue;
        // A string is judged against the object that holds it.
        visit(v, [...path, k], value, k, kind ?? blockKind, pathKey(path));
      }
    };
    const root = rootOf(d.design);
    if (root !== undefined) visit(root, ROOT_PATH, null, "rootNode", undefined, "");
  });
  // Blank fields come last and only a few, so SOL's attention stays on the words that are there.
  const filled = out.filter((s) => !s.empty);
  const blanks = out.filter((s) => s.empty).slice(0, MAX_EMPTY_SLOTS);
  return [...filled, ...blanks];
}

/** What SOL is shown: numbered 0, 1, 2... in reading order, trimmed to what it can usefully rewrite in one go (the same limits the page's words had). */
export function slotNodes(slots: Slot[]): Array<{ id: number; text: string }> {
  const nodes: Array<{ id: number; text: string }> = [];
  let total = 0;
  for (const s of slots) {
    if (nodes.length >= MAX_SLOTS || total >= MAX_TOTAL_CHARS) break;
    const text = s.text.slice(0, MAX_NODE_CHARS);
    nodes.push({ id: nodes.length, text });
    total += text.length;
  }
  return nodes;
}

/** SOL's answers are keyed by the numbers it was shown; this turns them into slot ids. Numbers that were never shown are ignored. */
export function copyBySlot(slots: Slot[], numbered: Record<string, string>): Record<string, string> {
  const shown = slotNodes(slots).length;
  const out: Record<string, string> = {};
  for (const [n, text] of Object.entries(numbered)) {
    if (!/^\d{1,4}$/.test(n)) continue;
    const slot = Number(n) < shown ? slots[Number(n)] : undefined;
    if (slot && typeof text === "string") out[slot.id] = text;
  }
  return out;
}

// ---------------------------------------------------------------- putting words back

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function getAt(root: unknown, path: Path): unknown {
  let cur = root;
  for (const k of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string | number, unknown>)[k];
  }
  return cur;
}

function setAt(root: unknown, path: Path, value: string): boolean {
  const parent = getAt(root, path.slice(0, -1));
  if (parent === null || typeof parent !== "object") return false;
  (parent as Record<string | number, unknown>)[path[path.length - 1]] = value;
  return true;
}

/** The words as they may be written back: plain text only (no tags), one line, a sensible length. "" and unusable text are refused. */
export function cleanCopy(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const plain = squash(text.replace(/<[^>]*>/g, " "));
  return plain ? plain.slice(0, MAX_REPLACEMENT_CHARS) : null;
}

/**
 * Puts new words into copies of the docs. `copy` is keyed by slot id; an id the design does not have, and words that are not usable, are skipped
 * (`skipped` says how many). Rich text keeps its inline tags: only the stretch of text of that slot changes. The inputs are not modified.
 */
export function applySlotCopy<T extends SlotDoc>(docs: T[], copy: Record<string, string>): { docs: T[]; applied: number; skipped: number } {
  const slots = listSlots(docs);
  const byId = new Map(slots.map((s) => [s.id, s]));
  const next = docs.map((d) => ({ ...d, design: clone(d.design) }));
  let applied = 0;
  let skipped = 0;
  // Group by field so a rich field's stretches are replaced against one split of the original value.
  const fields = new Map<string, { slot: Slot; text: string }[]>();
  for (const [id, raw] of Object.entries(copy)) {
    const slot = byId.get(id);
    const text = cleanCopy(raw);
    if (!slot || text === null) {
      skipped++;
      continue;
    }
    const k = `${slot.doc}|${pathKey(slot.path)}`;
    fields.set(k, [...(fields.get(k) ?? []), { slot, text }]);
  }
  for (const group of fields.values()) {
    const { slot } = group[0];
    const doc = next[slot.doc];
    const current = getAt(doc.design, slot.path);
    if (typeof current !== "string") {
      skipped += group.length;
      continue;
    }
    if (slot.part === undefined) {
      if (setAt(doc.design, slot.path, group[0].text)) applied++;
      else skipped++;
      continue;
    }
    const pieces = current.split(/(<[^>]*>)/);
    for (const { slot: s, text } of group) {
      const piece = pieces[s.part ?? -1];
      if (piece === undefined || (s.part ?? 0) % 2 === 1) {
        skipped++;
        continue;
      }
      const lead = piece.match(/^\s*/)?.[0] ?? "";
      const trail = piece.match(/\s*$/)?.[0] ?? "";
      pieces[s.part as number] = `${lead}${encodeText(text)}${trail}`;
      applied++;
    }
    setAt(doc.design, slot.path, pieces.join(""));
  }
  return { docs: next as T[], applied, skipped };
}

// ---------------------------------------------------------------- removing an optional section

/** Sections a design can lose without breaking: lists of claims that are the sample business's own. */
const OPTIONAL_KIND = /(testimonial|review|logo-?(cloud|strip|bar|wall)|logos|clients?|partners?|press|awards?|as-seen|stats?|statistics|numbers|team|pricing|plans|gallery|blog|news|social-proof|trust)/i;
/** Never removed, whatever else the kind says. */
const NEVER_KIND = /(header|footer|hero|nav|menu|form|contact|cart|checkout|product|store|shop|booking|login|signup|embed|code|custom)/i;
const MAX_REMOVED = 3;
const MIN_KEPT = 3;

type SectionNode = { id?: unknown; props?: { block?: { kind?: unknown } }; children?: unknown };

export type OptionalSection = { id: string; kind: string; /** The first few words in it, so SOL (and a person) can tell what it is. */ preview: string };

/** The page's top-level sections SOL may propose to remove, with a few of their words. Empty when removing anything would leave too little. */
export function removableSections(doc: SlotDoc | undefined): OptionalSection[] {
  const root = doc ? (rootOf(doc.design) as { children?: SectionNode[] } | undefined) : undefined;
  const sections = Array.isArray(root?.children) ? root.children : [];
  if (sections.length <= MIN_KEPT) return [];
  const allStrings: string[] = [];
  (function collect(v: unknown) {
    if (typeof v === "string") allStrings.push(v);
    else if (Array.isArray(v)) v.forEach(collect);
    else if (isRecord(v)) Object.values(v).forEach(collect);
  })(sections);
  const slots = listSlots([doc as SlotDoc]);
  const out: OptionalSection[] = [];
  sections.forEach((s, i) => {
    const kind = typeof s?.props?.block?.kind === "string" ? s.props.block.kind : "";
    const id = typeof s?.id === "string" ? s.id : "";
    if (!id || !kind || !OPTIONAL_KIND.test(kind) || NEVER_KIND.test(kind)) return;
    // A menu link that jumps to this section ("#pricing") would be left pointing at nothing.
    if (allStrings.some((str) => str === `#${id}` || str.endsWith(`#${id}`))) return;
    const prefix = `pages.0.rootNode.children.${i}.`;
    const preview = slots.filter((sl) => pathKey(sl.path).startsWith(prefix) && sl.text).slice(0, 3).map((sl) => sl.text).join(" | ").slice(0, 120);
    out.push({ id, kind, preview });
  });
  return out;
}

/** A copy of the doc without the named optional sections. Only sections `removableSections` offers are removed, at most three, always leaving a real page. */
export function removeSections<T extends SlotDoc>(doc: T, ids: string[]): { doc: T; removed: string[] } {
  const allowed = new Set(removableSections(doc).map((s) => s.id));
  const wanted = [...new Set(ids)].filter((id) => allowed.has(id)).slice(0, MAX_REMOVED);
  if (!wanted.length) return { doc, removed: [] };
  const next = { ...doc, design: clone(doc.design) };
  const root = rootOf(next.design) as { children: SectionNode[] };
  const before = root.children.length;
  root.children = root.children.filter((s) => !(typeof s?.id === "string" && wanted.includes(s.id)));
  if (root.children.length < MIN_KEPT || root.children.length === before) return { doc, removed: [] };
  return { doc: next as T, removed: wanted };
}
