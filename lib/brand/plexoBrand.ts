/**
 * Plexo's OWN brand, read live from the Plexo project in Strata (colours, fonts, radii, logos),
 * so a change in Strata shows up in Plexo with no code change or deploy. See
 * docs/PLEXO_BRAND_FROM_STRATA.md. Server-side only (uses process.env and fetch).
 *
 * `getPlexoBrand()` never throws and never holds a render hostage: a 60s in-memory cache,
 * single-flight refresh, a 3s network timeout, and stale-while-error (the last good value is
 * served for up to 24h). With nothing cached and Strata down it returns the bundled defaults.
 */
import { createHash } from "node:crypto";
import type { BrandTokens } from "@/lib/brandTokens";
import { brandTokensCss, LIGHT_TOKENS, mergeBrandTokens, SHARED_TOKENS } from "@/lib/brandTokens";
import { applyEmailBrand } from "./emailBrand";
import { isAllowedLogoUrl, LOGO_KINDS, mapStrataTokens, parseVariablesCss, resolveLogoAssets, type LogoKind, type StrataAsset } from "./strataTokens";

export type PlexoBrand = {
  /** Validated overrides on top of the bundled tokens (empty sets when falling back). */
  tokens: BrandTokens;
  /** Strata asset URLs by kind (null = none published; the logo proxy then serves the bundled file). */
  logos: { wordmarkOnLight: string | null; wordmarkOnDark: string | null; emailOnLight: string | null; emailOnDark: string | null; icon: string | null; appIcon: string | null };
  source: "strata" | "fallback";
  /** Changes whenever the published tokens or assets change. */
  revision: string;
};

const DEFAULT_PROJECT_ID = "01a1e54e-ab9a-779c-be4f-dba969d7bb45";
const DEFAULT_API = "https://api-production-charisol-design-system-be.aws.charisol.io";
const DEFAULT_SNAPSHOT = "https://snapshot.strata.charisol.io";

const TTL_MS = 60_000;
const RETRY_AFTER_FAIL_MS = 10_000;
const STALE_MAX_MS = 24 * 3600_000;
const TIMEOUT_MS = 3_000;
/** When a stale value exists, a slow refresh gets this long before the stale one is served. */
const STALE_WAIT_MS = 800;

export const FALLBACK_BRAND: PlexoBrand = { tokens: { light: {}, dark: {} }, logos: { wordmarkOnLight: null, wordmarkOnDark: null, emailOnLight: null, emailOnDark: null, icon: null, appIcon: null }, source: "fallback", revision: "fallback" };

export function brandEnabled(): boolean {
  return (process.env.PLEXO_BRAND_STRATA ?? "").trim().toLowerCase() !== "off";
}

const cfg = () => ({
  projectId: /^[0-9a-f-]{36}$/i.test(process.env.PLEXO_BRAND_STRATA_PROJECT_ID?.trim() ?? "") ? process.env.PLEXO_BRAND_STRATA_PROJECT_ID!.trim() : DEFAULT_PROJECT_ID,
  api: (process.env.STRATA_PUBLIC_API?.trim() || DEFAULT_API).replace(/\/+$/, "").replace(/\/v1$/, ""),
  snapshot: (process.env.STRATA_SNAPSHOT_BASE?.trim() || DEFAULT_SNAPSHOT).replace(/\/+$/, ""),
});

