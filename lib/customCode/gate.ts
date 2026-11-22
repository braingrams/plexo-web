// Who may run their own code on a published site: Starter and above (lib/subscription.ts
// customCodeEnabled), and only on a site served from the owner's OWN domain — never on the shared
// Plexo address, where one customer's script would sit beside everyone else's. Pure: callers pass
// the plan and where the page is being served. Every message is written for the site owner.

import { getTierFeatures } from "@/lib/subscription";

export type CustomCodeContext = { plan: string | null | undefined; hasCustomDomain: boolean };

/** What stops the owner right now, in plain words, plus the one place that fixes it (a button in the dashboard). */
export type CustomCodeBlock = {
  reason: "plan" | "domain";
  message: string;
  fix: { label: string; href: string };
};

const PLAN_FIX = { label: "See plans", href: "/dashboard/settings/subscription?upgrade=STARTER" };
const DOMAIN_FIX = { label: "Connect my domain", href: "/dashboard/domains" };

/** The reason the owner can't add code right now (with its fix), or null when they can. Plan is checked first. */
export function customCodeBlock(c: CustomCodeContext): CustomCodeBlock | null {
  if (!getTierFeatures(c.plan).customCodeEnabled) {
    return {
      reason: "plan",
      message: "Adding your own code comes with the Starter plan and above. Upgrade in Settings → Plan to add things like Google verification or tracking pixels.",
      fix: PLAN_FIX,
    };
  }
  if (!c.hasCustomDomain) {
    return {
      reason: "domain",
      message: "Your code only runs on your own domain (like www.yourname.com), so connect one first. Once it's connected, come back and paste your code here.",
      fix: DOMAIN_FIX,
    };
  }
  return null;
}

/** Same check as customCodeBlock, as a single sentence (MCP tools, API errors). */
export function customCodeEditError(c: CustomCodeContext): string | null {
  return customCodeBlock(c)?.message ?? null;
}

/** Whether saved code is injected into a page being served right now (the visitor-facing check). */
export function customCodeRunsOnServe(c: { plan: string | null | undefined; servedOnCustomDomain: boolean }): boolean {
  return c.servedOnCustomDomain && getTierFeatures(c.plan).customCodeEnabled;
}
