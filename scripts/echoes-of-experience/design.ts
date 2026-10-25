/**
 * The Echoes of Experience by Tolu site, as Plexo V2 (visual editor) pages. Pure: builds design JSON only, no database,
 * so it can be compiled and screenshotted locally. build.ts puts it in the owner's account.
 *
 * Measurements are the mockup's at 1024px wide (a desktop page in Plexo starts at 1024). Everything is plain, editable
 * elements, so the owner can change any of it in the visual editor.
 */
import type { DocumentNode, PageDefinition } from "@charisol/plexo-sdk/v2/compile";

export const C = {
  cream: "#f8f1e8",
  creamDeep: "#f1e8da",
  ink: "#3a3224",
  body: "#4d4634",
  muted: "#7b715f",
  olive: "#5d6442",
  oliveDark: "#4b5235",
  rust: "#8b4a24",
  line: "#cdbfa8",
  card: "#fdfaf5",
} as const;

// Chosen by rendering the mockup's own text next to ~100 candidates and measuring widths against it: Cormorant Garamond
// (600 for headings, 500 for text) for the serif, Oooh Baby (thin pen script, plain A, long-tailed L — set side by side
// with the mockup's "A Lasting Legacy." it is the closest; Sacramento was visibly off) for the cursive. Cormorant
// Garamond is in the editor's font list; Oooh Baby is added to the site as a custom font (self-hosted, OFL licence).
export const SERIF = "Cormorant Garamond";

// One fluid layout: content spans the whole screen with side margins that are a share of its width (63px at the
// mockup's 1024px, proportionally more on bigger screens) — never a fixed column centred in empty space. The header,
// hero text, every section and the footer use the same margins, so everything lines up at any width. A very large
// screen is capped so lines and cards don't stretch absurdly.
const SIDE = "6.15%";
const MAX = "1760px";
// The hero photo keeps the mockup's scale: it grows with the screen up to this width, then stops (anchored right, its
// left edge fading into the page) instead of zooming in on very wide screens. The fade layer is exactly as wide.
const PHOTO_W = "min(100%, 1180px)";
export const SCRIPT = "Oooh Baby";

export type SiteImages = {
  logo: string;
  hero: string;
  heroMobile: string;
  cta: string;
  leaf: string;
  videoThumb: string;
  favicon: string;
  og: string;
  /** The cursive font file (woff2), uploaded with the site. */
  scriptFont: string;
  blog: { listening: string; everyday: string; resilience: string };
};

/** On a plan that allows only one page, Contact lives on Home (#contact) and there is no separate Privacy page. */
let multiPage = true;
export const setMultiPage = (v: boolean) => { multiPage = v; };
const contactHref = () => (multiPage ? "/contact" : "#contact");

export const FACEBOOK = "https://facebook.com/";
export const INSTAGRAM = "https://instagram.com/";

// ---------------------------------------------------------------- tiny node DSL

let seq = 0;
const nid = (p: string) => `${p}-${++seq}`;

type Styles = DocumentNode["styles"];
type Opts = {
  name?: string;
  content?: string;
  props?: Record<string, unknown>;
  styles?: Styles;
  children?: DocumentNode[];
  tablet?: Partial<Styles>;
  mobile?: Partial<Styles>;
  hideOn?: ("desktop" | "tablet" | "mobile")[];
};

function node(type: DocumentNode["type"], o: Opts = {}): DocumentNode {
  const n: DocumentNode = {
    id: nid(type),
    type,
    name: o.name ?? type,
    styles: (o.styles ?? {}) as Styles,
    ...(o.content !== undefined ? { content: o.content } : {}),
    ...(o.props ? { props: o.props } : {}),
    ...(o.children ? { children: o.children } : {}),
  };
  if (o.tablet || o.mobile) n.responsive = { ...(o.tablet ? { tablet: o.tablet } : {}), ...(o.mobile ? { mobile: o.mobile } : {}) };
  if (o.hideOn?.length) {
    n.responsiveVisibility = {
      hideOnDesktop: o.hideOn.includes("desktop"),
      hideOnTablet: o.hideOn.includes("tablet"),
      hideOnMobile: o.hideOn.includes("mobile"),
    };
  }
  return n;
}

const flex = (direction: "row" | "column", extra: Styles = {}): Styles => ({
  layoutMode: "flow",
  display: "flex",
  flexDirection: direction,
  width: "100%",
  gap: "0px",
  ...extra,
});

