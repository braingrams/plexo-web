import { describe, expect, it } from "vitest";
import { brandTokensCss, DEFAULT_BRAND_TOKENS, mergeBrandTokens, orgBrandTokenOverrides, SEMANTIC_ALIASES } from "@/lib/brandTokens";
import { dashboardV3EnvEnabled, isDashboardV3, v3EntryDestination } from "@/lib/dashboardV3/flag";
import { effectiveTheme, parseThemePreference, resolveThemePreference, themeCookieString } from "@/lib/dashboardV3/theme";
import { activeNavId, buildV3Nav } from "@/lib/dashboardV3/nav";
import { readBuildProfile, sanitizeBuildProfile, userExperience } from "@/lib/dashboardV3/profile";
import { pickCurrentSite, siteKindOf, type SiteSummary } from "@/lib/dashboardV3/sites";

describe("brand tokens css", () => {
  const css = brandTokensCss();

  it("scopes every rule to data-theme so the old dashboard and marketing site are untouched", () => {
    const selectors = css.match(/(^|})\s*([^{}@]+)\{/g) ?? [];
    expect(selectors.length).toBeGreaterThan(0);
    for (const s of selectors) {
      const list = s.replace(/^}/, "").replace(/\{$/, "").split(",");
      for (const sel of list) expect(sel.trim()).toMatch(/\[data-theme="(light|dark|system)"\]$/);
    }
  });

  it("emits light, dark and system (via prefers-color-scheme) with Strata names", () => {
    expect(css).toContain(':root[data-theme="light"]');
    expect(css).toContain('[data-plexo-v3][data-theme="dark"]');
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\)\{[^}]*\[data-theme="system"\]\{color-scheme:dark;/);
    expect(css).toContain("--color-bg-canvas:#F7F8F3;");
    expect(css).toContain("--color-bg-canvas:#0B0B12;");
    expect(css).toContain("--color-action-primary-bg:#B8F34A;");
  });

  it("defines every semantic alias in terms of a Strata token that exists in both modes", () => {
    for (const [alias, target] of Object.entries(SEMANTIC_ALIASES)) {
      expect(css).toContain(`--${alias}:var(--${target});`);
      const inLight = target in DEFAULT_BRAND_TOKENS.light || css.includes(`--${target}:`);
      expect(inLight, `${alias} → ${target}`).toBe(true);
    }
    expect(Object.keys(DEFAULT_BRAND_TOKENS.light).sort()).toEqual(Object.keys(DEFAULT_BRAND_TOKENS.dark).sort());
  });

  it("is pure and takes live overrides (e.g. from Strata)", () => {
    expect(brandTokensCss()).toBe(css);
    const live = brandTokensCss(mergeBrandTokens({ light: { "color-action-primary-bg": "#FF00AA" } }));
    expect(live).toContain("--color-action-primary-bg:#FF00AA;");
    expect(live).toContain("--color-action-primary-bg:#B8F34A;"); // dark untouched
  });

  it("drops token names/values that could break out of the stylesheet", () => {
    const bad = brandTokensCss({ light: { "color-x": "red;}body{display:none", "bad name": "1px", "color-ok": "#123456" }, dark: {} });
    expect(bad).not.toContain("display:none");
    expect(bad).not.toContain("bad name");
    expect(bad).toContain("--color-ok:#123456;");
  });

  it("white-label colours pick readable text", () => {
    expect(orgBrandTokenOverrides("#FFE600").light?.["color-action-primary-text"]).toBe("#121212");
    expect(orgBrandTokenOverrides("#1A237E").light?.["color-action-primary-text"]).toBe("#F4F5F0");
    expect(orgBrandTokenOverrides("not a colour")).toEqual({});
    expect(orgBrandTokenOverrides(undefined)).toEqual({});
  });
});

describe("DASHBOARD_V3 flag", () => {
  it("reads the env flag", () => {
    expect(dashboardV3EnvEnabled("true")).toBe(true);
    expect(dashboardV3EnvEnabled(" ON ")).toBe(true);
    expect(dashboardV3EnvEnabled("1")).toBe(true);
    expect(dashboardV3EnvEnabled("false")).toBe(false);
    expect(dashboardV3EnvEnabled(undefined)).toBe(false);
    expect(dashboardV3EnvEnabled("")).toBe(false);
  });

  it("the user's own override wins either way", () => {
    expect(isDashboardV3({ dashboardV3: true }, undefined)).toBe(true);
    expect(isDashboardV3({ dashboardV3: false }, "true")).toBe(false);
    expect(isDashboardV3({}, "true")).toBe(true);
    expect(isDashboardV3({ dashboardV3: null }, undefined)).toBe(false);
    expect(isDashboardV3(null, "true")).toBe(true);
  });
});

