/**
 * The guided "next steps" for a site, computed from what really exists (SPEC "Guided tasks").
 * Nothing here is stored: ticking a step happens because the product, the payment details, the
 * web address... now exist, so the list can never drift from reality. Pure.
 */
import type { SolBuildGoal } from "@/lib/ai/solBuildContext";

export type TaskVariant = "store" | "payments" | "business" | "blog" | "course" | "link" | "app";

/** What the dashboard knows about one site, gathered by lib/dashboardV3/homeData.ts. */
export type SiteFacts = {
  /** A site exists (so "pick a design" is done). */
  hasSite: boolean;
  hasLogo: boolean;
  /** They said they don't have a logo (one is made from the name), so the step doesn't wait for one. */
  logoSkipped: boolean;
  hasColors: boolean;
  /** The owner has edited the site since it was made (words, contact details, links...). */
  edited: boolean;
  productCount: number;
  /** Bank-transfer details or live card keys are in place. */
  paymentsReady: boolean;
  postCount: number;
  lessonCount: number;
  /** A paid course with a price, or any lesson set up as free. */
  priceSet: boolean;
  /** The site has an active web address. */
  hasAddress: boolean;
  /** The site has been published at least once. */
  published: boolean;
  /** The app's sign-in is switched on. */
  signInOn: boolean;
  /** An uploaded page: it came with its own look, so there is no logo or colour step to do here. */
  ownDesign: boolean;
  /** Personalized directly with SOL AI (words, cards, images tailored). */
  personalizedWithSol: boolean;
  /** The owner gave SOL their phone, email or address while it personalized the site. */
  contactProvided: boolean;
};

/**
 * Has this been put online at least once? A site records that as its active version; an app (built and run on Plexo) records it as its
 * live build. Reading only the first made a published app on its own domain keep asking to "Put your app online".
 */
export function isPublished(t: { activeVersionId?: string | null; liveBuildId?: string | null } | null | undefined): boolean {
  return !!(t?.activeVersionId || t?.liveBuildId);
}

export const EMPTY_FACTS: SiteFacts = {
  hasSite: false,
  hasLogo: false,
  logoSkipped: false,
  hasColors: false,
  edited: false,
  productCount: 0,
  paymentsReady: false,
  postCount: 0,
  lessonCount: 0,
  priceSet: false,
  hasAddress: false,
  published: false,
  signInOn: false,
  ownDesign: false,
  personalizedWithSol: false,
  contactProvided: false,
};

export type TaskId = "design" | "brand" | "product" | "pay" | "words" | "contact" | "post" | "lesson" | "price" | "links" | "describe" | "signin" | "finish" | "live";

/** How a task is finished on the page: an inline form, or a link to the place it's done. */
export type TaskKind = "auto" | "product" | "pay" | "finish" | "link";

export type TaskDef = { id: TaskId; title: string; description: string; kind: TaskKind; help: string; done: (f: SiteFacts) => boolean };

const design: TaskDef = { id: "design", title: "Pick a design", description: "You chose one that fits you. You can change it any time.", kind: "auto", help: "Choosing a design", done: (f) => f.hasSite };
const brand: TaskDef = { id: "brand", title: "Add your logo and colours", description: "So your site looks like you.", kind: "link", help: "Adding your logo and colours", done: (f) => (f.hasColors && (f.hasLogo || f.logoSkipped)) || f.ownDesign || (f.hasAddress && f.published) };
/** Choosing the web address and going online used to be two steps that said almost the same thing. They are one: pick the address, tap once, you're online. */
const finish: TaskDef = { id: "finish", title: "Finish up", description: "Pick your web address and put your site online, in one tap. You can keep editing after.", kind: "finish", help: "Finishing up", done: (f) => f.hasAddress && f.published };

const pay: TaskDef = { id: "pay", title: "Choose how you get paid", description: "Card payments or a bank transfer, whichever suits you.", kind: "pay", help: "Getting paid", done: (f) => f.paymentsReady };

