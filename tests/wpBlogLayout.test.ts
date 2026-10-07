import { describe, expect, it } from "vitest";
import * as cheerio from "cheerio";
import { imageStem, makePostListsLive, type KnownPost } from "@/lib/wpMigration/livePostLists";
import { listingLayoutFromWpHtml, postLayoutFromWpHtml, shellLayout, wpPageRole } from "@/lib/wpMigration/blogLayout";
import { fillCardTemplate, formatPostDate, readPostListSpecs, renderLivePostLists, type LivePost } from "@/lib/pub/blogLivePostLists";
import { substituteBlogMarkers } from "@/lib/pub/blogLayoutRender";

const post = (id: number, title: string, extra: Partial<KnownPost> = {}): KnownPost => ({
  wpId: id,
  urls: [`https://site.test/${title.toLowerCase().replace(/\W+/g, "-")}/`, `/blog/${title.toLowerCase().replace(/\W+/g, "-")}`],
  title,
  excerpt: null,
  imageStem: null,
  dateGmt: "2026-10-05T08:40:00",
  authorName: null,
  categories: [],
  ...extra,
});

const coach = post(4422, "How To Become a Mental Health Coach", {
  imageStem: "coach-photo",
  categories: [{ name: "Coaching", slug: "coaching" }],
  authorName: "John Udemezue",
  excerpt: "People across the globe are prioritizing personal well-being more than ever before.",
});
const piracy = post(4400, "How to Protect Digital Downloads", { imageStem: "piracy", dateGmt: "2026-09-20T08:00:00", categories: [{ name: "Selling", slug: "selling" }] });
const leads = post(4300, "Nurture Leads With Email", { dateGmt: "2026-09-01T08:00:00", categories: [{ name: "Coaching", slug: "coaching" }] });
const posts = [coach, piracy, leads];

// Modelled on maildrip.io's Elementor Loop Grid: the card is generic widgets (a Heading
// holding the category link, an Image with WP Rocket lazy-loading), nothing labelled.
function loopCard(p: KnownPost, img: string) {
  return `<div class="elementor e-loop-item e-loop-item-${p.wpId} post-${p.wpId} type-post">
    <div class="elementor-widget-theme-post-featured-image"><div class="elementor-widget-container">
      <a href="${p.urls[1]}"><img src="data:image/svg+xml,x" data-lazy-src="/wp-content/uploads/2026/10/${img}-800x534.png" data-lazy-srcset="/wp-content/uploads/2026/10/${img}-300x200.png 300w"></a>
    </div></div>
    <div class="elementor-widget-heading"><h2 class="elementor-heading-title"><a href="/category/${p.categories[0]?.slug}/">${p.categories[0]?.name}</a></h2></div>
    <div class="elementor-widget-heading"><h3 class="elementor-heading-title"><a href="${p.urls[1]}">${p.title}</a></h3></div>
    <div class="elementor-button-wrapper"><a class="elementor-button" href="${p.urls[1]}">Read Now</a></div>
  </div>`;
}
const loopPage = `<html><head><title>Our Blog</title><link rel="canonical" href="https://site.test/blog/"></head><body class="page">
  <header data-elementor-type="header"><nav><a href="/">Home</a></nav></header>
  <main><h1>Our Blog</h1>
  <div class="elementor-widget elementor-widget-loop-grid"><div class="elementor-widget-container">
    <div class="elementor-loop-container elementor-grid"><style id="loop-4807">.x{}</style>
      ${loopCard(coach, "coach-photo")}${loopCard(piracy, "piracy")}
    </div>
    <div class="e-load-more-anchor" data-page="1"></div>
    <div class="elementor-button-wrapper"><a class="elementor-button" href="#">Load more</a></div>
  </div></div></main>
  <footer data-elementor-type="footer">© Site</footer></body></html>`;

// Modelled on LineageCare's own custom widget — no known widget class at all.
const customCard = (p: KnownPost, date: string) => `<article class="lceap-post-card">
  <a href="${p.urls[0]}"><img src="/wp-content/uploads/${p.imageStem ?? "none"}.jpg"></a>
  <div class="lceap-meta"><span>${date}</span> <span>LineageCare_admin</span></div>
  <h3 class="lceap-post-title"><a href="${p.urls[0]}">${p.title}</a></h3>
  <p>${p.excerpt ?? "Some words about this post that are long enough"}</p>
  <a href="${p.urls[0]}">Read More →</a></article>`;

const live: LivePost = {
  url: "/blog/fresh",
  title: "A <Fresh> Post",
  excerpt: "New words.",
  imageUrl: "/new.png",
  imageAlt: "alt",
  publishedAt: "2026-10-07T10:00:00Z",
  authorName: "Ada",
  authorUrl: "/blog/author/ada",
  categoryName: "Email",
  categoryUrl: "/blog/category/email",
  readingMinutes: 4,
};

