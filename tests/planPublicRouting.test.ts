import { beforeEach, describe, expect, it, vi } from "vitest";
import { issueHumanCheck } from "@/lib/forms/humanCheck";
import { NextRequest } from "next/server";

// The REAL public serve route (app/pub/[domain]/[[...slug]]) and app server
// (lib/projects/serve.ts), with the site's records in memory.

const db = vi.hoisted(() => ({
  site: null as null | { status: string; [k: string]: unknown },
  templates: new Map<string, Record<string, unknown>>(),
  files: new Map<string, string>(),
  submissions: [] as Array<{ formName: string; fields: Record<string, string> }>,
}));

vi.mock("@/lib/pub/resolveSiteDynamo", () => ({ resolveSite: async () => db.site }));
vi.mock("@/lib/db/contentEntities", () => ({
  Template: {
    get: ({ id }: { id: string }) => ({ go: async () => ({ data: db.templates.get(id) ?? null }) }),
    query: {
      byParent: ({ parentId }: { parentId: string }) => ({
        go: async () => ({ data: [...db.templates.values()].filter((t) => t.parentId === parentId) }),
      }),
    },
  },
  TemplateAsset: { get: () => ({ go: async () => ({ data: null }) }) },
  BlogSite: { get: () => ({ go: async () => ({ data: { enabled: true, showOnHomepage: false } }) }) },
  PublishedDomain: { query: { byDomain: () => ({ go: async () => ({ data: [] }) }) } },
}));
vi.mock("@/lib/db/commerceEntities", () => ({
  CommerceSettings: { get: () => ({ go: async () => ({ data: null }) }) },
  CommerceProduct: { query: { primary: () => ({ go: async () => ({ data: [] }) }) } },
}));
vi.mock("@/lib/db/opsEntities", () => ({
  PageView: { create: () => ({ go: async () => ({}) }) },
  FormSettings: { get: () => ({ go: async () => ({ data: null }) }) },
}));
vi.mock("@/lib/db/coreEntities", () => ({ User: {}, Organization: {} }));
vi.mock("@/lib/db/projectEntities", () => ({
  ProjectBuild: { get: () => ({ go: async () => ({ data: { id: "b1", templateId: "home", outputPrefix: "site/b1" } }) }) },
}));
vi.mock("@/lib/db/appEntities", () => ({
  AppSettings: { get: () => ({ go: async () => ({ data: null }) }) },
  DeployedApp: { get: () => ({ go: async () => ({ data: null }) }) },
}));
vi.mock("@/lib/projects/blobStore", () => ({
  buildSitePrefix: () => "site/b1",
  getObject: async (key: string) => {
    const body = db.files.get(key);
    if (body === undefined) return null;
    return { body: Buffer.from(body), contentType: key.endsWith(".js") ? "text/javascript" : "text/html; charset=utf-8" };
  },
}));
vi.mock("@/lib/projects/builds", () => ({ latestSuccessfulBuild: async () => null, recordLatestBuild: async () => {} }));
vi.mock("@/lib/projects/previewHost", () => ({ resolvePreviewHost: async () => null }));
vi.mock("@/lib/blog/redirectsDynamo", () => ({ resolveBlogRedirect: async () => null, resolveRedirectFull: async () => null }));
vi.mock("@/lib/redirects/notFound", () => ({ recordNotFound: () => {} }));
vi.mock("@/lib/customContent/render", () => ({ renderContentBlocks: async (html: string) => html }));
vi.mock("@/lib/pub/livePostQueries", () => ({ fillLatestPostLists: async (html: string) => html }));
vi.mock("@/lib/blog/queriesDynamo", () => ({ listAllPublishedSlugs: async () => [], listAllCategories: async () => [], listAllTags: async () => [] }));
vi.mock("@/lib/commerce/storefrontLayout", () => ({ getStorefrontPath: async () => null, getCheckoutPath: async () => null, DEFAULT_STOREFRONT_SLUG: "store" }));
vi.mock("@/lib/commerce/deriveCommerceTheme", () => ({ deriveCommerceTheme: () => null }));
vi.mock("@/lib/analyticsRollup", () => ({ recordPageViewRollup: async () => {} }));
vi.mock("@/server/analytics", () => ({ parseUserAgent: () => ({}), extractGeoFromHeaders: () => ({}) }));
vi.mock("@/server/orgDynamo", () => ({ orgCanWhiteLabelDynamo: async () => false }));
vi.mock("@/lib/forms/recordSubmission", () => ({
  collectFormFields: (entries: Iterable<[string, unknown]>) => Object.fromEntries([...entries].filter(([, v]) => typeof v === "string" && v)),
  recordFormSubmission: async (i: { formName: string; fields: Record<string, string> }) => { db.submissions.push({ formName: i.formName, fields: i.fields }); },
}));
vi.mock("@/lib/commerceRateLimitDynamo", () => ({ checkCommerceRateLimit: async () => true, clientIp: () => "1.1.1.1" }));

import { GET, POST } from "@/app/pub/[domain]/[[...slug]]/route";

