import type { AeoReport, ElementPointer, HealthReport, HealthSettingsView, Issue, Metric, Rating, SpeedReport } from "./types";
import { METRIC_LIMITS } from "./psi";
import { AEO_WEIGHTS } from "./aeo";

/**
 * Everything an owner reads. House rules: short sentences, everyday words, grade 6 or lower (tests check it),
 * no jargon without a "what's this?" tip, and numbers always come with what they mean.
 */

export function scoreLook(score: number): { tone: Rating; label: string } {
  if (score >= 100) return { tone: "good", label: "Perfect" };
  if (score >= 90) return { tone: "good", label: "Great" };
  if (score >= 50) return { tone: "okay", label: "Could be better" };
  return { tone: "poor", label: "Needs work" };
}

const VERDICT: Record<Rating, string> = { good: "Good", okay: "Could be better", poor: "Slow" };

export type MetricView = {
  key: "lcp" | "fcp" | "inp" | "tbt" | "cls";
  /** Friendly name first, the short code second. */
  name: string;
  term: string;
  /** "2.1 seconds" */
  value: string;
  verdict: string;
  tone: Rating | null;
  /** One line: what this measures, in everyday words. */
  meaning: string;
  /** "Good is under 2.5 seconds. Over 4 seconds is slow." */
  limits: string;
  /** Behind the "What's this?" button. */
  tip: string;
  /** Where the number came from. */
  source: string;
  /** Full sentence for screen readers and the AI assistant. */
  sentence: string;
};

const secs = (v: number) => `${v.toFixed(1)} second${v.toFixed(1) === "1.0" ? "" : "s"}`;

type Def = { key: MetricView["key"]; name: string; term: string; meaning: string; tip: string; fmt: (v: number) => string; limits: string; slow: string };
const DEFS: Def[] = [
  {
    key: "lcp", name: "Main content shows up", term: "LCP", fmt: secs,
    meaning: "How long until the biggest thing at the top of your page appears.",
    tip: "LCP stands for Largest Contentful Paint. That is a long name for a simple idea: the moment your biggest picture or heading shows up. Visitors judge your site by this moment.",
    limits: `Good is under ${METRIC_LIMITS.lcp[0]} seconds. Over ${METRIC_LIMITS.lcp[1]} seconds is slow.`, slow: "Slow",
  },
  {
    key: "fcp", name: "First thing appears", term: "FCP", fmt: secs,
    meaning: "How long until anything at all shows on the screen.",
    tip: "FCP stands for First Contentful Paint. It is the end of the blank white screen: the first text or picture a visitor sees.",
    limits: `Good is under ${METRIC_LIMITS.fcp[0]} seconds. Over ${METRIC_LIMITS.fcp[1]} seconds is slow.`, slow: "Slow",
  },
  {
    key: "inp", name: "Taps feel quick", term: "INP", fmt: (v) => `${Math.round(v)} milliseconds`,
    meaning: "How fast your page reacts when someone taps or clicks.",
    tip: "INP stands for Interaction to Next Paint. A millisecond is a thousandth of a second. Below 200 feels instant. Above 500 feels stuck.",
    limits: `Good is under ${METRIC_LIMITS.inp[0]} milliseconds. Over ${METRIC_LIMITS.inp[1]} is sluggish.`, slow: "Sluggish",
  },
  {
    key: "tbt", name: "Page freezes while it loads", term: "TBT", fmt: (v) => `${Math.round(v)} milliseconds`,
    meaning: "How long the page is stuck and ignores taps while it loads.",
    tip: "TBT stands for Total Blocking Time. We use it when Google has not measured real visitors yet. A lower number means taps will work sooner.",
    limits: `Good is under ${METRIC_LIMITS.tbt[0]} milliseconds. Over ${METRIC_LIMITS.tbt[1]} is sluggish.`, slow: "Sluggish",
  },
  {
    key: "cls", name: "Page stays still", term: "CLS", fmt: (v) => v.toFixed(2),
    meaning: "How much things jump around while the page loads.",
    tip: "CLS stands for Cumulative Layout Shift. You know that moment when a page jumps and you tap the wrong thing? This number counts that. Zero means nothing moved.",
    limits: `Good is under ${METRIC_LIMITS.cls[0]}. Over ${METRIC_LIMITS.cls[1]} is jumpy.`, slow: "Jumpy",
  },
];