const box = (name: string, direction: "row" | "column", styles: Styles, children: DocumentNode[], more: Partial<Opts> = {}) =>
  node("container", { name, styles: flex(direction, styles), children, ...more });

/** A full-width section with an inner container of the given max width. */
function section(name: string, children: DocumentNode[], o: { bg?: string; image?: string; maxWidth?: string; padY?: string; padX?: string; minHeight?: string; id?: string; bgPos?: string; tabletPadX?: string; mobilePadX?: string; pinned?: boolean } = {}): DocumentNode {
  const reading = o.maxWidth !== undefined && parseInt(o.maxWidth, 10) < 1000; // a narrow reading column keeps its own width
  const inner = box("Container", "column", { maxWidth: o.maxWidth ?? MAX, margin: "0 auto", paddingLeft: o.padX ?? (reading ? "0px" : SIDE), paddingRight: o.padX ?? (reading ? "0px" : SIDE) }, children, {
    tablet: { paddingLeft: o.tabletPadX ?? "32px", paddingRight: o.tabletPadX ?? "32px" },
    mobile: { paddingLeft: o.mobilePadX ?? "20px", paddingRight: o.mobilePadX ?? "20px" },
  });
  return node("section", {
    name,
    props: o.id ? { htmlId: o.id } : undefined,
    styles: {
      layoutMode: "flow",
      display: "flex",
      flexDirection: "column",
      position: "relative",
      width: "100%",
      paddingTop: o.padY ?? "0px",
      paddingBottom: o.padY ?? "0px",
      paddingLeft: "0px",
      paddingRight: "0px",
      backgroundColor: o.bg ?? C.cream,
      ...(o.image ? { backgroundImage: o.image, backgroundSize: "cover", backgroundPosition: o.bgPos ?? "center" } : {}),
      ...(o.minHeight ? { minHeight: o.minHeight } : {}),
      ...(o.pinned ? { pinned: true } : {}),
    },
    children: [inner],
  });
}

const text = (type: "heading" | "paragraph", content: string, styles: Styles, o: Partial<Opts> & { level?: number } = {}) =>
  node(type, { content, name: o.name ?? (type === "heading" ? "Heading" : "Text"), props: type === "heading" ? { level: o.level ?? 2 } : undefined, styles: { textColor: C.ink, fontFamily: SERIF, ...styles }, tablet: o.tablet, mobile: o.mobile, hideOn: o.hideOn });

const rule = (extra: Styles = {}) => node("container", { name: "Rule", styles: { width: "34px", height: "1px", backgroundColor: C.ink, opacity: 0.55, ...extra } });

const pill = (label: string, href: string, styles: Styles = {}, o: Partial<Opts> = {}) =>
  node("button", {
    name: label,
    content: label,
    props: { href, variant: "primary" },
    styles: {
      backgroundColor: C.olive,
      textColor: "#f7f2e6",
      fontFamily: SERIF,
      fontSize: "20px",
      fontWeight: "500",
      borderRadius: "999px",
      borderWidth: "0px",
      paddingTop: "10px",
      paddingBottom: "10px",
      paddingLeft: "34px",
      paddingRight: "34px",
      cursor: "pointer",
      hoverEffect: "lift",
      ...styles,
    },
    tablet: o.tablet,
    mobile: o.mobile,
  });

/** A quiet text link ("View All Videos →"). */
const textLink = (label: string, href: string, fontSize = "14px", extra: Styles = {}) =>
  node("button", {
    name: label,
    content: label,
    props: { href, variant: "ghost" },
    styles: { backgroundColor: "transparent", borderWidth: "0px", textColor: C.body, fontFamily: SERIF, fontSize, fontWeight: "500", padding: "0px", cursor: "pointer", whiteSpace: "nowrap", ...extra },
  });

// ---------------------------------------------------------------- header, footer, CTA, titles

const NAV = [
  { label: "Home", href: "/" },
  { label: "Stories", href: "/stories" },
  { label: "Videos", href: "/videos" },
  { label: "Blog", href: "/blog" },
  { label: "Happenings", href: "/happenings" },
];

const socialEl = (size: number, color: string, name = "Social links") =>
  node("social", {
    name,
    props: { links: [{ network: "facebook", url: FACEBOOK }, { network: "instagram", url: INSTAGRAM }], size, shape: "plain", colorMode: "mono" },
    styles: { width: "auto", textColor: color, gap: "24px", opacity: 1 },
  });

