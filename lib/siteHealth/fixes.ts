import { SiteHealthSettings } from "@/lib/db/opsEntities";
import { Template } from "@/lib/db/contentEntities";
import { generate } from "@/lib/ai/providers/bedrockClaude";
import { resolveModel } from "@/lib/ai/modelRegistry";
import { htmlOutlineLines } from "@/lib/sites/htmlOutline";
import { injectSeoTags } from "@/lib/pub/htmlInject";
import { CommerceProduct } from "@/lib/db/commerceEntities";
import { scoreAeo } from "./aeo";
import { applyHealthSettingsWithNotes, forgetHealthSettings, toView } from "./serve";
import { cleanBusiness, gatherBusinessDraft, type BusinessDetails, type Missing } from "./business";
import { imagesNeedingSize, learnSizes, sizesFor } from "./imageSize";
import { loadSitePages } from "./sitePages";
import { siteFacts } from "./facts";
import { MAX_TITLES, pagesWithoutTitle, picturesWithoutDescription, writePictureDescriptions, writeTitles } from "./aiText";
import { buildIssues } from "./explain";
import { EXTRA_FIX_IDS, type AutoFixId, type ExtraFixId, type HealthReport, type HealthSettingsView } from "./types";

const FIELD = {
  meta_description: "fallbackDescription",
  llms_txt: "llmsTxt",
  organization_schema: "organizationSchema",
  lazy_embeds: "lazyEmbeds",
  alt_text: "altFromFilename",
  language: "language",
} as const;

export function isAutoFixId(v: unknown): v is AutoFixId {
  return typeof v === "string" && (v in FIELD || (EXTRA_FIX_IDS as string[]).includes(v));
}

const isExtra = (id: AutoFixId): id is ExtraFixId => (EXTRA_FIX_IDS as string[]).includes(id);

/** A short, honest summary of the page for search results, written from the page's own words. */
export async function writeDescription(siteName: string, html: string): Promise<string | null> {
  const outline = htmlOutlineLines(html, 60)
    .filter((l) => l.kind === "heading" || l.kind === "text")
    .map((l) => l.text)
    .join("\n")
    .slice(0, 2500);
  if (!outline.trim()) return null;
  try {
    const result = await generate({
      model: resolveModel("bedrock_claude", "BASIC"),
      apiKey: "",
      systemPrompt: "You write the short summary shown under a website's name in Google results. Reply with ONLY the summary: one or two plain sentences, 110 to 155 characters, no quotes, no emoji, no hype. Use only facts in the text you are given.",
      userPrompt: `Website name: ${siteName}\n\nText from its home page:\n${outline}`,
      maxTokens: 80,
    });
    const text = (result.text ?? "").trim().replace(/^["'“”]+|["'“”]+$/g, "").replace(/\s+/g, " ");
    if (text.length < 40) return null;
    return text.length > 180 ? `${text.slice(0, 177).trimEnd()}…` : text;
  } catch (err) {
    console.error("site health: could not write a description:", err instanceof Error ? err.message : "unknown error");
    return null;
  }
}

export type FixResult = { ok: true; settings: HealthSettingsView } | { ok: false; error: string };
/** `userId`: whose AI credits pay for texts written for the owner (titles, picture descriptions). Without it nothing is written by AI. */
export type FixSite = { id: string; organizationId: string; name: string; compiledHtml: string; userId?: string };

const SUMMARY_MIN = 40;
const SUMMARY_MAX = 200;

/** Texts the owner edited in the preview, cleaned: only real page paths or picture addresses, trimmed and bounded. Empty text removes the entry. */
function cleanTexts(raw: unknown, kind: "titles" | "alts", keep: Record<string, string> = {}): Record<string, string> {
  const out = { ...keep };
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 200)) {
    if (kind === "titles" ? !k.startsWith("/") : !/^https?:\/\//i.test(k)) continue;
    const t = typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, kind === "titles" ? 70 : 200) : "";
    if (t) out[k] = t;
    else delete out[k];
  }
  return out;
}

