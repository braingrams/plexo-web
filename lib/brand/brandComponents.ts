/**
 * The brand's ready-made components (a button, a card, a banner...), as the linked Strata project publishes them.
 *
 *   CATALOGUE   read from the SAME stored design system the hosted brand sheet is made from (no extra Strata call), so what SOL,
 *               the MCP tools and the Brand tab list is exactly what the sheet styles. Each component is a class on the sheet:
 *               `.plx-brand-<name>`, `.plx-brand-<name>--<variant>` and, for its parts, `.plx-brand-<name>__<part>`
 *               (the SDK's brandComponentCss writes them).
 *   CREATE      a small, closed description (name, look, variants, text slots) becomes a Strata component row. Everything is checked
 *               here (tags, properties, values, token names) so nothing unsafe ever reaches Strata or a page.
 *
 * Pure: no database, no network. No Next.js imports (SOL's standalone bundle uses this through brandModel).
 */
import type { DesignSystem } from "@charisol/plexo-sdk/v2/compile";
import type { StrataSnapshot } from "@charisol/plexo-sdk/v2/strata";

/** A component row, as Plexo and Strata both hold it: { name, variant, props, nodes }. */
export type DesignComponent = StrataSnapshot["components"][number];

type Node = NonNullable<DesignComponent["nodes"]>[number];

export type BrandComponentSlot = { role: string; kind: "text" | "link" | "image"; sample?: string };
export type BrandComponentInfo = {
  name: string;
  /** Looks besides the plain one (the plain one is always there). */
  variants: string[];
  /** The parts an owner (or an AI) fills in: a button's label, a card's title and body. */
  slots: BrandComponentSlot[];
  /** The class on the hosted brand sheet that gives an element this component's look. */
  className: string;
};

const MAX_COMPONENTS = 40;
const MAX_VARIANTS = 12;
const MAX_SLOTS = 12;

