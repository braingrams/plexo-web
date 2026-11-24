// Code for one page only: a pixel for a landing page, a verification tag for a single address. Same rules as the site-wide
// header and footer code (plan, own domain, checked before saving, never on payment pages unless the owner allowed it),
// and added after the site-wide code on that page.

import { Template } from "@/lib/db/contentEntities";
import { sanitizeCustomCode } from "./sanitize";
import { gateFor } from "./store";

export type PageCodeState = { head: string; footer: string; blocked: string | null; blockedFix: { label: string; href: string; reason: string } | null; domain: string | null };

async function rootOf(templateId: string): Promise<string> {
  let id = templateId;
  for (let i = 0; i < 32; i++) {
    const { data } = await Template.get({ id }).go();
    if (!data?.parentId) return id;
    id = data.parentId;
  }
  return id;
}

export async function readPageCode(organizationId: string, pageId: string): Promise<PageCodeState | null> {
  const { data: page } = await Template.get({ id: pageId }).go();
  if (!page || page.organizationId !== organizationId) return null;
  const { block, domain } = await gateFor(organizationId, await rootOf(pageId));
  return { head: page.pageHeadCode ?? "", footer: page.pageFooterCode ?? "", blocked: block?.message ?? null, blockedFix: block ? { ...block.fix, reason: block.reason } : null, domain };
}

export async function savePageCode(args: { organizationId: string; pageId: string; userId: string; head?: unknown; footer?: unknown }): Promise<{ ok: true; state: PageCodeState } | { ok: false; error: string; status: number; planGate?: boolean }> {
  const { data: page } = await Template.get({ id: args.pageId }).go();
  if (!page || page.organizationId !== args.organizationId) return { ok: false, error: "Page not found.", status: 404 };
  const { block } = await gateFor(args.organizationId, await rootOf(args.pageId));
  if (block) return { ok: false, error: block.message, status: 403, planGate: block.reason === "plan" };
  const set: { pageHeadCode?: string; pageFooterCode?: string } = {};
  for (const [key, label, raw] of [["pageHeadCode", "Header code", args.head], ["pageFooterCode", "Footer code", args.footer]] as const) {
    if (raw === undefined) continue;
    const r = sanitizeCustomCode(raw);
    if (!r.ok) return { ok: false, error: `${label}: ${r.error}`, status: 400 };
    set[key] = r.html;
  }
  if (!Object.keys(set).length) return { ok: false, error: "Nothing to save.", status: 400 };
  await Template.patch({ id: args.pageId }).set(set).go();
  console.info(JSON.stringify({ event: "page-code-saved", templateId: args.pageId, userId: args.userId, at: new Date().toISOString(), headChars: set.pageHeadCode?.length, footerChars: set.pageFooterCode?.length }));
  const state = await readPageCode(args.organizationId, args.pageId);
  return { ok: true, state: state! };
}
