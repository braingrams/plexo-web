import {
  MAX_CUSTOM_JS,
  blankPages,
  buildPageFromTemplate,
  createDefaultDesignSystem,
  parsePages,
  starterEmailPages,
  templateSeed,
  repairDesignSystem,
  type DesignSystem,
  type PageDefinition,
} from "@charisol/plexo-sdk/v2/compile";

// The V2 (visual editor) design payload, stored in the SAME Template.designJson /
// Template.draftJson / TemplateRevision.designJson columns V1 uses — Template.designFormat
// ("v1" | "v2") says which one a row holds. No SDK dependency beyond the React-free
// "@charisol/plexo-sdk/v2/compile" entry, so this is safe to import from lambda bundles.
// See docs/v2-templates.md for the whole data contract.

export const V2_FORMAT = "plexo-v2@1" as const;

export type DesignFormat = "v1" | "v2";

/** The page's own browser-tab / search / share details (V1 kept these in body.style). */
export type V2Meta = {
  htmlTitle?: string;
  favicon?: string;
  metaDescription?: string;
  ogImageUrl?: string;
};

export type V2Design = {
  format: typeof V2_FORMAT;
  /** Exactly one page per Template row — a multi-page site is several rows (parentId tree), like V1. */
  pages: PageDefinition[];
  designSystem?: DesignSystem;
  /** The owner's own script for this page (V1's "custom code"). Owner code, never sanitised, contained at compile. */
  customJs?: string;
  meta?: V2Meta;
};

// A Template row is ONE DynamoDB item (400 KB) that also carries the draft copy and both
// compiled documents, so the design alone is held well under that.
export const MAX_V2_DESIGN_CHARS = 120_000;
// The built-in design system alone is ~84 KB of JSON, so it is never stored when unchanged
// (the compiler falls back to it); a customised one has its own cap. A design system brought in
// from Strata (hundreds of tokens and component variants) is several times that, so the cap is
// generous: rows are stored gzipped (lib/db/packed.ts, JSON shrinks ~10x), which keeps the live +
// draft copies well inside DynamoDB's 400 KB item limit.
export const MAX_V2_DESIGN_SYSTEM_CHARS = 450_000;
export const MAX_V2_HTML_CHARS = 200_000;

export class V2DesignError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "V2DesignError";
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Cheap shape check ("is this a V2 payload?") — NOT validation; use parseV2Design for that. */
export function isV2Design(raw: unknown): raw is V2Design {
  return isRecord(raw) && raw.format === V2_FORMAT && Array.isArray(raw.pages);
}

/** Missing (every row written before this existed) means "v1". */
export function designFormatOf(row: { designFormat?: string | null } | null | undefined): DesignFormat {
  return row?.designFormat === "v2" ? "v2" : "v1";
}