const VARIANTS: Record<TaskVariant, TaskDef[]> = {
  store: [
    design,
    brand,
    { id: "product", title: "Add your first product", description: "What are you selling, and for how much?", kind: "product", help: "Adding your first product", done: (f) => f.productCount > 0 },
    pay,
    finish,
  ],
  payments: [
    design,
    brand,
    pay,
    finish,
  ],
  business: [
    design,
    brand,
    { id: "words", title: "Check the words on your pages", description: "Make sure it says what you want, the way you'd say it.", kind: "link", help: "Editing the words on your site", done: (f) => f.edited || f.personalizedWithSol },
    { id: "contact", title: "Add your contact details", description: "Phone, email and where to find you.", kind: "link", help: "Adding contact details", done: (f) => f.edited || f.contactProvided },
    finish,
  ],
  blog: [
    design,
    { id: "post", title: "Write your first post", description: "A few lines is enough to start. SOL can help you draft it.", kind: "link", help: "Writing your first post", done: (f) => f.postCount > 0 },
    finish,
  ],
  course: [
    design,
    { id: "lesson", title: "Add your first lesson", description: "A video, some words, or both.", kind: "link", help: "Adding your first lesson", done: (f) => f.lessonCount > 0 },
    { id: "price", title: "Set a price, or make it free", description: "You decide what people pay to join.", kind: "link", help: "Setting your course price", done: (f) => f.priceSet },
    finish,
  ],
  link: [
    design,
    { id: "links", title: "Add your links", description: "Everything you want people to find in one place.", kind: "link", help: "Adding your links", done: (f) => f.edited || f.personalizedWithSol },
    finish,
  ],
  app: [
    { id: "describe", title: "Describe your app", description: "Tell SOL what it should do, in your own words.", kind: "link", help: "Describing your app", done: (f) => f.hasSite },
    { id: "signin", title: "Turn on sign-in", description: "So people can make an account and come back.", kind: "link", help: "Turning on sign-in", done: (f) => f.signInOn },
    { id: "live", title: "Put your app online", description: "One tap and anyone can use it.", kind: "link", help: "Putting your app online", done: (f) => f.hasAddress && f.published },
  ],
};

/** Which list of steps a site gets: what the site is first (a store is a store), then what they said they wanted. */
export function taskVariantFor(site: { kind?: string | null; sells?: boolean; hasDonations?: boolean; productCount?: number }, goal?: SolBuildGoal | null): TaskVariant {
  if (site.productCount && site.productCount > 0) return "store";
  if (site.hasDonations) return "payments";
  if (site.kind === "WordPress migrated site") {
    if (site.sells) return "payments";
    return "business";
  }
  if (site.sells || site.kind === "Online store") return "store";
  if (site.kind === "App with sign-in") return "app";
  if (site.kind === "Course") return "course";
  if (site.kind === "Blog") return "blog";
  if (goal === "store") return "store";
  if (goal === "blog") return "blog";
  if (goal === "course") return "course";
  if (goal === "link-in-bio") return "link";
  if (goal === "app") return "app";
  return "business";
}

export type TaskView = { id: TaskId; title: string; description: string; kind: TaskKind; help: string; state: "done" | "current" | "upcoming" };
export type TaskProgress = { variant: TaskVariant; /** The site already has its web address (so "Finish up" only needs the last tap). */ hasAddress: boolean; tasks: TaskView[]; done: number; total: number; currentId: TaskId | null; allDone: boolean };

export function computeTasks(variant: TaskVariant, facts: SiteFacts): TaskProgress {
  const defs = VARIANTS[variant];
  const flags = defs.map((d) => d.done(facts));
  const firstOpen = flags.findIndex((d) => !d);
  const tasks: TaskView[] = defs.map(({ done: _done, ...d }, i) => {
    let title = d.title;
    let description = d.description;
    if (facts.personalizedWithSol) {
      if (d.id === "words") {
        title = "Personalized with SOL";
        description = "SOL tailored your page words, story, and photos to your brand. Tap to review or tweak anything.";
      } else if (d.id === "contact" && facts.contactProvided) {
        description = "SOL added the phone, email or address you gave it. Tap to check or change them.";
      } else if (d.id === "links") {
        title = "Links personalized with SOL";
        description = "SOL set up your initial profile and links. Tap to review or add more.";
      }
    }
    return {
      ...d,
      title,
      description,
      state: flags[i] ? "done" : i === firstOpen ? "current" : "upcoming",
    };
  });
  const done = flags.filter(Boolean).length;
  return { variant, hasAddress: facts.hasAddress, tasks, done, total: defs.length, currentId: firstOpen === -1 ? null : defs[firstOpen].id, allDone: firstOpen === -1 };
}

const SLUG_STOP = /[^a-z0-9]+/g;

/** A friendly starting web address from the business name ("Ama's Kitchen" -> "amas-kitchen"). */
export function suggestAddressLabel(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, "")
    .replace(SLUG_STOP, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return base.length >= 3 ? base : base ? `${base}-site` : "my-site";
}

/** Whole-number amounts like "8,500" or "8500.50" to minor units (kobo/cents). null when it isn't a usable price. */
export function parsePriceToMinor(input: string): number | null {
  const cleaned = input.replace(/[^\d.,]/g, "").replace(/,/g, "");
  if (!cleaned || !/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const n = Math.round(parseFloat(cleaned) * 100);
  return Number.isFinite(n) ? n : null;
}
