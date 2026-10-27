import { CustomContentEntry, CustomContentType } from "@/lib/db/customContentEntities";
import { escapeHtmlAttr, insertBeforeBodyEnd, safeJsonLd } from "@/lib/pub/htmlInject";
import { BLOG_SLUG, listBlogItems } from "@/lib/customContent/blogSource";

// Server-side rendering of the content widget (public/plexo-content.js), so the titles,
// descriptions, pictures and links a content admin posts are in the page's HTML for search engines
// (and for anyone with scripts off) — plus schema.org markup (VideoObject / Event / Article) that
// makes videos, events and stories eligible for rich results. The browser script then replaces it
// with the live version (same markup, so nothing jumps) and adds the pop-up players.
//
// The markup below mirrors the script's own render functions; keep the two in step
// (tests/contentSsr.test.ts compares them).

type Item = Record<string, unknown> & { title: string; createdAt?: string };
type Layout = "gallery" | "stories" | "events" | "featured" | "list" | "posts";
const LAYOUTS: readonly Layout[] = ["gallery", "stories", "events", "featured", "list", "posts"];

/** What an empty section says: what it is and that it fills itself. Mirrored in public/plexo-content.js (emptyText). */
export function emptyTextFor(slug: string, layout: Layout): string {
  const s = slug.toLowerCase();
  if (s === "blog" || layout === "posts") return "No posts yet. They'll appear here as soon as they're published.";
  if (/video|gallery|watch/.test(s) || layout === "gallery") return "No videos yet. They'll appear here as soon as they're added.";
  if (/stor/.test(s) || layout === "stories") return "No stories yet. They'll appear here as soon as they're shared.";
  if (/event|happening|workshop|webinar/.test(s) || layout === "events") return "No upcoming events right now. They'll appear here as soon as they're scheduled.";
  return "Nothing here yet. It will appear here as soon as it's added.";
}

const esc = escapeHtmlAttr;
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const safeUrl = (u: unknown): string => {
  const s = str(u);
  return /^(https?:\/\/|\/(?!\/))/i.test(s) ? s : "";
};

