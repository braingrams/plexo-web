/**
 * The "Advanced" area of a site's hub (pros only): which sections a site shows, in what order, in plain words.
 * Pure. The hub page feeds it what the site is and what the owner's plan allows; see docs/ADVANCED_SETTINGS_PARITY.md.
 *
 * Three kinds of site, three section lists:
 *   site    a visual or own-code website (pages, shop, blog)
 *   app     an app built with the app builder (sign-in, data, server code)
 *   hosted  an app the owner brought as code (a server app or a static one)
 */
import type { Experience } from "./nav";
import type { HubFeatures } from "./hubTabs";

export type AdvancedKind = "site" | "app" | "hosted";

export type AdvancedSectionId =
  // websites
  | "seo" | "code" | "features" | "layout" | "lists" | "forms" | "redirects" | "scripts" | "versions" | "copy"
  // websites + hosted apps
  | "deploy" | "variables" | "github"
  // app builder
  | "appsettings" | "appseo" | "appsignin" | "appfiles" | "appcode" | "data" | "functions" | "secrets" | "users" | "history" | "publish" | "appgithub"
  // everyone
  | "danger";

export type AdvancedSection = { id: AdvancedSectionId; label: string; help: string };

const ALL: Record<AdvancedSectionId, AdvancedSection> = {
  seo: { id: "seo", label: "Search and sharing", help: "How your site shows up on Google and when someone shares a link, for the whole site and for each page." },
  code: { id: "code", label: "Code", help: "See the code behind each page. Pages you wrote yourself can be edited here." },
  features: { id: "features", label: "What is switched on", help: "Shop, blog, header and footer and your own lists: what this site uses and where to change it." },
  layout: { id: "layout", label: "Header and footer", help: "One header and footer, shared by every page." },
  lists: { id: "lists", label: "Your own lists", help: "Lists like videos, stories, events or team members that you show on pages." },
  forms: { id: "forms", label: "Forms", help: "What visitors send you, and where each form's messages go." },
  redirects: { id: "redirects", label: "Old links", help: "Send an old web address to a new page so nobody lands on a dead end." },
  scripts: { id: "scripts", label: "Scripts and embeds", help: "Ready-made blocks to paste into your own code, and permission to run scripts while you preview." },
  deploy: { id: "deploy", label: "Deploy and server", help: "Upload a new version, watch it build, and keep it always on." },
  variables: { id: "variables", label: "Variables and secrets", help: "Settings and passwords your app reads, like an API key." },
  github: { id: "github", label: "GitHub", help: "Keep your code in GitHub and update your app when you push." },
  versions: { id: "versions", label: "Versions", help: "Every saved version of a page, and going back to one." },
  copy: { id: "copy", label: "Copy, move or bring in", help: "Make a copy of this site, give it to another account, or bring in pages from another site." },
  appsettings: { id: "appsettings", label: "App name and address", help: "Your app's name and where people find it." },
  appseo: { id: "appseo", label: "Search and sharing", help: "How your app shows up on Google and when someone shares a link to it." },
  appsignin: { id: "appsignin", label: "Sign-in", help: "How people create accounts and log in to your app." },
  appfiles: { id: "appfiles", label: "Files", help: "Files people upload to your app, and who can see them." },
  appcode: { id: "appcode", label: "Code", help: "Every file in your app. Edit it here and the preview updates." },
  data: { id: "data", label: "Data", help: "The tables behind your app: look, edit and run queries." },
  functions: { id: "functions", label: "Server code and logs", help: "Code that runs on the server, and what it printed." },
  secrets: { id: "secrets", label: "Secret keys", help: "Passwords and API keys your app uses. They are saved safely and never shown again." },
  users: { id: "users", label: "People", help: "Everyone who has signed up to your app. Invite or remove people." },
  history: { id: "history", label: "History", help: "Every version of your app and every build, and going back." },
  publish: { id: "publish", label: "Publish", help: "Put your app online, or update the live one." },
  appgithub: { id: "appgithub", label: "GitHub", help: "Keep a copy of your app in GitHub and choose which side wins." },
  danger: { id: "danger", label: "Delete", help: "Remove this site for good." },
};

export function advancedKind(f: Pick<HubFeatures, "deployed" | "app">): AdvancedKind {
  if (f.deployed) return "hosted";
  return f.app ? "app" : "site";
}

export type AdvancedInput = {
  kind: AdvancedKind;
  experience: Experience;
  /** Hosted by Plexo's server tier (Pro and above): server apps, variables and secrets. */
  ssrEnabled?: boolean;
  /** For hosted apps: a server app (true) or plain files (false). */
  server?: boolean;
  /** The pages are the owner's own code. */
  ownCode?: boolean;
};

/**
 * Pros see everything that makes sense for the site. Beginners and intermediate people see no Advanced area
 * at all: the everyday things (name, address, look, form replies, old links) are already in their Settings.
 */
export function advancedSections(i: AdvancedInput): AdvancedSection[] {
  if (i.experience !== "pro") return [];
  const pick = (ids: AdvancedSectionId[]) => ids.map((id) => ALL[id]);
  if (i.kind === "app") return pick(["appsettings", "appseo", "appsignin", "appfiles", "appcode", "data", "functions", "secrets", "users", "history", "publish", "appgithub", "danger"]);
  if (i.kind === "hosted") {
    const ids: AdvancedSectionId[] = ["deploy"];
    if (i.server) {
      if (i.ssrEnabled !== false) ids.push("variables");
      ids.push("github");
    }
    ids.push("danger");
    return pick(ids);
  }
  const ids: AdvancedSectionId[] = ["seo", "code", "features", "layout", "lists", "forms", "redirects", "scripts", "versions", "deploy"];
  // Variables and secrets are for server apps: on a plain site they only exist when the plan includes servers.
  if (i.ssrEnabled) ids.push("variables");
  ids.push("copy", "danger");
  return pick(ids);
}

export function parseAdvancedSection(value: unknown): AdvancedSectionId | null {
  return typeof value === "string" && value in ALL ? (value as AdvancedSectionId) : null;
}

/** The section to show for `?section=`: the one asked for if this site has it, else the first. */
export function resolveAdvancedSection(requested: unknown, sections: AdvancedSection[]): AdvancedSectionId | null {
  const wanted = parseAdvancedSection(requested);
  if (wanted && sections.some((s) => s.id === wanted)) return wanted;
  return sections[0]?.id ?? null;
}

/** A section of the Advanced area, as a hub address. */
export function advancedHref(siteId: string, section?: AdvancedSectionId): string {
  return `/dashboard/sites/${siteId}?tab=advanced${section ? `&section=${section}` : ""}`;
}

export type SeoPageRow = { id: string; name: string; path: string; isRaw: boolean; title: string; description: string; image: string };

/** What a page still needs for search, in one plain sentence (empty when it is fine). */
export function seoGap(p: Pick<SeoPageRow, "title" | "description" | "image" | "isRaw">): string {
  if (p.isRaw) return "";
  const missing = [!p.title.trim() && "a title", !p.description.trim() && "a short description"].filter(Boolean) as string[];
  return missing.length ? `Add ${missing.join(" and ")}.` : "";
}

/** Google shows roughly 60 characters of title and 160 of description. Plain guidance, never a hard stop. */
export function seoLengthHint(kind: "title" | "description", text: string): string | null {
  const n = text.trim().length;
  if (kind === "title") return n > 60 ? "Google may cut this short. Around 60 letters works best." : null;
  return n > 160 ? "Google may cut this short. Around 160 letters works best." : null;
}