/** Strips ("" -> removed) and bounds the meta fields; only http(s)/relative addresses survive. */
function cleanMeta(raw: unknown): V2Meta | undefined {
  if (!isRecord(raw)) return undefined;
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const url = (v: unknown) => {
    const s = text(v, 2000);
    return s && (/^https?:\/\//i.test(s) || (/^\//.test(s) && !s.startsWith("//"))) ? s : "";
  };
  const out: V2Meta = {};
  const htmlTitle = text(raw.htmlTitle, 200);
  const metaDescription = text(raw.metaDescription, 300);
  const favicon = url(raw.favicon);
  const ogImageUrl = url(raw.ogImageUrl);
  if (htmlTitle) out.htmlTitle = htmlTitle;
  if (metaDescription) out.metaDescription = metaDescription;
  if (favicon) out.favicon = favicon;
  if (ogImageUrl) out.ogImageUrl = ogImageUrl;
  return Object.keys(out).length ? out : undefined;
}

/**
 * Validates untrusted V2 JSON (from the editor, an API client, or an AI). Returns the
 * cleaned design or a plain-language error — never throws. Pages are checked by the SDK's
 * own `parsePages` (element types, nesting, node count, unique ids).
 */
export function parseV2Design(raw: unknown): { ok: true; design: V2Design } | { ok: false; error: string } {
  if (!isRecord(raw)) return { ok: false, error: "This page's design is missing or isn't in the right shape." };
  if (raw.format !== V2_FORMAT) return { ok: false, error: `This design isn't in the new editor's format (expected "${V2_FORMAT}").` };

  let size = 0;
  try {
    size = JSON.stringify({ ...raw, designSystem: undefined }).length;
  } catch {
    return { ok: false, error: "This page's design can't be read." };
  }
  if (size > MAX_V2_DESIGN_CHARS) {
    return { ok: false, error: "This page is too large to save. Remove some content, or use pictures from your media library instead of embedding them." };
  }

  const parsed = parsePages(raw.pages);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  if (parsed.pages.length !== 1) {
    return { ok: false, error: "Each page holds exactly one design. Add other pages to your site as pages of their own." };
  }

  let designSystem: DesignSystem | undefined;
  if (raw.designSystem !== undefined && raw.designSystem !== null) {
    const ds = raw.designSystem as Partial<DesignSystem>;
    if (!isRecord(ds) || !Array.isArray(ds.tokens)) return { ok: false, error: "This site's colours and fonts aren't in the right shape." };
    const repaired = repairDesignSystem(ds as DesignSystem);
    const json = JSON.stringify(repaired);
    if (json.length > MAX_V2_DESIGN_SYSTEM_CHARS) return { ok: false, error: "This site's colours and fonts are too large to save." };
    // Unchanged built-in system: store nothing, the compiler uses it by default.
    if (json !== defaultSystemJson()) designSystem = repaired;
  }

  let customJs: string | undefined;
  if (raw.customJs !== undefined && raw.customJs !== null && raw.customJs !== "") {
    if (typeof raw.customJs !== "string") return { ok: false, error: "The custom code must be text." };
    if (raw.customJs.length > MAX_CUSTOM_JS) {
      return { ok: false, error: `The custom code is too long (over ${MAX_CUSTOM_JS.toLocaleString("en-US")} characters). Shorten it or load it from a file instead.` };
    }
    customJs = raw.customJs;
  }

  const meta = cleanMeta(raw.meta);
  return {
    ok: true,
    design: {
      format: V2_FORMAT,
      pages: parsed.pages,
      ...(designSystem ? { designSystem } : {}),
      ...(customJs ? { customJs } : {}),
      ...(meta ? { meta } : {}),
    },
  };
}

/** parseV2Design that throws a V2DesignError (message is safe to show the owner). */
export function requireV2Design(raw: unknown): V2Design {
  const r = parseV2Design(raw);
  if (!r.ok) throw new V2DesignError(r.error);
  return r.design;
}

let cachedDefaultJson: string | null = null;
const defaultSystemJson = (): string => (cachedDefaultJson ??= JSON.stringify(createDefaultDesignSystem()));

/** A brand-new, empty page (no designSystem: the built-in one applies until the owner customises it). */
export function blankV2Design(): V2Design {
  return { format: V2_FORMAT, pages: blankPages() };
}

/** A new email in the new editor: header, main message, highlights, a button and a footer, ready to change. */
export function starterV2EmailDesign(): V2Design {
  return { format: V2_FORMAT, pages: starterEmailPages() };
}

/** A page started from one of the SDK's page templates ("home", "pricing", ...). `seed` (the new row's id) keeps node ids unique across a site's pages. */
export function v2DesignFromTemplate(templateId: string, opts: { name: string; slug?: string; seed?: string }): V2Design {
  return {
    format: V2_FORMAT,
    pages: [buildPageFromTemplate(templateId, { name: opts.name, slug: opts.slug, seed: opts.seed ? `${templateSeed(templateId)}-${opts.seed}` : undefined, designSystem: createDefaultDesignSystem() })],
  };
}

/**
 * Which format NEW landing pages / site pages are created in. Env `TEMPLATES_V2_NEW`
 * ("true"/"1"/"on"); anything else keeps today's V1 behaviour. EMAIL templates never use this.
 */
export function defaultDesignFormat(): DesignFormat {
  const v = (process.env.TEMPLATES_V2_NEW ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "on" || v === "yes" ? "v2" : "v1";
}

/** The plain error a V1-only write path (old MCP tools, V1 API payloads) gives for a V2 page. */
export const V2_PAGE_NEEDS_NEW_TOOLS =
  "This page uses Plexo's new editor, so the classic page tools can't change it. Use page_describe to see it and page_edit to change it, or edit it in the dashboard.";

/** And the reverse: a V2 payload sent to a page that still uses the classic format. */
export const V1_PAGE_NEEDS_CLASSIC_PAYLOAD =
  "This page still uses Plexo's classic editor, so it needs a classic design (body.rows). It can't take a new-editor design.";

export type { DesignSystem, PageDefinition };
