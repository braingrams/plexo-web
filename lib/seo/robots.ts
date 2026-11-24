/**
 * The site's robots.txt: the short file that tells search engines which parts of a site they may read.
 *
 * Three ways to set it, from simple to advanced, all producing a safe file:
 *   default  everything is open (Plexo's own file, plus the optional AI rules and the sitemap line)
 *   folders  everything is open except a few folders the owner picks
 *   custom   the owner writes the file; it is checked line by line, and the sitemap line is always there
 * A site switched to "keep out of search" always wins and blocks everything. Pure and browser-safe.
 */

export type RobotsMode = "default" | "folders" | "custom";
export type RobotsConfig = { mode: RobotsMode; folders: string[]; custom: string };

export const DEFAULT_ROBOTS: RobotsConfig = { mode: "default", folders: [], custom: "" };
export const MAX_ROBOTS_CHARS = 5000;
const MAX_LINES = 200;
const MAX_FOLDERS = 30;

export function parseRobotsConfig(raw: unknown): RobotsConfig {
  let v: unknown = raw;
  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw);
    } catch {
      return { ...DEFAULT_ROBOTS };
    }
  }
  if (!v || typeof v !== "object") return { ...DEFAULT_ROBOTS };
  const o = v as Record<string, unknown>;
  const mode: RobotsMode = o.mode === "folders" || o.mode === "custom" ? o.mode : "default";
  const folders = Array.isArray(o.folders) ? o.folders.map((f) => (typeof f === "string" ? checkFolder(f) : null)).filter((f): f is string => !!f && f !== "/").slice(0, MAX_FOLDERS) : [];
  return { mode, folders: [...new Set(folders)], custom: typeof o.custom === "string" ? o.custom.slice(0, MAX_ROBOTS_CHARS) : "" };
}

/** "private", "/private" and "/private/" all mean the same folder; anything with spaces, quotes or wildcards is refused. */
export function checkFolder(input: string): string | null {
  const t = input.trim();
  if (!t || t.length > 120 || /[\s<>"'#*$?]/.test(t)) return null;
  let p = t.startsWith("/") ? t : `/${t}`;
  p = p.replace(/\/{2,}/g, "/");
  return p.endsWith("/") ? p : `${p}/`;
}

export type RobotsCheck = { ok: boolean; text: string; problems: string[]; warnings: string[] };

const DIRECTIVE = /^(user-agent|allow|disallow|crawl-delay|sitemap):\s*(.*)$/i;

/** Checks a hand-written file line by line. Problems stop it being saved; warnings are for "are you sure". */
export function checkRobotsText(input: string): RobotsCheck {
  const text = (input ?? "").replace(/\r\n?/g, "\n").trim();
  const problems: string[] = [];
  const warnings: string[] = [];
  if (text.length > MAX_ROBOTS_CHARS) return { ok: false, text, problems: ["That is too long. Keep the file under 5,000 characters."], warnings };
  const lines = text.split("\n");
  if (lines.length > MAX_LINES) return { ok: false, text, problems: [`Please keep it under ${MAX_LINES} lines.`], warnings };
  let agent: string | null = null;
  lines.forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith("#")) return;
    const m = DIRECTIVE.exec(t);
    if (!m) {
      problems.push(`Line ${i + 1} isn't something a robots file understands: "${t.slice(0, 50)}". Use User-agent, Allow, Disallow, Crawl-delay or Sitemap.`);
      return;
    }
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      agent = value;
      if (!value) problems.push(`Line ${i + 1}: User-agent needs a name, like * for everyone.`);
    } else if (key === "sitemap") {
      if (!/^https:\/\/[^\s]+$/i.test(value)) problems.push(`Line ${i + 1}: the Sitemap address must start with https://.`);
    } else {
      if (agent === null) problems.push(`Line ${i + 1}: put a User-agent line first, so the rule knows who it is for.`);
      if (key === "disallow" && value === "/" && agent === "*") warnings.push("This hides your whole site from search engines. Only keep it if that is what you want.");
      if (key === "disallow" && /sitemap\.xml/i.test(value)) warnings.push("This stops search engines reading your sitemap, which helps them find your pages.");
      if (key === "crawl-delay" && !/^\d{1,3}$/.test(value)) problems.push(`Line ${i + 1}: Crawl-delay should be a number of seconds.`);
    }
  });
  if (!lines.some((l) => DIRECTIVE.test(l.trim()))) problems.push("Add at least one line, for example: User-agent: *");
  return { ok: problems.length === 0, text, problems, warnings: [...new Set(warnings)] };
}

/** What the site serves at /robots.txt. */
export function buildRobotsTxt(host: string, siteNoindex: boolean, config: RobotsConfig = DEFAULT_ROBOTS, opts: { aiRules?: string } = {}): string {
  if (siteNoindex) return "User-agent: *\nDisallow: /\n";
  const sitemap = `Sitemap: https://${host}/sitemap.xml`;
  const ai = opts.aiRules ? `${opts.aiRules.trimEnd()}\n\n` : "";
  if (config.mode === "folders" && config.folders.length) {
    return `User-agent: *\nAllow: /\n${config.folders.map((f) => `Disallow: ${f}`).join("\n")}\n\n${ai}${sitemap}\n`;
  }
  if (config.mode === "custom") {
    const c = checkRobotsText(config.custom);
    if (c.ok) return /^sitemap:/im.test(c.text) ? `${c.text}\n` : `${c.text}\n\n${sitemap}\n`;
  }
  return `User-agent: *\nAllow: /\n\n${ai}${sitemap}\n`;
}
