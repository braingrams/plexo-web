/**
 * Pure helpers (no I/O) that turn Strata's published variables.css + the project's asset list
 * into Plexo's validated brand: token overrides and logo URLs. Everything from outside is
 * treated as hostile: each value is validated on its own and dropped (so the bundled value is
 * used) when it isn't a plain colour / font stack / radius / https URL on an allowed host.
 */
import { DARK_TOKENS, LIGHT_TOKENS, SHARED_TOKENS, type BrandTokens, type TokenSet } from "@/lib/brandTokens";

// ── Colour validation + maths ──────────────────────────────────────────────────────────────

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNC = /^(?:rgb|hsl)a?\(\s*[0-9.,%\s/-]+\)$/i;

/** hex / rgb() / hsl() only. Anything else (names, url(), var(), expressions) is rejected. */
export function isSafeColor(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const s = v.trim();
  return s.length <= 64 && (HEX.test(s) || FUNC.test(s));
}

/** Parse a validated colour to [r,g,b] 0-255 (alpha ignored), or null. */
export function parseColor(v: string): [number, number, number] | null {
  const s = v.trim();
  if (HEX.test(s)) {
    let h = s.slice(1);
    if (h.length <= 4) h = h.split("").map((c) => c + c).join("");
    const n = parseInt(h.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = /^(rgb|hsl)a?\(([^)]*)\)$/i.exec(s);
  if (!m) return null;
  const parts = m[2].split(/[\s,/]+/).filter(Boolean).slice(0, 3);
  if (parts.length < 3) return null;
  const nums = parts.map((p) => parseFloat(p));
  if (nums.some((n) => Number.isNaN(n))) return null;
  if (m[1].toLowerCase() === "rgb") {
    return parts.map((p, i) => Math.max(0, Math.min(255, p.endsWith("%") ? (nums[i] / 100) * 255 : nums[i]))) as [number, number, number];
  }
  const h = (((nums[0] % 360) + 360) % 360) / 360;
  const sat = Math.max(0, Math.min(1, nums[1] / 100));
  const l = Math.max(0, Math.min(1, nums[2] / 100));
  const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat;
  const p = 2 * l - q;
  const f = (t: number) => {
    const x = (t + 1) % 1;
    return Math.round(255 * (x < 1 / 6 ? p + (q - p) * 6 * x : x < 1 / 2 ? q : x < 2 / 3 ? p + (q - p) * (2 / 3 - x) * 6 : p));
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}

export function luminance(rgb: [number, number, number]): number {
  const c = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** WCAG contrast ratio of two colours; 0 when either can't be parsed. */
export function contrastRatio(a: string, b: string): number {
  const x = parseColor(a);
  const y = parseColor(b);
  if (!x || !y) return 0;
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

export const ON_DARK_INK = "#121212";
export const ON_LIGHT_INK = "#FFFFFF";

/** The text colour (near-black or white) that reads best on `bg`. */
export function onColorFor(bg: string): string {
  return contrastRatio(bg, ON_DARK_INK) >= contrastRatio(bg, ON_LIGHT_INK) ? ON_DARK_INK : ON_LIGHT_INK;
}

// ── Other value validation ─────────────────────────────────────────────────────────────────

const FONT_STACK = /^[A-Za-z0-9 ,'"._-]{1,200}$/;
export function isSafeFontStack(v: unknown): v is string {
  return typeof v === "string" && FONT_STACK.test(v.trim()) && !/url|import|expression/i.test(v);
}
const RADIUS = /^\d{1,3}(?:\.\d{1,3})?(?:px|rem)$/;
export function isSafeRadius(v: unknown): v is string {
  return typeof v === "string" && RADIUS.test(v.trim());
}

// ── variables.css parsing ──────────────────────────────────────────────────────────────────

/** `--name: value;` declarations of the first :root block, with var(--x[, fallback]) resolved. */
export function parseVariablesCss(css: string): Record<string, string> {
  const raw: Record<string, string> = {};
  const re = /--([a-z0-9-]{1,80})\s*:\s*([^;{}]{1,300});/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css.replace(/\/\*[\s\S]*?\*\//g, "")))) raw[m[1]] = m[2].trim();
  const resolve = (value: string, depth = 0): string | null => {
    const ref = /^var\(\s*--([a-z0-9-]+)\s*(?:,\s*(.+))?\)$/i.exec(value);
    if (!ref) return value;
    if (depth > 6) return null;
    if (raw[ref[1]] !== undefined) return resolve(raw[ref[1]], depth + 1);
    return ref[2] ? resolve(ref[2].trim(), depth + 1) : null;
  };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    const r = resolve(v);
    if (r !== null) out[k] = r;
  }
  return out;
}

// ── Token mapping ──────────────────────────────────────────────────────────────────────────

const mix = (a: string, pct: number, b: string) => `color-mix(in srgb, ${a} ${pct}%, ${b})`;

/**
 * Strata contract tokens -> Plexo's token overrides (light + dark), validated. Anything that is
 * missing or invalid is simply absent, so the bundled value applies for just that token.
 *
 * Light: brand primary/secondary(deep)/accent, page/surface/muted backgrounds, borders, text,
 * focus ring, font, radii. Dark stays Plexo's own derived neutrals; it takes primary, accent,
 * font and radii (and the secondary only where it is readable on dark). The on-colour of every
 * brand button is computed, never read, so a dark primary automatically gets white text.
 * Not mapped on purpose: text-inverse (Strata's is "text on the brand colour"; Plexo computes
 * that), action-secondary (would erase the hover state of secondary buttons), the violet and
 * status colours (Strata has no equivalent).
 */
export function mapStrataTokens(vars: Record<string, string>): BrandTokens {
  const light: TokenSet = {};
  const dark: TokenSet = {};
  const color = (name: string): string | null => (isSafeColor(vars[name]) ? vars[name].trim() : null);

  const primary = color("color-action-primary") ?? color("color-brand-primary");
  const secondary = color("color-brand-secondary");
  const accent = color("color-brand-accent");
  const focus = color("color-focus-ring");
  const bundledPrimary = LIGHT_TOKENS["color-action-primary-bg"];

  // Neutrals (light only). Keep the bundled group unless every text/background pair is >= 4.5:1.
  const page = color("color-bg-page");
  const surface = color("color-bg-surface");
  const muted = color("color-bg-muted");
  const text = color("color-text-primary");
  const text2 = color("color-text-secondary");
  const eff = {
    page: page ?? LIGHT_TOKENS["color-bg-canvas"],
    surface: surface ?? LIGHT_TOKENS["color-bg-surface"],
    muted: muted ?? LIGHT_TOKENS["color-bg-elevated"],
    text: text ?? LIGHT_TOKENS["color-text-primary"],
    text2: text2 ?? LIGHT_TOKENS["color-text-secondary"],
  };
  const pairsOk =
    contrastRatio(eff.text, eff.page) >= 4.5 && contrastRatio(eff.text, eff.surface) >= 4.5 && contrastRatio(eff.text, eff.muted) >= 4.5 && contrastRatio(eff.text2, eff.page) >= 4.5 && contrastRatio(eff.text2, eff.surface) >= 4.5;
  if (pairsOk) {
    if (page) light["color-bg-canvas"] = page;
    if (surface) {
      light["color-bg-surface"] = surface;
    }
    if (muted) light["color-bg-elevated"] = muted;
    if (text) {
      light["color-text-primary"] = text;
      light["color-action-ghost-text"] = text;
      light["color-action-secondary-text"] = text;
    }
    if (text2) light["color-text-secondary"] = text2;
  }
  const border = color("color-border-default");
  const borderStrong = color("color-border-strong");
  if (border) light["color-border-default"] = border;
  if (borderStrong) light["color-border-strong"] = borderStrong;

  if (primary) {
    const on = onColorFor(primary);
    const hover = color("color-action-primary-hover") ?? mix(primary, 88, on);
    for (const set of [light, dark]) {
      set["color-brand-primary"] = primary;
      set["color-action-primary-bg"] = primary;
      set["color-action-primary-text"] = on;
      set["color-action-primary-hover"] = hover;
      if (primary.toLowerCase() !== bundledPrimary.toLowerCase()) set["color-action-primary-active"] = mix(primary, 80, on);
      set["logo-mark"] = primary;
    }
    // Dark mode derives hover from the primary itself (Strata's hover is a light-theme value).
    dark["color-action-primary-hover"] = primary.toLowerCase() === bundledPrimary.toLowerCase() ? DARK_TOKENS["color-action-primary-hover"] : mix(primary, 85, "#FFFFFF");
    if (primary.toLowerCase() === bundledPrimary.toLowerCase()) delete dark["color-action-primary-active"];
    // Primary as the focus ring and "Live" green on the dark canvas, only if it is readable there. It is NOT used for
    // links or the "deep" accent: lime everywhere was overwhelming, so those stay neutral (colour is for the main action).
    if (contrastRatio(primary, DARK_TOKENS["color-bg-canvas"]) >= 4.5) {
      for (const k of ["color-focus-ring", "color-status-success"]) dark[k] = primary;
    }
  }
  if (secondary) {
    // The secondary colour is the light focus ring (needs 4.5:1 on white and the page). Links and the "deep" accent stay neutral.
    if (contrastRatio(secondary, eff.surface) >= 4.5 && contrastRatio(secondary, eff.page) >= 4.5) {
      light["color-focus-ring"] = secondary;
    }
  }
  if (focus && contrastRatio(focus, eff.page) >= 3) light["color-focus-ring"] = focus;
  if (accent) {
    light["color-brand-accent"] = accent;
    dark["color-brand-accent"] = accent;
  }

  // Shared (both modes): font + radii.
  const shared: TokenSet = {};
  const font = vars["font-family-base"];
  if (isSafeFontStack(font)) {
    // The bundled sans is loaded by next/font under its own generated name, so a stack that
    // starts with "Plus Jakarta Sans" is pointed at that loaded font.
    const first = font.trim().split(",")[0].replace(/["']/g, "").trim().toLowerCase();
    shared["font-family-base"] = first === "plus jakarta sans" ? `var(--font-v3-sans), ${font.trim().split(",").slice(1).join(",").trim()}` : font.trim();
  }
  if (isSafeRadius(vars["radius-md"])) shared["radius-control"] = vars["radius-md"].trim();
  if (isSafeRadius(vars["radius-lg"])) shared["radius-card"] = vars["radius-lg"].trim();
  Object.assign(light, shared);
  Object.assign(dark, shared);
  // Only names Plexo knows how to use ever leave this function.
  const known = new Set([...Object.keys(LIGHT_TOKENS), ...Object.keys(SHARED_TOKENS), "font-family-base"]);
  for (const set of [light, dark]) for (const k of Object.keys(set)) if (!known.has(k)) delete set[k];
  return { light, dark };
}

// ── Logos ──────────────────────────────────────────────────────────────────────────────────

export const LOGO_KINDS = ["wordmark-on-light", "wordmark-on-dark", "email-on-light", "email-on-dark", "icon", "app-icon"] as const;
export type LogoKind = (typeof LOGO_KINDS)[number];
export function isLogoKind(v: string): v is LogoKind {
  return (LOGO_KINDS as readonly string[]).includes(v);
}

export type StrataAsset = { type?: string; role?: string; name?: string; cdnUrl?: string; mimeType?: string; metadata?: Record<string, unknown> | null; createdAt?: string; updatedAt?: string };

/** Logo kinds an `email-*` logo must be a bitmap for (Gmail can't render SVG). */
export const BITMAP_ONLY: ReadonlySet<LogoKind> = new Set(["email-on-light", "email-on-dark"]);

const matchers: Record<LogoKind, (a: StrataAsset) => boolean> = {
  "wordmark-on-light": (a) => a.role === "PRIMARY",
  "wordmark-on-dark": (a) => a.role === "MONO_LIGHT",
  "email-on-light": (a) => !a.role && a.metadata?.usage === "email" && a.metadata?.background === "light",
  "email-on-dark": (a) => !a.role && a.metadata?.usage === "email" && a.metadata?.background === "dark",
  icon: (a) => a.role === "FAVICON",
  "app-icon": (a) => a.role === "SOCIAL_AVATAR",
};

const stamp = (a: StrataAsset) => Date.parse(a.updatedAt ?? a.createdAt ?? "") || 0;

/** The URL of the newest active LOGO asset for each kind (roles + metadata are the contract). */
export function resolveLogoAssets(assets: StrataAsset[] | undefined, primaryLogoUrl?: string | null, allowHost: (url: string) => boolean = isAllowedLogoUrl): Record<LogoKind, string | null> {
  const logos = (Array.isArray(assets) ? assets : []).filter((a) => a && a.type === "LOGO" && typeof a.cdnUrl === "string" && allowHost(a.cdnUrl));
  const out = {} as Record<LogoKind, string | null>;
  for (const kind of LOGO_KINDS) {
    let best: { a: StrataAsset; i: number } | null = null;
    logos.forEach((a, i) => {
      if (!matchers[kind](a)) return;
      const bitmapOk = !BITMAP_ONLY.has(kind) || /^image\/(png|jpeg|webp)$/.test(a.mimeType ?? "");
      if (!bitmapOk) return;
      if (!best || stamp(a) > stamp(best.a) || (stamp(a) === stamp(best.a) && i > best.i)) best = { a, i };
    });
    out[kind] = best ? (best as { a: StrataAsset }).a.cdnUrl! : null;
  }
  if (!out["wordmark-on-light"] && primaryLogoUrl && allowHost(primaryLogoUrl) && /\.(svg|png|webp|jpe?g)(\?|$)/i.test(primaryLogoUrl)) out["wordmark-on-light"] = primaryLogoUrl;
  return out;
}

/** https only; the Strata snapshot host or a CloudFront domain (Strata's asset CDN). */
export function isAllowedLogoUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.username || u.password) return false;
    const snapshot = new URL(process.env.STRATA_SNAPSHOT_BASE?.trim() || "https://snapshot.strata.charisol.io").hostname;
    return u.hostname === snapshot || u.hostname.endsWith(".cloudfront.net");
  } catch {
    return false;
  }
}