describe("imageStem", () => {
  it("matches resized, scaled and converted copies of one upload", () => {
    for (const src of ["/u/Coach-Photo.png", "/u/coach-photo-800x534.png", "/u/coach-photo-scaled.jpg", "/u/coach-photo.png.webp"]) {
      expect(imageStem(src)).toBe("coach-photo");
    }
  });
});

describe("makePostListsLive", () => {
  it("templates an Elementor Loop Grid card by matching the post's own data, and drops WordPress-only paging", () => {
    const $ = cheerio.load(loopPage);
    expect(makePostListsLive($, posts)).toBe(1);
    const html = $.html();
    const tpl = /<template[^>]*>([\s\S]*?)<\/template>/.exec(html)![1];
    expect(tpl).toContain("%%plexo.url%%");
    expect(tpl).toContain("%%plexo.title%%");
    expect(tpl).toContain('src="%%plexo.image%%"');
    expect(tpl).not.toContain("data-lazy-src");
    expect(tpl).toContain("%%plexo.category%%");
    expect(tpl).toContain("<!--plexo-if-image-->");
    expect(html).toContain('<style id="loop-4807">'); // the loop's own styles stay
    expect(html).not.toContain("e-load-more-anchor");
    expect(html).not.toContain("Load more");
    expect(readPostListSpecs(html)).toEqual([{ count: 2, offset: 0, category: null, main: false }]);
  });

  it("finds a site's own custom posts widget by its repeated post cards", () => {
    const lcPosts = [post(1, "Outreach of Hope in Ajura", { imageStem: "ajura", excerpt: "With hearts full of gratitude to God and appreciation to all who supported." }), post(2, "Hope to Plateau Communities", { dateGmt: "2026-06-01T09:00:00" })];
    const $ = cheerio.load(`<body><div class="lceap-posts-grid">${customCard(lcPosts[0], "October 5, 2026")}${customCard(lcPosts[1], "June 1, 2026")}</div></body>`);
    expect(makePostListsLive($, lcPosts)).toBe(1);
    const tpl = /<template[^>]*>([\s\S]*?)<\/template>/.exec($.html())![1];
    expect(tpl).toContain("%%plexo.date:mdy%%");
    expect(tpl).toContain("%%plexo.excerpt%%");
    expect(tpl).toContain("%%plexo.title%%");
  });

  it("keeps a category-limited list limited, and an offset list offset", () => {
    const html = `<body><div class="elementor-loop-container">${loopCard(leads, "x")}</div>
      <div class="elementor-loop-container">${loopCard(piracy, "piracy")}${loopCard(leads, "y")}</div></body>`;
    const $ = cheerio.load(html);
    makePostListsLive($, posts);
    const specs = readPostListSpecs($.html());
    expect(specs[1]).toMatchObject({ count: 2, offset: 1 }); // starts at the 2nd-newest post
    const cat = cheerio.load(`<body><div class="elementor-loop-container">${loopCard(coach, "coach-photo")}${loopCard(leads, "y")}</div></body>`);
    makePostListsLive(cat, posts);
    expect(readPostListSpecs(cat.html())[0]).toMatchObject({ category: "coaching" });
  });

  it("leaves a list alone when no card can be matched to a post", () => {
    const $ = cheerio.load(`<body><div class="elementor-loop-container"><div class="e-loop-item post-999"><a href="/x/">Unknown</a></div></div></body>`);
    expect(makePostListsLive($, posts)).toBe(0);
    expect($.html()).not.toContain("data-plexo-blog-postlist");
  });
});

describe("live list rendering", () => {
  it("fills a card in the site's design, escaping values and dropping image-only parts when there's no image", () => {
    const tpl = `<article><!--plexo-if-image--><a href="%%plexo.url%%"><img src="%%plexo.image%%" alt="%%plexo.imageAlt%%"></a><!--/plexo-if-image--><h3><a href="%%plexo.url%%">%%plexo.title%%</a></h3><span>%%plexo.date:dmy%%</span> · %%plexo.readingTime%% min read</article>`;
    const card = fillCardTemplate(tpl, live);
    expect(card).toContain('href="/blog/fresh"');
    expect(card).toContain("A &lt;Fresh&gt; Post");
    expect(card).toContain("7 October 2026");
    expect(card).toContain("4 min read");
    expect(fillCardTemplate(tpl, { ...live, imageUrl: null })).not.toContain("<img");
  });

  it("formats dates the way the site did", () => {
    expect(formatPostDate("2026-10-05T08:40:00Z", "mdy")).toBe("October 5, 2026");
    expect(formatPostDate("2026-10-05T08:40:00Z", "dmy-ord")).toBe("5th October 2026");
    expect(formatPostDate("2026-10-05T08:40:00Z", "eu")).toBe("05/10/2026");
  });

  it("fills each list on a page with its own posts", async () => {
    const $ = cheerio.load(loopPage);
    makePostListsLive($, posts);
    const out = await renderLivePostLists($.html(), async (spec) => Array.from({ length: spec.count }, (_, i) => ({ ...live, title: `Post ${i}` })));
    expect(out).toContain("Post 0");
    expect(out).toContain("Post 1");
    expect(out).not.toContain("<template data-plexo-blog-card");
  });
});

