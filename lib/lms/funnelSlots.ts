// How many funnels an org may have live at once: the plan's included allotment
// (lib/subscription.ts's includedFunnelSlots — only Ultra ships 1) plus however many
// recurring LmsFunnelAddonSlot rows are currently ACTIVE or PAST_DUE (grace period —
// stays counted so a funnel doesn't get treated as over-quota mid-dunning). Mirrors
// lib/domainLimit.ts's one-function simplicity.

import { LmsFunnel, LmsFunnelAddonSlot } from "@/lib/db/contentEntities";
import { getTierFeatures } from "@/lib/subscription";
import { getOrganizationOwnerPlanDynamo } from "@/server/orgDynamo";

export async function countActiveFunnels(organizationId: string): Promise<number> {
  const { data } = await LmsFunnel.query.byOrg({ organizationId }).go({ pages: "all" });
  return data.filter((f) => f.enabled).length;
}

export async function countFundedAddonSlots(organizationId: string): Promise<number> {
  const { data } = await LmsFunnelAddonSlot.query.primary({ organizationId }).go({ pages: "all" });
  return data.filter((slot) => slot.status === "ACTIVE" || slot.status === "PAST_DUE").length;
}

export async function getAvailableFunnelSlots(
  organizationId: string,
  plan: string | null | undefined,
): Promise<{ total: number; used: number; hasSlotAvailable: boolean }> {
  const [used, addonSlots] = await Promise.all([
    countActiveFunnels(organizationId),
    countFundedAddonSlots(organizationId),
  ]);
  const total = getTierFeatures(plan).includedFunnelSlots + addonSlots;
  return { total, used, hasSlotAvailable: used < total };
}

/**
 * Re-checks an org's enabled-funnel count against its current capacity and disables the
 * oldest enabled funnel(s) beyond it — called whenever capacity can only go DOWN: an
 * addon-slot subscription cancels/fails, or (from the platform-billing webhook) a plan
 * downgrade drops the included allotment. Never re-enables anything on its own; an admin
 * re-enabling a disabled funnel from Settings is a deliberate, unrelated action.
 *
 * Runs off the org owner's plan (not any particular member's own) since this fires from a
 * webhook with no "acting user" — same convention as getOrganizationOwnerPlanDynamo's other
 * callers (branding, site transfers).
 */
export async function reconcileFunnelSlotsForOrg(organizationId: string): Promise<void> {
  const [plan, addonSlots, { data: funnels }] = await Promise.all([
    getOrganizationOwnerPlanDynamo(organizationId),
    countFundedAddonSlots(organizationId),
    LmsFunnel.query.byOrg({ organizationId }).go({ pages: "all" }),
  ]);
  const total = getTierFeatures(plan).includedFunnelSlots + addonSlots;

  const enabled = funnels.filter((f) => f.enabled).sort((a, b) => (a.updatedAt ?? "").localeCompare(b.updatedAt ?? ""));
  const overBudget = enabled.length - total;
  if (overBudget <= 0) return;

  await Promise.all(
    enabled.slice(0, overBudget).map((f) => LmsFunnel.patch({ templateId: f.templateId }).set({ enabled: false }).go()),
  );
}
