// The plain-words side of every "you've hit what your plan holds" check that is not about
// publishing: how many sites / emails, funnels, domains, published posts. Each builder returns
// the message and the plan that lifts the limit, so API routes (planGateResponse), MCP tools
// (planGateMessage) and the dashboard (UpgradePrompt) all say the same thing.
// Server-side: reads the entitlement table through planNeeded.ts.

import { planThatRaises } from "./planNeeded";
import { PLAN, type PaidPlanId } from "./plans";
import type { PlanGateCode } from "./planGate";

export type LimitGate = { code: PlanGateCode; message: string; requiredPlan: PaidPlanId; details: Record<string, unknown> };

export type TemplateKind = "LANDING_PAGE" | "EMAIL";

/** Creating, copying, converting or installing one more site / email template than the plan holds. */
export function templateLimitGate(kind: TemplateKind, limit: number): LimitGate {
  const requiredPlan = planThatRaises((f) => (kind === "EMAIL" ? f.maxEmailTemplates : f.maxLandingPages), limit);
  const message =
    kind === "EMAIL"
      ? `Your plan holds ${limit} email template${limit === 1 ? "" : "s"} and they're all in use. Upgrade to make more, or delete one you no longer need.`
      : `Your plan holds ${limit} site${limit === 1 ? "" : "s"} and they're all in use. Upgrade to make more, or delete one you no longer need.`;
  return { code: "PLAN_TEMPLATE_LIMIT", message, requiredPlan, details: { kind, limit } };
}

/** Every funnel / course slot in use. A single extra slot can also be bought on its own, so the details say so. */
export function funnelSlotsGate(used: number, total: number): LimitGate {
  const requiredPlan = planThatRaises((f) => f.includedFunnelSlots, total);
  const message =
    total === 0
      ? "Courses and members areas come with the Starter plan and above. Upgrade to start one."
      : `You're using all ${total} course or members-area slot${total === 1 ? "" : "s"} your plan includes. Upgrade for more, or buy one extra slot.`;
  return { code: "PLAN_FUNNEL_SLOTS", message, requiredPlan: total === 0 ? PLAN.STARTER : requiredPlan, details: { used, total, canBuySlot: total > 0 } };
}

/** More custom domains linked than the plan allows. */
export function domainCountGate(limit: number): LimitGate {
  const requiredPlan = planThatRaises((f) => f.maxCustomDomains, limit);
  return {
    code: "PLAN_CUSTOM_DOMAIN_LIMIT",
    message: `Your plan connects ${limit} domain${limit === 1 ? "" : "s"} and they're all in use. Upgrade to connect another, or disconnect one you no longer use.`,
    requiredPlan,
    details: { limit },
  };
}

/** More published blog posts than the plan allows (Free has none live). */
export function blogLimitGate(limit: number): LimitGate {
  return {
    code: "PLAN_BLOG_LIMIT",
    message: limit === 0 ? "Publishing blog posts comes with the Starter plan and above. Your drafts are safe." : `Your plan allows ${limit} published blog posts. Upgrade to publish more.`,
    requiredPlan: limit === 0 ? PLAN.STARTER : planThatRaises((f) => f.maxPublishedBlogPosts, limit),
    details: { limit },
  };
}

/** A plain sentence for places that can only carry text (MCP tools, AI assistants): what's wrong, the plan, and where to fix it. */
export function planGateMessage(gate: Pick<LimitGate, "message" | "requiredPlan">, baseUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://plexo.charisol.io").replace(/\/$/, "")): string {
  return `${gate.message} (Plan needed: ${gate.requiredPlan[0]}${gate.requiredPlan.slice(1).toLowerCase()}. Upgrade, or start a free trial if you haven't, at ${baseUrl}/dashboard/settings/subscription?upgrade=${gate.requiredPlan})`;
}