describe("v3 entry routing", () => {
  it("sends anyone who hasn't done the new setup to it, once", () => {
    expect(v3EntryDestination({})).toBe("onboarding");
    expect(v3EntryDestination({ onboardingVersion: 2 })).toBe("onboarding");
    expect(v3EntryDestination(undefined)).toBe("onboarding");
  });
  it("lets them in after finishing or choosing Continue later", () => {
    expect(v3EntryDestination({ onboardingVersion: 3 })).toBe("home");
    expect(v3EntryDestination({ onboardingVersion: 4 })).toBe("home");
    expect(v3EntryDestination({ onboardingVersion: 1, onboardingDeferredAt: "2026-11-16T10:00:00Z" })).toBe("home");
  });
});

describe("theme preference", () => {
  it("account choice, then cookie, then System", () => {
    expect(resolveThemePreference({ user: "dark", cookie: "light" })).toBe("dark");
    expect(resolveThemePreference({ user: null, cookie: "light" })).toBe("light");
    expect(resolveThemePreference({ user: "purple", cookie: "nope" })).toBe("system");
    expect(resolveThemePreference({})).toBe("system");
  });
  it("resolves System from the OS setting", () => {
    expect(effectiveTheme("system", true)).toBe("dark");
    expect(effectiveTheme("system", false)).toBe("light");
    expect(effectiveTheme("light", true)).toBe("light");
  });
  it("parses and writes the cookie", () => {
    expect(parseThemePreference("dark")).toBe("dark");
    expect(parseThemePreference("DARK")).toBeNull();
    expect(themeCookieString("light")).toMatch(/^plexo-theme=light; Path=\/; Max-Age=\d+; SameSite=Lax$/);
  });
});

describe("nav by experience and goal", () => {
  const labels = (input: Parameters<typeof buildV3Nav>[0]) => buildV3Nav(input).map((n) => n.label);

  it("beginners see a short menu: Home, their site, Ask SOL, Emails and Settings", () => {
    expect(labels({ experience: "beginner", goal: "business-site", siteCount: 1 })).toEqual(["Home", "My site", "Ask SOL", "Emails", "Settings"]);
    expect(labels({ experience: "beginner", goal: "blog", siteCount: 2 })).toEqual(["Home", "My sites", "Ask SOL", "Emails", "Settings"]);
    expect(labels({})).toEqual(["Home", "My site", "Ask SOL", "Emails", "Settings"]);
  });

  it("adds Orders when they sell and Learners for a course", () => {
    expect(labels({ experience: "beginner", goal: "store" })).toEqual(["Home", "My site", "Orders", "Products", "Ask SOL", "Emails", "Settings"]);
    expect(labels({ experience: "beginner", goal: "course" })).toEqual(["Home", "My site", "Learners", "Ask SOL", "Emails", "Settings"]);
    expect(labels({ experience: "beginner", goal: "blog", sells: true })).toContain("Orders");
  });

  it("intermediate adds Domains; pro adds Developers", () => {
    expect(labels({ experience: "intermediate", goal: "business-site" })).toEqual(["Home", "Sites & apps", "Ask SOL", "Emails", "Domains", "Settings"]);
    expect(labels({ experience: "pro", goal: "store" })).toEqual(["Home", "Sites & apps", "Orders", "Products", "Ask SOL", "Emails", "Domains", "Developers", "Settings"]);
  });

  it("never offers more than five tab-bar places to a beginner", () => {
    const nav = buildV3Nav({ experience: "beginner", goal: "store", teaches: true });
    expect(nav.filter((n) => n.primary).length).toBeLessThanOrEqual(5);
  });

  it("marks the current page", () => {
    const nav = buildV3Nav({ experience: "pro" });
    expect(activeNavId(nav, "/dashboard")).toBe("home");
    expect(activeNavId(nav, "/dashboard/sites/abc")).toBe("sites");
    expect(activeNavId(nav, "/dashboard/settings/developers")).toBe("developers");
    expect(activeNavId(nav, "/dashboard/settings")).toBe("settings");
    expect(activeNavId(nav, "/elsewhere")).toBeNull();
  });
});

