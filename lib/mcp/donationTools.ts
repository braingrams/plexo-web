import { randomUUID } from "node:crypto";
import type { resolveUser } from "@/lib/auth/resolveUser";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { Template } from "@/lib/db/contentEntities";
import { CommerceDonationCampaign, CommerceDonationSubscription } from "@/lib/db/commerceEntities";
import {
  adoptExistingMonthlyDonors,
  cancelDonationSubscription,
  ensureDonationsReady,
  listDonationsOverview,
  normalizeCampaignInput,
} from "@/lib/commerce/donations";

type ResolvedUser = NonNullable<Awaited<ReturnType<typeof resolveUser>>>;

// Plexo Donations for AI assistants — full parity with the Commerce → Donations dashboard
// tab. Amounts are always in the smallest currency unit (cents/kobo), same as every other
// Commerce MCP tool.

const CAMPAIGN_FIELDS = {
  name: { type: "string", description: "What donors are giving to, e.g. 'Support our mission'." },
  description: { type: "string", description: "Optional one-line description shown on the form." },
  presetAmounts: {
    type: "array",
    description: "Suggested amounts in the smallest currency unit, optionally named — e.g. [{\"amountMinor\":2500,\"label\":\"Bronze\"},{\"amountMinor\":5000}].",
    items: { type: "object", properties: { amountMinor: { type: "number" }, label: { type: "string" } }, required: ["amountMinor"] },
  },
  defaultPresetIndex: { type: "number", description: "Which suggested amount is pre-selected (0-based)." },
  allowCustomAmount: { type: "boolean", description: "Let donors type their own amount (default true)." },
  minAmountMinor: { type: "number", description: "Smallest custom amount, smallest currency unit (default 100)." },
  allowMonthly: { type: "boolean", description: "Offer monthly giving (default true; needs Stripe or Paystack connected)." },
  defaultFrequency: { type: "string", enum: ["ONCE", "MONTHLY"], description: "Which frequency is pre-selected." },
  goalAmountMinor: { type: ["number", "null"], description: "Optional fundraising goal — shows a progress bar." },
  thankYouMessage: { type: "string", description: "Shown after donating and in the receipt email." },
  buttonLabel: { type: "string", description: "Donate button text (default 'Donate')." },
};

export const DONATION_MCP_TOOLS = [
  {
    name: "list_donations",
    description:
      "Shows a site's donations: totals (raised, donors, monthly donors), every donation form (campaign) with its amounts and progress, monthly donors, and recent gifts. Also says whether payments are connected yet (paymentsReady) — if not, tell the owner to connect Stripe/Paystack or add bank details in Commerce → Settings → Payments.",
    inputSchema: { type: "object", properties: { templateId: { type: "string", description: "The site's home page id (see list_landing_pages)." } }, required: ["templateId"] },
  },
  {
    name: "create_donation_campaign",
    description:
      "Creates a donation form (campaign) for a site — one-time and optional monthly giving — and switches on everything donations need (no shop is created). Returns the campaign id and the embed snippet `<div data-plexo-donation=\"<id>\"></div>`: add that HTML to any page (e.g. via update_landing_page_page or a raw HTML page) to show a working donate form styled to the site.",
    inputSchema: { type: "object", properties: { templateId: { type: "string", description: "The site's home page id." }, ...CAMPAIGN_FIELDS }, required: ["templateId", "name", "presetAmounts"] },
  },
  {
    name: "update_donation_campaign",
    description: "Edits a donation campaign. Only the fields you pass change. Pass active:false to turn a form off (gifts history is kept).",
    inputSchema: {
      type: "object",
      properties: { templateId: { type: "string" }, campaignId: { type: "string" }, active: { type: "boolean" }, ...CAMPAIGN_FIELDS },
      required: ["templateId", "campaignId"],
    },
  },
  {
    name: "cancel_monthly_donation",
    description: "Stops one donor's monthly gift (at Stripe/Paystack too) — they won't be charged again. Only do this when the owner asks; confirm the donor first using list_donations.",
    inputSchema: { type: "object", properties: { templateId: { type: "string" }, subscriptionId: { type: "string", description: "From list_donations' monthlyDonors[].id." } }, required: ["templateId", "subscriptionId"] },
  },
  {
    name: "adopt_monthly_donors",
    description:
      "Brings monthly donors over from a previous website: finds active monthly gifts on the site's connected Stripe/Paystack account that Plexo doesn't know yet and records them under a campaign, so every future charge is receipted and counted. Donors don't have to do anything. Requires the SAME payment account the old site used to be connected.",
    inputSchema: { type: "object", properties: { templateId: { type: "string" }, campaignId: { type: "string" } }, required: ["templateId", "campaignId"] },
  },
];