describe("blog layouts from WordPress pages", () => {
  it("listing: the site's own blog page with a live main list, its heading and paging slots, minus page-specific SEO", () => {
    const listing = listingLayoutFromWpHtml(loopPage, posts)!;
    expect(listing.title).toBe("Our Blog");
    expect(listing.postsShown).toBe(2);
    expect(listing.html).toContain('data-plexo-blog-main="true"');
    expect(listing.html).toMatch(/data-plexo-blog-heading="true"/);
    expect(listing.html).toMatch(/data-plexo-blog-pagination="true"/);
    expect(listing.html).not.toContain("<title>");
    expect(listing.html).not.toContain('rel="canonical"');
    const filled = substituteBlogMarkers(listing.html, { heading: "Coaching", pagination: "<nav>pages</nav>" });
    expect(filled).toContain("Coaching");
    expect(filled).toContain("<nav>pages</nav>");
  });

  it("post: a classic theme's labelled regions", () => {
    const html = `<html><head><title>One post</title></head><body><header>H</header><main><article class="post type-post">
      <h1 class="entry-title">One post</h1><div class="entry-meta"><span class="posted-on">May 1</span><span class="byline">Ada</span></div>
      <div class="post-thumbnail"><img src="/a.jpg"></div><div class="entry-content"><p>Body <span class="entry-title">x</span></p></div>
      <nav class="post-navigation"><a href="/prev/">Prev</a></nav><div id="comments">c</div></article></main><footer>F</footer></body></html>`;
    const layout = postLayoutFromWpHtml(html)!;
    for (const name of ["title", "date", "author", "featuredImage", "content", "comments"]) expect(layout.html).toMatch(new RegExp(`data-plexo-blog-${name}="true"`, "i"));
    expect(layout.html).not.toContain("Body"); // the sample post's own text is gone
    expect(layout.html).not.toContain("post-navigation");
    expect(layout.hasComments).toBe(true);
  });

  it("post: a page-builder template found by the sample post's own title, image, author and date", () => {
    const html = `<body><div data-elementor-type="single-post">
      <div class="elementor-widget-heading"><h1 class="elementor-heading-title">How To Become a Mental Health Coach</h1></div>
      <div class="elementor-widget-image"><img src="/wp-content/uploads/elementor/thumbs/coach-photo-rspfujgr.png"></div>
      <div class="elementor-widget-image-box"><p>By John Udemezue · October 5, 2026</p></div>
      <div class="elementor-widget-theme-post-content"><div class="elementor-widget-container"><p>Body</p></div></div>
    </div></body>`;
    const layout = postLayoutFromWpHtml(html, coach)!;
    for (const name of ["title", "featuredImage", "author", "date", "content"]) expect(layout.html).toMatch(new RegExp(`data-plexo-blog-${name}="true"`, "i"));
    expect(layout.html).toContain("By "); // the text around the author/date stays
    expect(layout.hasComments).toBe(false);
  });

  it("post: null for a page with no recognisable content area (caller falls back)", () => {
    expect(postLayoutFromWpHtml("<body><div>nothing</div></body>")).toBeNull();
  });

  it("fallback: the site's header and footer around a plain column, keeping scripts", () => {
    const html = `<html><head><title>Home</title></head><body class="elementor-kit-5"><div id="page">
      <header data-elementor-type="header">Logo</header><section>Hero</section><script>menu()</script><section>More</section>
      <footer data-elementor-type="footer">Footer</footer></div><script>cookie()</script></body></html>`;
    const out = shellLayout(html, "listing", "News")!;
    expect(out).toContain("Logo");
    expect(out).toContain("Footer");
    expect(out).not.toContain("Hero");
    expect(out).toContain("menu()");
    expect(out).toContain("cookie()");
    expect(out).toContain("News");
    expect(out).toMatch(/data-plexo-blog-postlist="true"/i);
    expect(out.indexOf("Logo")).toBeLessThan(out.indexOf("plexo-wp-blog"));
    expect(out.indexOf("plexo-wp-blog")).toBeLessThan(out.indexOf("Footer"));
  });

  it("reads WordPress's page role from <body class>", () => {
    expect(wpPageRole('<body class="blog paged">')).toEqual({ isPostsIndex: true, isFront: false });
    expect(wpPageRole('<body class="home blog">')).toEqual({ isPostsIndex: true, isFront: true });
    expect(wpPageRole('<body class="home page">')).toEqual({ isPostsIndex: false, isFront: true });
  });
});
