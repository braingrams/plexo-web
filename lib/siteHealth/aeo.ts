import type { AeoCheck, AeoCheckId, AeoReport } from "./types";

/**
 * "AI visibility": how easy it is for search engines and AI assistants (ChatGPT, Gemini, Perplexity…)
 * to read, understand and quote your site. Our own score, computed from the live page. Pure functions
 * here; fetching is in fetchAeoInputs.
 */

export type AeoInputs = {
  html: string;
  /** null = the file does not exist */
  robotsTxt: string | null;
  llmsTxtExists: boolean;
  sitemapExists: boolean;
};

/**
 * Weights add up to 100. The reasoning, in one line each (docs/google-analytics-and-site-health.md has the long form):
 * structured_data 18: the clearest signal to machines of who you are. headings 14: how AI tools split a page into answers.
 * meta_description 11: the summary shown in results. ai_crawlers 10: blocked means invisible. llms_txt 8: new and
 * optional, so it counts less than it is hyped. sitemap 7: finds pages. alt_text 7: pictures are unreadable without it.
 * title 7: the name in every result. faq_markup 5: only when questions exist. open_graph 5: link previews.
 * canonical 4 and language 4: housekeeping that avoids mistakes.
 */
export const AEO_WEIGHTS: Record<AeoCheckId, number> = {
  structured_data: 18,
  headings: 14,
  meta_description: 11,
  llms_txt: 8,
  ai_crawlers: 10,
  sitemap: 7,
  alt_text: 7,
  faq_markup: 5,
  canonical: 4,
  language: 4,
  title: 7,
  open_graph: 5,
};
const WEIGHTS = AEO_WEIGHTS;

const AI_BOTS = ["GPTBot", "ClaudeBot", "anthropic-ai", "PerplexityBot", "Google-Extended", "CCBot", "OAI-SearchBot"];

/** Does robots.txt shut an AI crawler (or everyone) out of the whole site? */
export function blockedAiBots(robots: string | null): string[] {
  if (!robots) return [];
  const blocked = new Set<string>();
  // Group by user-agent blocks.
  let agents: string[] = [];
  let sawRule = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "user-agent") {
      if (sawRule) {
        agents = [];
        sawRule = false;
      }
      agents.push(val.toLowerCase());
    } else if (key === "disallow" || key === "allow") {
      sawRule = true;
      if (key === "disallow" && val === "/") {
        for (const a of agents) {
          if (a === "*") AI_BOTS.forEach((b) => blocked.add(b));
          else for (const bot of AI_BOTS) if (bot.toLowerCase() === a) blocked.add(bot);
        }
      }
    }
  }
  return [...blocked];
}

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"))?.slice(2, 4).find((v) => v !== undefined);