describe("build profile", () => {
  it("keeps valid answers and trims them", () => {
    const r = sanitizeBuildProfile({ goal: "store", experience: "beginner", brand: { name: "  Ama's   Kitchen ", colors: ["#E4572E", "tomato"], logoUrl: "https://cdn.example.com/a.png" }, junk: 1 });
    expect(r).toEqual({ ok: true, value: { goal: "store", experience: "beginner", brand: { name: "Ama's Kitchen", colors: ["#E4572E", "tomato"], logoUrl: "https://cdn.example.com/a.png" } } });
  });
  it("explains problems in plain words", () => {
    const bad = sanitizeBuildProfile({ goal: "spaceship" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/choose what you want to make/);
    expect(sanitizeBuildProfile({ brand: { colors: ["red;}"] } }).ok).toBe(false);
    expect(sanitizeBuildProfile({ brand: { logoUrl: "javascript:alert(1)" } }).ok).toBe(false);
    expect(sanitizeBuildProfile({ brand: { name: "x".repeat(101) } }).ok).toBe(false);
    expect(sanitizeBuildProfile("nope").ok).toBe(false);
  });
  it("reads stored data defensively and picks the experience", () => {
    expect(readBuildProfile(undefined)).toBeUndefined();
    expect(readBuildProfile({ goal: "blog", brand: { logoUrl: "http://insecure" } })).toEqual({ goal: "blog" });
    expect(userExperience({ experience: "pro", buildProfile: { experience: "beginner" } })).toBe("pro");
    expect(userExperience({ buildProfile: { experience: "intermediate" } })).toBe("intermediate");
    expect(userExperience(null)).toBe("beginner");
  });
});

describe("sites", () => {
  const sites: SiteSummary[] = [
    { id: "a", name: "A", kind: "Website", status: "live", updatedAt: "2026-01-01" },
    { id: "b", name: "B", kind: "Blog", status: "draft", updatedAt: "2026-03-01" },
  ];
  it("shows the site they picked, else the most recently edited", () => {
    expect(pickCurrentSite(sites, "a")?.id).toBe("a");
    expect(pickCurrentSite(sites, "gone")?.id).toBe("b");
    expect(pickCurrentSite(sites)?.id).toBe("b");
    expect(pickCurrentSite([], "a")).toBeNull();
  });
  it("labels sites in plain words", () => {
    expect(siteKindOf({ sourceType: "REACT_PROJECT" })).toBe("App with sign-in");
    expect(siteKindOf({ isLmsFunnel: true })).toBe("Course");
    expect(siteKindOf({})).toBe("Website");
  });
});

describe("starting an email", () => {
  it("gives every experience level an Emails menu item", () => {
    for (const experience of ["beginner", "intermediate", "pro"] as const) {
      expect(buildV3Nav({ experience }).some((n) => n.id === "emails" && n.href === "/dashboard/emails")).toBe(true);
    }
  });
  it("sends SOL a ready-typed request and Back to the right emails list", async () => {
    const { solEmailHref, emailsListHref, NEW_EMAIL_HREF } = await import("@/lib/dashboardV3/emails");
    expect(solEmailHref()).toMatch(/^\/dashboard\/sol\?new=1&draft=Write%20an%20email/);
    expect(emailsListHref(true)).toBe("/dashboard/emails");
    expect(emailsListHref(false)).toBe("/dashboard/templates?filter=EMAIL");
    expect(NEW_EMAIL_HREF).toBe("/dashboard/emails?new=1");
  });
});

describe("classic dashboard: finding emails", () => {
  it("opens the list on emails from ?filter=EMAIL, and ignores nonsense", async () => {
    const { parseTemplatesFilter } = await import("@/lib/templatesFilter");
    expect(parseTemplatesFilter("EMAIL")).toBe("EMAIL");
    expect(parseTemplatesFilter("email")).toBe("EMAIL");
    expect(parseTemplatesFilter(["FUNNEL"])).toBe("FUNNEL");
    expect(parseTemplatesFilter("junk")).toBe("ALL");
    expect(parseTemplatesFilter(null)).toBe("ALL");
  });
  it("has an Emails item in the classic menu that lights up on the templates list", async () => {
    const { NAV_ITEMS, isNavItemActive } = await import("@/app/dashboard/nav-items");
    const emails = NAV_ITEMS.find((n) => n.label === "Emails")!;
    expect(emails.href).toBe("/dashboard/templates?filter=EMAIL");
    expect(isNavItemActive(emails, "/dashboard/templates")).toBe(true);
    expect(isNavItemActive(emails, "/dashboard/pages")).toBe(false);
    expect(isNavItemActive(NAV_ITEMS[0], "/dashboard/pages")).toBe(false);
  });
});