function sourceWords(m: NonNullable<Metric>, report: SpeedReport, key: MetricView["key"]): string {
  if (key === "tbt") return "From a test we ran just now.";
  if (m.source === "visitors") return report.fieldScope === "site" ? "From real visitors to your whole site." : "From real visitors to this page.";
  return "From a test we ran just now.";
}

/** The timings for one test (phone or computer), each in plain words. */
export function describeMetrics(s: SpeedReport): MetricView[] {
  const out: MetricView[] = [];
  const by: Record<MetricView["key"], Metric> = { lcp: s.lcp, fcp: s.fcp, inp: s.inp, tbt: s.inpEstimated ? s.tbt : null, cls: s.cls };
  for (const d of DEFS) {
    if (d.key === "tbt" && !s.inpEstimated) continue;
    if (d.key === "inp" && s.inpEstimated) continue;
    const m = by[d.key];
    if (!m) {
      out.push({ key: d.key, name: d.name, term: d.term, value: "Not measured", verdict: "Not measured", tone: null, meaning: d.meaning, limits: d.limits, tip: d.tip, source: "Google has no numbers for this yet.", sentence: `${d.name}: Google has no numbers for this yet.` });
      continue;
    }
    const verdict = m.rating === "poor" ? d.slow : VERDICT[m.rating];
    const value = d.fmt(m.value);
    out.push({ key: d.key, name: d.name, term: d.term, value, verdict, tone: m.rating, meaning: d.meaning, limits: d.limits, tip: d.tip, source: sourceWords(m, s, d.key), sentence: `${d.name}: ${value}. That is ${verdict.toLowerCase()}. ${d.meaning}` });
  }
  return out;
}

/** The one-line verdict above the rings. */
export function headline(r: HealthReport): { text: string; tone: Rating | null; perfect: boolean } {
  if (!r.speed) return { text: "We could not time your site this time.", tone: null, perfect: false };
  const score = r.speed.speed;
  const sec = r.speed.lcp?.value;
  const perfect = score >= 100 && r.speed.seo >= 100 && (r.aeo?.score ?? 100) >= 100;
  if (perfect) return { text: "Perfect scores. Your site is as fast and findable as it gets.", tone: "good", perfect: true };
  const tail = sec != null ? ` Your main content shows up in ${secs(sec)}.` : "";
  if (score >= 90) return { text: `Your site is fast.${tail}`, tone: "good", perfect: false };
  if (score >= 50) return { text: `Your site could be faster.${tail}`, tone: "okay", perfect: false };
  return { text: `Your site is slow.${tail}`, tone: "poor", perfect: false };
}

type Ctx = { speed: SpeedReport | null; aeo: AeoReport | null; settings: HealthSettingsView; /** The page's own HTML, to spot what is missing without a new test. */ html?: string; facts?: { productCount: number } };

const failedAudit = (s: SpeedReport | null, ...ids: string[]) => !!s && ids.some((id) => s.failedAudits.includes(id));
const aeoFailed = (a: AeoReport | null, id: string) => !!a && a.checks.some((c) => c.id === id && !c.passed);
const where = (s: SpeedReport | null, ...ids: string[]): ElementPointer[] | undefined => {
  if (!s) return undefined;
  const found = ids.flatMap((id) => s.elements[id] ?? []);
  return found.length ? found.slice(0, 5) : undefined;
};

/** "Could save about 1.2 seconds" from Google's own estimate, or nothing at all (no guessing). */
export function gainWords(ms: number | undefined): string | undefined {
  if (!ms || ms < 100) return undefined;
  if (ms < 1000) return `Could save about ${Math.round(ms / 100) * 100} milliseconds`;
  return `Could save about ${(ms / 1000).toFixed(1)} seconds`;
}

const savings = (s: SpeedReport | null, ...ids: string[]) => Math.max(0, ...(s?.opportunities.filter((o) => ids.includes(o.id)).map((o) => o.savingsMs ?? 0) ?? [0]));
const aeoGain = (id: keyof typeof AEO_WEIGHTS) => `Worth up to ${AEO_WEIGHTS[id]} points of AI visibility`;

