import { applyCommands, blankPages, createDefaultDesignSystem, type PageDefinition } from "@charisol/plexo-sdk/v2/compile";

import { V2_FORMAT, type V2Design } from "@/lib/v2/design";

/**
 * V2 twins of the designs Plexo generates for people (storefront pages, product page, funnel
 * starter, blog layouts, default header/footer). Each one is a clean stack of SDK-managed
 * sections ("Shop", "Cart & checkout", "Header & menu" …) so a site owner who opens it in the
 * editor edits plain words and picks layouts — nothing to take apart. The pure, DB-free half:
 * the V1 builders stay exactly as they were for V1 targets.
 *
 * Built by replaying the SDK's own `addSection` commands (the same path Sol uses), so the
 * sections are byte-for-byte what the editor itself would add, with the kind's starter
 * words overridden where the generated page should say something specific.
 *
 * Marker contract: the dynamic blocks inside those sections compile to the SAME
 * `data-plexo-*` markers the server (commerce.js, lms-signup.js, lib/pub blog render) already
 * substitutes — tests/v2LayoutDesigns.test.ts holds that line.
 */

type Command = Record<string, unknown>;

/** Where the generated pages link to. Defaults are the auto-provisioned slugs. */
export type StoreLinks = {
  /** The storefront page's real served path (renameable), e.g. "/store". */
  shopPath: string;
  /** The order tracking page's real served path. */
  trackPath: string;
};

export const DEFAULT_STORE_LINKS: StoreLinks = { shopPath: "/store", trackPath: "/track-order" };

export type ChromeOptions = {
  /** The site's name, shown in the header/footer the page brings along. */
  siteName: string;
  /** False when the site already has a shared header (Site layout) — never show two. */
  header: boolean;
  footer: boolean;
};

const section = (kind: string, id: string, extra: Command = {}): Command => ({ op: "addSection", kind, id, ...extra });

function emptyPage(name: string, slug: string): PageDefinition {
  const base = blankPages()[0];
  return {
    ...base,
    id: `page-${slug}`,
    name,
    slug,
    isHome: false,
    rootNode: { ...base.rootNode, id: `root-${slug}`, children: [] },
  };
}

/** One-page V2 design from section commands (throws if the SDK rejects one — a bug here, never user input). */
export function buildV2Page(name: string, slug: string, commands: Command[]): V2Design {
  const page = emptyPage(name, slug);
  const out = applyCommands([page], createDefaultDesignSystem(), commands.map((c) => ({ ...c, pageId: page.id })));
  const failed = out.results.find((r) => !r.ok);
  if (failed) throw new Error(`Couldn't build the "${name}" page: ${failed.message}`);
  return { format: V2_FORMAT, pages: out.pages };
}

const SHOP_CHROME_LINKS = (siteName: string, links: StoreLinks) => ({
  header: section("header", "sec-header", {
    variant: "classic",
    content: {
      brand: siteName,
      logo: "",
      links: [
        { label: "Home", href: "/" },
        { label: "Shop", href: links.shopPath },
        { label: "Track order", href: links.trackPath },
      ],
      cta: { label: "", href: "" },
    },
  }),
  footer: section("footer", "sec-footer", {
    variant: "simple",
    content: {
      brand: siteName,
      text: "",
      columns: [{ title: "Shop", links: `Home | /\nShop | ${links.shopPath}\nTrack order | ${links.trackPath}` }],
      socials: [],
      copyright: `© ${new Date().getFullYear()} ${siteName}. All rights reserved.`,
    },
  }),
});

function withChrome(chrome: ChromeOptions, links: StoreLinks, body: Command[]): Command[] {
  const c = SHOP_CHROME_LINKS(chrome.siteName, links);
  return [...(chrome.header ? [c.header] : []), ...body, ...(chrome.footer ? [c.footer] : [])];
}

// ----------------------------------------------------------------------------- storefront

export function buildStorefrontV2(chrome: ChromeOptions, links: StoreLinks = DEFAULT_STORE_LINKS): V2Design {
  return buildV2Page(
    "Shop",
    "store",
    withChrome(chrome, links, [
      section("shop", "sec-shop", {
        variant: "full",
        content: { eyebrow: "", heading: "Shop", text: "Everything we sell, in one place.", cta: { label: "", href: "" } },
      }),
    ]),
  );
}

export function buildCheckoutV2(chrome: ChromeOptions, links: StoreLinks = DEFAULT_STORE_LINKS): V2Design {
  return buildV2Page(
    "Checkout",
    "checkout",
    withChrome(chrome, links, [
      section("cartCheckout", "sec-checkout", {
        variant: "stacked",
        content: { heading: "Your cart", text: "Check your items, then pay securely when you’re ready.", checkoutHeading: "Checkout" },
      }),
    ]),
  );
}