export type FixOptions = { language?: string; text?: string; business?: unknown; titles?: unknown; alts?: unknown };

/** Writes the texts the fix needs when none are stored yet (a one-shot apply with no preview). Failure is not an error: the file-name and heading fallbacks still work. */
async function ensureWrittenTexts(site: FixSite, fix: "page_title" | "alt_text", stored: HealthSettingsView): Promise<Record<string, string> | null> {
  if (!site.userId) return null;
  const pages = await loadSitePages(site.id, { name: site.name, html: site.compiledHtml });
  if (fix === "page_title") {
    const need = pagesWithoutTitle(pages).filter((p) => !stored.aiTitles?.[p.path]).map((p) => p.path);
    if (!need.length) return null;
    const r = await writeTitles(site.userId, site.name, pages, need);
    return r.ok ? r.texts : null;
  }
  const need = picturesWithoutDescription(pages, "https://example.invalid/").filter((p) => !stored.aiAlts?.[p.url]);
  if (!need.length) return null;
  const r = await writePictureDescriptions(site.userId, site.name, need);
  return r.ok ? r.texts : null;
}

/**
 * Turns one fix on or off. Reversible by design: the value lives in the site's health options and is applied
 * while pages are served (lib/siteHealth/serve.ts); the owner's own pages are never changed.
 * `opts.text` is a summary the owner approved (and maybe edited) in the preview, so apply does not write a different one.
 * Business details, written titles and picture descriptions are kept when a fix is switched off (so switching it back on
 * costs nothing); they are only served while the fix is on.
 */
export async function setAutoFix(site: FixSite, fix: AutoFixId, enabled: boolean, opts: FixOptions = {}): Promise<FixResult> {
  const base = { templateId: site.id, organizationId: site.organizationId };
  const finish = async (): Promise<FixResult> => {
    forgetHealthSettings(site.id);
    // The live pages just changed: clear the edge's saved copies and queue a fresh check.
    const { afterHealthSettingsChanged } = await import("./recheck");
    afterHealthSettingsChanged(site.id);
    return { ok: true, settings: toView((await SiteHealthSettings.get({ templateId: site.id }).go()).data) };
  };

  if (isExtra(fix)) {
    const current = (await SiteHealthSettings.get({ templateId: site.id }).go()).data;
    const view = toView(current);
    const extras = { ...view.extras };
    const patch: Record<string, unknown> = {};
    if (enabled) {
      extras[fix] = true;
      if (fix === "page_title") {
        const given = cleanTexts(opts.titles, "titles", view.aiTitles);
        const written = opts.titles === undefined ? await ensureWrittenTexts(site, "page_title", view) : null;
        patch.aiTitles = written ? { ...given, ...cleanTexts(written, "titles", given) } : given;
      }
      if (fix === "image_sizes") {
        const pages = await loadSitePages(site.id, { name: site.name, html: site.compiledHtml });
        await learnSizes(pages.flatMap((p) => imagesNeedingSize(p.html, "https://example.invalid/")).filter((u) => !u.includes("example.invalid")), { deadlineMs: 40_000 });
      }
    } else delete extras[fix];
    await SiteHealthSettings.upsert({ ...base, extras, ...patch }).go();
    return finish();
  }

  const field = FIELD[fix];
  let value: string | boolean | undefined;
  const extra: Record<string, unknown> = {};
  if (fix === "meta_description") {
    if (enabled) {
      const given = opts.text?.replace(/\s+/g, " ").trim();
      if (given && given.length >= SUMMARY_MIN && given.length <= SUMMARY_MAX) value = given;
      else if (given) return { ok: false, error: `Your summary should be between ${SUMMARY_MIN} and ${SUMMARY_MAX} characters. Right now it is ${given.length}.` };
      else {
        const text = await writeDescription(site.name, site.compiledHtml);
        if (!text) return { ok: false, error: "We could not write a summary from your page yet. Add a few sentences about what you do to your home page, then try again." };
        value = text;
      }
    }
  } else if (fix === "language") {
    if (enabled) value = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(opts.language ?? "") ? opts.language : "en";
  } else {
    value = enabled;
    if (enabled && fix === "organization_schema") {
      const stored = toView((await SiteHealthSettings.get({ templateId: site.id }).go()).data).business;
      // What the owner confirmed in the preview; or, applied in one step, everything Plexo already knows about the business.
      extra.business = opts.business !== undefined ? cleanBusiness(opts.business) : (await gatherBusinessDraft(site, stored)).details;
    }
    if (enabled && fix === "alt_text") {
      const view = toView((await SiteHealthSettings.get({ templateId: site.id }).go()).data);
      const given = cleanTexts(opts.alts, "alts", view.aiAlts);
      const written = opts.alts === undefined ? await ensureWrittenTexts(site, "alt_text", view) : null;
      extra.aiAlts = written ? { ...given, ...cleanTexts(written, "alts", given) } : given;
    }
  }

  if (value === undefined) {
    // Switching a text option off: remove the value so the page goes back to how it was.
    await SiteHealthSettings.upsert(base).go();
    await SiteHealthSettings.patch({ templateId: site.id }).remove([field]).go();
  } else {
    await SiteHealthSettings.upsert({ ...base, [field]: value, ...extra }).go();
  }
  return finish();
}

