/**
 * A site's brand, as ONE shape, and the ONE precedence rule. Pure (no database, no network): lib/brand/resolveSiteBrand.ts
 * loads the inputs, everything else (the dashboard, SOL, the quality gate, MCP, emails, apps) reads this shape.
 *
 *   PRECEDENCE   linked Strata project  >  the site's own saved brand (Template.brand, the Brand tab)
 *                >  the account's onboarding brand  >  defaults (nothing)
 *
 * It is applied per kind of fact: colours and fonts and the logo each come from the highest source that has them, so a site
 * linked to a Strata project with no logo still shows the logo saved on the site, rather than nothing.
 */
import type { DesignSystem } from "@charisol/plexo-sdk/v2/compile";

import { displayBrand, normalizeHex, type SiteBrand } from "@/lib/dashboardV3/brandLook";
import type { SolBuildProfile } from "@/lib/ai/solBuildContext";
import { sanitizeCustomFonts, type CustomFont } from "@/lib/fonts/customFonts";
import { hasVoice, mergeVoice, voicePromptBlock, voiceSummary, type BrandVoice } from "./brandVoice";
import { catalogueFromDesignSystem, componentLine, usageHint, type BrandComponentInfo } from "./brandComponents";

type DesignToken = DesignSystem["tokens"][number];

export type BrandSourceKind = "strata" | "site" | "profile" | "default";
export type BrandRole = "primary" | "secondary" | "accent" | "text" | "background" | "surface";
export type BrandColour = { role: BrandRole | "colour"; label: string; value: string };

export type LinkedBrandInput = {
  projectId: string;
  projectName: string | null;
  /** "Keep in sync" is on. */
  syncOn: boolean;
  status: "active" | "needs-reconnect";
  /** The design system last pulled from Strata (may be missing if the file can't be read). */
  designSystem: DesignSystem | null;
  /** The project's logo, when Strata holds one. */
  logoUrl?: string | null;
  stylesheet?: string | null;
};

export type ResolvedBrand = {
  /** Where the colours (or, with none, the logo) come from: the top of the precedence list that had something. */
  source: BrandSourceKind;
  siteId: string | null;
  linked: boolean;
  project: { id: string; name: string | null } | null;
  syncOn: boolean;
  status: "active" | "needs-reconnect" | "off";
  name?: string;
  about?: string;
  industry?: string;
  /** The brand's voice in one plain line ("friendly, warm; casual; for busy parents"), derived from `words`. */
  voice?: string;
  /** The brand's tagline, when one is set. */
  tagline?: string;
  /** The brand's words in full: tagline, short description, tones, formality, audience, words they like and avoid (lib/brand/brandVoice.ts). */
  words?: BrandVoice;
  /** Main colour first. */
  colours: BrandColour[];
  fonts: { heading?: string; body?: string };
  /** How many design tokens the linked brand holds (its colours, fonts, spacing...), for the brand bible overview. */
  tokenCount?: number;
  /** The weight each font is used at, when the brand says. */
  fontWeights?: { heading?: number; body?: number };
  /** Fonts the owner uploaded (lib/fonts/customFonts.ts). */
  customFonts?: CustomFont[];
  radius?: string;
  /** The brand's ready-made components (a button, a card...) from the linked Strata project's published design system; empty when none. */
  components: BrandComponentInfo[];
  logoUrl?: string;
  /** "I don't have a logo": a wordmark is made from the name. */
  noLogo?: boolean;
  /** The hosted brand sheet (/__plexo/brand/<siteId>.css) that every page of a linked site links to. */
  stylesheet: string | null;
};

// ---------------------------------------------------------------- reading a design system

const ROLE_KEYS: Array<{ role: BrandRole; label: string; keys: string[] }> = [
  { role: "primary", label: "Main colour (buttons, links)", keys: ["--color-action-primary-bg", "--color-brand-primary-500", "--color-brand-primary"] },
  { role: "secondary", label: "Second colour", keys: ["--color-brand-secondary-500", "--color-brand-secondary", "--color-action-secondary-text"] },
  { role: "accent", label: "Accent", keys: ["--color-brand-accent-500", "--color-brand-accent", "--color-accent"] },
  { role: "text", label: "Text", keys: ["--color-text-primary"] },
  { role: "background", label: "Page background", keys: ["--color-bg-canvas", "--color-bg-page", "--color-bg-default"] },
  { role: "surface", label: "Cards and panels", keys: ["--color-bg-surface"] },
];

