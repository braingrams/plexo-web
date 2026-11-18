/**
 * The onboarding wizard's pure logic (docs/redesign/SPEC.md "Onboarding"): the questions, what
 * counts as answered, which step to resume on, and what the answers become. No React, no
 * database — tested in tests/onboardingFlow.test.ts.
 */
import type { SolBuildGoal, SolBuildProfile, SolExperience } from "@/lib/ai/solBuildContext";

export const STEP_COUNT = 5;
export type StepIndex = 0 | 1 | 2 | 3 | 4;

/** The preview panel only shows once there's enough to make it look real (step 4 onward). */
export const PREVIEW_FROM_STEP = 3;

export type Feel = "warm" | "bold" | "calm" | "elegant";

export type OnboardingDraft = {
  name: string;
  about: string;
  goal: SolBuildGoal | "";
  experience: SolExperience | "";
  logoUrl: string;
  /** Colours picked out of the logo, offered first. */
  suggested: string[];
  color: string;
  feel: Feel | "";
  designId: string;
};

export const EMPTY_DRAFT: OnboardingDraft = { name: "", about: "", goal: "", experience: "", logoUrl: "", suggested: [], color: "", feel: "", designId: "" };

export const ABOUT_IDEAS = ["I sell homemade meals", "I run a hair salon", "I teach online", "I'm a photographer"] as const;

export const GOALS: { id: SolBuildGoal; title: string; text: string }[] = [
  { id: "store", title: "Sell products online", text: "A shop with checkout, payments and delivery, ready to go." },
  { id: "business-site", title: "A website for my business", text: "Home, about, services and contact pages." },
  { id: "blog", title: "Write a blog", text: "Share stories and updates people can find on Google." },
  { id: "course", title: "Sell a course or lessons", text: "Lessons people pay for and finish step by step." },
  { id: "link-in-bio", title: "One link for all my links", text: "A simple page for your Instagram or TikTok bio." },
  { id: "landing", title: "One page to promote something", text: "An event, a launch, a single product." },
  { id: "app", title: "An app people sign into", text: "Bookings, members, dashboards and saved data." },
  { id: "explore", title: "Just looking around", text: "Show me everything and let me explore." },
];

export const EXPERIENCES: { id: SolExperience; title: string; text: string }[] = [
  { id: "beginner", title: "I'm new to this", text: "We'll guide you one step at a time, in plain words." },
  { id: "intermediate", title: "I've made a site before", text: "Shortcuts and a few more options, still simple." },
  { id: "pro", title: "I build websites for a living", text: "Everything, including code, custom domain setup and developer tools." },
];

export const FEELS: { id: Feel; label: string; tone: string }[] = [
  { id: "warm", label: "Warm & friendly", tone: "warm & friendly" },
  { id: "bold", label: "Bold", tone: "bold" },
  { id: "calm", label: "Calm & clean", tone: "minimal, calm & clean" },
  { id: "elegant", label: "Elegant", tone: "elegant" },
];

/** Starting colours (the owner can also pick any colour). Data, not styling: the owner's brand colour. */
export const PALETTE: { name: string; hex: string }[] = [
  { name: "Tomato", hex: "#E4572E" },
  { name: "Ocean", hex: "#1F6FEB" },
  { name: "Forest", hex: "#1E7A4C" },
  { name: "Berry", hex: "#A23B8E" },
  { name: "Lime", hex: "#B8F34A" },
  { name: "Charcoal", hex: "#222222" },
];

export const HEX = /^#[0-9a-fA-F]{6}$/;

export const feelTone = (feel: string): string => FEELS.find((f) => f.id === feel)?.tone ?? "";
export const feelLabel = (feel: string): string => FEELS.find((f) => f.id === feel)?.label ?? "";

/** Can they move on from this step? (Step 1 needs a name; the rest can be skipped past with defaults.) */
export function canContinue(step: number, d: OnboardingDraft): boolean {
  switch (step) {
    case 0: return d.name.trim().length > 0;
    case 1: return d.goal !== "";
    case 2: return d.experience !== "";
    default: return true;
  }
}

/** The first step that still has an unanswered required question — where a returning owner picks up. */
export function resumeStep(d: OnboardingDraft): StepIndex {
  if (!canContinue(0, d)) return 0;
  if (!canContinue(1, d)) return 1;
  if (!canContinue(2, d)) return 2;
  return 3;
}

/** The plain-words reason the Continue button is waiting, or "". */
export function waitingHint(step: number, d: OnboardingDraft): string {
  if (canContinue(step, d)) return "";
  if (step === 0) return "Add a name to continue";
  if (step === 1) return "Pick the closest one to continue";
  return "Pick one to continue";
}

const clean = (v: string) => v.replace(/\s+/g, " ").trim();

/** What's saved on the user (the same shape SOL reads: lib/ai/solBuildContext.ts). */
export function draftToBuildProfile(d: OnboardingDraft, industry?: string): SolBuildProfile {
  const colors = [d.color, ...d.suggested].filter((c, i, a) => HEX.test(c) && a.indexOf(c) === i).slice(0, 4);
  const brand: NonNullable<SolBuildProfile["brand"]> = {};
  if (clean(d.name)) brand.name = clean(d.name).slice(0, 100);
  if (clean(d.about)) brand.about = clean(d.about).slice(0, 500);
  if (industry) brand.industry = industry;
  if (d.feel) brand.tone = feelTone(d.feel);
  if (colors.length) brand.colors = colors;
  if (/^https:\/\//i.test(d.logoUrl)) brand.logoUrl = d.logoUrl;
  const out: SolBuildProfile = {};
  if (d.goal) out.goal = d.goal;
  if (d.experience) out.experience = d.experience;
  if (Object.keys(brand).length) out.brand = brand;
  return out;
}

/** Fills a draft from what's already stored (a returning owner's earlier answers). */
export function draftFromBuildProfile(p: SolBuildProfile | undefined): OnboardingDraft {
  const b = p?.brand ?? {};
  const feel = FEELS.find((f) => f.tone === b.tone)?.id ?? "";
  const [color = "", ...rest] = b.colors ?? [];
  return { ...EMPTY_DRAFT, name: b.name ?? "", about: b.about ?? "", goal: p?.goal ?? "", experience: p?.experience ?? "", logoUrl: b.logoUrl ?? "", color, suggested: rest, feel };
}

/** Goals that end in a website made here; an app is built with Sol, so it skips picking a design. */
export const goalMakesSite = (goal: SolBuildGoal | ""): boolean => goal !== "" && goal !== "app";

/** Words for the live preview's menu and button, per goal (the real pages come from the design). */
export const NEXT_STEP_LABEL: Record<SolBuildGoal, string> = {
  store: "Your online store", "business-site": "Your business website", blog: "Your blog", course: "Your course page",
  "link-in-bio": "Your link page", landing: "Your promo page", app: "Your app", explore: "Your website",
};