const HOST = "mysite.plexopages.com";
const page = (id: string, extra: Record<string, unknown> = {}) =>
  db.templates.set(id, { id, name: id, sourceType: "BUILDER", designJson: {}, compiledHtml: `<html><head></head><body><h1>${id}</h1></body></html>`, ...extra });

function liveSite(plan: string, root: Record<string, unknown> = {}) {
  page("home", root);
  db.site = {
    status: "ok",
    published: {
      templateId: "home",
      domain: HOST,
      noindex: false,
      template: db.templates.get("home"),
      user: { subscriptionPlan: plan, hideBranding: true },
      organization: { id: "org1", logo: null, whiteLabelEnabled: false },
    },
  };
}

function visit(path: string) {
  const slug = path.split("/").filter(Boolean);
  return GET(new NextRequest(`https://${HOST}${path}`), { params: Promise.resolve({ domain: HOST, slug: slug.length ? slug : undefined }) });
}

beforeEach(() => {
  db.templates.clear();
  db.files.clear();
  db.submissions.length = 0;
});

describe("a Free site serves its homepage only", () => {
  beforeEach(() => {
    liveSite("FREE");
    page("about", { parentId: "home", slug: "about", isPublished: false, planArchivedAt: "2026-10-01" });
    page("team", { parentId: "about", slug: "team" });
    page("contact", { parentId: "home", slug: "contact" }); // never archived — still not served on Free
  });

  it("/ serves the homepage, with the Hosted with Plexo badge back on", async () => {
    const res = await visit("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<h1>home</h1>");
    expect(html).toContain("data-plexo-badge"); // hideBranding is ignored on Free
    expect(html).toContain("<strong>Plexo</strong>"); // shown until the logo has loaded
    expect(html).toContain("/api/brand/logo/wordmark-on-dark");
    expect(html).toContain("#b8f34a"); // the new brand colour, not the old violet
  });

  it("former sub-pages send visitors back to / with a clean, uncached 302", async () => {
    for (const path of ["/about", "/about/team", "/contact", "/contact/"]) {
      const res = await visit(path);
      expect(res.status, path).toBe(302);
      expect(new URL(res.headers.get("location")!).pathname, path).toBe("/");
      expect(res.headers.get("cache-control"), path).toBe("no-store");
    }
  });

  it("a page that never existed is still a plain 404, and a sub-page's own files 404 instead of redirecting", async () => {
    expect((await visit("/no-such-page")).status).toBe(404);
    expect((await visit("/about/style.css")).status).toBe(404);
  });

  it("the sitemap lists only the homepage", async () => {
    const res = await visit("/sitemap.xml");
    const xml = await res.text();
    expect(xml).toContain(`<loc>https://${HOST}/</loc>`);
    expect(xml).not.toContain("/about");
    expect(xml).not.toContain("/blog");
  });
});

describe("a paid site serves every published page", () => {
  beforeEach(() => {
    liveSite("PRO");
    page("about", { parentId: "home", slug: "about" });
    page("hidden", { parentId: "home", slug: "hidden", isPublished: false });
    page("under-hidden", { parentId: "hidden", slug: "child" });
  });

  it("sub-pages are served", async () => {
    const res = await visit("/about");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<h1>about</h1>");
  });

  it("an unpublished page — and everything under it — is a 404", async () => {
    expect((await visit("/hidden")).status).toBe(404);
    expect((await visit("/hidden/child")).status).toBe(404);
  });
});

describe("addresses the plan switched off", () => {
  it("a paused custom domain shows the inactive-domain screen (404, never cached)", async () => {
    db.site = { status: "inactive", domain: "mybrand.com", domainType: "CUSTOM" };
    const res = await visit("/");
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const html = await res.text();
    expect(html).toContain("This site is taking a break");
    expect(html).toContain("mybrand.com");
  });

  it("an offline site's Plexo address is a plain 404", async () => {
    db.site = { status: "inactive", domain: "myshop.plexopages.com", domainType: "SUBDOMAIN" };
    const res = await visit("/");
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("404");
  });
});