/** What a fix would do, in plain words, without changing anything. */
export type FixPreview = {
  fix: AutoFixId;
  /** What the owner will see change. Empty means "nothing to change on your pages right now". */
  notes: string[];
  /** For meta_description: the text that would be used, editable before applying. */
  text?: string;
  /** Projected AI-visibility score (our own, computed from the page's HTML), before and after. Speed needs a new check. */
  aeo?: { from: number; to: number };
  error?: string;
  /** For business details: what we already know, what we found where, and the few things still to ask the owner. */
  business?: { values: BusinessDetails; found: string[]; missing: Missing[] };
  /** For page titles and picture descriptions: the texts written for the owner to read, edit and regenerate. */
  texts?: { kind: "titles" | "pictures"; items: { key: string; label: string; text: string }[]; more: boolean; skipped: number; credits: number; error?: string };
};

/** The platform's own tags every page already gets, so our projection starts where the live page really starts. */
function baselineHtml(html: string, siteName: string): string {
  return injectSeoTags(html, { canonicalUrl: "https://example.invalid/", noindex: false, siteName });
}

export function projectAeo(html: string, siteName: string, settings: HealthSettingsView, last: HealthReport | null): number {
  const ctx = { canonicalUrl: "https://example.invalid/", siteName };
  const served = applyHealthSettingsWithNotes(baselineHtml(html, siteName), settings, ctx).html;
  const checks = last?.aeo?.checks ?? [];
  const robotsBlocks = checks.some((c) => c.id === "ai_crawlers" && !c.passed);
  const sitemapMissing = checks.some((c) => c.id === "sitemap" && !c.passed);
  return scoreAeo({ html: served, robotsTxt: robotsBlocks ? "User-agent: *\nDisallow: /\n" : null, llmsTxtExists: settings.llmsTxt, sitemapExists: !sitemapMissing }).score;
}

const STATIC_NOTES: Partial<Record<AutoFixId, string>> = {
  llms_txt: "A short guide to your site appears at your-address/llms.txt for AI assistants, with a list of your pages.",
  ai_robots: "Your robots file says, in plain lines, that ChatGPT, Claude, Perplexity and Google's AI may read your site.",
};

const merge = (a: Record<string, string> | undefined, b: Record<string, string>) => ({ ...(a ?? {}), ...b });

