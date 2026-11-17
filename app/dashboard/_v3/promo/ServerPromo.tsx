import { ApiKey } from "@/lib/db/coreEntities";
import { loadPromos } from "@/lib/promos/load";
import { choosePromo, isDeveloper, readDismissed } from "@/lib/promos/promos";
import { PromoStrip } from "./PromoStrip";

type Who = { id: string; experience?: string | null; buildProfile?: unknown; dismissedPromos?: unknown };

/** Never makes the page wait: a slow or failed read just means no banner. */
async function pick(user: Who) {
  const promos = await Promise.race([loadPromos(), new Promise<never[]>((resolve) => setTimeout(() => resolve([]), 800))]);
  const dismissed = readDismissed(user.dismissedPromos);
  return choosePromo(promos, dismissed, Date.now(), async () => {
    const { userExperience } = await import("@/lib/dashboardV3/profile");
    const keys = user.experience === "pro" ? 0 : (await ApiKey.query.byUser({ userId: user.id }).go({ limit: 1 })).data.length;
    return isDeveloper({ experience: userExperience(user), apiKeyCount: keys });
  });
}

/**
 * The admin-controlled strip. `yieldTo` is true when a plan / trial / past-due notice is showing:
 * then no promo renders. (A moving-site banner is a client notice; v3.css hides the strip whenever
 * a `.plx-notice` sits above it, so at most one banner-like strip is ever visible.)
 */
export async function ServerPromo({ user, yieldTo }: { user: Who; yieldTo: boolean }) {
  if (yieldTo) return null;
  try {
    const p = await pick(user);
    if (!p) return null;
    return <PromoStrip promo={{ id: p.id, version: p.version, feature: p.feature, audience: p.audience, headline: p.headline, body: p.body, buttonLabel: p.buttonLabel, href: p.href, imageUrl: p.imageUrl, tone: p.tone }} />;
  } catch (err) {
    console.error("[promos] skipped", err);
    return null;
  }
}