describe("an app on Free answers its first screen only", () => {
  beforeEach(() => {
    db.templates.set("home", { id: "home", name: "My App", sourceType: "REACT_PROJECT", liveBuildId: "b1" });
    db.files.set("site/b1/index.html", "<html><head></head><body><div id=root></div></body></html>");
    db.files.set("site/b1/__plexo/assets/app.js", "console.log('app')");
    db.files.set("site/b1/pricing/index.html", "<html><head></head><body>pre-rendered</body></html>");
  });
  const appSite = (plan: string) => {
    db.site = {
      status: "ok",
      published: {
        templateId: "home",
        domain: HOST,
        noindex: false,
        template: db.templates.get("home"),
        user: { subscriptionPlan: plan, hideBranding: false },
        organization: { id: "org1", logo: null, whiteLabelEnabled: false },
      },
    };
  };

  it("/ serves the app with a guard that keeps in-app navigation on the first screen", async () => {
    appSite("FREE");
    const res = await visit("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<div id=root>');
    expect(html).toContain('location.replace("/")');
  });

  it("other screens — router paths and pre-rendered pages — redirect to /; its scripts still load", async () => {
    appSite("FREE");
    for (const path of ["/dashboard", "/pricing", "/settings/profile"]) {
      const res = await visit(path);
      expect(res.status, path).toBe(302);
      expect(new URL(res.headers.get("location")!).pathname).toBe("/");
    }
    const js = await visit("/__plexo/assets/app.js");
    expect(js.status).toBe(200);
  });

  it("on a paid plan every screen works and there's no guard", async () => {
    appSite("PRO");
    const res = await visit("/dashboard");
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain('location.replace("/")');
  });
});

describe("a form on an uploaded site that posts to its own page", () => {
  // A real page's form carries the ticket the page asked for when it loaded (lib/forms/humanCheck.ts), a few seconds old by the time it is sent.
  const post = (path: string, fields: Record<string, string>, headers: Record<string, string> = {}, ticket: string | null = issueHumanCheck("home", Date.now() - 10_000)) => {
    const slug = path.split("/").filter(Boolean);
    return POST(
      new NextRequest(`https://${HOST}${path}`, { method: "POST", body: new URLSearchParams(ticket ? { ...fields, _plx_check: ticket } : fields), headers: { "content-type": "application/x-www-form-urlencoded", ...headers } }),
      { params: Promise.resolve({ domain: HOST, slug }) },
    );
  };
  beforeEach(() => {
    liveSite("PRO");
    page("contact", { parentId: "home", slug: "contact", sourceType: "RAW_UPLOAD" });
  });

  it("is collected in Form Submissions (not refused with 405) and the visitor goes back to the page", async () => {
    const res = await post("/contact", { name: "Ada", email: "ada@example.com", message: "Hello" }, { origin: `https://${HOST}` });
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get("location")!).pathname + new URL(res.headers.get("location")!).search).toBe("/contact?submitted=1");
    expect(db.submissions).toEqual([{ formName: "Contact", fields: { name: "Ada", email: "ada@example.com", message: "Hello" } }]);
  });

  it("drops a bot (filled hidden field) and a post from another site without recording anything, answering as if it worked", async () => {
    expect((await post("/contact", { name: "x", _hp_field: "spam" }, { origin: `https://${HOST}` })).status).toBe(303);
    expect((await post("/contact", { name: "x" }, { origin: "https://evil.example" })).status).toBe(303);
    expect(db.submissions).toEqual([]);
  });

  it("asks for something to be filled in when the form was empty", async () => {
    const res = await post("/contact", {}, { origin: `https://${HOST}` });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/fill in the form/i);
  });

  it("never records a call from a WordPress service (MalCare) or a post with no sign of a browser", async () => {
    const malcare = { BvMethod: "getdata", Bvplugname: "malcare", Apipage: "blogvault", Sig: "x", Pubkey: "y" };
    expect((await post("/contact", malcare, { origin: `https://${HOST}` })).status).toBe(200);
    expect((await post("/contact", { name: "Ada", email: "ada@example.com", message: "Hello" })).status).toBe(200);
    expect(db.submissions).toEqual([]);
  });

  it("asks a person to try again when there is no genuine ticket, or it was sent too fast, and records nothing", async () => {
    const withheld = await post("/contact", { name: "Ada", email: "ada@example.com", message: "Hello" }, { origin: `https://${HOST}` }, null);
    expect(withheld.status).toBe(303);
    expect(new URL(withheld.headers.get("location")!).search).toBe("?plexo_form_error=check");
    const tooFast = await post("/contact", { name: "Ada", email: "ada@example.com", message: "Hello" }, { origin: `https://${HOST}` }, issueHumanCheck("home", Date.now()));
    expect(new URL(tooFast.headers.get("location")!).search).toBe("?plexo_form_error=fast");
    const forged = await post("/contact", { name: "Ada", email: "ada@example.com", message: "Hello" }, { origin: `https://${HOST}` }, "v1.eyJzIjoiaG9tZSIsInQiOjF9.bad");
    expect(new URL(forged.headers.get("location")!).search).toBe("?plexo_form_error=check");
    const otherSite = await post("/contact", { name: "Ada", email: "ada@example.com", message: "Hello" }, { origin: `https://${HOST}` }, issueHumanCheck("another-site", Date.now() - 10_000));
    expect(new URL(otherSite.headers.get("location")!).search).toBe("?plexo_form_error=check");
    expect(db.submissions).toEqual([]);
  });

  it("other POSTs to the site are still refused", async () => {
    const res = await POST(new NextRequest(`https://${HOST}/contact`, { method: "POST", body: "{}", headers: { "content-type": "application/json" } }), { params: Promise.resolve({ domain: HOST, slug: ["contact"] }) });
    expect(res.status).toBe(405);
  });

  it("an old .html address redirects to the page's clean address", async () => {
    page("home", { sourceType: "RAW_UPLOAD" });
    liveSite("PRO", { sourceType: "RAW_UPLOAD" });
    const res = await visit("/contact.html");
    expect(res.status).toBe(301);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/contact");
  });
});
