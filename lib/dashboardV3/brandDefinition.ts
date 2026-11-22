/**
 * "Your brand" page, pure: the choices an owner can make about their look (colours, fonts, roundness, spacing), the ready-made
 * styles to start from, and every word the page uses. Tested in tests/brandDefinition.test.ts.
 *
 * Owners see "brand", "colours", "fonts", "logo". The design-system tool behind it is named only in HELP_COPY (the small help panel).
 */
import { normalizeHex } from "@/lib/dashboardV3/brandLook";
import type { TokenRequest } from "@/lib/brand/brandModel";

export type Roundness = "sharp" | "soft" | "round" | "extra";
export type Density = "compact" | "comfortable" | "roomy";

export type BrandDraft = {
  primary: string;
  secondary: string;
  accent: string;
  headingFont: string;
  bodyFont: string;
  /** 100 to 900. */
  headingWeight: number;
  bodyWeight: number;
  roundness: Roundness;
  density: Density;
};

export const ROUNDNESS: Array<{ id: Roundness; label: string; px: number }> = [
  { id: "sharp", label: "Sharp", px: 0 },
  { id: "soft", label: "Soft", px: 8 },
  { id: "round", label: "Round", px: 16 },
  { id: "extra", label: "Very round", px: 28 },
];

export const DENSITY: Array<{ id: Density; label: string; hint: string; steps: Record<string, number> }> = [
  { id: "compact", label: "Compact", hint: "More on screen", steps: { "2": 6, "4": 12, "6": 18 } },
  { id: "comfortable", label: "Comfortable", hint: "Balanced", steps: { "2": 8, "4": 16, "6": 24 } },
  { id: "roomy", label: "Roomy", hint: "Lots of breathing space", steps: { "2": 10, "4": 20, "6": 32 } },
];


export const BRAND_PRESETS: Array<{ id: string; name: string; blurb: string; draft: BrandDraft }> = [
  { id: "fresh", name: "Fresh and friendly", blurb: "Bright, rounded, easy to read", draft: { primary: "#1E7A4C", secondary: "#B8F34A", accent: "#E4572E", headingFont: "Plus Jakarta Sans", bodyFont: "Inter", headingWeight: 700, bodyWeight: 400, roundness: "round", density: "comfortable" } },
  { id: "classic", name: "Calm and classic", blurb: "Trusted, timeless, a little formal", draft: { primary: "#1F3A5F", secondary: "#C9A227", accent: "#8C2F39", headingFont: "Playfair Display", bodyFont: "Lora", headingWeight: 700, bodyWeight: 400, roundness: "soft", density: "roomy" } },
  { id: "bold", name: "Bold and modern", blurb: "Strong colour, sharp edges", draft: { primary: "#E4572E", secondary: "#222222", accent: "#1F6FEB", headingFont: "Space Grotesk", bodyFont: "DM Sans", headingWeight: 700, bodyWeight: 400, roundness: "sharp", density: "compact" } },
  { id: "warm", name: "Warm and personal", blurb: "Soft colours, friendly shapes", draft: { primary: "#A23B8E", secondary: "#F6C28B", accent: "#1E7A4C", headingFont: "Poppins", bodyFont: "Lora", headingWeight: 700, bodyWeight: 400, roundness: "extra", density: "roomy" } },
];

export const nearestRoundness = (px: string | number | undefined): Roundness => {
  const n = typeof px === "number" ? px : parseFloat(String(px ?? ""));
  if (!Number.isFinite(n)) return "soft";
  return ROUNDNESS.reduce((best, r) => (Math.abs(r.px - n) < Math.abs(best.px - n) ? r : best), ROUNDNESS[0]).id;
};

type Colour = { role: string; value: string };
/** The page's starting point: what the brand already holds, with gentle defaults for anything it doesn't. */
export function draftFromBrand(brand: { colours?: Colour[]; fonts?: { heading?: string; body?: string }; fontWeights?: { heading?: number; body?: number }; radius?: string } | null | undefined): BrandDraft {
  const by = (role: string) => normalizeHex(brand?.colours?.find((c) => c.role === role)?.value) ?? "";
  return {
    primary: by("primary") || "#1F6FEB",
    secondary: by("secondary"),
    accent: by("accent"),
    headingFont: brand?.fonts?.heading ?? "Plus Jakarta Sans",
    bodyFont: brand?.fonts?.body ?? "Inter",
    headingWeight: brand?.fontWeights?.heading ?? 700,
    bodyWeight: brand?.fontWeights?.body ?? 400,
    roundness: nearestRoundness(brand?.radius),
    density: "comfortable",
  };
}

/** What the brand's tokens need to become for this draft. Colours left blank are left alone. */
export function tokenRequestFromDraft(d: BrandDraft): TokenRequest {
  const colours: NonNullable<TokenRequest["colours"]> = {};
  for (const role of ["accent"] as const) {
    const hex = normalizeHex(d[role]);
    if (hex) colours[role] = hex;
  }
  return {
    colours,
    fonts: { heading: d.headingFont, body: d.bodyFont },
    fontWeights: { heading: d.headingWeight, body: d.bodyWeight },
    radius: ROUNDNESS.find((r) => r.id === d.roundness)?.px ?? 8,
    spacing: DENSITY.find((x) => x.id === d.density)?.steps ?? {},
  };
}