/** Logo + menu + social + Contact. `overlay` = it sits on top of the home page's photo. */
function headerBar(img: SiteImages, overlay: boolean): DocumentNode {
  const logo = node("image", {
    name: "Logo",
    props: { src: img.logo, alt: "Echoes of Experience by Tolu — real stories, real wisdom, timeless impact", href: "/" },
    styles: { width: overlay ? "262px" : "150px", height: overlay ? "262px" : "150px", flexShrink: 0, overflow: "visible" },
    tablet: { width: overlay ? "190px" : "130px", height: overlay ? "190px" : "130px" },
    mobile: { width: "120px", height: "120px" },
  });
  const nav = node("menu", {
    name: "Menu",
    props: { links: NAV, layout: "horizontal", mobile: "hamburger" },
    styles: { width: "auto", gap: "36px", marginRight: overlay ? "16px" : "0px", fontFamily: SERIF, fontSize: "16px", fontWeight: "500", textColor: C.ink, letterSpacing: "0.2px" },
  });
  const right = box(
    "Menu and Contact",
    "row",
    { width: "auto", alignItems: "center", gap: "29px", marginTop: overlay ? "40px" : "0px", justifyContent: "flex-end" },
    [
      nav,
      node("container", { name: "Social", styles: flex("row", { width: "auto" }), children: [socialEl(30, "#16130d")], hideOn: ["mobile"] }),
      pill("Contact", contactHref(), { fontSize: "16px", borderRadius: "6px", paddingTop: "6px", paddingBottom: "6px", paddingLeft: "19px", paddingRight: "19px", width: "92px", height: "33px", justifyContent: "center", alignItems: "center" }, { mobile: {} }),
    ],
    { tablet: { gap: "20px" }, mobile: { gap: "14px" } },
  );
  return box("Header", "row", { position: "relative", zIndex: 1, maxWidth: MAX, margin: "0 auto", alignItems: "flex-start", justifyContent: "space-between", paddingTop: overlay ? "0px" : "10px", paddingLeft: "4.4%", paddingRight: "2.7%", gap: "24px" }, [logo, right], {
    tablet: { paddingLeft: "24px", paddingRight: "24px" },
    mobile: { paddingLeft: "16px", paddingRight: "16px", alignItems: "center" },
  });
}

/** Every page except Home: cream header with a smaller logo. */
export function headerSection(img: SiteImages): DocumentNode {
  return node("section", {
    name: "Header",
    styles: { layoutMode: "flow", display: "flex", flexDirection: "column", position: "relative", width: "100%", backgroundColor: C.cream, paddingBottom: "6px" },
    children: [headerBar(img, false)],
  });
}

export function footerSection(img: SiteImages): DocumentNode {
  const left = text("paragraph", "© 2026 Echoes of Experience by Tolu. All rights reserved.", { fontSize: "14px", fontWeight: "500", textColor: C.body }, { name: "Copyright" });
  const links = box(
    "Footer links",
    "row",
    { width: "auto", alignItems: "center", gap: "18px" },
    [
      socialEl(24, C.ink, "Social links"),
      node("container", { name: "Divider", styles: { width: "1px", height: "22px", backgroundColor: C.muted, opacity: 0.6 } }),
      ...(multiPage ? [textLink("Privacy", "/privacy", "14px")] : []),
      textLink("Contact", contactHref(), "14px"),
    ],
    { mobile: { flexWrap: "wrap" } },
  );
  const leaf = node("image", {
    name: "Decorative leaf",
    props: { src: img.leaf, alt: "", ariaHidden: true },
    styles: { position: "absolute", x: 0, y: 0, width: "60px", height: "50px", pointerEvents: "none", horizontalConstraint: "right", verticalConstraint: "bottom", rightOffset: 20, bottomOffset: 18, zIndex: 1 },
    hideOn: ["mobile"],
  });
  return node("section", {
    name: "Footer",
    styles: { layoutMode: "flow", display: "flex", flexDirection: "column", position: "relative", width: "100%", backgroundColor: C.cream, paddingTop: "30px", paddingBottom: "30px", minHeight: "81px" },
    children: [
      box(
        "Footer row",
        "row",
        { alignItems: "center", justifyContent: "space-between", maxWidth: MAX, margin: "0 auto", paddingLeft: SIDE, paddingRight: "9.8%", gap: "20px", flexWrap: "wrap" },
        [left, links],
        { tablet: { paddingLeft: "32px", paddingRight: "90px" }, mobile: { paddingLeft: "20px", paddingRight: "20px", flexDirection: "column", alignItems: "flex-start" } },
      ),
      leaf,
    ],
  });
}