const REF = /^var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)$/;
const COLOUR = /^(#[0-9a-f]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\))$/i;

function resolveToken(map: Map<string, DesignToken>, key: string, depth = 0): string | undefined {
  const t = map.get(key);
  if (!t || depth > 8) return undefined;
  const m = REF.exec(t.value.trim());
  if (m) return resolveToken(map, m[1], depth + 1);
  const v = t.value.trim();
  return /^-?\d+(\.\d+)?$/.test(v) && t.unit ? `${v}${t.unit}` : v;
}

const tidyColour = (v: string): string | null => {
  const hex = normalizeHex(v);
  if (hex) return hex;
  return COLOUR.test(v.trim()) ? v.trim() : null;
};

/** The first family of a font stack, unquoted: `"Plus Jakarta Sans", sans-serif` -> Plus Jakarta Sans. Null for a bare generic. */
export function primaryFontOf(stack: string | undefined): string | null {
  if (!stack) return null;
  const first = stack.split(",")[0]?.trim().replace(/^["']|["']$/g, "").trim();
  if (!first || /^(ui-)?(sans-serif|serif|monospace|system-ui)$/i.test(first)) return null;
  return /^[\w .\-]{1,60}$/.test(first) ? first : null;
}

/** Colours (with their roles), fonts and corner radius out of a Strata-shaped design system. Unresolvable tokens are left out. */
export function brandFromDesignSystem(ds: Pick<DesignSystem, "tokens" | "name"> | null | undefined): { name?: string; colours: BrandColour[]; fonts: { heading?: string; body?: string }; fontWeights?: { heading?: number; body?: number }; radius?: string } {
  if (!ds || !Array.isArray(ds.tokens)) return { colours: [], fonts: {} };
  const map = new Map(ds.tokens.map((t) => [t.key, t]));
  const colours: BrandColour[] = [];
  const seen = new Set<string>();
  for (const r of ROLE_KEYS) {
    for (const key of r.keys) {
      const raw = resolveToken(map, key);
      const value = raw ? tidyColour(raw) : null;
      if (!value) continue;
      colours.push({ role: r.role, label: r.label, value });
      seen.add(value.toLowerCase());
      break;
    }
  }
  const font = (keys: string[]) => {
    for (const k of keys) {
      const f = primaryFontOf(resolveToken(map, k));
      if (f) return f;
    }
    return undefined;
  };
  const heading = font(["--font-family-heading", "--semantic-font-family-heading", "--font-family-sans", "--font-family-base"]);
  const body = font(["--font-family-body", "--semantic-font-family-body", "--font-family-base", "--font-family-sans"]);
  const radius = resolveToken(map, "--radius-md");
  const weight = (key: string) => {
    const n = Number(resolveToken(map, key));
    return Number.isInteger(n) && n >= 100 && n <= 900 ? n : undefined;
  };
  const hw = weight("--font-weight-heading");
  const bw = weight("--font-weight-body");
  return {
    name: ds.name,
    colours,
    fonts: { ...(heading ? { heading } : {}), ...(body ? { body } : {}) },
    ...(hw || bw ? { fontWeights: { ...(hw ? { heading: hw } : {}), ...(bw ? { body: bw } : {}) } } : {}),
    ...(radius && /^\d+(\.\d+)?(px|rem)?$/.test(radius) ? { radius: /^\d+(\.\d+)?$/.test(radius) ? `${radius}px` : radius } : {}),
  };
}

/** The picture to treat as the project's logo: an image whose role is PRIMARY or whose type says logo (newest last wins in Strata's list). */
export function pickLogoAsset<T extends { kind?: string; url: string; type?: string; role?: string }>(assets: T[]): T | null {
  const images = assets.filter((a) => (a.kind ?? "image") === "image" && /^https:\/\//i.test(a.url));
  const isLogo = (a: T) => /logo/i.test(a.type ?? "");
  return [...images].reverse().find((a) => isLogo(a) && /^primary$/i.test(a.role ?? "")) ?? [...images].reverse().find(isLogo) ?? null;
}

// ---------------------------------------------------------------- sending a Plexo brand to Strata

const fontStack = (family: string) => `${family}, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif`;

/**
 * The tokens to change in a freshly made Strata project (its base set, already in the main colour) so it holds the rest of the
 * site's brand: second colour, accent and fonts. Existing tokens keep their layer and name; missing ones are added on the brand layer.
 * Pure. `sent` is the plain-words list of what went across.
 */
/**
 * The main colour, for a project that already has one: updates the project's own `--color-brand-primary` token (Strata computes its
 * ramp). Only ever changes a token that exists, so it can't invent keys in a project it doesn't know the shape of. Pure.
 */
export function strataPushPrimary(existing: DesignToken[], primary: string | undefined): { tokens: DesignToken[]; sent: string[] } {
  if (!primary || !/^#[0-9a-f]{6}$/i.test(primary)) return { tokens: [], sent: [] };
  const cur = existing.find((t) => t.key === "--color-brand-primary");
  if (!cur || cur.value.toLowerCase() === primary.toLowerCase()) return { tokens: [], sent: [] };
  return { tokens: [{ ...cur, value: primary }], sent: ["main colour"] };
}

export function strataPushTokens(existing: DesignToken[], brand: Pick<ResolvedBrand, "colours" | "fonts">): { tokens: DesignToken[]; sent: string[] } {
  const byKey = new Map(existing.map((t) => [t.key, t]));
  const out: DesignToken[] = [];
  const sent: string[] = [];
  const put = (key: string, value: string, type: string, name: string, label: string) => {
    const cur = byKey.get(key);
    if (cur && (cur.value === value || (type === "font family" && primaryFontOf(cur.value) === primaryFontOf(value)))) return;
    out.push(cur ? { ...cur, value } : { key, name, value, type, unit: null, layer: "brand", comment: null });
    sent.push(label);
  };
  const colour = (role: BrandRole) => brand.colours.find((c) => c.role === role && /^#[0-9a-f]{6}$/i.test(c.value))?.value;
  const second = colour("secondary");
  if (second) put("--color-brand-secondary-500", second, "color", "Brand Secondary 500", "second colour");
  const accent = colour("accent");
  if (accent) put("--color-brand-accent-500", accent, "color", "Brand Accent 500", "accent colour");
  if (brand.fonts.heading) put("--font-family-heading", fontStack(brand.fonts.heading), "font family", "Font Family Heading", "heading font");
  if (brand.fonts.body) put("--font-family-body", fontStack(brand.fonts.body), "font family", "Font Family Body", "body font");
  return { tokens: out, sent };
}

// ---------------------------------------------------------------- changing a project's tokens (colours, fonts, corners, spacing)

/** What an owner (or an AI for them) may set on a linked brand. Anything else is left alone: only tokens the project has, or the standard ones, change. */
export type TokenRequest = {
  colours?: Partial<Record<BrandRole, string>>;
  fonts?: { heading?: string; body?: string };
  /** The weight each font is used at (100 to 900), e.g. { heading: 700, body: 400 }. */
  fontWeights?: { heading?: number | string; body?: number | string };
  /** Corner radius in px (the "medium" corner every component uses). */
  radius?: number | string;
  /** Spacing steps in px, keyed by step: { "4": 16 } or { "space-4": "16px" }. */
  spacing?: Record<string, number | string>;
};

const COLOUR_KEYS: Record<BrandRole, { keys: string[]; label: string }> = {
  primary: { keys: ["--color-brand-primary", "--color-brand-primary-500"], label: "main colour" },
  secondary: { keys: ["--color-brand-secondary", "--color-brand-secondary-500"], label: "second colour" },
  accent: { keys: ["--color-brand-accent", "--color-brand-accent-500"], label: "accent colour" },
  text: { keys: ["--color-text-primary"], label: "text colour" },
  background: { keys: ["--color-bg-page", "--color-bg-canvas"], label: "page background" },
  surface: { keys: ["--color-bg-surface"], label: "card and panel colour" },
};

const HEX6 = /^#[0-9a-f]{6}$/i;
const toPx = (v: unknown, max: number): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\s*\d{1,3}(\.\d+)?\s*(px)?\s*$/i.test(v) ? parseFloat(v) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n * 100) / 100 : null;
};
/** A dimension token's value in the project's own style: "12px" when the project writes the unit in the value, "12" with a unit field otherwise. */
const dimensionLike = (cur: DesignToken | undefined, n: number): Pick<DesignToken, "value" | "unit"> => (cur?.unit ? { value: String(n), unit: cur.unit } : { value: `${n}px`, unit: null });
const tokenName = (key: string) => key.replace(/^--/, "").replace(/-/g, " ");

/**
 * The token changes a request makes against a project's current tokens. Pure. `tokens` are only the ones that CHANGE (ready for a push),
 * `sent` is the plain-words list of what changed, `skipped` is plain words for what could not be applied (a colour that isn't a hex value...).
 */
export function planTokenChanges(existing: DesignToken[], req: TokenRequest): { tokens: DesignToken[]; sent: string[]; skipped: string[] } {
  const byKey = new Map(existing.map((t) => [t.key, t]));
  const tokens: DesignToken[] = [];
  const sent: string[] = [];
  const skipped: string[] = [];
  const put = (key: string, patch: Partial<DesignToken>, fresh: DesignToken, label: string, same: (cur: DesignToken) => boolean) => {
    const cur = byKey.get(key);
    if (cur && same(cur)) return;
    tokens.push(cur ? { ...cur, ...patch } : fresh);
    sent.push(label);
  };
  const firstExisting = (keys: string[]) => keys.find((k) => byKey.has(k)) ?? keys[0];

  for (const [role, raw] of Object.entries(req.colours ?? {}) as Array<[BrandRole, string | undefined]>) {
    const spec = COLOUR_KEYS[role];
    if (!spec || raw === undefined) continue;
    if (!HEX6.test(String(raw).trim())) {
      skipped.push(`The ${spec.label} must be a hex colour like #E4572E.`);
      continue;
    }
    const value = String(raw).trim().toUpperCase();
    const key = firstExisting(spec.keys);
    put(key, { value }, { key, name: tokenName(key), value, type: "color", unit: null, layer: "brand", comment: null }, spec.label, (c) => c.value.toLowerCase() === value.toLowerCase());
  }

  // Fonts. A project with one shared font (--font-family-base) takes the body font there; the heading font is added separately.
  const wanted = new Map<string, string>();
  for (const which of ["heading", "body"] as const) {
    const family = req.fonts?.[which];
    if (family === undefined) continue;
    const clean = String(family).trim();
    if (!/^[A-Za-z0-9 .-]{1,60}$/.test(clean)) {
      skipped.push(`The ${which} font "${clean.slice(0, 40)}" isn't a font name Plexo can use.`);
      continue;
    }
    const key =
      which === "heading"
        ? byKey.has("--font-family-heading") || !byKey.has("--font-family-base") || req.fonts?.body !== undefined ? "--font-family-heading" : "--font-family-base"
        : byKey.has("--font-family-body") ? "--font-family-body" : byKey.has("--font-family-base") ? "--font-family-base" : "--font-family-body";
    wanted.set(key, clean);
  }
  for (const [key, family] of wanted) {
    const label = key === "--font-family-heading" ? "heading font" : key === "--font-family-body" ? "body font" : "font";
    const value = fontStack(family);
    put(key, { value }, { key, name: tokenName(key), value, type: "font family", unit: null, layer: "brand", comment: null }, label, (c) => primaryFontOf(c.value) === family);
  }

  for (const which of ["heading", "body"] as const) {
    const raw = req.fontWeights?.[which];
    if (raw === undefined) continue;
    const w = Number(raw);
    if (!Number.isInteger(w) || w < 100 || w > 900 || w % 100 !== 0) {
      skipped.push(`The ${which} font weight must be 100, 200 ... up to 900.`);
      continue;
    }
    const key = `--font-weight-${which}`;
    put(key, { value: String(w) }, { key, name: tokenName(key), value: String(w), type: "font weight", unit: null, layer: "brand", comment: null }, `${which} font weight`, (c) => Number(c.value) === w);
  }

  if (req.radius !== undefined) {
    const n = toPx(req.radius, 64);
    if (n === null) skipped.push("The corner radius must be a number of pixels between 0 and 64.");
    else {
      const d = dimensionLike(byKey.get("--radius-md"), n);
      put("--radius-md", d, { key: "--radius-md", name: "radius md", ...d, type: "dimension", layer: "brand", comment: null }, "corner roundness", (c) => toPx(c.value, 64) === n);
    }
  }

  for (const [rawKey, rawVal] of Object.entries(req.spacing ?? {}).slice(0, 12)) {
    const m = /^(?:--)?(?:space-)?(\d{1,2})$/.exec(rawKey.trim());
    const n = toPx(rawVal, 160);
    const key = m ? `--space-${m[1]}` : "";
    if (!m || n === null || (!byKey.has(key) && Number(m[1]) > 12)) {
      skipped.push(`Spacing "${rawKey}" isn't a step Plexo can set (use a step like 4 and a size in px).`);
      continue;
    }
    const d = dimensionLike(byKey.get(key), n);
    put(key, d, { key, name: tokenName(key), ...d, type: "dimension", layer: "brand", comment: null }, `spacing step ${m[1]}`, (c) => toPx(c.value, 160) === n);
  }
  return { tokens, sent, skipped };
}

/** The project's tokens as an AI client reads them (references resolved). Capped. */
export function tokensForClient(ds: Pick<DesignSystem, "tokens"> | null | undefined): Array<{ key: string; value: string; resolved?: string; type: string }> {
  if (!ds || !Array.isArray(ds.tokens)) return [];
  const map = new Map(ds.tokens.map((t) => [t.key, t]));
  return ds.tokens.slice(0, 400).map((t) => {
    const resolved = REF.test(t.value.trim()) ? resolveToken(map, t.key) : undefined;
    return { key: t.key, value: t.unit && /^-?\d+(\.\d+)?$/.test(t.value) ? `${t.value}${t.unit}` : t.value, ...(resolved && resolved !== t.value ? { resolved } : {}), type: t.type };
  });
}

// ---------------------------------------------------------------- the precedence rule

type Profile = SolBuildProfile["brand"] | undefined;

const dedupeColours = (list: BrandColour[]): BrandColour[] => {
  const seen = new Set<string>();
  return list.filter((c) => (seen.has(c.value.toLowerCase()) ? false : (seen.add(c.value.toLowerCase()), true)));
};

const fromHexList = (hexes: string[] | undefined): BrandColour[] =>
  (hexes ?? []).map((value, i) => ({ role: (i === 0 ? "primary" : i === 1 ? "secondary" : "colour") as BrandColour["role"], label: i === 0 ? "Main colour" : i === 1 ? "Second colour" : "Colour", value }));

/**
 * THE rule. linked Strata project > the site's own brand > the account's onboarding brand > nothing.
 * `siteName` is the site's own name (it beats the account's business name for a site that has one).
 */
export function mergeBrand(input: { siteId?: string | null; siteName?: string; linked?: LinkedBrandInput | null; own?: SiteBrand; profile?: Profile; /** The site's own visual-editor design system: only its non-default fonts and corners count. */ ownDesign?: DesignSystem | null }): ResolvedBrand {
  const { linked, own, profile } = input;
  const strata = linked ? brandFromDesignSystem(linked.designSystem) : null;
  const ownDs = !strata && input.ownDesign ? brandFromDesignSystem(input.ownDesign) : null;
  const ownFonts = ownDs ? Object.fromEntries(Object.entries(ownDs.fonts).filter(([, f]) => f && f !== "Inter")) : {};
  const fallback = displayBrand(own, profile);
  const ownColours = own?.colors?.length ? fromHexList(own.colors) : [];
  const profileColours = fromHexList(displayBrand(undefined, profile).colors);

  let colours: BrandColour[] = [];
  let source: BrandSourceKind = "default";
  if (strata?.colours.length) (colours = strata.colours), (source = "strata");
  else if (ownColours.length) (colours = ownColours), (source = "site");
  else if (profileColours.length) (colours = profileColours), (source = "profile");

  // Logo: the linked project's, else the site's own, else the account's (the "I have no logo" choice is the site's).
  let logoUrl: string | undefined;
  let noLogo: boolean | undefined;
  const linkedLogo = linked?.logoUrl && /^https:\/\//i.test(linked.logoUrl) ? linked.logoUrl : undefined;
  if (linkedLogo) logoUrl = linkedLogo;
  else if (fallback.logoUrl) logoUrl = fallback.logoUrl;
  else if (fallback.noLogo) noLogo = true;
  if (source === "default" && (logoUrl || noLogo)) source = own?.logoUrl || own?.noLogo ? "site" : "profile";

  const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) || undefined : undefined);
  const name = clean(input.siteName, 80) ?? clean(profile?.name, 80);
  const words = mergeVoice(own?.voice, { about: profile?.about, tone: profile?.tone });
  // The owner's own words describe the voice; without them, the onboarding answer is shown as they typed it.
  const summary = own?.voice ? voiceSummary(words) : clean(profile?.tone, 80) || voiceSummary(words);
  return {
    source,
    siteId: input.siteId ?? null,
    linked: !!linked,
    project: linked ? { id: linked.projectId, name: linked.projectName } : null,
    syncOn: !!linked && linked.syncOn,
    status: linked ? linked.status : "off",
    ...(name ? { name } : {}),
    ...((words.aboutLine ?? clean(profile?.about, 400)) ? { about: words.aboutLine ?? clean(profile?.about, 400) } : {}),
    ...(clean(profile?.industry, 80) ? { industry: clean(profile?.industry, 80) } : {}),
    ...(summary ? { voice: summary } : {}),
    ...(words.tagline ? { tagline: words.tagline } : {}),
    ...(hasVoice(words) ? { words } : {}),
    colours: dedupeColours(colours).slice(0, 8),
    fonts: strata?.fonts ?? (ownFonts as ResolvedBrand["fonts"]),
    ...(strata?.fontWeights ? { fontWeights: strata.fontWeights } : {}),
    ...(linked?.designSystem?.tokens?.length ? { tokenCount: linked.designSystem.tokens.length } : {}),
    ...(sanitizeCustomFonts(own?.customFonts).length ? { customFonts: sanitizeCustomFonts(own?.customFonts) } : {}),
    ...(strata?.radius ? { radius: strata.radius } : {}),
    components: linked ? catalogueFromDesignSystem(linked.designSystem) : [],
    ...(logoUrl ? { logoUrl } : {}),
    ...(noLogo ? { noLogo } : {}),
    stylesheet: linked?.stylesheet ?? null,
  };
}

/** Hex colours only, main colour first (what a build tool's `colors` takes). */
export const brandHexList = (b: Pick<ResolvedBrand, "colours">, max = 4): string[] =>
  b.colours.map((c) => normalizeHex(c.value)).filter((c): c is string => !!c).slice(0, max);

export const hasBrand = (b: ResolvedBrand | null | undefined): b is ResolvedBrand => !!b && (b.colours.length > 0 || !!b.logoUrl || !!b.noLogo || b.linked);

/** What the brief of a build tool is missing, filled from the brand. Never overrides what the caller passed. */
export function applyBriefDefaults<T extends { colors?: unknown; fonts?: unknown; logoUrl?: unknown; tone?: unknown }>(brief: T, brand: ResolvedBrand | null | undefined): { brief: T; filled: string[] } {
  if (!brand) return { brief, filled: [] };
  const next: Record<string, unknown> = { ...brief };
  const filled: string[] = [];
  const hexes = brandHexList(brand);
  if ((!Array.isArray(brief.colors) || brief.colors.length === 0) && hexes.length) (next.colors = hexes), filled.push("colours");
  const f = brief.fonts as { heading?: string; body?: string } | undefined;
  if (!f?.heading && !f?.body && (brand.fonts.heading || brand.fonts.body)) (next.fonts = { heading: brand.fonts.heading, body: brand.fonts.body }), filled.push("fonts");
  if (!brief.logoUrl && brand.logoUrl) (next.logoUrl = brand.logoUrl), filled.push("logo");
  if (!brief.tone && brand.voice) (next.tone = brand.voice), filled.push("tone");
  if (!(brief as { tagline?: unknown }).tagline && brand.tagline) (next.tagline = brand.tagline), filled.push("tagline");
  return { brief: next as T, filled };
}

// ---------------------------------------------------------------- what SOL and MCP clients are told

const sourceWords = (b: ResolvedBrand): string =>
  b.source === "strata" ? `linked from the owner's Strata project "${b.project?.name ?? "their brand"}"${b.syncOn ? ", kept in sync (a change published in Strata shows up on the next turn)" : ""}` : b.source === "site" ? "saved on this site (Brand tab)" : "from the owner's account";

/**
 * The site's brand as a short prompt block for SOL (and the MCP server's tool results). Empty when there is nothing known.
 * Values are the owner's own data, quoted and capped: context about the business, never instructions.
 */
export function brandPromptBlock(b: ResolvedBrand | null | undefined, siteName?: string): string {
  if (!b) return "";
  const words = voicePromptBlock(b.words);
  const wordsOrNote = words || (b.voice ? `## How this brand speaks\n- Voice: "${b.voice}"` : "");
  if (!b.colours.length && !b.logoUrl && !b.noLogo && !b.fonts.heading && !b.fonts.body) return wordsOrNote;
  const name = (b.project?.name ?? siteName ?? b.name)?.replace(/\s+brand$/i, "");
  const lines: string[] = [`## This site's brand (${sourceWords(b)})`];
  if (b.colours.length) lines.push(`- Colours: ${b.colours.map((c) => `${c.role === "colour" ? "colour" : c.role} ${c.value}`).join(", ")}`);
  if (b.fonts.heading || b.fonts.body) lines.push(`- Fonts: headings ${b.fonts.heading ?? "(site default)"}${b.fontWeights?.heading ? ` at weight ${b.fontWeights.heading}` : ""}, body ${b.fonts.body ?? b.fonts.heading ?? "(site default)"}${b.fontWeights?.body ? ` at weight ${b.fontWeights.body}` : ""}`);
  if (b.radius) lines.push(`- Corner radius: ${b.radius}`);
  if (b.logoUrl) lines.push(`- Logo: ${b.logoUrl}`);
  else if (b.noLogo) lines.push("- Logo: none, set the business name as a clean wordmark");
  if (b.linked && !b.components.length) lines.push("- Ready-made components: none yet. When you build something reusable (a button, a card, a banner), offer once to save it to the brand (create_brand_component), so it is in Strata for every page.");
  const how = b.linked
    ? `Pages of this site already link to the brand sheet, so colours and fonts come from it: in the visual editor you do not need setBrand (it would only repeat these values); in raw HTML, apps and emails use these exact values, or the variables from ${b.stylesheet ?? "/__plexo/brand/<siteId>.css"} (var(--color-action-primary-bg), var(--color-text-primary), var(--font-family-heading), var(--font-family-body), var(--radius-md)).`
    : "Use these exact values on every page, section, email and app screen you make (setBrand on visual pages).";
  if (b.components.length) {
    lines.push(`- Ready-made components (from the brand): ${b.components.slice(0, 12).map(componentLine).join("; ")}. Each is a class on the brand sheet: .plx-brand-<name>, .plx-brand-<name>--<look>.`);
    lines.push(`Use the brand's ready-made components (buttons, cards...) before inventing your own: where you need one of them, use it, and say once "I'll use your brand's <name>" (e.g. "I'll use your brand's button"). When you build something reusable that the brand doesn't have (a banner, a pricing card), offer once to save it to the brand (create_brand_component), so it is in Strata and every page and tool can use it.`);
  }
  lines.push(
    `Use this brand on EVERYTHING you build or change for this site (new pages, new sections, restyles, emails, blog and store layouts, funnel and course pages, apps), automatically. ${how} Never ask the owner for colours, fonts or a logo while this brand exists. Tell them plainly once: "I'll use your ${name ?? "saved"} brand." Don't mention it again unless they ask. If they ask for something off-brand, do it for that item only and say so.`,
  );
  if (b.linked) lines.push("Wording for the owner: say \"brand\" (\"your brand\", \"saved your brand\"), never \"Strata\", unless the owner uses that word first. Beginners do not know the tool behind it.");
  if (wordsOrNote) lines.push("", wordsOrNote);
  return lines.join("\n");
}

/** The shape SOL's brief reads (lib/ai/solBrief.ts KnownBrand) for this site: the linked brand wins over the site's saved one. */
export function knownBrandFromResolved(b: ResolvedBrand): { colors?: string[]; logoUrl?: string; noLogo?: boolean; fonts?: string[]; strataProject?: string; brandComponents?: string[] } {
  const colors = brandHexList(b);
  const fonts = [b.fonts.heading, b.fonts.body].filter((f, i, a): f is string => !!f && a.indexOf(f) === i);
  return {
    ...(colors.length ? { colors } : {}),
    ...(b.logoUrl ? { logoUrl: b.logoUrl } : b.noLogo ? { noLogo: true } : {}),
    ...(fonts.length ? { fonts } : {}),
    ...(b.project?.name ? { strataProject: b.project.name } : {}),
    ...(b.components.length ? { brandComponents: b.components.map((c) => c.name) } : {}),
  };
}

/** What get_site_brand returns to an AI client: plain facts, no secrets. */
export function brandForClient(b: ResolvedBrand): Record<string, unknown> {
  return {
    siteId: b.siteId,
    source: b.source,
    precedence: "linked Strata project > this site's saved brand > the account's onboarding brand",
    linkedProject: b.project,
    autoSync: b.syncOn,
    linkStatus: b.status,
    name: b.name ?? null,
    colours: b.colours,
    fonts: b.fonts,
    fontWeights: b.fontWeights ?? null,
    uploadedFonts: (b.customFonts ?? []).map((f) => f.family),
    radius: b.radius ?? null,
    components: b.components.map((c) => ({ ...c, howToUse: usageHint(c) })),
    logoUrl: b.logoUrl ?? null,
    noLogo: b.noLogo ?? false,
    voice: b.voice ?? null,
    tagline: b.tagline ?? null,
    words: b.words ?? null,
    stylesheet: b.stylesheet,
    howToUse: b.linked
      ? "Pages link to this brand's hosted stylesheet, so a visual page needs no setBrand. For raw HTML, apps and emails use these values (or the CSS variables in the stylesheet). Pass nothing else: the brand is applied by default."
      : b.colours.length
        ? "Use these colours (and the logo) on everything you make for this site. Offer link_site_brand to connect a Strata project so the brand stays in sync."
        : "No brand is saved for this site yet. Ask the owner once for their colours and logo, or offer list_strata_projects / create_strata_project_from_brand.",
  };
}

// ---------------------------------------------------------------- the choice made while setting a site up

export type BrandChoice = { projectId?: string; projectName?: string; createFromBrand?: boolean };

/** Reads the "Your brand" choice a set-up screen sends (untrusted). undefined = skipped / nothing usable. */
export function parseBrandChoice(raw: unknown): BrandChoice | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.projectId === "string" && r.projectId.trim() && r.projectId.length <= 200) {
    return { projectId: r.projectId.trim(), ...(typeof r.projectName === "string" ? { projectName: r.projectName.slice(0, 120) } : {}) };
  }
  return r.createFromBrand === true ? { createFromBrand: true } : undefined;
}
