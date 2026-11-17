/**
 * A site's logo and colours, as the Brand tab saves them: stored on the SITE (each site has its own), with the
 * account's onboarding answers only a starting default. Pure: validation, reading, and the one rule for when the
 * "Add your logo and colours" step counts as done. SPEC "Look": a logo is optional; with none, one is made from the name.
 */
import type { SolBuildProfile } from "@/lib/ai/solBuildContext";

type Brand = NonNullable<SolBuildProfile["brand"]>;
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export type BrandLook = {
  /** Main colour first, optional second colour next. */
  colors: string[];
  /** The uploaded logo, or null to remove it. */
  logoUrl: string | null;
  /** "I don't have a logo": one is made from the name. */
  logoSkipped: boolean;
};

const HEX6 = /^#[0-9A-F]{6}$/;

/** "#abc", "abc" or "e4572e" to "#AABBCC"; null when it isn't a colour. */
export function normalizeHex(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let s = input.trim().replace(/^#/, "").toUpperCase();
  if (/^[0-9A-F]{3}$/.test(s)) s = s.split("").map((c) => c + c).join("");
  const out = `#${s}`;
  return HEX6.test(out) ? out : null;
}

/** Reads what the Brand tab sends, explaining any problem in plain words. */
export function sanitizeBrandLook(input: unknown): Result<BrandLook> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "We couldn't read your logo and colours. Please try again." };
  const raw = input as Record<string, unknown>;
  if (!Array.isArray(raw.colors) || raw.colors.length === 0) return { ok: false, error: "Choose a main colour first." };
  const colors: string[] = [];
  for (const c of raw.colors.slice(0, 6)) {
    const hex = normalizeHex(c);
    if (!hex) return { ok: false, error: "One of those colours isn't a colour we can read. Pick it from the colour picker or type it like #E4572E." };
    if (!colors.includes(hex)) colors.push(hex);
  }
  let logoUrl: string | null = null;
  if (raw.logoUrl !== undefined && raw.logoUrl !== null && raw.logoUrl !== "") {
    if (typeof raw.logoUrl !== "string" || raw.logoUrl.length > 1000 || !/^https:\/\//i.test(raw.logoUrl)) return { ok: false, error: "Your logo needs to be uploaded again. Please pick the file once more." };
    logoUrl = raw.logoUrl;
  }
  return { ok: true, value: { colors, logoUrl, logoSkipped: logoUrl ? false : raw.logoSkipped === true } };
}

/** A site's own brand, as stored on the site (Template.brand). Each site has its own. */
export type SiteBrand = { logoUrl?: string; colors?: string[]; /** "I don't have a logo": one is made from the name. */ noLogo?: boolean };

/** Reads a stored site brand defensively (a schemaless field). Undefined when there's nothing usable. */
export function readSiteBrand(stored: unknown): SiteBrand | undefined {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return undefined;
  const r = stored as Record<string, unknown>;
  const out: SiteBrand = {};
  if (typeof r.logoUrl === "string" && /^https:\/\//i.test(r.logoUrl)) out.logoUrl = r.logoUrl;
  if (Array.isArray(r.colors)) {
    const colors = r.colors.map(normalizeHex).filter((c): c is string => !!c);
    if (colors.length) out.colors = colors;
  }
  if (r.noLogo === true && !out.logoUrl) out.noLogo = true;
  return Object.keys(out).length ? out : undefined;
}

/** What gets stored on the site for a look. */
export function siteBrandFromLook(look: BrandLook): SiteBrand {
  return { colors: look.colors, ...(look.logoUrl ? { logoUrl: look.logoUrl } : look.logoSkipped ? { noLogo: true } : {}) };
}

/** The brand a site starts with when it's made from onboarding: the owner's answers, copied onto the site. */
export function siteBrandFromProfile(brand: SolBuildProfile["brand"] | undefined): SiteBrand | undefined {
  const copied = readSiteBrand({ logoUrl: brand?.logoUrl, colors: brand?.colors });
  // They went through the "Look" step with colours but no logo: that was their choice (one is made from the name).
  return copied?.colors?.length && !copied.logoUrl ? { ...copied, noLogo: true } : copied;
}

/** What to SHOW for a site: its own brand, else the account's default for sites that never had one. */
export function displayBrand(own: SiteBrand | undefined, profile: SolBuildProfile["brand"] | undefined): SiteBrand {
  return {
    colors: own?.colors?.length ? own.colors : readSiteBrand({ colors: profile?.colors })?.colors,
    logoUrl: own?.logoUrl ?? (own?.noLogo ? undefined : readSiteBrand({ logoUrl: profile?.logoUrl })?.logoUrl),
    ...(own?.noLogo ? { noLogo: true } : {}),
  };
}

/** The "Add your logo and colours" step for ONE site: judged only from that site's own brand. */
export function brandStepDone(own: SiteBrand | null | undefined): boolean {
  return !!own?.colors?.length && (!!own.logoUrl || own.noLogo === true);
}

/** What the visual editor's brand command takes: the main colour and an optional second one. */
export function lookTokens(colors: string[]): { primaryColor: string; secondaryColor?: string } {
  return colors[1] ? { primaryColor: colors[0], secondaryColor: colors[1] } : { primaryColor: colors[0] };
}

/** The "Colours and logo" card's starting colours from a stored brand (it may only hold a single primaryColor). */
export function startingColors(brand: { colors?: string[]; primaryColor?: string } | null | undefined): { main: string; second: string } {
  const list = brand?.colors?.length ? brand.colors : brand?.primaryColor ? [brand.primaryColor] : [];
  return { main: normalizeHex(list[0]) ?? "", second: normalizeHex(list[1]) ?? "" };
}

/** What applying a look to a site's pages did. */
export type LookApplied = {
  /** Pages (including the shared header and footer) whose colours were changed. */
  updated: number;
  /** Of those, pages whose new look is saved as a working copy and still needs publishing. */
  needsPublish: number;
  /** Pages that can't be restyled automatically (classic editor, uploaded code, apps). */
  skipped: number;
  logoPlaced: boolean;
};

/** One plain sentence for under the Save button. Never claims more than was done. */
export function lookOutcomeMessage(a: LookApplied, hasLogo: boolean): { text: string; askSol: boolean } {
  if (a.updated === 0) return { text: "Saved. This site can't be restyled automatically, so ask SOL to restyle your existing pages with it.", askSol: true };
  const logoNote = hasLogo ? (a.logoPlaced ? " Your logo is in the header." : " Your logo is saved, but this design has no place for it yet, so ask SOL to add it.") : "";
  const rest = a.skipped > 0 ? ` ${a.skipped === 1 ? "One page was" : `${a.skipped} pages were`} built another way, so ask SOL to restyle ${a.skipped === 1 ? "it" : "them"}.` : "";
  const publish = a.needsPublish > 0 ? " Your new look shows in the editor. Publish your site to put it online." : " It's on your site now.";
  return { text: `Saved and applied to your pages.${publish}${logoNote}${rest}`, askSol: a.skipped > 0 || (hasLogo && !a.logoPlaced) };
}