type Video = { kind: "youtube" | "vimeo" | "file" | "link"; embed: string; thumb: string };
export function parseVideo(url: unknown): Video | null {
  const u = safeUrl(url);
  if (!u) return null;
  let m = u.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/i);
  if (m) return { kind: "youtube", embed: `https://www.youtube-nocookie.com/embed/${m[1]}?autoplay=1&rel=0`, thumb: `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg` };
  m = u.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
  if (m) return { kind: "vimeo", embed: `https://player.vimeo.com/video/${m[1]}?autoplay=1`, thumb: "" };
  if (/\.(mp4|webm|mov|m4v|ogg)(\?|#|$)/i.test(u)) return { kind: "file", embed: u, thumb: "" };
  return { kind: "link", embed: u, thumb: "" };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "2026-10-30T18:00" or "2026-10-30" → its parts, read as written (no time zone shifting). */
function dateParts(v: unknown): { y: number; mo: number; d: number; h: number | null; mi: number } | null {
  const m = str(v).match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!m) return null;
  return { y: +m[1], mo: +m[2], d: +m[3], h: m[4] === undefined ? null : +m[4], mi: m[5] === undefined ? 0 : +m[5] };
}
function timeLabel(p: NonNullable<ReturnType<typeof dateParts>>): string {
  if (p.h === null) return "";
  const h12 = p.h % 12 === 0 ? 12 : p.h % 12;
  return `${h12}:${String(p.mi).padStart(2, "0")} ${p.h < 12 ? "AM" : "PM"}`;
}

function media(item: Item): { video: Video | null; img: string } {
  const video = parseVideo(item.video);
  return { video, img: safeUrl(item.image) || video?.thumb || "" };
}
function mediaHtml(item: Item, m: ReturnType<typeof media>): string {
  const inner = m.img ? `<img src="${esc(m.img)}" alt="${esc(item.title)}" loading="lazy">` : "";
  return `<div class="plx-c-media${m.img ? "" : " plx-c-media--empty"}">${inner}${m.video ? '<span class="plx-c-play"></span>' : ""}</div>`;
}

function card(item: Item, i: number, layout: Layout): string {
  const m = media(item);
  const story = layout === "stories";
  const desc = str(item.description);
  return `<button type="button" class="plx-c-card" data-i="${i}">${mediaHtml(item, m)}<div class="plx-c-body"><h3 class="plx-c-title">${esc(item.title)}</h3>` +
    (story && str(item.author) ? `<p class="plx-c-meta">Shared by ${esc(str(item.author))}</p>` : "") +
    (desc ? `<p class="plx-c-desc">${esc(desc)}</p>` : "") +
    (story ? '<span class="plx-c-more">Read story</span>' : "") + "</div></button>";
}

function grid(items: Item[], layout: Layout, cols: number): string {
  return `<div class="plx-c-grid" style="--plx-c-cols:${cols}">${items.map((it, i) => card(it, i, layout)).join("")}</div>`;
}

function featured(items: Item[]): string {
  const it = items[0];
  const m = media(it);
  const desc = str(it.description);
  return `<div class="plx-c-feature"><button type="button" class="plx-c-media${m.img ? "" : " plx-c-media--empty"}" data-i="0" aria-label="Open ${esc(it.title)}">` +
    (m.img ? `<img src="${esc(m.img)}" alt="${esc(it.title)}">` : "") + (m.video ? '<span class="plx-c-play"></span>' : "") + "</button>" +
    `<div><h3 class="plx-c-title">${esc(it.title)}</h3>` + (desc ? `<p class="plx-c-desc">${esc(desc)}</p>` : "") +
    `<span class="plx-c-rule"></span><button type="button" class="plx-c-link" data-i="0">${m.video ? "Watch Now" : "Read more"} &nbsp;&rarr;</button></div></div>`;
}

function events(items: Item[]): string {
  return '<div class="plx-c-events">' + items.map((it) => {
    const p = dateParts(it.date);
    const link = safeUrl(it.link), loc = str(it.location), desc = str(it.description), img = safeUrl(it.image);
    const when = p ? `${WEEKDAYS[new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay()]}, ${MONTHS_LONG[p.mo - 1]} ${p.d}, ${p.y}` : "";
    const meta = [when, p ? timeLabel(p) : "", loc].filter(Boolean).join(" · ");
    return `<article class="plx-c-event"><div class="plx-c-date">${p ? `<span>${MONTHS[p.mo - 1]}</span><b>${p.d}</b>` : "<b>&bull;</b>"}</div>` +
      `<div><h3 class="plx-c-title">${esc(it.title)}</h3>` + (meta ? `<p class="plx-c-meta">${esc(meta)}</p>` : "") +
      (desc ? `<p class="plx-c-desc" style="-webkit-line-clamp:unset;display:block">${esc(desc)}</p>` : "") +
      (img ? `<img class="plx-c-event-img" src="${esc(img)}" alt="${esc(it.title)}" loading="lazy">` : "") + "</div>" +
      (link ? `<div class="plx-c-event-cta"><a class="plx-c-btn" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Learn more</a></div>` : "") + "</article>";
  }).join("") + "</div>";
}

function list(items: Item[]): string {
  return '<ul class="plx-c-list">' + items.map((it) => {
    const desc = str(it.description);
    return `<li><strong>${esc(it.title)}</strong>${desc ? `<p class="plx-c-desc">${esc(desc)}</p>` : ""}</li>`;
  }).join("") + "</ul>";
}

function posts(items: Item[], cols: number): string {
  return `<div class="plx-c-grid" style="--plx-c-cols:${cols}">` + items.map((it) => {
    const link = safeUrl(it.link), img = safeUrl(it.image), date = str(it.dateLabel);
    const alt = str(it.imageAlt) || it.title;
    return `<a class="plx-c-card plx-c-post" href="${esc(link || "/blog")}"><div class="plx-c-media${img ? "" : " plx-c-media--empty"}">${img ? `<img src="${esc(img)}" alt="${esc(alt)}" loading="lazy">` : ""}</div>` +
      `<div class="plx-c-body"><h3 class="plx-c-title">${esc(it.title)}</h3>${date ? `<p class="plx-c-meta">${esc(date)}</p>` : ""}</div></a>`;
  }).join("") + "</div>";
}

export function renderContentLayout(items: Item[], layout: Layout, cols: number, slug = ""): string {
  if (!items.length) return `<div class="plx-c-empty">${esc(emptyTextFor(slug, layout))}</div>`;
  if (layout === "posts") return posts(items, cols);
  if (layout === "events") return events(items);
  if (layout === "featured") return featured(items);
  if (layout === "list") return list(items);
  return grid(items, layout, cols);
}

/** Past events drop out, soonest first — same rule the browser script applies (it re-checks with the visitor's clock). */
export function upcomingEvents(items: Item[], now = new Date()): Item[] {
  // The server doesn't know the visitor's time zone, so it keeps anything that could still be today somewhere.
  const cutoff = new Date(now.getTime() - 24 * 3600 * 1000).toISOString().slice(0, 16);
  const key = (it: Item) => {
    const v = str(it.date);
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T23:59` : v.slice(0, 16);
  };
  return items
    .filter((it) => !dateParts(it.date) || key(it) >= cutoff)
    .sort((a, b) => (dateParts(a.date) ? key(a) : "9999").localeCompare(dateParts(b.date) ? key(b) : "9999"));
}

function jsonLdFor(items: Item[], layout: Layout, origin: string): unknown[] {
  const abs = (u: string) => (u.startsWith("/") ? origin + u : u);
  const out: unknown[] = [];
  for (const it of items) {
    const desc = str(it.description);
    const img = safeUrl(it.image);
    const m = media(it);
    if (layout === "events") {
      const p = dateParts(it.date);
      if (!p) continue;
      const loc = str(it.location);
      out.push({
        "@context": "https://schema.org", "@type": "Event", name: it.title,
        startDate: str(it.date).slice(0, p.h === null ? 10 : 16),
        eventStatus: "https://schema.org/EventScheduled",
        ...(desc ? { description: desc } : {}),
        ...(img ? { image: [abs(img)] } : {}),
        ...(loc ? { location: { "@type": "Place", name: loc, address: loc } } : {}),
        ...(safeUrl(it.link) ? { url: abs(safeUrl(it.link)) } : {}),
      });
    } else if (m.video && m.img && m.video.kind !== "link") {
      out.push({
        "@context": "https://schema.org", "@type": "VideoObject", name: it.title,
        description: desc || it.title, thumbnailUrl: [abs(m.img)],
        uploadDate: (it.createdAt ?? new Date().toISOString()).slice(0, 10),
        ...(m.video.kind === "file" ? { contentUrl: abs(m.video.embed) } : { embedUrl: m.video.embed.replace(/[?&]autoplay=1(&rel=0)?/, "") }),
      });
    } else if (layout === "stories") {
      const author = str(it.author);
      out.push({
        "@context": "https://schema.org", "@type": "Article", headline: it.title.slice(0, 110),
        ...(desc ? { description: desc } : {}),
        ...(m.img ? { image: [abs(m.img)] } : {}),
        ...(author ? { author: { "@type": "Person", name: author } } : {}),
        datePublished: (it.createdAt ?? new Date().toISOString()).slice(0, 10),
      });
    }
  }
  return out;
}

const MARKER_RE = /<div\b([^>]*?\bdata-plexo-content=(["'])([^"']*)\2[^>]*)>\s*<\/div>/gi;
const attr = (tag: string, name: string): string => tag.match(new RegExp(`\\b${name}=(["'])(.*?)\\1`, "i"))?.[2] ?? "";

/**
 * Fills every empty content marker on a page with its published items (and adds schema.org markup).
 * Falls back to the page untouched if anything goes wrong — the browser script still fills the markers.
 */
export async function renderContentBlocks(html: string, templateId: string, origin: string): Promise<string> {
  const markers = [...html.matchAll(MARKER_RE)];
  if (markers.length === 0) return html;
  try {
    const { data: types } = await CustomContentType.query.primary({ templateId }).go({ pages: "all" });
    const cache = new Map<string, Promise<Item[]>>();
    const load = (slug: string): Promise<Item[]> => {
      const type = types.find((t) => t.slug === slug);
      if (!type && slug === BLOG_SLUG) return listBlogItems(templateId, 48).then((list) => list.map((b) => ({ ...b } as unknown as Item)));
      if (!type) return Promise.resolve([]);
      if (!cache.has(slug)) {
        cache.set(slug, CustomContentEntry.query.primary({ contentTypeId: type.id }).go({ pages: "all" }).then(({ data }) =>
          data
            .filter((e) => e.status === "PUBLISHED")
            .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
            .slice(0, 200)
            .map((e) => {
              const d = (e.data && typeof e.data === "object" ? e.data : {}) as Record<string, unknown>;
              return { ...d, title: str(d.title) || str(d.name) || "Untitled", createdAt: e.createdAt } as Item;
            }),
        ));
      }
      return cache.get(slug)!;
    };

    const ld: unknown[] = [];
    const rendered = await Promise.all(markers.map(async (m) => {
      const tag = m[1];
      const slug = m[3].trim().toLowerCase();
      let layout = (attr(tag, "data-plexo-content-layout") || "gallery") as Layout;
      if (!LAYOUTS.includes(layout)) layout = "list";
      const limit = parseInt(attr(tag, "data-plexo-content-limit"), 10);
      const cols = Math.min(4, Math.max(1, parseInt(attr(tag, "data-plexo-content-columns"), 10) || 3));
      let items = await load(slug);
      if (layout === "events") items = upcomingEvents(items);
      if (limit > 0) items = items.slice(0, limit);
      ld.push(...jsonLdFor(items, layout, origin));
      return `<div ${tag.trim()} data-plexo-content-ssr="1">${renderContentLayout(items, layout, cols, slug)}</div>`;
    }));

    let i = 0;
    let out = html.replace(MARKER_RE, () => rendered[i++]);
    // Stylesheet in <head> so the server-rendered content is styled before the script runs.
    const link = `<link rel="stylesheet" href="/plexo-content.css?v=${process.env.ASSET_VERSION ?? "dev"}">`;
    out = /<\/head\s*>/i.test(out) ? out.replace(/<\/head\s*>/i, `${link}</head>`) : link + out;
    if (ld.length) out = insertBeforeBodyEnd(out, `<script type="application/ld+json">${safeJsonLd(ld)}</script>`);
    return out;
  } catch (err) {
    console.error("[content] server render failed; the page falls back to the browser script:", err);
    return html;
  }
}
