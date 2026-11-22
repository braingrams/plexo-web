import type { BusinessDetails } from "./businessMarkup";

export type Rating = "good" | "okay" | "poor";

/** `source`: "visitors" = measured on real visits (Google's Chrome data), "test" = one test run just now. */
export type Metric = { value: number; rating: Rating; source?: "visitors" | "test" } | null;

/** A page element Google pointed at, so owners can be shown exactly where. */
export type ElementPointer = {
  selector: string;
  snippet: string;
  label: string;
  /** Address parameters that open the editor on this exact element (lib/siteHealth/editorLinks.ts): focus=<id>, or mode=text&field=..., or mode=code&line=... */
  editor?: string;
  /** For pages edited as HTML: the same element's line in Code view. */
  code?: string;
};

/** One thing Google says would make the page faster, with how much. */
export type Opportunity = { id: string; savingsMs?: number; savingsBytes?: number };

/** What Google's PageSpeed check found, trimmed to what we show. */
export type SpeedReport = {
  /** 0-100 category scores. */
  speed: number;
  seo: number;
  accessibility: number;
  bestPractices: number;
  /** Seconds until the main content shows (LCP). */
  lcp: Metric;
  /** Milliseconds until the page answers a tap or click (INP). Often missing for new sites: Google has no real visitor data yet. */
  inp: Metric;
  /** Layout shift: how much the page jumps while loading (CLS). */
  cls: Metric;
  /** Seconds until anything shows (FCP). */
  fcp: Metric;
  /** Total blocking time in ms: how long the page is frozen while loading. Stands in for INP when Google has no visitor data. */
  tbt: Metric;
  /** True when `inp` is missing and `tbt` should be used to describe tap response. */
  inpEstimated: boolean;
  /** Where the real-visitor numbers come from: this page or the whole site. */
  fieldScope: "page" | "site" | null;
  /** Speed savings Google found, biggest first. */
  opportunities: Opportunity[];
  /** Up to a few elements per failed audit (heading order, link text, tap size, contrast...). */
  elements: Record<string, ElementPointer[]>;
  /** Audits that failed, with Google's ids (used to pick advice). */
  failedAudits: string[];
  /** "lab" = a test run now; "field" adds real visitor data. */
  hasRealVisitorData: boolean;
};

export type AeoCheckId =
  | "structured_data"
  | "headings"
  | "meta_description"
  | "llms_txt"
  | "ai_crawlers"
  | "sitemap"
  | "alt_text"
  | "faq_markup"
  | "canonical"
  | "language"
  | "title"
  | "open_graph";

export type AeoCheck = { id: AeoCheckId; passed: boolean; /** Weight out of 100 */ weight: number; detail: string };

export type AeoReport = { score: number; checks: AeoCheck[] };

export type HealthReport = {
  url: string;
  /** The phone test (the one that sets the score). */
  speed: SpeedReport | null;
  /** The computer test. */
  desktop?: SpeedReport | null;
  /** Fixes that were switched on when this check ran. */
  fixesOn?: string[];
  /** Why the speed part is missing, in plain words. */
  speedError?: string;
  aeo: AeoReport | null;
  aeoError?: string;
  /** True when the numbers are made-up samples (no Google key in dev). */
  sample?: boolean;
  /** This check was run by Plexo by itself (after a change, or the weekly turn), not by the owner pressing the button. */
  auto?: "changed" | "weekly";
};

export type HealthStatus = {
  siteId: string;
  /** The published address we test, or null when the site is not live yet. */
  url: string | null;
  last: { createdAt: string; report: HealthReport } | null;
  history: { createdAt: string; speed: number | null; aeo: number | null; desktop?: number | null }[];
  /** The site was published after the last check: the numbers may be out of date. */
  stale: boolean;
  /** Fix settings changed since the last check: a fresh check is worth running. */
  fixesChangedSinceCheck: boolean;
  /** When the owner may run the next check, if they cannot right now. */
  nextCheckAt: string | null;
  settings: HealthSettingsView;
  /** Facts about the site that decide which fixes are worth offering. */
  facts?: { productCount: number };
  /** Automatic re-checks: when the last one ran by itself, and when the next is due (a change was queued, or the weekly turn). */
  auto?: { lastAt: string | null; nextAt: string | null; reason: "changed" | "weekly" | null };
};

export type ExtraFixId = "hero_image" | "fast_fonts" | "social_tags" | "page_title" | "faq_schema" | "ai_robots" | "smaller_html" | "image_sizes" | "product_schema";
export const EXTRA_FIX_IDS: ExtraFixId[] = ["hero_image", "fast_fonts", "social_tags", "page_title", "faq_schema", "ai_robots", "smaller_html", "image_sizes", "product_schema"];

export type HealthSettingsView = {
  /** Fixes switched on beyond the first six. */
  extras: Partial<Record<ExtraFixId, boolean>>;
  fallbackDescription: string | null;
  llmsTxt: boolean;
  organizationSchema: boolean;
  lazyEmbeds: boolean;
  altFromFilename: boolean;
  language: string | null;
  /** Business details the owner confirmed (lib/siteHealth/business.ts). */
  business?: BusinessDetails | null;
  /** Page titles written once, by page path, editable by the owner. */
  aiTitles?: Record<string, string>;
  /** Picture descriptions written once, by picture address, editable by the owner. */
  aiAlts?: Record<string, string>;
  /** The weekly "Your site health" email. On unless the owner switched it off. */
  emailDigest: boolean;
};

export type AutoFixId = "meta_description" | "llms_txt" | "organization_schema" | "lazy_embeds" | "alt_text" | "language" | ExtraFixId;

export type Issue = {
  id: string;
  /** Which score it drags down. */
  area: "speed" | "seo" | "ai" | "accessibility";
  severity: Rating;
  /** Plain-words estimate, e.g. "Could save about 1.2 seconds". */
  gain?: string;
  /** Sort weight: bigger = matters more. */
  impact?: number;
  title: string;
  /** One or two plain sentences: what is wrong and why anyone should care. */
  why: string;
  /** Present when Plexo can fix it with one click. Turning it off again undoes it. */
  autoFix?: { id: AutoFixId; label: string; /** True once switched on. */ on: boolean };
  /** Steps for owners who prefer to do it themselves. */
  steps: string[];
  /** Exactly where on the page, when Google told us (manual-only problems). */
  where?: ElementPointer[];
  /** Where to fix it by hand: the editor, or the page settings. */
  editorHint?: "editor" | "settings" | "media";
};
