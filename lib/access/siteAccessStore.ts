import { Template } from "@/lib/db/contentEntities";
import { Member } from "@/lib/db/coreEntities";
import { cleanSiteAccess, type SiteAccess, type SiteRole } from "./siteAccess";

// The database half of site-only access (the rules that need no database are in siteAccess.ts).

const ROOT_TTL_MS = 60_000;
const roots = new Map<string, { root: string | null; org: string | null; at: number }>();

/** The home page's id of the site a page belongs to (a site's own id when given a site), with the workspace that owns it. Remembered for a minute. */
export async function rootOfTemplate(templateId: string): Promise<{ root: string | null; organizationId: string | null }> {
  const hit = roots.get(templateId);
  if (hit && Date.now() - hit.at < ROOT_TTL_MS) return { root: hit.root, organizationId: hit.org };
  let id = templateId;
  let organizationId: string | null = null;
  let root: string | null = null;
  for (let i = 0; i < 32; i++) {
    const { data } = await Template.get({ id }).go();
    if (!data) break;
    organizationId = data.organizationId;
    if (!data.parentId) { root = data.id; break; }
    id = data.parentId;
  }
  roots.set(templateId, { root, org: organizationId, at: Date.now() });
  return { root, organizationId };
}

/** What a site-only member may do with a call on `siteId` (a site or one of its pages), or null when this is not one of their sites. */
export async function guestRoleForSite(access: SiteAccess, siteId: string, organizationId: string): Promise<{ role: SiteRole; root: string } | null> {
  const { root, organizationId: owner } = await rootOfTemplate(siteId);
  if (!root || owner !== organizationId) return null;
  const role = access[root];
  return role ? { role, root } : null;
}

export type SiteAccessCheck = { ok: true; access: SiteAccess } | { ok: false; error: string };

/** The access list a super-careful owner submitted, checked: every site must be one of this workspace's own sites (a home page, not a sub-page). */
export async function validateSiteAccess(organizationId: string, raw: unknown): Promise<SiteAccessCheck> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Choose at least one site and a role for it." };
  const entries = Object.entries(raw as Record<string, unknown>);
  const access = cleanSiteAccess(raw);
  if (entries.length === 0 || Object.keys(access).length !== entries.length) return { ok: false, error: "Each site needs one of the roles shown." };
  if (entries.length > 100) return { ok: false, error: "That is too many sites for one person. Choose up to 100." };
  for (const id of Object.keys(access)) {
    const { data } = await Template.get({ id }).go();
    if (!data || data.organizationId !== organizationId || data.parentId || data.kind !== "LANDING_PAGE") return { ok: false, error: "One of those sites isn't in this workspace." };
  }
  return { ok: true, access };
}

/** Forget what was remembered about sites (tests). */
export const forgetSiteRoots = (): void => roots.clear();

/** The sites a site-only member can open (and their role on each), or null when this person is an ordinary member and can open every site. */
export async function guestAccessFor(userId: string, organizationId: string): Promise<SiteAccess | null> {
  const { data } = await Member.get({ organizationId, userId }).go();
  return data?.role === "guest" ? cleanSiteAccess(data.siteAccess) : null;
}