export function ctaSection(img: SiteImages): DocumentNode {
  return node("section", {
    name: "Share a story",
    styles: {
      layoutMode: "flow", display: "flex", flexDirection: "column", position: "relative", width: "100%",
      backgroundColor: C.creamDeep, backgroundImage: img.cta, backgroundSize: "cover", backgroundPosition: "center",
      paddingTop: "28px", paddingBottom: "28px", minHeight: "182px", justifyContent: "center",
    },
    children: [
      box("Text", "column", { alignItems: "center", gap: "12px", maxWidth: "720px", margin: "0 auto", paddingLeft: "24px", paddingRight: "24px", textAlign: "center" }, [
        text("heading", "Know a Remarkable Senior?", { fontSize: "36.5px", fontWeight: "500", lineHeight: "1.2", textAlign: "center" }, { level: 2, mobile: { fontSize: "29px" } }),
        text("paragraph", "Help us share their story. Every life has a story worth telling.", { fontSize: "19px", fontWeight: "500", textColor: C.ink, textAlign: "center" }),
        pill("Share a Story\u00A0\u00A0→", contactHref(), { fontSize: "20px", marginTop: "6px", width: "200px", height: "44px", lineHeight: "44px", textAlign: "center", paddingTop: "0px", paddingBottom: "0px", paddingLeft: "0px", paddingRight: "0px" }),
      ]),
    ],
  });
}

/** The title band on the inner pages: one h1 and a short line under it. */
function titleBand(title: string, lead: string): DocumentNode {
  return section(
    `${title} title`,
    [
      text("heading", title, { fontSize: "56px", fontWeight: "600", lineHeight: "1.05" }, { level: 1, name: "Page title", tablet: { fontSize: "46px" }, mobile: { fontSize: "38px" } }),
      node("paragraph", { name: "Script line", content: lead, styles: { fontFamily: SCRIPT, fontSize: "40px", textColor: C.rust, lineHeight: "1.2", marginTop: "4px" }, mobile: { fontSize: "32px" } }),
      rule({ marginTop: "20px" }),
    ],
    { padY: "28px" },
  );
}

/** "Latest Video  ────────  View All Videos →" */
function sectionHeading(title: string, linkLabel: string, href: string): DocumentNode {
  return box("Section heading", "row", { alignItems: "center", gap: "16px", paddingTop: "30px", paddingBottom: "6px" }, [
    text("heading", title, { fontSize: "37px", fontWeight: "500", lineHeight: "1.2", whiteSpace: "nowrap" }, { level: 2, mobile: { fontSize: "28px" } }),
    node("container", { name: "Line", styles: { flexGrow: 1, height: "1px", backgroundColor: C.line, width: "auto" }, hideOn: ["mobile"] }),
    textLink(linkLabel, href, "15.5px", { marginLeft: "auto" }),
  ], { mobile: { justifyContent: "space-between" } });
}

/**
 * How a content list (videos, stories, events) is drawn:
 *  - "block": the native Content list block (SDK with the contentList block) — the real, editable thing.
 *  - "static": a site whose editor doesn't have the block yet — Home's latest-video row is plain elements; content pages aren't built.
 *  - "html":  the same marker inside an HTML element. Only for local previews: an HTML element is an isolated frame, so on a
 *             live page the marker would never be filled in.
 */
export type ContentMode = "block" | "html" | "static";
let contentMode: ContentMode = "block";
export const setContentMode = (m: ContentMode) => { contentMode = m; };

const contentMarker = (slug: string, layout: string, extra: { limit?: number; columns?: number } = {}, name = "Content") => {
  if (contentMode !== "html") {
    return node("contentList", { name, props: { contentType: slug, layout, ...(extra.limit ? { limit: extra.limit } : {}), ...(extra.columns ? { itemsPerRow: extra.columns } : {}) }, styles: { width: "100%" } });
  }
  const attrs = [`data-plexo-content="${slug}"`, `data-plexo-content-layout="${layout}"`, ...(extra.limit ? [`data-plexo-content-limit="${extra.limit}"`] : []), ...(extra.columns ? [`data-plexo-content-columns="${extra.columns}"`] : [])].join(" ");
  return node("html", { name, props: { code: `<div ${attrs}></div>`, title: name }, styles: { width: "100%" } });
};

