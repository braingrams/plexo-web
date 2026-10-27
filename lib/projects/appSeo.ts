import { escapeHtmlAttr } from "@/lib/pub/htmlInject";

// An app's search & sharing settings (Settings → Search & sharing): how it appears in Google
// results and link previews, its browser-tab icon, and the ownership tags Google Search Console
// and Bing Webmaster Tools ask for. Stored on AppSettings.seo and written into every page of
// the app as it's served (lib/projects/serve.ts) — nothing for the owner to paste into code.

export type AppSeo = {
  title?: string;
  description?: string;
  imageUrl?: string;
  faviconUrl?: string;
  googleVerification?: string;
  bingVerification?: string;
};

export const SEO_LIMITS = { title: 70, description: 200 } as const;

/** Thrown for a value the owner can fix; the message says how. */
export class SeoInputError extends Error {}

/** The verification code from whatever the owner pasted — the code itself, or the whole
 *  `<meta name="google-site-verification" content="…">` tag the console shows. */
function verificationCode(raw: string, label: string): string | undefined {
  const value = raw.trim();
  if (!value) return undefined;
  const fromTag = value.match(/content\s*=\s*["']([^"']+)["']/i)?.[1] ?? value;
  const code = fromTag.trim();
  if (!/^[A-Za-z0-9_\-.:=+/]{6,200}$/.test(code)) throw new SeoInputError(`That ${label} code doesn't look right. Paste the code (or the whole meta tag) exactly as it's shown.`);
  return code;
}

function httpsUrl(raw: string, label: string): string | undefined {
  const value = raw.trim();
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") throw new Error();
    return url.toString();
  } catch {
    throw new SeoInputError(`The ${label} needs to be a full https:// link — or upload one instead.`);
  }
}

/** Checks and tidies what the settings form sent. Empty fields are dropped (back to default). */
export function normalizeSeo(input: Record<string, unknown>): AppSeo {
  const str = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : "");
  const title = str("title").trim().replace(/\s+/g, " ");
  const description = str("description").trim().replace(/\s+/g, " ");
  if (title.length > SEO_LIMITS.title) throw new SeoInputError(`Keep the title to ${SEO_LIMITS.title} characters or fewer — search results cut off anything longer.`);
  if (description.length > SEO_LIMITS.description) throw new SeoInputError(`Keep the description to ${SEO_LIMITS.description} characters or fewer.`);
  const seo: AppSeo = {
    title: title || undefined,
    description: description || undefined,
    imageUrl: httpsUrl(str("imageUrl"), "sharing image"),
    faviconUrl: httpsUrl(str("faviconUrl"), "browser-tab icon"),
    googleVerification: verificationCode(str("googleVerification"), "Google"),
    bingVerification: verificationCode(str("bingVerification"), "Bing"),
  };
  return Object.fromEntries(Object.entries(seo).filter(([, v]) => v !== undefined)) as AppSeo;
}

const TAG_PATTERNS = {
  title: /<title\b[^>]*>[\s\S]*?<\/title\s*>/gi,
  description: /<meta\b[^>]*\bname=["']?description["']?[^>]*>/gi,
  og: (prop: string) => new RegExp(`<meta\\b[^>]*\\bproperty=["']?og:${prop}["']?[^>]*>`, "gi"),
  twitter: (name: string) => new RegExp(`<meta\\b[^>]*\\bname=["']?twitter:${name}["']?[^>]*>`, "gi"),
  icon: /<link\b[^>]*\brel=["']?(?:shortcut )?icon["']?[^>]*>/gi,
};

/** Writes the owner's settings into a page's <head>. The owner's choices replace the app's own
 *  defaults (the title and icon in its index.html); settings left empty leave the app as built. */
export function injectAppSeo(html: string, seo: AppSeo | null | undefined, pageUrl: string): string {
  if (!seo || !Object.keys(seo).length) return html;
  const headEnd = html.search(/<\/head\s*>/i);
  if (headEnd === -1) return html;
  let head = html.slice(0, headEnd);
  const rest = html.slice(headEnd);
  const tags: string[] = [];
  const meta = (attr: "name" | "property", key: string, content: string) => `<meta ${attr}="${key}" content="${escapeHtmlAttr(content)}">`;

  if (seo.title) {
    head = head.replace(TAG_PATTERNS.title, "").replace(TAG_PATTERNS.og("title"), "").replace(TAG_PATTERNS.twitter("title"), "");
    tags.push(`<title>${escapeHtmlAttr(seo.title)}</title>`, meta("property", "og:title", seo.title), meta("name", "twitter:title", seo.title));
  }
  if (seo.description) {
    head = head.replace(TAG_PATTERNS.description, "").replace(TAG_PATTERNS.og("description"), "").replace(TAG_PATTERNS.twitter("description"), "");
    tags.push(meta("name", "description", seo.description), meta("property", "og:description", seo.description), meta("name", "twitter:description", seo.description));
  }
  if (seo.imageUrl) {
    head = head.replace(TAG_PATTERNS.og("image"), "").replace(TAG_PATTERNS.twitter("image"), "").replace(TAG_PATTERNS.twitter("card"), "");
    tags.push(meta("property", "og:image", seo.imageUrl), meta("name", "twitter:image", seo.imageUrl), meta("name", "twitter:card", "summary_large_image"));
  }
  if (seo.title || seo.description || seo.imageUrl) {
    if (!TAG_PATTERNS.og("type").test(head)) tags.push(meta("property", "og:type", "website"));
    head = head.replace(TAG_PATTERNS.og("url"), "");
    tags.push(meta("property", "og:url", pageUrl));
  }
  if (seo.faviconUrl) {
    head = head.replace(TAG_PATTERNS.icon, "");
    tags.push(`<link rel="icon" href="${escapeHtmlAttr(seo.faviconUrl)}">`);
  }
  if (seo.googleVerification) tags.push(meta("name", "google-site-verification", seo.googleVerification));
  if (seo.bingVerification) tags.push(meta("name", "msvalidate.01", seo.bingVerification));
  return head + tags.join("") + rest;
}