export function buildOrderConfirmationV2(chrome: ChromeOptions, links: StoreLinks = DEFAULT_STORE_LINKS): V2Design {
  return buildV2Page(
    "Order Confirmation",
    "order-confirmation",
    withChrome(chrome, links, [
      section("orderConfirmation", "sec-confirmation", {
        variant: "centered",
        content: { cta: { label: "Keep shopping", href: links.shopPath } },
      }),
    ]),
  );
}

export function buildTrackOrderV2(chrome: ChromeOptions, links: StoreLinks = DEFAULT_STORE_LINKS): V2Design {
  return buildV2Page("Track Order", "track-order", withChrome(chrome, links, [section("orderTracking", "sec-tracking", { variant: "centered" })]));
}

/** The one reusable page every product uses (commerce.js draws the product itself from the visited URL). */
export function buildProductDetailV2(chrome: ChromeOptions, links: StoreLinks = DEFAULT_STORE_LINKS): V2Design {
  return buildV2Page(
    "Product Detail Layout",
    "product",
    withChrome(chrome, links, [section("productPage", "sec-product", { variant: "detail", content: { back: { label: "Back to the shop", href: links.shopPath } } })]),
  );
}

// ----------------------------------------------------------------------------- funnel

export function buildFunnelStarterV2(funnelName: string): V2Design {
  return buildV2Page("Sign up", "signup", [
    section("funnelSignup", "sec-signup", {
      variant: "centered",
      style: { background: "inverted" },
      content: { eyebrow: "", heading: funnelName, text: "Sign up below to get started." },
    }),
  ]);
}

// ----------------------------------------------------------------------------- blog

export function buildBlogPostLayoutV2(chrome: ChromeOptions): V2Design {
  return buildV2Page("Blog Post Layout", "blog-post", [
    ...(chrome.header ? [blogHeader(chrome.siteName)] : []),
    section("blogArticle", "sec-article", { variant: "classic", content: { back: { label: "Back to all posts", href: "/blog" } } }),
    ...(chrome.footer ? [blogFooter(chrome.siteName)] : []),
  ]);
}

export function buildBlogListingLayoutV2(chrome: ChromeOptions): V2Design {
  return buildV2Page("Blog Listing Layout", "blog-listing", [
    ...(chrome.header ? [blogHeader(chrome.siteName)] : []),
    section("blogList", "sec-posts", { variant: "centered", content: { eyebrow: "The blog", heading: "Latest from the blog", text: "News, ideas and stories from our team." } }),
    ...(chrome.footer ? [blogFooter(chrome.siteName)] : []),
  ]);
}

const blogHeader = (siteName: string): Command =>
  section("header", "sec-header", {
    variant: "classic",
    content: { brand: siteName, logo: "", links: [{ label: "Home", href: "/" }, { label: "Blog", href: "/blog" }], cta: { label: "", href: "" } },
  });

const blogFooter = (siteName: string): Command =>
  section("footer", "sec-footer", {
    variant: "simple",
    content: { brand: siteName, text: "", columns: [{ title: "Blog", links: "Home | /\nAll posts | /blog" }], socials: [], copyright: `© ${new Date().getFullYear()} ${siteName}. All rights reserved.` },
  });

// ----------------------------------------------------------------------------- site header / footer (shared layout)

/** The default shared header Plexo creates for a V2 site: the site's name and a Home link (plus the shop when it has one). */
export function buildSiteHeaderV2(siteName: string, shopPath?: string | null): V2Design {
  return buildV2Page("Site Header", "site-header", [
    section("header", "sec-header", {
      variant: "classic",
      content: {
        brand: siteName,
        logo: "",
        links: [{ label: "Home", href: "/" }, ...(shopPath ? [{ label: "Shop", href: shopPath }] : [])],
        cta: { label: "", href: "" },
      },
    }),
  ]);
}

export function buildSiteFooterV2(siteName: string, shopPath?: string | null): V2Design {
  return buildV2Page("Site Footer", "site-footer", [
    section("footer", "sec-footer", {
      variant: "simple",
      content: {
        brand: siteName,
        text: "",
        columns: shopPath ? [{ title: "Pages", links: `Home | /\nShop | ${shopPath}` }] : [{ title: "Pages", links: "Home | /" }],
        socials: [],
        copyright: `© ${new Date().getFullYear()} ${siteName}. All rights reserved.`,
      },
    }),
  ]);
}
