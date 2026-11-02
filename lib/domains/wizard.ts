import { registrableDomain, registrarRelativeName } from "./registrable";

// The pure decisions behind the "Connect a domain" wizard (app/dashboard/domains/LinkDomainWizard.tsx):
// cleaning what someone types, spotting a root domain, which DNS names to show, which step to resume at and how a
// certificate's state reads to a person. Client-safe (no server imports).

export type WizardDomainType = "SUBDOMAIN" | "CUSTOM" | "BUY";
export type WizardStep = "choose" | "address" | "domain" | "point" | "certificate" | "buy" | "done";

/** The numbered steps for each way of connecting (the final "all set" screen isn't numbered). */
export function stepsFor(type: WizardDomainType): WizardStep[] {
  if (type === "CUSTOM") return ["choose", "domain", "point", "certificate"];
  if (type === "BUY") return ["choose", "buy"];
  return ["choose", "address"];
}

export const STEP_LABEL: Record<WizardStep, string> = {
  choose: "Choose",
  address: "Your address",
  domain: "Your domain",
  point: "Point it at Plexo",
  certificate: "Secure it",
  buy: "Buy a domain",
  done: "All set",
};

/** "Step 2 of 4" for the header; null on the final screen. */
export function stepPosition(step: WizardStep, type: WizardDomainType): { n: number; of: number } | null {
  const steps = stepsFor(type);
  const i = steps.indexOf(step);
  return i === -1 ? null : { n: i + 1, of: steps.length };
}

/**
 * Cleans what was typed into the domain box: lower case, no spaces, no "https://", login, path, query or port —
 * people paste whole addresses. While typing, a trailing dot is kept (it's on the way to "www.example"); when the
 * person moves on (`final`) it goes too.
 */
export function normalizeDomainInput(raw: string, opts: { final?: boolean } = {}): string {
  let s = raw.trim().toLowerCase();
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  s = s.replace(/^[^@/]*@/, "");
  s = s.split(/[/?#]/)[0];
  s = s.replace(/:\d*$/, "");
  s = s.replace(/\s+/g, "");
  if (opts.final) s = s.replace(/\.+$/, "");
  return s;
}

/** A friendly reason the domain can't be used yet, or null when it looks right. */
export function customDomainProblem(domain: string): string | null {
  if (!domain) return "Enter the domain you own, for example www.mybusiness.com.";
  if (!domain.includes(".")) return "That needs an ending too, like .com — for example www.mybusiness.com.";
  if (domain.length > 253) return "That domain name is too long.";
  if (!/^[a-z0-9.-]+$/.test(domain)) return "Domains can only use letters, numbers, hyphens and dots.";
  const labels = domain.split(".");
  if (labels.some((l) => l === "")) return "There's an extra dot in that domain — check it and try again.";
  if (labels.some((l) => l.startsWith("-") || l.endsWith("-"))) return "Parts of a domain can't start or end with a hyphen.";
  if (labels.some((l) => l.length > 63)) return "One part of that domain is too long.";
  const tld = labels[labels.length - 1];
  if (!/^([a-z]{2,}|xn--[a-z0-9-]+)$/.test(tld)) return "The ending of that domain (like .com) doesn't look right.";
  return null;
}

/** A root domain: example.com rather than www.example.com or shop.example.com. */
export function isApexDomain(domain: string): boolean {
  return domain !== "" && registrableDomain(domain) === domain;
}

/** The "Name" to type at the registrar for the record that points the domain at Plexo: "www", "shop", or "@" for the root. */
export function pointRecordName(domain: string): string {
  return registrarRelativeName(domain, domain);
}

/** The "Name" to type for the certificate record — relative to the zone, so it keeps ".www" for www.example.com. */
export function certificateRecordName(fullName: string, domain: string): string {
  return registrarRelativeName(fullName, domain);
}

export type CertUi = "preparing" | "waiting" | "issuing" | "live" | "failed";

/** How a domain's certificate reads to a person. `hasRecord` is whether we already have the record to show. */
export function certUi(status: string | undefined, hasRecord: boolean): CertUi {
  if (status === "ATTACHED") return "live";
  if (status === "FAILED") return "failed";
  if (status === "ISSUED") return "issuing";
  if (!hasRecord) return "preparing";
  return "waiting";
}

export type ExistingDomainState = { type: WizardDomainType; certificateStatus?: string; dnsVerified?: boolean; certificateValidationName?: string };

/** Where "Finish setup" on a half-finished domain should land. */
export function resumeStep(d: ExistingDomainState): WizardStep {
  if (d.type !== "CUSTOM") return "done";
  if (d.certificateStatus === "ATTACHED") return "done";
  if (d.certificateStatus === "FAILED" || d.certificateStatus === "ISSUED") return "certificate";
  // Routing not confirmed yet → start at the first record; otherwise the certificate record is what's missing.
  return d.dnsVerified ? "certificate" : "point";
}

/** Does a domain still need the owner to do something? (Drives the "Finish setup" button in the list.) */
export function needsSetup(d: { type: string; certificateStatus?: string; pausedByPlan?: boolean }): boolean {
  return d.type === "CUSTOM" && !d.pausedByPlan && !!d.certificateStatus && d.certificateStatus !== "ATTACHED";
}

/** Has the person already created this domain in this wizard (so Next must move on, not create it again)? */
export function alreadyCreated(created: { domain: string; templateId: string } | null, domain: string, templateId: string): boolean {
  return !!created && created.domain === domain && created.templateId === templateId;
}

/** "mybusiness.com" → "www.mybusiness.com" (the suggestion for a root domain). */
export const wwwVersionOf = (domain: string): string => (domain.startsWith("www.") ? domain : `www.${domain}`);
