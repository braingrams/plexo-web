import { describe, expect, it } from "vitest";
import { filterListings, onboardingReturnPath, paginate, priceBadge, rankListings, topCategories, useLabel, type MarketListing } from "@/lib/onboarding/marketDesigns";

const L = (o: Partial<MarketListing> & { id: string }): MarketListing => ({ name: o.id, kind: "LANDING_PAGE", category: null, description: null, priceCents: 0, purchaseCount: 0, publishedAt: null, ...o });

describe("rankListings", () => {
  it("drops email designs and puts the best fit for the goal first", () => {
    const r = rankListings(
      [L({ id: "mail", kind: "EMAIL", category: "Shop" }), L({ id: "blog", category: "Blog" }), L({ id: "shop", category: "Online shop", name: "Boutique" }), L({ id: "other" })],
      "store",
    );
    expect(r[0].id).toBe("shop");
    expect(r[0].bestFit).toBe(true);
    expect(r.find((x) => x.id === "mail")).toBeUndefined();
    expect(r.find((x) => x.id === "other")?.bestFit).toBe(false);
  });
  it("breaks ties by most used, then newest", () => {
    const r = rankListings([L({ id: "a", purchaseCount: 1, publishedAt: "2026-01-01" }), L({ id: "b", purchaseCount: 5 }), L({ id: "c", purchaseCount: 1, publishedAt: "2026-06-01" })], "blog");
    expect(r.map((x) => x.id)).toEqual(["b", "c", "a"]);
  });
  it("uses what the owner does", () => {
    const r = rankListings([L({ id: "a", category: "Photography" }), L({ id: "b", category: "Restaurant" })], "explore", { about: "I run a small restaurant in Lagos" });
    expect(r[0].id).toBe("b");
  });
  it("maps every goal to some words", () => {
    for (const g of ["store", "business-site", "blog", "course", "landing", "link-in-bio", "explore", undefined]) expect(rankListings([L({ id: "x" })], g)).toHaveLength(1);
  });
});

describe("filters and labels", () => {
  const items = [L({ id: "f", name: "Fresh", category: "Food", priceCents: 0 }), L({ id: "p", name: "Pro", category: "Tech", priceCents: 1250, description: "for startups" })];
  it("filters by price, category and search", () => {
    expect(filterListings(items, { price: "free" }).map((x) => x.id)).toEqual(["f"]);
    expect(filterListings(items, { price: "paid" }).map((x) => x.id)).toEqual(["p"]);
    expect(filterListings(items, { category: "Tech" }).map((x) => x.id)).toEqual(["p"]);
    expect(filterListings(items, { q: " STARTUP " }).map((x) => x.id)).toEqual(["p"]);
    expect(filterListings(items, {})).toHaveLength(2);
  });
  it("lists common categories first", () => {
    expect(topCategories([L({ id: "1", category: "B" }), L({ id: "2", category: "A" }), L({ id: "3", category: "A" }), L({ id: "4" })])).toEqual(["A", "B"]);
  });
  it("labels free, paid and owned designs", () => {
    expect(priceBadge(0)).toEqual({ label: "Free", free: true });
    expect(priceBadge(1250).label).toBe("$12.50");
    expect(priceBadge(2000).label).toBe("$20");
    expect(priceBadge(2000, true).label).toBe("You own this");
    expect(useLabel(0, false)).toBe("Use this design");
    expect(useLabel(2000, true)).toBe("Use this design");
    expect(useLabel(2000, false)).toBe("Buy for $20 and use");
  });
  it("paginates safely", () => {
    expect(paginate([1, 2, 3, 4, 5], 2, 2)).toEqual({ items: [3, 4], page: 2, pageCount: 3 });
    expect(paginate([1], 9, 2).page).toBe(1);
    expect(paginate([], 1, 2).pageCount).toBe(1);
  });
});

describe("onboardingReturnPath", () => {
  it("only returns to the setup page", () => {
    expect(onboardingReturnPath("/welcome/setup", "abc")).toBe("/welcome/setup?paidDesign=abc");
    expect(onboardingReturnPath("/welcome/setup?new=1", "abc")).toBe("/welcome/setup?new=1&paidDesign=abc");
    expect(onboardingReturnPath("https://evil.com", "abc")).toBeNull();
    expect(onboardingReturnPath("/welcome/setup/../../x", "abc")).toBeNull();
    expect(onboardingReturnPath(undefined, "abc")).toBeNull();
  });
});

