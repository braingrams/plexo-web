import sanitizeHtmlLib from "sanitize-html";

// Unlike server/sanitizer.ts's sanitizeHtml (a full HTML *document* — the page-builder's
// compileToHTML output, complete with <html>/<head>/<style>), this sanitizes a prose
// *fragment* — Tiptap's rendered output for one blog post. It also renders directly on
// the tenant's real live domain (never an isolated raw-upload origin), so every write
// path that produces BlogPost.contentHtml (the editor's save action, the WordPress
// importer) MUST run through this first — see prisma/schema.prisma's BlogPost comment.
const ALLOWED_TAGS = [
  "p", "br", "hr",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "strong", "em", "u", "s", "code", "mark", "sub", "sup",
  "ul", "ol", "li",
  "blockquote", "pre",
  "a", "img", "figure", "figcaption",
  "table", "thead", "tbody", "tr", "th", "td",
  "iframe",
];

const SAFE_TEXT_ALIGN = /^text-align:\s*(left|right|center|justify)\s*;?$/i;
const DANGEROUS_URL_SCHEMES = ["javascript:", "vbscript:", "data:"];

function stripDangerousUrl(value: string | undefined): string | undefined {
  if (typeof value !== "string") return value;
  const trimmed = value.trim().toLowerCase();
  return DANGEROUS_URL_SCHEMES.some((scheme) => trimmed.startsWith(scheme)) ? undefined : value;
}

export function sanitizeBlogHtml(html: string): string {
  return sanitizeHtmlLib(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ["href", "target", "rel"],
      img: ["src", "alt", "title", "width", "height", "loading"],
      iframe: ["src", "width", "height", "allow", "allowfullscreen", "frameborder", "title"],
      "*": ["style"],
    },
    allowedIframeHostnames: ["www.youtube.com", "player.vimeo.com"],
    allowedSchemesByTag: { img: ["http", "https"], iframe: ["https"] },
    transformTags: {
      "*": (tagName, attribs) => {
        const next = { ...attribs };
        if (typeof next.style === "string" && !SAFE_TEXT_ALIGN.test(next.style.trim())) {
          delete next.style;
        }
        return { tagName, attribs: next };
      },
      a: (tagName, attribs) => {
        const next = { ...attribs };
        const href = stripDangerousUrl(next.href);
        if (!href) {
          delete next.href;
        } else {
          next.href = href;
        }
        if (next.target === "_blank") {
          next.rel = "noopener noreferrer";
        } else {
          delete next.target;
          delete next.rel;
        }
        return { tagName: "a", attribs: next };
      },
      img: (tagName, attribs) => {
        const next = { ...attribs };
        const src = stripDangerousUrl(next.src);
        if (!src) delete next.src;
        else next.src = src;
        next.loading = "lazy";
        return { tagName: "img", attribs: next };
      },
    },
  });
}