/** Saves written texts straight away: they are only served once the fix is on, and storing them means a second look costs nothing. */
async function keepTexts(site: FixSite, field: "aiTitles" | "aiAlts", texts: Record<string, string>) {
  if (!Object.keys(texts).length) return;
  await SiteHealthSettings.upsert({ templateId: site.id, organizationId: site.organizationId, [field]: texts }).go();
  forgetHealthSettings(site.id);
}

export async function previewFix(site: FixSite, fix: AutoFixId, current: HealthSettingsView, last: HealthReport | null, opts: { regenerate?: boolean } = {}): Promise<FixPreview> {
  const next: HealthSettingsView = { ...current, extras: { ...current.extras } };
  let text: string | undefined;
  let business: FixPreview["business"];
  let texts: FixPreview["texts"];
  let sizes: Map<string, { width: number; height: number }> | undefined;
  const extraNotes: string[] = [];
  if (fix === "meta_description") {
    const written = await writeDescription(site.name, site.compiledHtml);
    if (!written) return { fix, notes: [], error: "We could not write a summary from your page yet. Add a few sentences about what you do to your home page, then try again." };
    text = written;
    next.fallbackDescription = written;
  } else if (fix === "organization_schema") {
    next.organizationSchema = true;
    const draft = await gatherBusinessDraft(site, current.business);
    next.business = draft.details;
    business = { values: draft.details, found: draft.found, missing: draft.missing };
  } else if (fix === "llms_txt") next.llmsTxt = true;
  else if (fix === "lazy_embeds") next.lazyEmbeds = true;
  else if (fix === "alt_text") {
    next.altFromFilename = true;
    const pages = await loadSitePages(site.id, { name: site.name, html: site.compiledHtml });
    const pictures = picturesWithoutDescription(pages, "https://example.invalid/").filter((p) => !p.url.includes("example.invalid"));
    const missing = opts.regenerate ? pictures : pictures.filter((p) => !current.aiAlts?.[p.url]);
    let written: Record<string, string> = {};
    let credits = 0;
    let error: string | undefined;
    let skipped = 0;
    let more = false;
    if (missing.length && site.userId) {
      const r = await writePictureDescriptions(site.userId, site.name, missing);
      if (r.ok) {
        written = r.texts;
        credits = r.credits;
        skipped = r.skipped.length;
        more = r.capped;
        await keepTexts(site, "aiAlts", merge(current.aiAlts, written));
      } else error = r.error;
    }
    next.aiAlts = merge(current.aiAlts, written);
    const items = pictures.filter((p) => next.aiAlts?.[p.url]).slice(0, 40).map((p) => ({ key: p.url, label: p.page, text: next.aiAlts![p.url] }));
    texts = { kind: "pictures", items, more, skipped, credits, error };
  } else if (fix === "language") next.language = "en";
  else if (fix === "page_title") {
    next.extras.page_title = true;
    const pages = await loadSitePages(site.id, { name: site.name, html: site.compiledHtml });
    const without = pagesWithoutTitle(pages);
    const missing = opts.regenerate ? without : without.filter((p) => !current.aiTitles?.[p.path]);
    let written: Record<string, string> = {};
    let credits = 0;
    let error: string | undefined;
    let skipped = 0;
    if (missing.length && site.userId) {
      const r = await writeTitles(site.userId, site.name, pages, missing.map((p) => p.path));
      if (r.ok) {
        written = r.texts;
        credits = r.credits;
        skipped = r.skipped.length;
        await keepTexts(site, "aiTitles", merge(current.aiTitles, written));
      } else error = r.error;
    }
    next.aiTitles = merge(current.aiTitles, written);
    const items = without.filter((p) => next.aiTitles?.[p.path]).map((p) => ({ key: p.path, label: p.name || p.path, text: next.aiTitles![p.path] }));
    texts = { kind: "titles", items, more: without.length - items.length > 0 && missing.length > MAX_TITLES, skipped, credits, error };
  } else if (fix === "image_sizes") {
    next.extras.image_sizes = true;
    const pages = await loadSitePages(site.id, { name: site.name, html: site.compiledHtml });
    const urls = pages.flatMap((p) => imagesNeedingSize(p.html, "https://example.invalid/")).filter((u) => !u.includes("example.invalid"));
    await learnSizes(urls, { deadlineMs: 25_000 });
    sizes = await sizesFor(urls);
    const unknown = new Set(urls).size - sizes.size;
    if (unknown > 0) extraNotes.push(`${unknown} ${unknown === 1 ? "picture" : "pictures"} could not be measured (the other site may block it), so ${unknown === 1 ? "it" : "they"} stay as they are.`);
  } else if (fix === "product_schema") {
    next.extras.product_schema = true;
    const { data } = await CommerceProduct.query.primary({ templateId: site.id }).go({ pages: "all" });
    const n = data.filter((p) => p.active && p.kind === "PHYSICAL").length;
    if (!n) return { fix, notes: [], error: "You have no products for sale yet. Add a product in Commerce first, then come back." };
    extraNotes.push(`${n} ${n === 1 ? "product page tells" : "product pages tell"} Google its price, picture and whether it is in stock, so it can show them in results.`);
  } else next.extras[fix] = true;

  const ctx = { canonicalUrl: "https://example.invalid/", siteName: site.name, sizes };
  const only: HealthSettingsView = {
    ...next,
    fallbackDescription: fix === "meta_description" ? next.fallbackDescription : null,
    llmsTxt: false,
    organizationSchema: fix === "organization_schema",
    lazyEmbeds: fix === "lazy_embeds",
    altFromFilename: fix === "alt_text",
    language: fix === "language" ? "en" : null,
    extras: isExtra(fix) ? { [fix]: true } : {},
  };
  const { notes } = applyHealthSettingsWithNotes(baselineHtml(site.compiledHtml, site.name), only, ctx);
  const key = fix === "organization_schema" ? "organization_schema" : fix;
  const lines = [...(notes[key] ?? []), ...extraNotes];
  if (texts?.kind === "titles" && texts.items.length) lines.unshift(`${texts.items.length} ${texts.items.length === 1 ? "page gets" : "pages get"} a name for the browser tab and Google, like "${texts.items[0].text}".`);
  if (texts?.kind === "pictures" && texts.items.length) lines.unshift(`${texts.items.length} ${texts.items.length === 1 ? "picture gets" : "pictures get"} a description, like "${texts.items[0].text}".`);
  if (STATIC_NOTES[fix]) lines.push(STATIC_NOTES[fix]!);
  const from = projectAeo(site.compiledHtml, site.name, current, last);
  const to = projectAeo(site.compiledHtml, site.name, next, last);
  return { fix, notes: lines, text, business, texts, aeo: to !== from ? { from, to } : undefined };
}

