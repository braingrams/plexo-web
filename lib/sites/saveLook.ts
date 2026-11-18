import { Template } from "@/lib/db/contentEntities";
import { User } from "@/lib/db/coreEntities";
import { checkCommerceRateLimit } from "@/lib/commerceRateLimitDynamo";
import { lookOutcomeMessage, readSiteBrand, sanitizeBrandLook, siteBrandFromLook } from "@/lib/dashboardV3/brandLook";
import { applySiteLook } from "@/lib/sites/applyLook";

type Who = { userId: string; organizationId: string };
export type SaveLookResult = { status: number; body: Record<string, unknown> };

/**
 * Saves a site's logo and colours and puts them into its pages. The one place both the Brand tab
 * (PUT /api/v1/sites/[id]/look) and SOL's site_save_look tool go through, so they behave the same.
 * `revalidate` is passed by the route; it is not imported here because SOL's Lambda bundle must never pull in Next.
 */
export async function saveSiteLook(who: Who, siteId: string, input: unknown, revalidate?: (path: string) => void): Promise<SaveLookResult> {
  const { data: site } = await Template.get({ id: siteId }).go();
  if (!site || site.organizationId !== who.organizationId || site.parentId || site.kind !== "LANDING_PAGE") return { status: 404, body: { error: "Site not found." } };
  if (!(await checkCommerceRateLimit(`site-look:${who.userId}`, 30))) return { status: 429, body: { error: "That's a lot of changes in a short time. Wait a few minutes and try again." } };
  const parsed = sanitizeBrandLook(input);
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };
  const look = parsed.value;
  try {
    const hadLogo = !!readSiteBrand(site.brand)?.logoUrl;
    const brand = siteBrandFromLook(look);
    await Template.patch({ id: siteId }).set({ brand }).go();
    const { data: user } = await User.get({ id: who.userId }).go({ attributes: ["name"] });
    let applied = { updated: 0, needsPublish: 0, skipped: 0, logoPlaced: false };
    try {
      applied = await applySiteLook({ organizationId: who.organizationId, userId: who.userId, userName: user?.name ?? "Plexo User", siteId, look, hadLogo });
    } catch (err) {
      console.error("applying a site look failed", err);
    }
    // The brand lives in Strata: send this change there (Plexo's copy above stays as the fallback). Never fails the save.
    let strata: { state: string; message: string } | undefined;
    if (look.colors?.length) {
      try {
        const { sendBrandWithin } = await import("@/lib/brand/writeThrough");
        strata = await sendBrandWithin({ siteId, userId: who.userId, organizationId: who.organizationId });
      } catch (err) {
        console.warn("sending the look to Strata failed", err);
      }
    }
    revalidate?.("/dashboard");
    revalidate?.(`/dashboard/sites/${siteId}`);
    return { status: 200, body: { brand, applied, ...(strata ? { strata } : {}), ...lookOutcomeMessage(applied, !!look.logoUrl) } };
  } catch (err) {
    console.error("saving a site look failed", err);
    return { status: 500, body: { error: "We couldn't save your logo and colours. Please try again in a moment." } };
  }
}