/** Home's "Latest video" row drawn from plain elements — used until the site can hold the Content list block. */
const latestVideoStatic = (img: SiteImages): DocumentNode =>
  node("container", {
    name: "Latest video (static — swap for a Content list block)",
    styles: { layoutMode: "grid", display: "grid", width: "100%", gridTemplateColumns: "1.15fr 1fr", gap: "37px", alignItems: "center" },
    tablet: { gridTemplateColumns: "1fr", gap: "20px" },
    children: [
      node("container", {
        name: "Video thumbnail",
        styles: { layoutMode: "flow", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", width: "100%", height: "205px", borderRadius: "6px", backgroundColor: "#1a120a", backgroundImage: img.videoThumb, backgroundSize: "cover", backgroundPosition: "center 28%", overflow: "hidden" },
        mobile: { height: "190px" },
        children: [
          node("button", { name: "Play", content: "►", props: { href: "/videos", variant: "ghost", ariaLabel: "Watch A Life Well Lived — Mr. James, an older man in glasses, tells his story in a softly lit room" }, styles: { width: "58px", height: "58px", borderRadius: "50%", borderWidth: "2px", borderStyle: "solid", borderColor: "#ffffff", backgroundColor: "rgba(0,0,0,0.35)", textColor: "#ffffff", fontSize: "20px", padding: "0px 0px 0px 4px", cursor: "pointer", hoverEffect: "grow" } }),
        ],
      }),
      box("Video text", "column", { gap: "10px" }, [
        text("heading", "A Life Well Lived", { fontSize: "31px", fontWeight: "600", lineHeight: "1.2" }, { level: 3, name: "Video title" }),
        text("paragraph", "Mr. James shares lessons from a lifetime of hard work, faith, family, and resilience.", { fontSize: "17px", fontWeight: "500", lineHeight: "1.4", textColor: C.body, maxWidth: "330px" }, { name: "Video description" }),
        rule({ marginTop: "22px", marginBottom: "4px" }),
        textLink("Watch Now   →", "/videos", "17px", { alignSelf: "flex-start" }),
      ]),
    ],
  });

// ---------------------------------------------------------------- pages

export type PageSpec = { name: string; slug: string; isHome?: boolean; title: string; description: string; sections: DocumentNode[]; /** Needs the Content list block (so only buildable when the editor has it). */ usesContentBlock?: boolean };

export type BlogCard = { title: string; date: string; href: string; image: string; alt: string };

const blogCard = (c: BlogCard): DocumentNode =>
  node("container", {
    name: c.title,
    styles: flex("column", { backgroundColor: C.card, borderRadius: "4px", overflow: "hidden", boxShadow: "0 1px 6px rgba(70,55,30,0.08)", hoverEffect: "lift", width: "auto" }),
    children: [
      node("image", { name: "Post image", props: { src: c.image, alt: c.alt, href: c.href }, styles: { width: "100%", height: "143px", objectPosition: "center" } }),
      box("Post text", "column", { padding: "12px 16px 14px", gap: "4px" }, [
        node("heading", { name: "Post title", content: c.title, props: { level: 3, href: c.href }, styles: { fontFamily: SERIF, fontSize: "21px", fontWeight: "500", textColor: C.ink, lineHeight: "1.25" } }),
        text("paragraph", c.date, { fontSize: "16.5px", fontWeight: "500", textColor: C.muted }, { name: "Date" }),
      ]),
    ],
  });

/** Home's own "Share a story" form, used while the site can't have a separate Contact page. */
const homeContactSection = (): DocumentNode =>
  section(
    "Share a story",
    [
      text("heading", "Share a Story", { fontSize: "33px", fontWeight: "600", lineHeight: "1.2" }, { level: 2, mobile: { fontSize: "27px" } }),
      text("paragraph", "Know a remarkable senior — a parent, a neighbour, a friend from church? Tell us a little about them and how to reach you, and we'll be in touch.", { fontSize: "19px", fontWeight: "500", textColor: C.body, maxWidth: "640px", marginTop: "8px", marginBottom: "20px" }, { name: "Intro" }),
      contactForm(),
    ],
    { padY: "26px", id: "contact" },
  );

export function homePage(img: SiteImages, cards: BlogCard[]): PageSpec {
  // The photo is the user's own, untouched, anchored right. The cream fade on its left (where the text sits) is a gradient
  // element laid over it, so swapping the photo in the editor keeps the fade. A faint warm tint pulls the photo toward the
  // mockup's softer tones; a light wash over the top keeps the menu legible.
  const FADE =
    // Left to right: the photo's own soft, sunlit blur shows through a cream wash (so the left reads as an extension of
    // the photo rather than a flat block), clearing completely before the subject.
    "linear-gradient(90deg, rgba(248,241,232,1) 0%, rgba(248,241,232,0.9) 9%, rgba(248,241,232,0.84) 30%, rgba(248,241,232,0.66) 40%, rgba(248,241,232,0.36) 49%, rgba(248,241,232,0.12) 58%, rgba(248,241,232,0) 66%), " +
    // Top: solid under the menu, easing into the photo. Bottom: eases into the page so the photo has no hard edge.
    "linear-gradient(180deg, rgba(248,241,232,1) 0px, rgba(248,241,232,0.96) 90px, rgba(248,241,232,0.5) 150px, rgba(248,241,232,0.16) 215px, rgba(248,241,232,0) 270px), " +
    "linear-gradient(0deg, rgba(248,241,232,1) 0px, rgba(248,241,232,0.75) 16px, rgba(248,241,232,0.28) 44px, rgba(248,241,232,0) 84px), " +
    "linear-gradient(rgba(96,62,28,0.08), rgba(96,62,28,0.08))";
  const hero = node("section", {
    name: "Hero",
    styles: {
      layoutMode: "flow", display: "flex", flexDirection: "column", position: "relative", width: "100%",
      backgroundColor: C.cream,
      minHeight: "652px", paddingBottom: "40px",
    },
    // Phones show the photo under the text instead (see the image after the text, below).
    mobile: { minHeight: "0px", paddingBottom: "0px" },
    children: [
      // The photo: the user's own, untouched, sized by the screen's width (so the mug is the same size relative to the page
      // as in the mockup) up to PHOTO_W, anchored bottom right. An image element, not a background, so it never tiles and
      // replacing it in the editor is one click.
      node("image", {
        name: "Hero photo",
        props: { src: img.hero, alt: "" },
        styles: { position: "absolute", x: 0, y: 0, width: PHOTO_W, height: "auto", horizontalConstraint: "right", verticalConstraint: "bottom", rightOffset: 0, bottomOffset: 0, pointerEvents: "none", zIndex: 0 },
        hideOn: ["mobile"],
      }),
      node("container", {
        name: "Fade over the photo",
        styles: { position: "absolute", x: 0, y: 0, width: PHOTO_W, height: "100%", horizontalConstraint: "right", verticalConstraint: "stretch", rightOffset: 0, bottomOffset: 0, backgroundGradient: FADE, pointerEvents: "none", zIndex: 0 },
        hideOn: ["mobile"],
      }),
      headerBar(img, true),
      box("Hero text", "column", { position: "relative", zIndex: 1, maxWidth: MAX, margin: "0 auto", paddingLeft: SIDE, paddingRight: SIDE, paddingTop: "0px", marginTop: "-14px", alignItems: "flex-start" }, [
        text("heading", "Real People. Real Stories.", { fontSize: "64px", fontWeight: "500", lineHeight: "0.92", maxWidth: "360px" }, { level: 1, name: "Headline", tablet: { fontSize: "54px", maxWidth: "300px" }, mobile: { fontSize: "42px", maxWidth: "250px" } }),
        node("paragraph", { name: "Script line", content: "A Lasting Legacy.", styles: { fontFamily: SCRIPT, fontSize: "58px", textColor: C.rust, lineHeight: "1.12", marginTop: "2px", whiteSpace: "nowrap" }, mobile: { fontSize: "50px" } }),
        rule({ marginTop: "19px", marginBottom: "14px" }),
        text("paragraph", "Honest conversations with remarkable seniors — preserving their stories, wisdom, and life lessons for today and tomorrow.", { fontSize: "20.5px", fontWeight: "500", lineHeight: "1.22", textColor: C.ink, maxWidth: "348px" }, { name: "Intro" }),
        pill("►\u00A0\u00A0\u00A0\u00A0Watch Our Stories", multiPage ? "/stories" : "#latest-video", { marginTop: "22px", width: "277px", height: "49px", lineHeight: "49px", textAlign: "center", paddingTop: "0px", paddingBottom: "0px", paddingLeft: "0px", paddingRight: "0px" }, { mobile: { width: "100%" } }),
      ], { tablet: { paddingLeft: "32px", paddingRight: "32px", marginTop: "10px" }, mobile: { paddingLeft: "20px", paddingRight: "20px", paddingTop: "0px", marginTop: "12px" } }),
      node("image", { name: "Hero photo (phones)", props: { src: img.heroMobile, alt: "A warm mug, reading glasses and an old leather book on a wooden table by a sunlit window, with a vase of small white flowers" }, styles: { width: "100%", height: "240px", marginTop: "26px" }, hideOn: ["desktop", "tablet"] }),
    ],
  });

  const latest = section(
    "Latest video",
    [
      sectionHeading("Latest Video", "View All Videos  →", "/videos"),
      contentMode === "static" ? latestVideoStatic(img) : contentMarker("videos", "featured", { limit: 1 }, "Latest video"),
    ],
    { padY: "0px", id: "latest-video" },
  );
  latest.styles.paddingBottom = "8px";

  const blog = section(
    "From the blog",
    [
      sectionHeading("From the Blog", "Read All Posts  →", "/blog"),
      // Live: the latest published posts, each card linking to its post, new posts appearing by themselves; when the
      // site has none yet it says so. (An editor without the Content list block gets fixed cards instead.)
      contentMode === "static"
        ? node("container", {
            name: "Posts",
            styles: { layoutMode: "grid", display: "grid", width: "100%", gridTemplateColumns: "1.05fr 1fr 1.05fr", gap: "21px", marginTop: "6px" },
            tablet: { gridTemplateColumns: "1fr 1fr" },
            mobile: { gridTemplateColumns: "1fr" },
            children: cards.map(blogCard),
          })
        : contentMarker("blog", "posts", { limit: 3, columns: 3 }, "Latest blog posts"),
    ],
    {},
  );
  blog.styles.paddingBottom = "26px";

  return {
    name: "Home",
    slug: "home",
    isHome: true,
    title: "Echoes of Experience by Tolu — Real People. Real Stories. A Lasting Legacy.",
    description: "Honest conversations with remarkable seniors — watch their stories, read their wisdom, and help preserve life lessons for today and tomorrow.",
    sections: [hero, latest, blog, ctaSection(img), ...(multiPage ? [] : [homeContactSection()]), footerSection(img)],
  };
}

export function storiesPage(img: SiteImages): PageSpec {
  return {
    name: "Stories",
    slug: "stories",
    usesContentBlock: true,
    title: "Stories — Echoes of Experience by Tolu",
    description: "Read the life stories of remarkable seniors — hard work, faith, family and resilience, in their own words.",
    sections: [
      headerSection(img),
      titleBand("Stories", "Lives well lived, in their own words."),
      section("Stories list", [contentMarker("stories", "stories", { columns: 3 }, "Stories")], { padY: "10px" }),
      ctaSection(img),
      footerSection(img),
    ],
  };
}

export function videosPage(img: SiteImages): PageSpec {
  return {
    name: "Videos",
    slug: "videos",
    usesContentBlock: true,
    title: "Videos — Echoes of Experience by Tolu",
    description: "Watch honest, unhurried conversations with remarkable seniors and the lessons their lives have taught them.",
    sections: [
      headerSection(img),
      titleBand("Videos", "Conversations worth watching."),
      section("Video gallery", [contentMarker("videos", "gallery", { columns: 3 }, "Video gallery")], { padY: "10px" }),
      ctaSection(img),
      footerSection(img),
    ],
  };
}

export function happeningsPage(img: SiteImages): PageSpec {
  return {
    name: "Happenings",
    slug: "happenings",
    usesContentBlock: true,
    title: "Happenings — Echoes of Experience by Tolu",
    description: "Upcoming gatherings, screenings and conversations from Echoes of Experience by Tolu. Come and listen.",
    sections: [
      headerSection(img),
      titleBand("Happenings", "Come and listen."),
      section("Upcoming events", [contentMarker("happenings", "events", {}, "Upcoming events")], { padY: "10px" }),
      ctaSection(img),
      footerSection(img),
    ],
  };
}

const contactForm = (): DocumentNode =>
  node("form", {
    name: "Share a Story",
    props: {
      fields: [
        { id: "name", label: "Your name", type: "text", required: true },
        { id: "email", label: "Your email", type: "email", required: true },
        { id: "phone", label: "Phone (optional)", type: "tel", required: false },
        { id: "about", label: "Tell us about the senior you'd like us to meet — or send us a message", type: "textarea", required: true },
      ],
      submitLabel: "Send",
      successMessage: "Thank you — we've received your message and will be in touch soon.",
      buttonColor: C.olive,
      buttonTextColor: "#f7f2e6",
      buttonRadius: "999px",
    },
    styles: { width: "100%", maxWidth: "640px", fontFamily: SERIF, fontSize: "18px", textColor: C.ink },
  });

export function contactPage(img: SiteImages): PageSpec {
  const form = contactForm();
  return {
    name: "Contact",
    slug: "contact",
    title: "Contact — Share a Story — Echoes of Experience by Tolu",
    description: "Know a remarkable senior? Tell us about them, or send Tolu a message. Every life has a story worth telling.",
    sections: [
      headerSection(img),
      titleBand("Share a Story", "Every life has one worth telling."),
      section("Contact", [
        text("paragraph", "Know a remarkable senior — a parent, a neighbour, a friend from church? Tell us a little about them and how to reach you, and we'll be in touch.", { fontSize: "19px", fontWeight: "500", textColor: C.body, maxWidth: "640px", marginBottom: "22px" }, { name: "Intro" }),
        form,
      ], { padY: "10px" }),
      footerSection(img),
    ],
  };
}

export function privacyPage(img: SiteImages): PageSpec {
  const p = (t: string) => text("paragraph", t, { fontSize: "18px", fontWeight: "500", lineHeight: "1.55", textColor: C.body, maxWidth: "700px", marginBottom: "14px" });
  return {
    name: "Privacy",
    slug: "privacy",
    title: "Privacy — Echoes of Experience by Tolu",
    description: "How Echoes of Experience by Tolu handles the details you share with us.",
    sections: [
      headerSection(img),
      titleBand("Privacy", "Your details stay with us."),
      section("Privacy text", [
        p("When you send us a message or tell us about someone, we use what you share only to reply to you and to arrange a conversation. We do not sell your details."),
        p("Stories and videos are published only with the permission of the people who share them. If you would like something taken down, contact us and we will remove it."),
        p("Questions about your details? Write to us from the Contact page."),
      ], { padY: "10px" }),
      footerSection(img),
    ],
  };
}

/** A V2 page definition for one spec. */
export function toPageDefinition(spec: PageSpec): PageDefinition {
  return {
    id: nid("page"),
    name: spec.name,
    slug: spec.slug,
    ...(spec.isHome ? { isHome: true } : {}),
    rootNode: node("page", { name: spec.name, styles: { backgroundColor: C.cream, textColor: C.ink, fontFamily: SERIF }, children: spec.sections }),
  } as PageDefinition;
}

// ---------------------------------------------------------------- blog layouts (the native blog, in the same look)

export function blogListingSpec(img: SiteImages): PageSpec {
  return {
    name: "Blog Listing Layout",
    slug: "blog",
    title: "Blog — Echoes of Experience by Tolu",
    description: "Notes on listening, everyday wisdom and lives of resilience from Echoes of Experience by Tolu.",
    sections: [
      headerSection(img),
      titleBand("Blog", "Notes on listening and living."),
      section("Posts", [node("blogPostList", { name: "Blog post list", styles: { width: "100%" } })], { padY: "10px" }),
      ctaSection(img),
      footerSection(img),
    ],
  };
}

export function blogPostSpec(img: SiteImages): PageSpec {
  return {
    name: "Blog Post Layout",
    slug: "blog-post",
    title: "Echoes of Experience by Tolu",
    description: "A post from Echoes of Experience by Tolu.",
    sections: [
      headerSection(img),
      section("Article", [
        node("blogFeaturedImage", { name: "Post picture", styles: { width: "100%", borderRadius: "6px", overflow: "hidden", marginBottom: "22px" } }),
        node("blogTitle", { name: "Post title", styles: { width: "100%", fontFamily: SERIF, fontSize: "46px", fontWeight: "500", lineHeight: "1.1", textColor: C.ink } , mobile: { fontSize: "36px" } }),
        node("blogDate", { name: "Post date", props: { prefix: "" }, styles: { width: "100%", fontFamily: SERIF, fontSize: "16px", textColor: C.muted, marginTop: "8px", marginBottom: "18px" } }),
        node("blogContent", { name: "Post text", styles: { width: "100%", fontFamily: SERIF, fontSize: "20px", lineHeight: "1.65", textColor: C.body } }),
      ], { maxWidth: "760px", padY: "24px" }),
      ctaSection(img),
      footerSection(img),
    ],
  };
}