export type FixAllSummary = { done: { fix: AutoFixId; label: string; notes: string[] }[]; skipped: { fix: AutoFixId; reason: string }[]; aeo?: { from: number; to: number } };

/**
 * "Fix everything": turns on every one-click fix that applies and is not on yet. Each is reversible on its own,
 * and the whole set can be undone with fixAll(site, false).
 */
export async function fixEverything(site: FixSite, current: HealthSettingsView, last: HealthReport | null): Promise<{ summary: FixAllSummary; settings: HealthSettingsView }> {
  const issues = buildIssues({ speed: last?.speed ?? null, aeo: last?.aeo ?? null, settings: current, html: site.compiledHtml, facts: await siteFacts(site.id) }).filter((i) => i.autoFix && !i.autoFix.on && i.severity !== "good");
  const summary: FixAllSummary = { done: [], skipped: [] };
  let settings = current;
  const from = projectAeo(site.compiledHtml, site.name, current, last);
  for (const issue of issues) {
    const fix = issue.autoFix!.id;
    const preview = await previewFix(site, fix, settings, last);
    if (preview.error) {
      summary.skipped.push({ fix, reason: preview.error });
      continue;
    }
    if (preview.texts?.error && !preview.texts.items.length) {
      summary.skipped.push({ fix, reason: preview.texts.error });
      continue;
    }
    if (fix === "meta_description" && !preview.notes.length && preview.text) {
      preview.notes = [`Google shows: "${preview.text}"`];
    }
    if (!preview.notes.length && fix !== "llms_txt" && fix !== "ai_robots" && fix !== "meta_description") {
      summary.skipped.push({ fix, reason: "Nothing on your pages needed this one." });
      continue;
    }
    const res = await setAutoFix(site, fix, true, { text: preview.text, business: preview.business?.values, titles: preview.texts?.kind === "titles" ? Object.fromEntries(preview.texts.items.map((i) => [i.key, i.text])) : undefined, alts: preview.texts?.kind === "pictures" ? Object.fromEntries(preview.texts.items.map((i) => [i.key, i.text])) : undefined });
    if (!res.ok) {
      summary.skipped.push({ fix, reason: res.error });
      continue;
    }
    settings = res.settings;
    summary.done.push({ fix, label: issue.autoFix!.label, notes: preview.notes });
  }
  const to = projectAeo(site.compiledHtml, site.name, settings, last);
  if (to !== from) summary.aeo = { from, to };
  return { summary, settings };
}