/** The class the hosted brand sheet gives a component (matches the SDK's brandComponentCss). */
export const brandComponentClass = (name: string): string => `plx-brand-${String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;

function walk(nodes: Node[] | undefined, visit: (n: Node, depth: number) => void, depth = 0): void {
  for (const n of Array.isArray(nodes) ? nodes : []) {
    if (!n || typeof n !== "object") continue;
    visit(n, depth);
    walk(n.children, visit, depth + 1);
  }
}

/** The components a design system holds, grouped by name, in the words an owner (and an AI) needs. Never throws. */
export function catalogueFromDesignSystem(ds: Pick<DesignSystem, "components"> | null | undefined): BrandComponentInfo[] {
  if (!ds || !Array.isArray(ds.components)) return [];
  const byName = new Map<string, BrandComponentInfo>();
  for (const c of ds.components) {
    const name = typeof c?.name === "string" ? c.name.trim() : "";
    if (!name || name.length > 60) continue;
    const key = name.toLowerCase();
    let entry = byName.get(key);
    if (!entry) {
      if (byName.size >= MAX_COMPONENTS) continue;
      entry = { name, variants: [], slots: [], className: brandComponentClass(name) };
      byName.set(key, entry);
    }
    const variant = typeof c.variant === "string" ? c.variant.trim() : "";
    const addVariant = (v: string) => {
      if (v && v !== "default" && v.length <= 40 && !entry!.variants.includes(v) && entry!.variants.length < MAX_VARIANTS) entry!.variants.push(v);
    };
    addVariant(variant);
    walk(c.nodes, (n, depth) => {
      for (const v of Object.keys(n.variants ?? {})) addVariant(v);
      if (depth === 0 && n.role === "root") return;
      const role = typeof n.role === "string" ? n.role.trim() : "";
      if (!role || role === "root" || entry!.slots.length >= MAX_SLOTS || entry!.slots.some((s) => s.role === role)) return;
      const kind: BrandComponentSlot["kind"] = n.tag === "img" ? "image" : n.tag === "a" ? "link" : "text";
      if (kind === "text" && typeof n.textContent !== "string") return;
      entry!.slots.push({ role, kind, ...(typeof n.textContent === "string" && n.textContent ? { sample: n.textContent.slice(0, 80) } : {}) });
    });
  }
  return [...byName.values()];
}

/** One plain line per component, for SOL's brand block and the MCP tools. */
export function componentLine(c: BrandComponentInfo): string {
  const variants = c.variants.length ? ` (looks: ${c.variants.join(", ")})` : "";
  const slots = c.slots.length ? `, fill in: ${c.slots.map((s) => s.role).join(", ")}` : "";
  return `${c.name}${variants}${slots}`;
}

// ---------------------------------------------------------------- creating one

export type NewComponentInput = {
  name?: unknown;
  /** The tag of the outer element (default div; button for a button). */
  tag?: unknown;
  /** The look of the outer element: CSS property -> value. Prefer the brand's variables: var(--color-action-primary-bg). */
  styles?: unknown;
  /** Other looks: name -> the CSS that changes from the plain look. */
  variants?: unknown;
  /** The parts inside it: [{ role, tag, text, styles }]. */
  slots?: unknown;
};

export class ComponentInputError extends Error {}

const NAME = /^[a-z][a-z0-9-]{0,39}$/;
const ROLE = /^[a-z][a-z0-9-]{0,29}$/;
const PROP = /^[a-z][a-z-]{1,40}$/;
/** Elements a component may be made of: structure and text only (no scripts, frames, forms or embeds). */
const OUTER_TAGS = new Set(["div", "section", "article", "aside", "header", "footer", "nav", "figure", "button", "a", "span", "p", "ul", "ol", "li", "blockquote"]);
const SLOT_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "span", "a", "small", "strong", "em", "li", "label", "blockquote", "button"]);
const SAFE_VALUE = /^[\w\s#%.,()/*+\-'"!:]{1,200}$/;
const VAR_REF = /var\(\s*(--[a-z0-9-]+)/gi;

const kebab = (s: string) => s.replace(/([A-Z])/g, "-$1").toLowerCase();

/** Cleans a component's name into the one place it appears (the class name). */
export function cleanComponentName(raw: unknown): string {
  const name = String(raw ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!NAME.test(name)) throw new ComponentInputError("Give the component a short name made of letters and numbers, like \"button\", \"card\" or \"banner\".");
  return name;
}

function cleanStyles(raw: unknown, where: string, knownTokens: Set<string> | null): Record<string, { value: string; type: string }> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) throw new ComponentInputError(`The look of ${where} should be an object like {"padding": "var(--space-3)", "background-color": "var(--color-action-primary)"}.`);
  const out: Record<string, { value: string; type: string }> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 40)) {
    const prop = kebab(k.trim());
    if (!PROP.test(prop)) throw new ComponentInputError(`"${k}" isn't a style Plexo can use in ${where}. Use ordinary CSS names like padding or background-color.`);
    const value = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : "";
    if (!value || !SAFE_VALUE.test(value) || /url\s*\(|expression|javascript:|@import|<|>|\\/i.test(value)) throw new ComponentInputError(`The value for ${prop} in ${where} isn't allowed. Use plain CSS values or the brand's variables, like var(--color-text-primary).`);
    if (knownTokens) {
      for (const m of value.matchAll(VAR_REF)) {
        if (!knownTokens.has(m[1])) throw new ComponentInputError(`${where} uses ${m[1]}, which this brand doesn't have. Read the brand first (get_brand_tokens) and use one of its variables.`);
      }
    }
    out[prop] = { value, type: /color|background|^fill$|^stroke$/.test(prop) && !/background-(?:size|position|repeat|image)/.test(prop) ? "color" : "string" };
  }
  return out;
}

/**
 * Turns a description into the component row Strata stores ({ name, variant:"default", props, nodes }), the same shape a published
 * Strata component has: the outer element carries its looks as `variants`, the parts sit inside it as children with a role.
 * `tokens` (the brand's own variable names) lets it refuse a variable the brand doesn't have; pass null to skip that check.
 */