export const DONATION_TOOL_NAMES = new Set(DONATION_MCP_TOOLS.map((t) => t.name));

async function resolveSiteId(resolved: ResolvedUser, templateId: unknown): Promise<string> {
  const id = typeof templateId === "string" ? templateId.trim() : "";
  if (!id) throw new Error("templateId is required — pass the site's home page id (see list_landing_pages).");
  const { data: site } = await Template.get({ id }).go();
  if (!site || site.organizationId !== resolved.organizationId || site.parentId) {
    throw new Error(`No site found with id "${id}" in this account. Use a site's home page id from list_landing_pages.`);
  }
  return site.id;
}

function assertCommerce(resolved: ResolvedUser, action: "create" | "update"): void {
  const err = requirePermission(resolved.role, { commerce: [action] });
  if (err) throw new Error("Your role in this organization can't manage donations.");
}

export async function handleDonationTool(toolName: string, args: any, resolved: ResolvedUser): Promise<any> {
  const templateId = await resolveSiteId(resolved, args.templateId);
  switch (toolName) {
    case "list_donations":
      return listDonationsOverview(templateId);

    case "create_donation_campaign": {
      assertCommerce(resolved, "create");
      const normalized = normalizeCampaignInput(args ?? {});
      if ("error" in normalized) throw new Error(normalized.error);
      await ensureDonationsReady(templateId, resolved.organizationId, resolved.userId);
      const id = randomUUID();
      await CommerceDonationCampaign.create({ ...normalized.values, id, templateId, organizationId: resolved.organizationId, name: normalized.values.name!, presetAmounts: normalized.values.presetAmounts ?? [] }).go();
      const overview = await listDonationsOverview(templateId);
      return {
        campaign: overview.campaigns.find((c) => c.id === id),
        embedHtml: `<div data-plexo-donation="${id}"></div>`,
        paymentsReady: overview.paymentsReady,
        next: overview.paymentsReady
          ? "Add embedHtml to the page where donors should give."
          : "Add embedHtml to a page, and ask the owner to connect Stripe/Paystack (or add bank details) in Commerce → Settings → Payments — the form shows 'being set up' until then.",
      };
    }

    case "update_donation_campaign": {
      assertCommerce(resolved, "update");
      const { data: existing } = await CommerceDonationCampaign.get({ templateId, id: String(args.campaignId ?? "") }).go();
      if (!existing) throw new Error("Campaign not found — use list_donations for ids.");
      const normalized = normalizeCampaignInput(args ?? {}, true);
      if ("error" in normalized) throw new Error(normalized.error);
      const values = Object.fromEntries(Object.entries(normalized.values).filter(([, v]) => v !== undefined));
      if (Object.keys(values).length > 0) await CommerceDonationCampaign.patch({ templateId, id: existing.id }).set(values).go();
      return { updated: true, campaign: (await listDonationsOverview(templateId)).campaigns.find((c) => c.id === existing.id) };
    }

    case "cancel_monthly_donation": {
      assertCommerce(resolved, "update");
      const { data: sub } = await CommerceDonationSubscription.get({ templateId, id: String(args.subscriptionId ?? "") }).go();
      if (!sub) throw new Error("Monthly gift not found — use list_donations for ids.");
      await cancelDonationSubscription(sub, `mcp:${resolved.userId}`);
      return { cancelled: true };
    }

    case "adopt_monthly_donors": {
      assertCommerce(resolved, "update");
      return adoptExistingMonthlyDonors(templateId, resolved.organizationId, String(args.campaignId ?? ""));
    }
  }
  throw new Error(`Unknown tool: ${toolName}`);
}