async function getText(url: string, signal: AbortSignal): Promise<string> {
  const res = await fetch(url, { signal, cache: "no-store", headers: { accept: "*/*" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const text = await res.text();
  if (text.length > 500_000) throw new Error("response too large");
  return text;
}

/** One network round: the project (assets) and the published variables.css, in parallel. */
export async function fetchPlexoBrandFromStrata(): Promise<PlexoBrand> {
  const { projectId, api, snapshot } = cfg();
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  const [projectRaw, cssRaw] = await Promise.all([
    getText(`${api}/v1/public/projects/${projectId}`, signal),
    getText(`${snapshot}/snapshots/${projectId}/variables.css`, signal),
  ]);
  const project = (JSON.parse(projectRaw) as { project?: { logo?: string; updatedAt?: string; designSystemData?: { assets?: StrataAsset[] } } }).project;
  if (!project) throw new Error("no project in response");
  const vars = parseVariablesCss(cssRaw);
  if (!Object.keys(vars).length) throw new Error("no tokens published");
  const l = resolveLogoAssets(project.designSystemData?.assets, project.logo, isAllowedLogoUrl);
  return {
    tokens: mapStrataTokens(vars),
    logos: { wordmarkOnLight: l["wordmark-on-light"], wordmarkOnDark: l["wordmark-on-dark"], emailOnLight: l["email-on-light"], emailOnDark: l["email-on-dark"], icon: l.icon, appIcon: l["app-icon"] },
    source: "strata",
    revision: createHash("sha1").update(cssRaw).update(JSON.stringify(l)).digest("hex").slice(0, 12),
  };
}

type State = { value: PlexoBrand | null; at: number; nextTry: number; flight: Promise<PlexoBrand | null> | null; fetcher: () => Promise<PlexoBrand> };
const state: State = { value: null, at: 0, nextTry: 0, flight: null, fetcher: fetchPlexoBrandFromStrata };

/** Tests only. */
export function __resetPlexoBrandForTests(fetcher?: () => Promise<PlexoBrand>) {
  state.value = null;
  state.at = 0;
  state.nextTry = 0;
  state.flight = null;
  state.fetcher = fetcher ?? fetchPlexoBrandFromStrata;
  lastKnown = FALLBACK_BRAND;
  applyEmailBrand(FALLBACK_BRAND.tokens);
}

function refresh(): Promise<PlexoBrand | null> {
  if (state.flight) return state.flight;
  state.flight = state
    .fetcher()
    .then((v) => {
      state.value = v;
      state.at = Date.now();
      state.nextTry = state.at + TTL_MS;
      lastKnown = v;
      applyEmailBrand(v.tokens);
      return v;
    })
    .catch((err) => {
      state.nextTry = Date.now() + RETRY_AFTER_FAIL_MS;
      console.warn("[plexo-brand] Strata unavailable, using", state.value ? "last good brand" : "bundled brand", err instanceof Error ? err.message : err);
      return null;
    })
    .finally(() => {
      state.flight = null;
    });
  return state.flight;
}

/** The live brand. Never throws. */
export async function getPlexoBrand(): Promise<PlexoBrand> {
  if (!brandEnabled()) return FALLBACK_BRAND;
  const now = Date.now();
  const usable = state.value && now - state.at < STALE_MAX_MS ? state.value : null;
  if (usable && now < state.nextTry) return usable;
  if (!usable && now < state.nextTry && !state.flight) return FALLBACK_BRAND;
  const pending = refresh();
  if (usable) {
    const winner = await Promise.race([pending, new Promise<null>((r) => setTimeout(() => r(null), STALE_WAIT_MS))]);
    return winner ?? usable;
  }
  return (await pending) ?? FALLBACK_BRAND;
}

// ── Last-known-good, for code that can't await (the sync email builders) ──────────────────

let lastKnown: PlexoBrand = FALLBACK_BRAND;
/** The most recent brand any call resolved (bundled defaults on a cold start). Sync. */
export function getLastKnownPlexoBrand(): PlexoBrand {
  return brandEnabled() ? lastKnown : FALLBACK_BRAND;
}

/** Fire-and-forget: warm the cache so the next (sync) email build has the live colours. */
export function primeEmailBrand(): void {
  if (brandEnabled()) void getPlexoBrand();
}

// ── Helpers for callers ───────────────────────────────────────────────────────────────────

/** The v3 token stylesheet with the live brand applied (what the dashboard layout injects). */
export async function plexoBrandTokensCss(extra?: Partial<BrandTokens>): Promise<string> {
  const live = (await getPlexoBrand()).tokens;
  return brandTokensCss(mergeBrandTokens({ light: { ...live.light, ...(extra?.light ?? {}) }, dark: { ...live.dark, ...(extra?.dark ?? {}) } }));
}

/**
 * For the auth pages (app/auth/_kit/auth-tokens.css follow-up): a `:root{...}` block of the
 * live brand under Strata's own token names (light mode, on-colour already contrast-checked),
 * plus --plexo-logo-light / --plexo-logo-dark URLs. Usage in a server component:
 *   <style dangerouslySetInnerHTML={{ __html: await plexoBrandCssVars() }} />
 * and have auth-tokens.css read var(--color-brand-primary, #B8F34A) etc. so the bundled value
 * remains the fallback. Values are validated, so the string is safe to inline.
 */
export async function plexoBrandCssVars(): Promise<string> {
  const { tokens } = await getPlexoBrand();
  const t = { ...SHARED_TOKENS, ...LIGHT_TOKENS, ...tokens.light };
  const map: Record<string, string> = {
    "color-brand-primary": t["color-brand-primary"],
    "color-brand-secondary": t["color-brand-deep"],
    "color-brand-accent": t["color-brand-accent"],
    "color-action-primary": t["color-action-primary-bg"],
    "color-action-primary-hover": t["color-action-primary-hover"],
    "color-on-action-primary": t["color-action-primary-text"],
    "color-bg-page": t["color-bg-canvas"],
    "color-bg-surface": t["color-bg-surface"],
    "color-bg-muted": t["color-bg-elevated"],
    "color-border-default": t["color-border-default"],
    "color-border-strong": t["color-border-strong"],
    "color-text-primary": t["color-text-primary"],
    "color-text-secondary": t["color-text-secondary"],
    "color-focus-ring": t["color-focus-ring"],
    "radius-md": t["radius-control"],
    "radius-lg": t["radius-card"],
    "plexo-logo-on-light": "url(/api/brand/logo/wordmark-on-light)",
    "plexo-logo-on-dark": "url(/api/brand/logo/wordmark-on-dark)",
  };
  if (t["font-family-base"] && !t["font-family-base"].includes("--font-v3-sans")) map["font-family-base"] = t["font-family-base"];
  return `:root{${Object.entries(map).map(([k, v]) => `--${k}:${v};`).join("")}}`;
}

export { LOGO_KINDS };
export type { LogoKind };