export function scoreAeo(input: AeoInputs): AeoReport {
  const { html } = input;
  const headEnd = html.search(/<\/head\s*>/i);
  const head = headEnd === -1 ? html.slice(0, 20000) : html.slice(0, headEnd);
  const results: Omit<AeoCheck, "weight">[] = [];
  const add = (id: AeoCheckId, passed: boolean, detail: string) => results.push({ id, passed, detail });

  const ldBlocks = [...html.matchAll(/<script\b[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  const ldTypes = new Set<string>();
  for (const block of ldBlocks) for (const t of block.matchAll(/"@type"\s*:\s*"([^"]+)"/g)) ldTypes.add(t[1]);
  // WebSite alone is the baseline every Plexo page gets; a richer type is what helps.
  const richTypes = [...ldTypes].filter((t) => t !== "WebSite");
  add("structured_data", richTypes.length > 0, richTypes.length ? `Found: ${richTypes.slice(0, 3).join(", ")}.` : "Only the basic site markup is there; nothing that says who you are or what you offer.");

  const body = html.replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, " ");
  const h1s = [...body.matchAll(/<h1\b/gi)].length;
  const h2s = [...body.matchAll(/<h2\b/gi)].length;
  add("headings", h1s === 1 && h2s >= 1, h1s === 0 ? "No main heading found." : h1s > 1 ? `${h1s} main headings; there should be one.` : h2s === 0 ? "A main heading but no section headings." : "One main heading and clear section headings.");

  const desc = [...head.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]).find((t) => /name=["']description["']/i.test(t));
  const descText = desc ? attr(desc, "content")?.trim() ?? "" : "";
  add("meta_description", descText.length >= 50 && descText.length <= 200, !descText ? "No short summary for search results." : descText.length < 50 ? "The summary is very short." : descText.length > 200 ? "The summary is long and will be cut off." : "A good short summary is set.");

  add("llms_txt", input.llmsTxtExists, input.llmsTxtExists ? "An AI guide file is published." : "There is no file telling AI tools what your site is about.");

  const blocked = blockedAiBots(input.robotsTxt);
  add("ai_crawlers", blocked.length === 0, blocked.length ? `Your robots file keeps out: ${blocked.slice(0, 3).join(", ")}.` : "AI tools are allowed to read your site.");

  add("sitemap", input.sitemapExists, input.sitemapExists ? "A sitemap lists your pages." : "No sitemap, so search tools have to guess where your pages are.");

  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const noAlt = imgs.filter((t) => !(attr(t, "alt") ?? "").trim() && !/\brole=["']presentation["']/i.test(t));
  add("alt_text", imgs.length === 0 || noAlt.length === 0, imgs.length === 0 ? "No pictures on this page." : noAlt.length ? `${noAlt.length} of ${imgs.length} pictures have no description.` : "Every picture has a description.");

  const hasFaqSchema = ldTypes.has("FAQPage");
  const looksLikeFaq = /<(h[2-4])\b[^>]*>[^<]*\?<\/\1>/i.test(body) || /<details\b/i.test(body);
  add("faq_markup", hasFaqSchema || !looksLikeFaq, hasFaqSchema ? "Questions and answers are marked up." : looksLikeFaq ? "You have questions on the page, but AI tools cannot tell they are questions." : "No question-and-answer section to mark up.");

  add("canonical", /<link\b[^>]*rel=["']canonical["']/i.test(head), /<link\b[^>]*rel=["']canonical["']/i.test(head) ? "The page names its own main address." : "The page does not say which address is the main one.");

  const lang = html.match(/<html\b[^>]*\blang=["']([^"']+)["']/i)?.[1];
  add("language", !!lang, lang ? `Language is set (${lang}).` : "The page does not say which language it is written in.");

  const titleText = (head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/<[^>]*>/g, "").trim();
  add("title", titleText.length >= 3, titleText.length >= 3 ? "The page has a name for the browser tab and search results." : "The page has no name for the browser tab and search results.");

  const hasMeta = (key: string) => new RegExp(`<meta\\b[^>]*(?:property|name)=["']${key}["']`, "i").test(head);
  const og = hasMeta("og:title") && (hasMeta("og:image") || hasMeta("og:description"));
  add("open_graph", og, og ? "Shared links show a title and a picture or summary." : "Shared links will look plain: no preview title, picture or summary.");

  const checks: AeoCheck[] = results.map((r) => ({ ...r, weight: WEIGHTS[r.id] }));
  const total = checks.reduce((s, c) => s + c.weight, 0);
  const got = checks.reduce((s, c) => s + (c.passed ? c.weight : 0), 0);
  return { score: Math.round((got / total) * 100), checks };
}

const UA = "PlexoSiteHealth/1.0 (+https://plexo.charisol.io)";

async function fetchText(url: string): Promise<{ ok: boolean; text: string }> {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA }, redirect: "follow", signal: AbortSignal.timeout(10_000), cache: "no-store" });
    const text = res.ok ? (await res.text()).slice(0, 1_000_000) : "";
    return { ok: res.ok, text };
  } catch {
    return { ok: false, text: "" };
  }
}

export async function fetchAeoInputs(siteUrl: string): Promise<AeoInputs> {
  const origin = new URL(siteUrl).origin;
  const [page, robots, llms, sitemap] = await Promise.all([fetchText(siteUrl), fetchText(`${origin}/robots.txt`), fetchText(`${origin}/llms.txt`), fetchText(`${origin}/sitemap.xml`)]);
  if (!page.ok) throw new Error("We could not open your site to check it.");
  return { html: page.text, robotsTxt: robots.ok ? robots.text : null, llmsTxtExists: llms.ok && llms.text.trim().length > 0 && !/<html/i.test(llms.text), sitemapExists: sitemap.ok && /<urlset|<sitemapindex/i.test(sitemap.text) };
}

export async function runAeo(siteUrl: string): Promise<AeoReport> {
  return scoreAeo(await fetchAeoInputs(siteUrl));
}
