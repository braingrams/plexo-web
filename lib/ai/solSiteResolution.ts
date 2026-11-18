// Which of the owner's sites a request is about. Pure. SOL never guesses: an explicit choice wins, then
// the conversation's own binding, then a pick made in this conversation, then "the only site they have";
// with two or more and none chosen it asks. The dashboard's current-site cookie is only a HINT (it orders
// the choices); it never decides on its own.

import type { KnownBrand } from "./solBrief";

export type OwnerSite = {
  id: string;
  name?: string;
  updatedAt?: string;
  brand?: Pick<KnownBrand, "colors" | "logoUrl" | "noLogo" | "fonts" | "strataProject" | "brandComponents">;
  /** The brand this site really uses (lib/brand/resolveSiteBrand.ts), ready for SOL's prompt; only set when it is the site's own or linked from Strata. */
  resolvedBrand?: import("@/lib/brand/brandModel").ResolvedBrand;
};
export type SiteSignal = {
  /** The site the owner picked in the SOL chat (the chip). */
  explicitSiteId?: string;
  /** The site this conversation was bound to earlier. */
  boundSiteId?: string;
  /** The dashboard's current-site cookie: a hint only. */
  hintSiteId?: string;
};

export const SITE_QUESTION = "Which website is this for?";
export const NEW_SITE_LABEL = "A new website";
export const newOrAddQuestion = (siteName: string) => `Is this a new website, or part of ${siteName}?`;
export const addToLabel = (siteName: string) => `Add to ${siteName}`;

const GENERIC = /^(untitled|untitled site|home|home page|landing page|new page|my site|my website)$/i;
export const displayName = (s: OwnerSite): string => (s.name && !GENERIC.test(s.name.trim()) ? s.name.trim() : "Untitled site");

/** Owner's sites, most recently edited first, with a stable tie-break. */
export const orderedSites = (sites: OwnerSite[]): OwnerSite[] => [...sites].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || a.id.localeCompare(b.id));

/** The label shown for each site; two sites with the same name get a number so the answer is unambiguous. */
export function siteLabels(sites: OwnerSite[]): Map<string, string> {
  const out = new Map<string, string>();
  const seen = new Map<string, number>();
  for (const s of orderedSites(sites)) {
    const base = displayName(s);
    const n = (seen.get(base.toLowerCase()) ?? 0) + 1;
    seen.set(base.toLowerCase(), n);
    out.set(s.id, n > 1 ? `${base} (${n})` : base);
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();

/** Reads the owner's answer to a which-site or new-or-add question, back to a site id, "new", or "unmatched". */
export function pickedFromAnswers(answers: Array<{ question: string; answer: string }>, sites: OwnerSite[]): { siteId: string } | "new" | "unmatched" | undefined {
  const labels = siteLabels(sites);
  let result: { siteId: string } | "new" | "unmatched" | undefined;
  for (const { question, answer } of answers) {
    const isWhich = question.trim() === SITE_QUESTION;
    const addTo = [...labels].find(([, label]) => question.trim() === newOrAddQuestion(label.replace(/ \(\d+\)$/, "")));
    if (!isWhich && !addTo) continue;
    const a = norm(answer);
    if (!a || /^(a new website|new website|new|a new site)$/.test(a) || a === norm(NEW_SITE_LABEL)) {
      result = a ? "new" : result;
      continue;
    }
    if (/^skip/.test(a)) { result = "unmatched"; continue; }
    if (addTo && a.startsWith("add to")) { result = { siteId: addTo[0] }; continue; }
    const exact = [...labels].find(([, label]) => norm(label) === a);
    const loose = exact ?? [...labels].find(([, label]) => a.includes(norm(label)) || norm(label).includes(a));
    result = loose ? { siteId: loose[0] } : "unmatched";
  }
  return result;
}

export type SiteResolution =
  | { kind: "none" }
  | { kind: "new"; reason: "picked-new" | "named-other-business" | "unrelated" }
  | { kind: "use"; site: OwnerSite; via: "explicit" | "bound" | "picked" | "single"; announce: boolean }
  | { kind: "ask-which"; options: Array<{ label: string }> }
  | { kind: "ask-new-or-add"; site: OwnerSite }
  | { kind: "unresolved"; answer?: string };

export type ResolveInput = {
  sites: OwnerSite[];
  signal?: SiteSignal;
  answers?: Array<{ question: string; answer: string }>;
  /** The request is about something that already exists (an edit, "my site", its brand or pages). */
  touchesExisting: boolean;
  /** A new build for a business named in the message. */
  namedBusiness?: string;
  /** The owner's own current business/site names for comparing against namedBusiness. */
  isNewBuild: boolean;
};

const sameBusiness = (a?: string, b?: string) => !!a && !!b && norm(a).replace(/ /g, "") === norm(b).replace(/ /g, "");

/** explicit choice > conversation binding > a pick made in this conversation > the single site > ask. */
export function resolveSite(input: ResolveInput): SiteResolution {
  const { sites, signal = {} } = input;
  if (sites.length === 0) return { kind: "none" };
  const byId = (id?: string) => (id ? sites.find((s) => s.id === id) : undefined);

  const picked = pickedFromAnswers(input.answers ?? [], sites);
  let chosen: { site: OwnerSite; via: "explicit" | "bound" | "picked" | "single" } | undefined;
  const explicit = byId(signal.explicitSiteId);
  const bound = byId(signal.boundSiteId);
  if (explicit) chosen = { site: explicit, via: "explicit" };
  else if (bound) chosen = { site: bound, via: "bound" };
  else if (picked && picked !== "new" && picked !== "unmatched") chosen = { site: byId(picked.siteId)!, via: "picked" };
  else if (picked === "new") return { kind: "new", reason: "picked-new" };
  else if (picked === "unmatched") return { kind: "unresolved" };
  else if (sites.length === 1) chosen = { site: sites[0], via: "single" };

  if (chosen) {
    // A new build for a business that is not the chosen site's: ask, don't assume (only when it was not just answered).
    if (input.isNewBuild && input.namedBusiness && !sameBusiness(input.namedBusiness, chosen.site.name) && chosen.via !== "picked") {
      const answered = pickedFromAnswers(input.answers ?? [], sites);
      if (answered === undefined) return { kind: "ask-new-or-add", site: chosen.site };
    }
    return { kind: "use", site: chosen.site, via: chosen.via, announce: chosen.via !== "bound" };
  }

  // Two or more sites, none chosen.
  if (input.isNewBuild && input.namedBusiness && !input.touchesExisting) return { kind: "new", reason: "named-other-business" };
  const hint = signal.hintSiteId;
  const ordered = orderedSites(sites);
  const first = hint ? [...ordered.filter((s) => s.id === hint), ...ordered.filter((s) => s.id !== hint)] : ordered;
  const labels = siteLabels(sites);
  return { kind: "ask-which", options: [...first.slice(0, 7).map((s) => ({ label: labels.get(s.id)! })), { label: NEW_SITE_LABEL }] };
}

export const SITE_TOUCH_RE = /\b(my|our|the)\s+(?:\w+\s+)?(site|website|web site|page|pages|homepage|home page|brand|logo|colou?rs|shop|store|blog|menu|footer|header)\b|\b(this|that) (?:site|page)\b/i;
