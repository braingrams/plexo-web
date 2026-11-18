/**
 * A readable outline of a page's HTML — headings, paragraphs, list items, buttons/links and
 * pictures, in page order — so SOL can "see" a hand-written or classic page the same way it
 * sees a visual one's sections. Regex-based on purpose (no DOM in the Lambda bundle); it only
 * has to be good enough to read, never to round-trip.
 */

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", mdash: "—", ndash: "–", hellip: "…", copy: "©" };

function decode(s: string): string {
  return s
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, e: string) => {
      const k = e.toLowerCase();
      if (k.startsWith("#x")) return String.fromCodePoint(parseInt(k.slice(2), 16));
      if (k.startsWith("#") && k !== "#39") return String.fromCodePoint(parseInt(k.slice(1), 10));
      return ENTITIES[k] ?? m;
    })
    .replace(/\s+/g, " ")
    .trim();
}

const text = (inner: string) => decode(inner.replace(/<[^>]+>/g, " ")).replace(/\s+([.,!?;:])/g, "$1");
const attr = (tag: string, name: string) => decode(tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"))?.slice(2, 4).find((v) => v !== undefined) ?? "");

export type OutlineLine = { kind: "heading" | "text" | "item" | "link" | "image"; level?: number; text: string; href?: string };

/** The outline as structured lines (at most `maxLines`). */
export function htmlOutlineLines(html: string, maxLines = 200): OutlineLine[] {
  const body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html)
    .replace(/<(script|style|noscript|template|svg|head)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const lines: OutlineLine[] = [];
  const re = /<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>|<(p|li|blockquote|figcaption|td|th|label)\b[^>]*>([\s\S]*?)<\/\3>|(<a\b[^>]*>)([\s\S]*?)<\/a>|(<button\b[^>]*>)([\s\S]*?)<\/button>|(<img\b[^>]*>)/gi;
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = re.exec(body)) && lines.length < maxLines) {
    let line: OutlineLine | null = null;
    if (m[1]) line = { kind: "heading", level: Number(m[1][1]), text: text(m[2]) };
    else if (m[3]) line = { kind: m[3].toLowerCase() === "li" ? "item" : "text", text: text(m[4]) };
    else if (m[5]) line = { kind: "link", text: text(m[6]), href: attr(m[5], "href") || undefined };
    else if (m[7]) line = { kind: "link", text: text(m[8]) };
    else if (m[9]) {
      const alt = attr(m[9], "alt");
      const src = attr(m[9], "src");
      line = { kind: "image", text: alt || "(picture)", href: src || undefined };
    }
    if (!line || !line.text) continue;
    const key = `${line.kind}|${line.text}|${line.href ?? ""}`;
    if (seen.has(key)) continue; // menus repeated for mobile, duplicated buttons
    seen.add(key);
    lines.push(line);
  }
  return lines;
}

/** The outline as compact text, e.g. "# Welcome\n- Fresh bread daily\n[Order now → /store]". Capped at `maxChars`. */
export function htmlOutline(html: string, maxChars = 6000): string {
  const out: string[] = [];
  let size = 0;
  for (const l of htmlOutlineLines(html)) {
    const s =
      l.kind === "heading" ? `${"#".repeat(l.level ?? 2)} ${l.text}`
      : l.kind === "item" ? `- ${l.text}`
      : l.kind === "link" ? `[${l.text}${l.href ? ` → ${l.href}` : ""}]`
      : l.kind === "image" ? `(picture: ${l.text})`
      : l.text;
    if (size + s.length > maxChars) {
      out.push("…");
      break;
    }
    out.push(s);
    size += s.length + 1;
  }
  return out.join("\n");
}
