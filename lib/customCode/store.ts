// Reading and saving a site's header/footer code. Shared by the dashboard route and the MCP tool so both
// apply the same gate, the same validation and the same "who changed it" record. No next/server import.

import { randomUUID } from "node:crypto";

import { PublishedDomain, SiteLayout } from "@/lib/db/contentEntities";
import { User } from "@/lib/db/coreEntities";
import { planFromOwner, workspaceOwner } from "@/lib/plan/workspacePlan";
import { customCodeBlock, type CustomCodeBlock } from "./gate";
import { analyzeCustomCode, sanitizeCustomCode, type Snippet } from "./sanitize";

export type CustomCodeState = {
  head: string;
  footer: string;
  /** Null when the owner can add code; otherwise a plain sentence saying why not and what to do. */
  blocked: string | null;
  /** The same block with the one-click fix (button label and dashboard address) so the dashboard can offer it. */
  blockedFix: CustomCodeBlock["fix"] & { reason: CustomCodeBlock["reason"] } | null;
  /** The owner's own domain the code runs on, when one is connected. */
  domain: string | null;
  /** Also run on cart, checkout and order pages (off unless the owner chose it). */
  onCheckout: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
  /** What each saved snippet is, in plain words, so the owner can see it was understood. */
  headSnippets: Snippet[];
  footerSnippets: Snippet[];
};

export async function gateFor(organizationId: string, templateId: string): Promise<{ block: CustomCodeBlock | null; domain: string | null }> {
  const [owner, { data: domains }] = await Promise.all([
    workspaceOwner(organizationId),
    PublishedDomain.query.primary({ templateId }).go({ pages: "all" }),
  ]);
  const custom = domains.find((d) => d.type === "CUSTOM" && d.active !== false && !d.planDisabledAt && !d.suspendedAt);
  return { block: customCodeBlock({ plan: planFromOwner(owner).subscriptionPlan, hasCustomDomain: !!custom }), domain: custom?.domain ?? null };
}

export async function readCustomCode(organizationId: string, templateId: string): Promise<CustomCodeState> {
  const [{ data: row }, { block, domain }] = await Promise.all([SiteLayout.get({ templateId }).go(), gateFor(organizationId, templateId)]);
  let updatedBy: string | null = null;
  if (row?.customCodeUpdatedBy) {
    const { data: u } = await User.get({ id: row.customCodeUpdatedBy }).go();
    updatedBy = u?.name || u?.email || null;
  }
  return { head: row?.customHeadCode ?? "", footer: row?.customFooterCode ?? "", blocked: block?.message ?? null, blockedFix: block ? { ...block.fix, reason: block.reason } : null, domain, onCheckout: !!row?.customCodeOnCheckout, updatedAt: row?.customCodeUpdatedAt ?? null, updatedBy, headSnippets: analyzeCustomCode(row?.customHeadCode).snippets, footerSnippets: analyzeCustomCode(row?.customFooterCode).snippets };
}

/** Validates and saves. `head`/`footer` left undefined are kept as they are; "" clears. */
export async function saveCustomCode(args: {
  organizationId: string;
  templateId: string;
  userId: string;
  head?: unknown;
  footer?: unknown;
  onCheckout?: unknown;
}): Promise<{ ok: true; state: CustomCodeState } | { ok: false; error: string; status: number; planGate?: boolean }> {
  const { block } = await gateFor(args.organizationId, args.templateId);
  if (block) return { ok: false, error: block.message, status: 403, planGate: block.reason === "plan" };

  const set: { customHeadCode?: string; customFooterCode?: string; customCodeOnCheckout?: boolean } = {};
  if (args.onCheckout !== undefined) {
    if (typeof args.onCheckout !== "boolean") return { ok: false, error: "\"Also run on checkout pages\" has to be on or off.", status: 400 };
    set.customCodeOnCheckout = args.onCheckout;
  }
  for (const [key, label, raw] of [
    ["customHeadCode", "Header code", args.head],
    ["customFooterCode", "Footer code", args.footer],
  ] as const) {
    if (raw === undefined) continue;
    const r = sanitizeCustomCode(raw);
    if (!r.ok) return { ok: false, error: `${label}: ${r.error}`, status: 400 };
    set[key] = r.html;
  }
  if (Object.keys(set).length === 0) return { ok: false, error: "Nothing to save.", status: 400 };

  const audit = { customCodeUpdatedBy: args.userId, customCodeUpdatedAt: new Date().toISOString() };
  const { data: existing } = await SiteLayout.get({ templateId: args.templateId }).go();
  if (existing) await SiteLayout.patch({ templateId: args.templateId }).set({ ...set, ...audit }).go();
  else await SiteLayout.create({ id: randomUUID(), templateId: args.templateId, organizationId: args.organizationId, ...set, ...audit }).go();

  // Audit trail: who, when, which site and how much (never the code itself, which can hold ids). The row also keeps who/when.
  console.info(JSON.stringify({ event: "custom-code-saved", templateId: args.templateId, userId: args.userId, at: audit.customCodeUpdatedAt, headChars: set.customHeadCode?.length, footerChars: set.customFooterCode?.length, onCheckout: set.customCodeOnCheckout }));
  return { ok: true, state: await readCustomCode(args.organizationId, args.templateId) };
}