/** What "Fix everything" would do, without doing it. */
export async function previewEverything(site: FixSite, current: HealthSettingsView, last: HealthReport | null): Promise<{ fixes: FixPreview[]; aeo?: { from: number; to: number } }> {
  const issues = buildIssues({ speed: last?.speed ?? null, aeo: last?.aeo ?? null, settings: current, html: site.compiledHtml, facts: await siteFacts(site.id) }).filter((i) => i.autoFix && !i.autoFix.on && i.severity !== "good");
  const fixes: FixPreview[] = [];
  const next: HealthSettingsView = { ...current, extras: { ...current.extras } };
  for (const issue of issues) {
    const p = await previewFix(site, issue.autoFix!.id, current, last);
    fixes.push(p);
    const id = issue.autoFix!.id;
    if (!p.error) {
      if (id === "meta_description") next.fallbackDescription = p.text ?? null;
      else if (id === "organization_schema") {
        next.organizationSchema = true;
        next.business = p.business?.values ?? null;
      } else if (id === "llms_txt") next.llmsTxt = true;
      else if (id === "lazy_embeds") next.lazyEmbeds = true;
      else if (id === "alt_text") next.altFromFilename = true;
      else if (id === "language") next.language = "en";
      else next.extras[id] = true;
    }
  }
  const from = projectAeo(site.compiledHtml, site.name, current, last);
  const to = projectAeo(site.compiledHtml, site.name, next, last);
  return { fixes, aeo: to !== from ? { from, to } : undefined };
}

/** Switches every fix off: the site is served exactly as the owner built it. */
export async function undoEverything(site: FixSite, current: HealthSettingsView): Promise<HealthSettingsView> {
  let settings = current;
  const on: AutoFixId[] = [];
  if (current.fallbackDescription) on.push("meta_description");
  if (current.llmsTxt) on.push("llms_txt");
  if (current.organizationSchema) on.push("organization_schema");
  if (current.lazyEmbeds) on.push("lazy_embeds");
  if (current.altFromFilename) on.push("alt_text");
  if (current.language) on.push("language");
  for (const id of EXTRA_FIX_IDS) if (current.extras[id]) on.push(id);
  for (const fix of on) {
    const r = await setAutoFix(site, fix, false);
    if (r.ok) settings = r.settings;
  }
  return settings;
}

export async function loadSiteForHealth(organizationId: string, id: string) {
  const { data: site } = await Template.get({ id }).go();
  if (!site || site.organizationId !== organizationId || site.parentId || site.kind !== "LANDING_PAGE") return null;
  return site;
}