export function buildComponentRow(input: NewComponentInput, tokens: Iterable<string> | null): DesignComponent {
  const name = cleanComponentName(input.name);
  const known = tokens ? new Set(tokens) : null;
  const tag = typeof input.tag === "string" && input.tag.trim() ? input.tag.trim().toLowerCase() : "div";
  if (!OUTER_TAGS.has(tag)) throw new ComponentInputError(`A component can't be made from <${tag}>. Use one of: ${[...OUTER_TAGS].join(", ")}.`);
  const properties = cleanStyles(input.styles, "the component", known);
  if (!Object.keys(properties).length) throw new ComponentInputError("Say how it looks (styles), for example padding, background-color and border-radius, using the brand's variables.");

  const variants: Record<string, { properties: Record<string, { value: string; type: string }> }> = {};
  if (input.variants !== undefined && input.variants !== null) {
    if (typeof input.variants !== "object" || Array.isArray(input.variants)) throw new ComponentInputError("variants should be an object: each look's name and the styles that change, like {\"secondary\": {\"background-color\": \"transparent\"}}.");
    const entries = Object.entries(input.variants as Record<string, unknown>);
    if (entries.length > MAX_VARIANTS) throw new ComponentInputError(`Use at most ${MAX_VARIANTS} looks per component.`);
    for (const [vName, styles] of entries) {
      const key = vName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      if (!ROLE.test(key) || key === "default") throw new ComponentInputError(`"${vName}" can't be a look's name. Use a short word like primary, secondary or outline.`);
      const p = cleanStyles(styles, `the "${vName}" look`, known);
      if (!Object.keys(p).length) throw new ComponentInputError(`The "${vName}" look needs at least one style that changes.`);
      variants[key] = { properties: p };
    }
  }

  const children: Node[] = [];
  if (input.slots !== undefined && input.slots !== null) {
    if (!Array.isArray(input.slots)) throw new ComponentInputError("slots should be a list: the parts inside the component, like [{\"role\": \"title\", \"tag\": \"h3\", \"text\": \"Card title\"}].");
    if (input.slots.length > MAX_SLOTS) throw new ComponentInputError(`Use at most ${MAX_SLOTS} parts per component.`);
    const seen = new Set<string>();
    for (const raw of input.slots) {
      const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      const role = typeof s.role === "string" ? s.role.trim().toLowerCase() : "";
      if (!ROLE.test(role) || role === "root") throw new ComponentInputError("Each part needs a short role name, like title, body or label.");
      if (seen.has(role)) throw new ComponentInputError(`Two parts are both called "${role}". Give each a different role.`);
      seen.add(role);
      const sTag = typeof s.tag === "string" && s.tag.trim() ? s.tag.trim().toLowerCase() : "span";
      if (!SLOT_TAGS.has(sTag)) throw new ComponentInputError(`The part "${role}" can't be a <${sTag}>. Use one of: ${[...SLOT_TAGS].join(", ")}.`);
      const text = typeof s.text === "string" ? s.text.replace(/\s+/g, " ").trim().slice(0, 200) : "";
      if (/[<>]/.test(text)) throw new ComponentInputError(`The sample text of "${role}" can't contain markup. Plain words only.`);
      const props = cleanStyles(s.styles, `the part "${role}"`, known);
      children.push({ tag: sTag, role, textContent: text || (sTag === "img" ? "" : role), ...(Object.keys(props).length ? { properties: props } : {}) });
    }
  }

  const root: Node = { tag, role: "root", properties, ...(Object.keys(variants).length ? { variants } : {}), ...(children.length ? { children } : {}) };
  return { name, variant: "default", props: {}, nodes: [root] };
}

/** `rows` with `incoming` put in: a row with the same name and look is replaced, anything else is added. Never mutates. */
export function mergeComponentRows(rows: DesignComponent[], incoming: DesignComponent[]): DesignComponent[] {
  const same = (a: DesignComponent, b: DesignComponent) => String(a.name).toLowerCase() === String(b.name).toLowerCase() && (a.variant || "default") === (b.variant || "default");
  const out = rows.filter((r) => !incoming.some((i) => same(r, i)));
  return [...out, ...incoming];
}

/** How to use a component on a page, for an AI: plain, with the exact classes. */
export function usageHint(c: BrandComponentInfo): string {
  const tags = c.slots.length ? ` Put the owner's words in its parts (${c.slots.map((s) => s.role).join(", ")}).` : "";
  return `Use it as an element with class "${c.className}"${c.variants.length ? ` (add "${c.className}--<look>" for ${c.variants.join(", ")})` : ""}.${tags}`;
}

/** The components in `after` that were not in `before` (the SDK keeps the ones it did not touch as the same objects), i.e. what a call just added to the brand. */
export function newBrandComponents(before: readonly unknown[] | undefined, after: readonly unknown[] | undefined): DesignComponent[] {
  const had = new Set<unknown>(before ?? []);
  return ((after ?? []) as DesignComponent[]).filter((c) => !had.has(c));
}