/** Every problem we found, biggest first. Each has a one-click fix when Plexo can do it, and steps for doing it by hand. */
export function buildIssues(ctx: Ctx): Issue[] {
  const { speed, aeo, settings, html } = ctx;
  const ex = settings.extras;
  const issues: Issue[] = [];
  const push = (i: Issue) => issues.push(i);
  const SEV: Record<Rating, number> = { poor: 30, okay: 10, good: 0 };
  const sev = (r: Rating) => SEV[r];

  // ── Speed ──
  const lcpBad = !!speed?.lcp && speed.lcp.rating !== "good";
  const heroAudit = failedAudit(speed, "lcp-lazy-loaded", "prioritize-lcp-image");
  if (heroAudit || (lcpBad && !ex.hero_image) || ex.hero_image) {
    const ms = savings(speed, "prioritize-lcp-image", "lcp-lazy-loaded");
    push({
      id: "hero_image", area: "speed", severity: heroAudit || lcpBad ? (speed?.lcp?.rating === "poor" ? "poor" : "okay") : "good",
      impact: (ms || 600) + sev(speed?.lcp?.rating ?? "good"), gain: gainWords(ms) ?? (lcpBad ? "Helps your main content show up sooner" : undefined),
      title: ex.hero_image ? "Your main picture loads first" : "Your top picture loads too late",
      why: "The big picture at the top is what people wait for. When the page loads it first, the page feels much faster.",
      autoFix: { id: "hero_image", label: "Load it first", on: !!ex.hero_image },
      steps: ["Find the biggest picture at the top of your page.", "Make sure it is not set to 'load when scrolled to'.", "Keep that picture under 300 KB. Use a JPG or WebP.", "Publish the page."],
      editorHint: "editor",
    });
  }
  if (failedAudit(speed, "offscreen-images", "efficient-animated-content", "third-party-facades") || settings.lazyEmbeds) {
    const ms = savings(speed, "offscreen-images", "third-party-facades");
    push({
      id: "lazy_embeds", area: "speed", severity: settings.lazyEmbeds ? "good" : "okay", impact: ms || 300, gain: gainWords(ms),
      title: settings.lazyEmbeds ? "Videos and maps wait their turn" : "Videos and maps load before anyone scrolls to them",
      why: "Loading everything at once makes the top of your page appear later. Waiting until someone scrolls down is faster.",
      autoFix: { id: "lazy_embeds", label: "Make them wait", on: settings.lazyEmbeds },
      steps: ["Move videos and maps lower on the page, or", "Use a picture with a play button that opens the video when tapped."],
      editorHint: "editor",
    });
  }
  if (failedAudit(speed, "font-display", "uses-rel-preconnect") || ex.fast_fonts) {
    const ms = savings(speed, "font-display", "uses-rel-preconnect");
    push({
      id: "fast_fonts", area: "speed", severity: ex.fast_fonts ? "good" : "okay", impact: ms || 250, gain: gainWords(ms),
      title: ex.fast_fonts ? "Text shows while fonts load" : "Your text stays invisible while fonts load",
      why: "Some fonts are big. Until they arrive, the browser may show nothing. This makes it show plain text first, then swap in your font.",
      autoFix: { id: "fast_fonts", label: "Show text first", on: !!ex.fast_fonts },
      steps: ["Use fewer fonts. Two is plenty.", "Use fewer weights of each font (regular and bold).", "Publish the page."],
      editorHint: "settings",
    });
  }
  if (failedAudit(speed, "unminified-css", "unminified-javascript", "total-byte-weight", "dom-size", "uses-text-compression") || ex.smaller_html || (html && html.length > 90_000)) {
    const ms = savings(speed, "unminified-css", "unminified-javascript", "uses-text-compression");
    push({
      id: "smaller_html", area: "speed", severity: ex.smaller_html ? "good" : "okay", impact: ms || 200, gain: gainWords(ms) ?? (ex.smaller_html ? undefined : "Makes every page a little smaller"),
      title: ex.smaller_html ? "Your pages are trimmed down" : "Your pages carry extra weight",
      why: "Blank space and old notes in the page's code add up. Trimming them makes the page smaller, so it arrives sooner.",
      autoFix: { id: "smaller_html", label: "Trim my pages", on: !!ex.smaller_html },
      steps: ["Remove sections you no longer use.", "Shorten very long pages, or split them into two pages."],
      editorHint: "editor",
    });
  }
  if (failedAudit(speed, "uses-optimized-images", "uses-responsive-images", "modern-image-formats") || (lcpBad && !heroAudit)) {
    const ms = savings(speed, "uses-optimized-images", "modern-image-formats", "uses-responsive-images");
    push({
      id: "big_images", area: "speed", severity: speed?.lcp?.rating === "poor" ? "poor" : "okay", impact: (ms || 500) + sev(speed?.lcp?.rating ?? "okay"), gain: gainWords(ms),
      title: "Some pictures are bigger than they need to be",
      why: "Large pictures are the most common reason a page feels slow, most of all on a phone with a weak signal. Pictures you upload to Plexo are shrunk for you. Pictures linked from other websites are not.",
      steps: ["Upload pictures to Plexo. Do not link to pictures on other sites.", "Before you upload, make a picture about 1600 pixels wide at most.", "Save photos as JPG or WebP, and logos as PNG or SVG.", "Tools like squoosh.app shrink a picture for free, in your browser."],
      where: where(speed, "largest-contentful-paint-element", "image-size-responsive"),
      editorHint: "media",
    });
  }
  if (failedAudit(speed, "unused-javascript", "render-blocking-resources", "bootup-time", "mainthread-work-breakdown", "third-party-summary")) {
    const ms = savings(speed, "render-blocking-resources", "unused-javascript", "bootup-time", "third-party-summary");
    push({
      id: "extra_code", area: "speed", severity: "okay", impact: ms || 300, gain: gainWords(ms),
      title: "Your page loads extra add-ons it does not need",
      why: "Chat bubbles, trackers and widgets each load their own code. Every one slows the page a little. Plexo's own add-ons already load last, so they do not hold the page up.",
      steps: ["List the add-ons and widgets on your page.", "Remove the ones you do not really need.", "Keep only one of each kind (one chat tool, one tracker)."],
      editorHint: "settings",
    });
  }
  const jumpy = !!speed?.cls && speed.cls.rating !== "good";
  if (jumpy || failedAudit(speed, "unsized-images") || ex.image_sizes) {
    push({
      id: "jumpy_page", area: "speed", severity: ex.image_sizes && !jumpy ? "good" : jumpy ? speed!.cls!.rating : "okay", impact: 200 + (jumpy ? sev(speed!.cls!.rating) : 0),
      title: ex.image_sizes ? "Your pictures hold their place while they load" : "Your page jumps around while it loads",
      why: "When pictures pop in late, the text moves and people tap the wrong thing. Giving each picture its size ahead of time stops that.",
      autoFix: { id: "image_sizes", label: "Stop the jumping", on: !!ex.image_sizes },
      steps: ["Give each picture a fixed size in the editor.", "Avoid banners that slide in above your text."],
      where: where(speed, "layout-shift-elements", "unsized-images"), editorHint: "editor",
    });
  }

  // ── Search ──
  const noDescription = aeoFailed(aeo, "meta_description") || failedAudit(speed, "meta-description");
  if (noDescription || settings.fallbackDescription) {
    push({
      id: "meta_description", area: "seo", severity: settings.fallbackDescription ? "good" : (noDescription ? "okay" : "good"), impact: 120, gain: !settings.fallbackDescription && noDescription ? aeoGain("meta_description") : undefined,
      title: settings.fallbackDescription ? "Your short summary is on" : (noDescription ? "Your site has no short summary for Google" : "Your short summary is on"),
      why: "These are the one or two sentences people read under your site's name in search results. Without them, Google picks random words from your page.",
      autoFix: { id: "meta_description", label: "Write it for me", on: !!settings.fallbackDescription },
      steps: ["Open your home page in the editor.", "Open the page settings and find the box called description.", "Write one or two sentences about what you offer, about 120 to 155 characters.", "Publish the page."],
      editorHint: "settings",
    });
  }
  const noTitle = aeoFailed(aeo, "title") || failedAudit(speed, "document-title");
  if (noTitle || ex.page_title) {
    push({
      id: "page_title", area: "seo", severity: ex.page_title ? "good" : (noTitle ? "okay" : "good"), impact: 130, gain: !ex.page_title && noTitle ? aeoGain("title") : undefined,
      title: ex.page_title ? "Your page has a name in the browser tab" : (noTitle ? "Your page has no name in the browser tab" : "Your page has a name in the browser tab"),
      why: "The page title is the big blue link in Google results and the words on the browser tab. Without one, people see your web address.",
      autoFix: { id: "page_title", label: "Name my page", on: !!ex.page_title },
      steps: ["Open the page settings.", "Find the box called title.", "Write your page name and your business name, like 'Fresh bread | Mama Tee Bakery'.", "Publish the page."],
      editorHint: "settings",
    });
  }
  const noSocial = aeoFailed(aeo, "open_graph");
  if (noSocial || ex.social_tags) {
    push({
      id: "social_tags", area: "seo", severity: ex.social_tags ? "good" : (noSocial ? "okay" : "good"), impact: 70, gain: !ex.social_tags && noSocial ? aeoGain("open_graph") : undefined,
      title: ex.social_tags ? "Shared links show a nice preview" : (noSocial ? "Shared links of your site look plain" : "Shared links show a nice preview"),
      why: "When someone shares your link, hidden labels decide the picture and words they see. WhatsApp, Facebook and LinkedIn all use them.",
      autoFix: { id: "social_tags", label: "Add the preview", on: !!ex.social_tags },
      steps: ["Open the page settings.", "Add a share picture and a short summary.", "Publish the page."],
      editorHint: "settings",
    });
  }
  if (aeoFailed(aeo, "language")) {
    push({
      id: "language", area: "seo", severity: "okay", impact: 60, gain: aeoGain("language"),
      title: "Your page does not say what language it is in",
      why: "Browsers use this for translation, and screen readers use it to pick the right voice.",
      autoFix: { id: "language", label: "Set it to English", on: !!settings.language },
      steps: ["Open the page settings.", "Find the language setting and choose the language your page is written in.", "Publish the page."],
      editorHint: "settings",
    });
  } else if (settings.language) {
    push({ id: "language", area: "seo", severity: "good", impact: 0, title: "Your page language is set", why: "Browsers can translate it and screen readers use the right voice.", autoFix: { id: "language", label: "Set it to English", on: true }, steps: [] });
  }
  if (aeoFailed(aeo, "canonical")) {
    push({
      id: "canonical", area: "seo", severity: "okay", impact: 40, gain: aeoGain("canonical"),
      title: "Your page does not name its main address",
      why: "If the same page opens at two addresses, search engines may split your ranking between them.",
      steps: ["Plexo normally adds this by itself. Publish the page again and run the check again."],
    });
  }
  if (aeoFailed(aeo, "sitemap")) {
    push({
      id: "sitemap", area: "seo", severity: "okay", impact: 70, gain: aeoGain("sitemap"),
      title: "There is no list of your pages for search engines",
      why: "Plexo makes this list for you. If it is missing, a file you uploaded may be replacing it.",
      steps: ["If you uploaded a sitemap.xml file, check that it opens.", "Or delete it, and Plexo will make a fresh one for you."],
    });
  }

  // ── Pictures and reading ──
  const missingAlt = aeoFailed(aeo, "alt_text") || failedAudit(speed, "image-alt");
  if (missingAlt || settings.altFromFilename) {
    push({
      id: "alt_text", area: "accessibility", severity: settings.altFromFilename ? "good" : (missingAlt ? "okay" : "good"), impact: 90, gain: !settings.altFromFilename && missingAlt ? aeoGain("alt_text") : undefined,
      title: settings.altFromFilename ? "Picture descriptions are on" : (missingAlt ? "Some pictures have no description" : "Picture descriptions are on"),
      why: "People who use a screen reader, and AI tools, cannot see your pictures. A short description tells them what is in each one.",
      autoFix: { id: "alt_text", label: "Describe my pictures", on: settings.altFromFilename },
      steps: ["Click a picture in the editor.", "Find the box called alt text or description.", "Type a few words about what the picture shows, like 'Our team at the market stall'.", "Publish the page."],
      where: where(speed, "image-alt"), editorHint: "editor",
    });
  }
  const manual: { audit: string[]; id: string; title: string; why: string; steps: string[]; area: Issue["area"] }[] = [
    { audit: ["heading-order"], id: "heading_order", area: "accessibility", title: "A heading skips a level", why: "Headings are the outline of your page. Jumping from a big heading to a tiny one confuses people who listen to your page.", steps: ["Open the heading shown below.", "Change its level so it is one step smaller than the heading above it.", "Pick headings for their place in the outline, not their size. Use the text size setting for size."] },
    { audit: ["link-name"], id: "link_text", area: "accessibility", title: "Some links have no words", why: "A link with no words, or just 'click here', tells nobody where it goes.", steps: ["Open the link shown below.", "Give it words that say where it goes, like 'See our menu'."] },
    { audit: ["target-size"], id: "tap_targets", area: "accessibility", title: "Some buttons are too small to tap", why: "Small buttons close together are hard to hit with a thumb.", steps: ["Open the button or link shown below.", "Make it bigger, or add more space around it.", "Aim for at least the size of a fingertip."] },
    { audit: ["color-contrast"], id: "contrast", area: "accessibility", title: "Some text is hard to read", why: "Light grey text on a white background, or similar, is hard to read, most of all in sunlight.", steps: ["Open the text shown below.", "Make the text darker, or the background lighter (or the other way around).", "Dark text on a light background is the safest choice."] },
  ];
  for (const m of manual) {
    if (!failedAudit(speed, ...m.audit)) continue;
    push({ id: m.id, area: m.area, severity: "okay", impact: 50, title: m.title, why: m.why, steps: m.steps, where: where(speed, ...m.audit), editorHint: "editor" });
  }

  // ── AI assistants ──
  const sdFail = aeoFailed(aeo, "structured_data");
  if (sdFail || settings.organizationSchema) {
    push({
      id: "structured_data", area: "ai", severity: settings.organizationSchema ? "good" : (sdFail ? "okay" : "good"), impact: 160, gain: !settings.organizationSchema && sdFail ? aeoGain("structured_data") : undefined,
      title: settings.organizationSchema ? "Your business details are on" : (sdFail ? "Search and AI tools cannot tell who you are" : "Your business details are on"),
      why: "A hidden label tells Google and AI assistants your business name, logo, phone, address and opening hours. Then they can name you correctly in answers and show you on maps.",
      autoFix: { id: "organization_schema", label: "Add my business details", on: settings.organizationSchema },
      steps: ["Open the page settings, then the custom code box in the head section.", "Paste a small JSON-LD block that says what kind of business you are, your name and your address.", "Publish the page."],
      editorHint: "settings",
    });
  }
  const products = ctx.facts?.productCount ?? 0;
  if (products > 0 || ex.product_schema) {
    push({
      id: "product_schema", area: "ai", severity: ex.product_schema ? "good" : "okay", impact: 90,
      title: ex.product_schema ? "Google can see your prices and stock" : "Google cannot see your product prices",
      why: "Your product pages do not tell Google the price, picture or whether a product is in stock. With that label, results can show them under your link. It does not change the scores above.",
      autoFix: { id: "product_schema", label: "Show my prices in Google", on: !!ex.product_schema },
      steps: ["Open each product in Commerce.", "Make sure it has a price, a picture and a short description.", "Plexo can then add the label for you with one button."],
    });
  }
  const faqFail = aeoFailed(aeo, "faq_markup");
  if (faqFail || ex.faq_schema) {
    push({
      id: "faq_markup", area: "ai", severity: ex.faq_schema ? "good" : (faqFail ? "okay" : "good"), impact: 60, gain: !ex.faq_schema && faqFail ? aeoGain("faq_markup") : undefined,
      title: ex.faq_schema ? "Your questions and answers are labelled" : (faqFail ? "Your questions and answers are not labelled" : "Your questions and answers are labelled"),
      why: "You have questions on the page. Labelling them helps Google and AI assistants quote your answers.",
      autoFix: { id: "faq_schema", label: "Label my questions", on: !!ex.faq_schema },
      steps: ["Add a FAQ section with the FAQ block in the editor, which labels it for you.", "Each question should be a heading that ends with a question mark, followed by its answer."],
      editorHint: "editor",
    });
  }
  if (aeoFailed(aeo, "llms_txt") || settings.llmsTxt) {
    push({
      id: "llms_txt", area: "ai", severity: settings.llmsTxt ? "good" : (aeoFailed(aeo, "llms_txt") ? "okay" : "good"), impact: 80, gain: !settings.llmsTxt && aeoFailed(aeo, "llms_txt") ? aeoGain("llms_txt") : undefined,
      title: settings.llmsTxt ? "Your guide for AI assistants is on" : (aeoFailed(aeo, "llms_txt") ? "AI assistants have no guide to your site" : "Your guide for AI assistants is on"),
      why: "A small file at your-address/llms.txt gives AI assistants like ChatGPT a quick summary of your site. It also lists your pages.",
      autoFix: { id: "llms_txt", label: "Add the guide", on: settings.llmsTxt },
      steps: ["Create a plain text file called llms.txt.", "Put your site name on the first line after a # sign, then one sentence about it, then a list of your pages as links.", "Upload it so it opens at your-address/llms.txt."],
    });
  }
  if (aeoFailed(aeo, "ai_crawlers")) {
    push({
      id: "ai_crawlers", area: "ai", severity: "okay", impact: 110, gain: aeoGain("ai_crawlers"),
      title: "AI assistants are blocked from reading your site",
      why: "Your site has a robots file that tells AI crawlers to stay out. That means they cannot recommend you. If that is what you want, ignore this.",
      steps: ["Open the robots.txt file on your site.", "Remove the lines that keep out AI robots, like GPTBot.", "Save it and check your-address/robots.txt."],
    });
  } else if (ex.ai_robots || aeo) {
    push({
      id: "ai_robots", area: "ai", severity: "good", impact: 5,
      title: ex.ai_robots ? "AI assistants are told they are welcome" : "You can tell AI assistants they are welcome",
      why: "Today nothing blocks them. This adds a clear welcome for ChatGPT, Claude, Perplexity and Google's AI to your robots file. It does not change your score.",
      autoFix: { id: "ai_robots", label: "Welcome them", on: !!ex.ai_robots },
      steps: ["Open your robots.txt file.", "Add a short block for each AI crawler with the line Allow: /."],
    });
  }
  if (aeoFailed(aeo, "headings")) {
    push({
      id: "headings", area: "ai", severity: "okay", impact: 140, gain: aeoGain("headings"),
      title: "Your headings need tidying",
      why: "Headings are the outline of your page. Search and AI tools use them to understand what each part is about.",
      steps: ["Use exactly one big main heading, usually your page title.", "Use smaller headings for each section underneath it.", "Pick a heading for its place in the outline, not because of its size."],
      editorHint: "editor",
    });
  }
  if (speed && speed.accessibility < 90 && !issues.some((i) => i.area === "accessibility" && i.severity !== "good")) {
    push({
      id: "accessibility", area: "accessibility", severity: "okay", impact: 40,
      title: "Some things are hard to read or tap for some people",
      why: "Low contrast text and tiny buttons are hard for many people, and for anyone using a phone in sunlight.",
      steps: ["Use dark text on light backgrounds, or the other way around.", "Make buttons at least as big as a fingertip.", "Make sure every link says where it goes (not just 'click here')."],
    });
  }

  const order: Record<Rating, number> = { poor: 0, okay: 1, good: 2 };
  return issues.sort((a, b) => order[a.severity] - order[b.severity] || (b.impact ?? 0) - (a.impact ?? 0));
}

/** How many open problems the "Fix everything" button would handle. */
export function fixableCount(issues: Issue[]): number {
  return issues.filter((i) => i.autoFix && !i.autoFix.on && i.severity !== "good").length;
}

/** "Since your last check: speed +12". Only whole, honest differences. */
export function trendWords(history: { speed: number | null; aeo: number | null }[]): string | null {
  if (history.length < 2) return null;
  const a = history[history.length - 2];
  const b = history[history.length - 1];
  const parts: string[] = [];
  const diff = (name: string, x: number | null, y: number | null) => {
    if (x == null || y == null || x === y) return;
    parts.push(`${name} ${y > x ? "went up" : "went down"} ${Math.abs(y - x)} point${Math.abs(y - x) === 1 ? "" : "s"}`);
  };
  diff("Speed", a.speed, b.speed);
  diff("AI visibility", a.aeo, b.aeo);
  if (!parts.length) return "Same as your last check.";
  return `Since your last check: ${parts.join(", and ")}.`;
}
