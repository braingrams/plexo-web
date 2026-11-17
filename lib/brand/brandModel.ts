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
  /** The brand's voice or feel, when somebody wrote one down (the account's onboarding answer). Strata holds none yet. */
  voice?: string;
  /** Main colour first. */
  colours: BrandColour[];
  fonts: { heading?: string; body?: string };
  radius?: string;
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
export function brandFromDesignSystem(ds: Pick<DesignSystem, "tokens" | "name"> | null | undefined): { name?: string; colours: BrandColour[]; fonts: { heading?: string; body?: string }; radius?: string } {
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
  return {
    name: ds.name,
    colours,
    fonts: { ...(heading ? { heading } : {}), ...(body ? { body } : {}) },
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
  return {
    source,
    siteId: input.siteId ?? null,
    linked: !!linked,
    project: linked ? { id: linked.projectId, name: linked.projectName } : null,
    syncOn: !!linked && linked.syncOn,
    status: linked ? linked.status : "off",
    ...(name ? { name } : {}),
    ...(clean(profile?.about, 400) ? { about: clean(profile?.about, 400) } : {}),
    ...(clean(profile?.industry, 80) ? { industry: clean(profile?.industry, 80) } : {}),
    ...(clean(profile?.tone, 80) ? { voice: clean(profile?.tone, 80) } : {}),
    colours: dedupeColours(colours).slice(0, 8),
    fonts: strata?.fonts ?? (ownFonts as ResolvedBrand["fonts"]),
    ...(strata?.radius ? { radius: strata.radius } : {}),
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
  if (!b || (!b.colours.length && !b.logoUrl && !b.noLogo && !b.fonts.heading && !b.fonts.body)) return "";
  const name = (b.project?.name ?? siteName ?? b.name)?.replace(/\s+brand$/i, "");
  const lines: string[] = [`## This site's brand (${sourceWords(b)})`];
  if (b.colours.length) lines.push(`- Colours: ${b.colours.map((c) => `${c.role === "colour" ? "colour" : c.role} ${c.value}`).join(", ")}`);
  if (b.fonts.heading || b.fonts.body) lines.push(`- Fonts: headings ${b.fonts.heading ?? "(site default)"}, body ${b.fonts.body ?? b.fonts.heading ?? "(site default)"}`);
  if (b.radius) lines.push(`- Corner radius: ${b.radius}`);
  if (b.logoUrl) lines.push(`- Logo: ${b.logoUrl}`);
  else if (b.noLogo) lines.push("- Logo: none, set the business name as a clean wordmark");
  if (b.voice) lines.push(`- Voice: "${b.voice}"`);
  const how = b.linked
    ? `Pages of this site already link to the brand sheet, so colours and fonts come from it: in the visual editor you do not need setBrand (it would only repeat these values); in raw HTML, apps and emails use these exact values, or the variables from ${b.stylesheet ?? "/__plexo/brand/<siteId>.css"} (var(--color-action-primary-bg), var(--color-text-primary), var(--font-family-heading), var(--font-family-body), var(--radius-md)).`
    : "Use these exact values on every page, section, email and app screen you make (setBrand on visual pages).";
  lines.push(
    `Use this brand on EVERYTHING you build or change for this site (new pages, new sections, restyles, emails, blog and store layouts, funnel and course pages, apps), automatically. ${how} Never ask the owner for colours, fonts or a logo while this brand exists. Tell them plainly once: "I'll use your ${name ?? "saved"} brand." Don't mention it again unless they ask. If they ask for something off-brand, do it for that item only and say so.`,
  );
  return lines.join("\n");
}

/** The shape SOL's brief reads (lib/ai/solBrief.ts KnownBrand) for this site: the linked brand wins over the site's saved one. */
export function knownBrandFromResolved(b: ResolvedBrand): { colors?: string[]; logoUrl?: string; noLogo?: boolean; fonts?: string[]; strataProject?: string } {
  const colors = brandHexList(b);
  const fonts = [b.fonts.heading, b.fonts.body].filter((f, i, a): f is string => !!f && a.indexOf(f) === i);
  return {
    ...(colors.length ? { colors } : {}),
    ...(b.logoUrl ? { logoUrl: b.logoUrl } : b.noLogo ? { noLogo: true } : {}),
    ...(fonts.length ? { fonts } : {}),
    ...(b.project?.name ? { strataProject: b.project.name } : {}),
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
    radius: b.radius ?? null,
    logoUrl: b.logoUrl ?? null,
    noLogo: b.noLogo ?? false,
    voice: b.voice ?? null,
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
