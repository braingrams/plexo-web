import { signedDraftPreviewUrl } from "@/lib/draftPreviewToken";
import { screenshotPage, type ScreenshotResult } from "@/lib/projects/screenshot";

// Screenshots of a page that is not online yet: a short-lived signed address for the owner-only draft preview
// (lib/draftPreviewToken.ts) is opened by Plexo's own browser through the existing screenshot service. Used by
// SOL's visual review (lib/ai/solVisualReview.ts). Nothing here is shown to the owner: no addresses, no tokens.

export type DraftShotDevice = "desktop" | "phone";
export type DraftShot = { device: DraftShotDevice; kind: "top" | "full"; imageUrl: string };

/** This deployment's own public address (what the browser Lambda can reach). */
function selfOrigin(): string {
  const o = process.env.PLEXO_SELF_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (!o || !/^https:\/\//.test(o)) throw new Error("This deployment has no public https address for screenshots.");
  return o;
}

type Shooter = (url: string, opts: { viewport: "desktop" | "phone"; userId: string; fullPage?: boolean }) => Promise<Pick<ScreenshotResult, "imageUrl">>;

/**
 * Desktop (1440x900): the top of the page and a full-page capture. Phone (390x844): the top of the page.
 * `templateId` is the site's root; `pageId` the page inside it (omit for the home page). Throws on any failure
 * (the caller fails open).
 */
export async function screenshotDraftPage(
  args: { templateId: string; pageId?: string | null; device: DraftShotDevice | "both"; userId: string },
  deps: { shoot?: Shooter; origin?: string; now?: number; secret?: string } = {},
): Promise<DraftShot[]> {
  const shoot: Shooter = deps.shoot ?? ((url, opts) => screenshotPage(url, opts));
  const origin = deps.origin ?? selfOrigin();
  const url = signedDraftPreviewUrl(origin, { templateId: args.templateId, pageId: args.pageId ?? null, shot: true }, { now: deps.now, secret: deps.secret });
  const jobs: Array<{ device: DraftShotDevice; kind: "top" | "full" }> = [];
  if (args.device === "desktop" || args.device === "both") jobs.push({ device: "desktop", kind: "top" }, { device: "desktop", kind: "full" });
  if (args.device === "phone" || args.device === "both") jobs.push({ device: "phone", kind: "top" });
  return Promise.all(jobs.map(async (j) => ({ ...j, imageUrl: (await shoot(url, { viewport: j.device, userId: args.userId, fullPage: j.kind === "full" })).imageUrl })));
}