describe("personalizeTemplateHtml", () => {
  it("edits the chosen template directly instead of generating an old orchestrator mock", async () => {
    const { personalizeTemplateHtml } = await import("@/lib/onboarding/personalize");

    const templateHtml = `<!doctype html>
<html>
<head><title>Chef Tomi: food creator link in bio</title></head>
<body>
  <nav><span class="logo">Chef Tomi</span></nav>
  <div class="hero">
    <h1>Original Chef Tomi Headline</h1>
    <p class="lead">Original recipe and culinary blog description.</p>
    <a href="#cta" class="btn primary">Get started</a>
  </div>
  <div class="bento-grid">
    <div class="card">Recipe Video</div>
  </div>
</body>
</html>`;

    const result = personalizeTemplateHtml({
      html: templateHtml,
      name: "Murano",
      about: "I want people to see my shows and performances",
      templateName: "Chef Tomi: food creator link in bio",
      brandColor: "#7c3aed",
    });

    // 1. Must preserve the original template structure (e.g. bento-grid, nav)
    expect(result.html).toContain('class="bento-grid"');
    expect(result.html).toContain('class="card">Recipe Video');

    // 2. Must replace the original brand name with the owner's name
    expect(result.html).toContain('<span class="logo">Murano</span>');
    expect(result.html).not.toContain('<span class="logo">Chef Tomi</span>');

    // 3. Must tailor the headline to the owner's name and performance intent
    expect(result.html).toContain("Murano — Live Shows &amp; Performances");

    // 4. Must personalize the subhero text with the owner's about description
    expect(result.html).toContain("I want people to see my shows and performances");

    // 5. Must personalize the CTA button
    expect(result.html).toContain("See upcoming shows");

    // 6. Must update document title
    expect(result.html).toContain("<title>Murano — Live Shows &amp; Performances</title>");

    // 7. Must inject brand accent color
    expect(result.html).toContain("--brand:#7c3aed");

    // 8. Must stamp data-sol-personalized for facts/checklist detection
    expect(result.html).toContain('data-sol-personalized="true"');
  });

  it("prioritizes musician template over food template when user describes being an artist", () => {
    const r = rankListings(
      [
        L({ id: "chef", name: "Chef Tomi: food creator link in bio", category: "Link in bio", description: "A bento-grid link hub for a food creator or home cook: mixed-size photo tiles li" }),
        L({ id: "noor", name: "Noor Vale: musician link in bio", category: "Link in bio", description: "A full-bleed stage-photo link hub for a singer or band: smoked-glass link button" }),
      ],
      "link-in-bio",
      {
        about: "I want users to see what i do, as i am an artist so i want them to see my shows, performance and latest release music video and audio from spotify",
        name: "Murano",
      }
    );
    expect(r[0].id).toBe("noor");
    expect(r[0].score).toBeGreaterThan(r[1].score);
  });

  it("deeply replaces images, bento tiles, and footers across the template", async () => {
    const { personalizeTemplateHtml } = await import("@/lib/onboarding/personalize");

    const templateHtml = `<!doctype html>
<html>
<head><title>Chef Tomi: food creator link in bio</title></head>
<body>
  <nav><span class="logo">Chef Tomi</span></nav>
  <div class="hero">
    <span class="badge">● COOKING VIDEOS EVERY SUNDAY</span>
    <h1>Murano — Live Shows & Performances</h1>
    <p class="lead">Original recipe and culinary blog description.</p>
  </div>
  <div class="bento-grid">
    <div class="card">
      <img src="https://images.unsplash.com/pasta.jpg" alt="Pasta" />
      <h3>Watch: 20-minute tagliatelle with burst tomatoes</h3>
    </div>
    <div class="card">
      <img src="https://images.unsplash.com/bread.jpg" alt="Bread" />
      <h3>Focaccia for scaredy-cats</h3>
    </div>
    <div class="card stat">
      <span>112 RECIPES</span>
      <p>The Sunday Table: my first cookbook</p>
    </div>
  </div>
  <section class="strip">
    <h2>Dinner in 20, 40 or 90 minutes.</h2>
    <div class="recipe-card">Fridge-raid fusilli</div>
    <div class="recipe-card">Pizza dough you cannot ruin</div>
    <div class="recipe-card">Jollof arancini</div>
    <button>Cook this tonight</button>
  </section>
  <section class="form">
    <h3>The Sunday Supper Letter</h3>
    <p>One recipe, one story, every Sunday morning.</p>
    <label>What should Tomi call you?</label>
    <button>Send me Sunday's recipe</button>
  </section>
  <footer>
    <p>© 2026 Murano Kitchen Ltd · Brand and sponsorship: partners@tomiskitchen.co · Pans, knives and oil are in the shop, and yes, I use all of them.</p>
  </footer>
</body>
</html>`;

    const result = personalizeTemplateHtml({
      html: templateHtml,
      name: "Murano",
      about: "I want users to see what i do, as i am an artist so i want them to see my shows, performance and latest release music video and audio from spotify",
      templateName: "Chef Tomi: food creator link in bio",
    });

    // Images must be replaced with domain stock photos (no pasta/bread)
    expect(result.html).not.toContain("https://images.unsplash.com/pasta.jpg");
    expect(result.html).not.toContain("https://images.unsplash.com/bread.jpg");
    expect(result.html).toContain("https://images.unsplash.com/photo-");

    // Bento cards must be transformed
    expect(result.html).toContain("Watch: Official Music Video &amp; Studio Session");
    expect(result.html).toContain("Stream on Spotify &amp; Apple Music");
    expect(result.html).toContain("150K+ LISTENERS");

    // Feature strip must be transformed
    expect(result.html).toContain("Upcoming Live Tour Dates &amp; Shows");
    expect(result.html).toContain("London — Roundhouse");
    expect(result.html).toContain("Paris — Le Trianon");
    expect(result.html).toContain("Berlin — Astra Kulturhaus");
    expect(result.html).toContain("Get tickets");

    // Form and footer must be transformed
    expect(result.html).toContain("The VIP Backstage Pass");
    expect(result.html).toContain("What should we call you?");
    expect(result.html).toContain("Get Tour &amp; Ticket Alerts");
    expect(result.html).toContain("booking@murano.com");
    expect(result.html).toContain("Streaming live on Spotify, Apple Music, and YouTube.");
  });

  it("deeply personalizes a strength gym template for a fitness business without raw prompt pasting", async () => {
    const { personalizeTemplateHtml } = await import("@/lib/onboarding/personalize");
    const rawTemplate = `<!doctype html>
<html>
<head><title>Iron &amp; Grain: strength gym and coaching</title></head>
<body>
  <nav><span class="logo">IRON &amp; GRAIN</span></nav>
  <div class="hero">
    <div class="badge">STRENGTH GYM · CHEESE LANE, BRISTOL</div>
    <h1>IRON &amp; GRAIN</h1>
    <p class="lead">Original coaching and barbells.</p>
    <div class="card">TODAY AT IRON &amp; GRAIN</div>
    <div class="class-item">Barbell Club</div>
    <a href="tel:0117 999 1234" class="btn">Claim your free week</a>
    <footer>© 2026 Iron &amp; Grain Ltd · Cheese Lane, Bristol</footer>
  </div>
</body>
</html>`;

    const result = personalizeTemplateHtml({
      html: rawTemplate,
      name: "Musti",
      about: "I run a gym business, and i want people to discover me and be able to reach out to me about fitness, workout and lifestyle",
      templateName: "Iron & Grain: strength gym and coaching",
      details: {
        location: "Lagos, Nigeria",
        whatsapp: "+2348012345678",
        offering: "Personal Training",
      },
    });

    // 1. Must replace brand name everywhere, including logo, title, and timetable
    expect(result.html).toContain("<title>Musti — Build Strength. Move Better. Welcome to Musti</title>");
    expect(result.html).toContain('<span class="logo">Musti</span>');
    expect(result.html).not.toContain("IRON &amp; GRAIN");
    expect(result.html).not.toContain("Iron &amp; Grain");
    expect(result.html).toContain("TODAY AT Musti");

    // 2. Must tailor the headline to strength/fitness (NOT compassionate holistic care)
    expect(result.html).toContain("Build Strength. Move Better. Welcome to Musti");
    expect(result.html).not.toContain("Compassionate, Holistic Care");

    // 3. Must NOT paste the raw first-person user prompt
    expect(result.html).not.toContain("I run a gym business, and i want people to discover me");
    expect(result.html).toContain("Musti is a premier strength gym and coaching studio");

    // 4. Must integrate location, whatsapp, and offering
    expect(result.html).toContain("STRENGTH GYM · LAGOS, NIGERIA");
    expect(result.html).toContain("Personal Training");
    expect(result.html).toContain("https://wa.me/2348012345678");
    expect(result.html).toContain("© 2026 Musti");
  });
});