export const sameDraft = (a: BrandDraft, b: BrandDraft): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Reads what the page sends to save tokens (anything unexpected is dropped; the brand itself skips what it can't use). */
export function readBrandTokens(raw: unknown): TokenRequest | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const out: TokenRequest = {};
  if (r.colours && typeof r.colours === "object") {
    const c: NonNullable<TokenRequest["colours"]> = {};
    for (const role of ["primary", "secondary", "accent"] as const) {
      const hex = normalizeHex((r.colours as Record<string, unknown>)[role]);
      if (hex) c[role] = hex;
    }
    out.colours = c;
  }
  if (r.fonts && typeof r.fonts === "object") {
    const f = r.fonts as Record<string, unknown>;
    out.fonts = { ...(typeof f.heading === "string" ? { heading: f.heading } : {}), ...(typeof f.body === "string" ? { body: f.body } : {}) };
  }
  if (r.fontWeights && typeof r.fontWeights === "object") {
    const w = r.fontWeights as Record<string, unknown>;
    const ok = (v: unknown) => (typeof v === "number" || (typeof v === "string" && /^\d{3}$/.test(v)) ? Number(v) : undefined);
    out.fontWeights = { ...(ok(w.heading) ? { heading: ok(w.heading) } : {}), ...(ok(w.body) ? { body: ok(w.body) } : {}) };
  }
  if (typeof r.radius === "number" || typeof r.radius === "string") out.radius = r.radius;
  if (r.spacing && typeof r.spacing === "object" && !Array.isArray(r.spacing)) {
    const s: Record<string, number | string> = {};
    for (const [k, v] of Object.entries(r.spacing as Record<string, unknown>).slice(0, 12)) if (typeof v === "number" || typeof v === "string") s[k] = v;
    out.spacing = s;
  }
  return out;
}

/** The save status shown next to the brand's name. */
export type SaveStatus = "saving" | "saved" | "waiting" | "error";
export function saveStatusText(s: SaveStatus): string {
  return s === "saving" ? "Saving…" : s === "waiting" ? "Saved. Finishing up" : s === "error" ? "Not saved yet" : "Saved";
}

/** Every word on the Your brand page that is not an error. "Strata" appears ONLY under HELP_COPY. */
export const BRAND_COPY = {
  pageTitle: "Your brand",
  pageSub: "The colours, fonts, logo and words your website uses everywhere.",
  definitionTitle: "Your brand definition",
  definitionSub: "Change anything and watch the preview. Everything you save is used on every page.",
  saved: "Your brand is saved",
  savedSub: "It's kept safe, so you can use it again on other sites.",
  saving: "Saving your brand…",
  switchBrand: "Switch brand",
  switchTitle: "Switch brand",
  switchSub: "Pick the brand this website should use.",
  signInTitle: "One quick step",
  signInText: "Sign in to save your brand. If you signed in with Charisol it happens by itself.",
  signInButton: "Sign in to save my brand",
  presetsTitle: "Start from a style",
  presetsSub: "Pick one to fill everything in, then change what you like.",
  save: "Save my brand",
  upToDate: "Everything is saved",
  unsaved: "You have changes to save",
  footnote: "Saved to your design system",
} as const;

/** The help panel's three groups of readers. The one place that names the tool. */
export const HELP_COPY = {
  title: "About your brand",
  newcomer: { heading: "New to this?", text: "Your brand is the colours, fonts and logo your site uses everywhere. We keep a safe copy in a tool called Strata so it's easy to reuse." },
  strataUser: { heading: "Already use Strata?", text: "You can pick or change the brand from your own Strata account.", action: "Switch brand" },
  words: { heading: "Fonts and words", text: "Pick any of about 1,600 free fonts, or upload your own, and choose one for headings and one for text. Under Your words, add a tagline and describe how you sound. SOL and your AI helpers then write your pages, emails and posts in your voice, and your footer and search results start from it." },
  designer: {
    heading: "For design-system people",
    text: "Your brand is saved as design tokens in a Strata project: brand, secondary and accent colours, heading and body font families, the medium corner radius and the spacing steps, plus your logo and any ready-made components. Your site reads them from a hosted style sheet, so a change published in Strata reaches every page within a couple of minutes.",
    link: "Try Strata",
  },
} as const;

/** Colours the live preview falls back to before a brand has been chosen (kept here: the dashboard folder takes its colours from the theme). */
export const PREVIEW_FALLBACK = { primary: "#1F6FEB", page: "#F4F4F5", ink: "#1B1B1F" } as const;

/** Black or white, whichever is easier to read on this colour (for button labels in the preview). */
export function readableOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 > 0.6 ? "#111111" : "#FFFFFF";
}
