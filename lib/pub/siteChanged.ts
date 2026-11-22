import { after } from "next/server";
import { Template } from "@/lib/db/contentEntities";

/** The id of the site (home page) a page belongs to, walking up through its parents. */
export async function siteRootOf(templateId: string): Promise<string | null> {
  let current: string | undefined = templateId;
  for (let i = 0; i < 8 && current; i++) {
    const lookup: { data?: { parentId?: string | null } | null } = await Template.get({ id: current }).go();
    if (!lookup.data) return null;
    if (!lookup.data.parentId) return current;
    current = lookup.data.parentId;
  }
  return null;
}

/** Runs after the response is sent where the runtime supports it, otherwise just starts it. Never throws. */
function inBackground(task: () => Promise<unknown>): void {
  const run = () => task().catch((err) => console.error("after site change:", err instanceof Error ? err.message : "unknown error"));
  try {
    after(run);
  } catch {
    void run();
  }
}

/**
 * Called whenever a page is saved or published. The live site changed, so: the edge's saved copies of its pages are
 * cleared (lib/pub/edgeCache.ts) and a fresh health check is queued (lib/siteHealth/recheck.ts). Both are best effort.
 */
export function afterSiteChanged(templateId: string): void {
  inBackground(async () => {
    const siteId = await siteRootOf(templateId);
    if (!siteId) return;
    // Loaded when needed: a page save must not pull the CDN and health code into every caller.
    const { purgeSitePages } = await import("@/lib/pub/edgeCache");
    await purgeSitePages(siteId);
    const { queueRecheck } = await import("@/lib/siteHealth/recheck");
    await queueRecheck(siteId);
  });
}
