import { ApiKey } from "@/lib/db/coreEntities";
import { loadPromos } from "@/lib/promos/load";
import { isDeveloper, pickPromo, promoAudience, readDismissed } from "@/lib/promos/promos";
import { PromoStrip } from "./PromoStrip";

type Who = { id: string; experience?: string | null; buildProfile?: unknown; dismissedPromos?: unknown };

/** Never makes the page wait: a slow or failed read just means no banner. */
async function pick(user: Who) {
  const promos = await Promise.race([loadPromos(), new Promise<never[]>((resolve) => setTimeout(() => resolve([]), 800))]);
  const dismissed = readDismissed(user.dismissedPromos);
  // Promos for everyone win. Only when none is showing do we ask whether this person is a developer.
  const first = pickPromo(promos, dismissed);
  if (!first || promoAudience(first) === "all") return first;
  const { userExperience } = await import("@/lib/dashboardV3/profile");
  const keys = user.experience === "pro" ? 0 : (await ApiKey.query.byUser({ userId: user.id }).go({ limit: 1 })).data.length;
  const developer = isDeveloper({ experience: userExperience(user), apiKeyCount: keys });
  return pickPromo(promos, dismissed, Date.now(), { developer });
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
