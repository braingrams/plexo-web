// What SOL knows about what the owner is building — filled in by the onboarding flow (a
// parallel workstream stores it on the user record) and turned into a short block of the
// system prompt (lib/ai/solAgent.ts buildSolSystemPrompt). Everything here is optional: an
// owner who skipped onboarding just gets SOL's normal behaviour.

export type SolBuildGoal = "store" | "business-site" | "blog" | "course" | "link-in-bio" | "landing" | "app" | "explore";
export type SolExperience = "beginner" | "intermediate" | "pro";

export type SolBuildProfile = {
  goal?: SolBuildGoal;
  experience?: SolExperience;
  brand?: {
    name?: string;
    about?: string;
    industry?: string;
    tone?: string;
    colors?: string[];
    logoUrl?: string;
  };
  /** The owner's sites and which one (if any) was chosen (lib/ai/solSiteContext.ts): the intake never guesses a site. */
  sites?: Array<{ id: string; name?: string; updatedAt?: string; brand?: { colors?: string[]; logoUrl?: string; noLogo?: boolean } }>;
  siteSignal?: { explicitSiteId?: string; boundSiteId?: string; hintSiteId?: string };
};

const GOAL_LABEL: Record<SolBuildGoal, string> = {
  store: "an online store (selling products)",
  "business-site": "a website for their business",
  blog: "a blog",
  course: "a course or digital product to sell",
  "link-in-bio": "a simple link-in-bio page",
  landing: "a single landing page",
  app: "a web app (sign-ins, accounts or their own data)",
  explore: "nothing specific yet — they're exploring",
};

const GOAL_HINT: Partial<Record<SolBuildGoal, string>> = {
  store: "For a new site, plan a store: home, shop, about and contact (site_create with a store page turns selling on).",
  "business-site": "For a new site, plan a few connected pages (home, about, services, contact — plus pricing or a gallery if it fits).",
  blog: "For a new site, include a blog (site_create with a blog page) with two or three first posts written for them.",
  course: "For a new site, a sales page with a buy card (sell_product_on_page) is usually the fastest route to the first sale.",
  "link-in-bio": "Keep it to one short, mobile-first page.",
  landing: "Keep it to one strong page unless they ask for more.",
  app: "When they describe something with sign-ins, accounts, dashboards or their own data, it's a React app (create_app).",
  explore: "Suggest two or three concrete things they could make, and offer to build one.",
};

const clean = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/**
 * The profile as a prompt block, or "" when there's nothing useful in it. Values come from
 * the owner's own onboarding answers — they're context about the business, not instructions,
 * so they're quoted and length-capped.
 */
export function solBuildProfilePrompt(profile?: SolBuildProfile): string {
  if (!profile) return "";
  const lines: string[] = [];
  if (profile.goal && GOAL_LABEL[profile.goal]) lines.push(`- They're building ${GOAL_LABEL[profile.goal]}.`);
  const b = profile.brand ?? {};
  const name = clean(b.name, 80);
  const about = clean(b.about, 400);
  const industry = clean(b.industry, 80);
  const tone = clean(b.tone, 80);
  const colors = Array.isArray(b.colors) ? b.colors.map((c) => clean(c, 24)).filter(Boolean).slice(0, 5) : [];
  const logo = clean(b.logoUrl, 500);
  if (name) lines.push(`- Business name: "${name}".`);
  if (about) lines.push(`- What they do: "${about}".`);
  if (industry) lines.push(`- Industry: "${industry}".`);
  if (tone) lines.push(`- The feel they want: "${tone}".`);
  if (colors.length) lines.push(`- Brand colours: ${colors.map((c) => `"${c}"`).join(", ")}.`);
  if (/^https?:\/\//i.test(logo)) lines.push(`- Logo: ${logo}`);

  const experience = profile.experience;
  if (!lines.length && !experience) return "";

  const parts = ["## What this owner is building (from their onboarding)"];
  if (lines.length) {
    parts.push(lines.join("\n"));
    parts.push(
      "Treat these as answers you already have: don't ask for them again, and use them (name, about, industry, tone, colours, logo) in the brief you pass to site_create. Only ask about what's still missing and actually changes what you'd build.",
    );
  }
  if (profile.goal && GOAL_HINT[profile.goal]) parts.push(GOAL_HINT[profile.goal]!);
  if (experience === "beginner") {
    parts.push(
      "They're new to building websites. Use plain, everyday words (say \"your site's address\" not \"domain\", \"menu\" not \"navigation\"), explain what you did and what they can do next in a sentence or two, offer the obvious next step as a choice, and never assume they know how a feature works.",
    );
  } else if (experience === "pro") {
    parts.push("They're experienced. Be brief and precise, skip basic explanations, and go straight to the work.");
  }
  return parts.join("\n\n");
}

/**
 * What the owner is building, read from their user record (`buildProfile`, written by the
 * onboarding at /welcome/setup; their dashboard `experience` choice wins over the onboarding
 * answer). undefined when there's nothing — SOL then behaves normally. Never throws: a failed
 * read just means SOL works without the extra context.
 */
export async function loadBuildProfile(userId: string): Promise<SolBuildProfile | undefined> {
  try {
    // Imported lazily so the prompt helpers above stay free of database code (and cheap to test).
    const [{ User }, { readBuildProfile }, { parseExperience }] = await Promise.all([import("@/lib/db/coreEntities"), import("@/lib/dashboardV3/profile"), import("@/lib/dashboardV3/nav")]);
    const { data: user } = await User.get({ id: userId }).go({ attributes: ["buildProfile", "experience"] });
    if (!user) return undefined;
    const profile = readBuildProfile(user.buildProfile) ?? {};
    const experience = parseExperience(user.experience);
    if (experience) profile.experience = experience;
    return Object.keys(profile).length ? profile : undefined;
  } catch (err) {
    console.error("loadBuildProfile failed", err);
    return undefined;
  }
}
