import { SiteImportPlatform } from "@prisma/client";
import type { PlatformAdapter } from "../types";
import { detectInteractiveFeatures } from "../interactiveFeatureDetect";

// Wix (Thunderbolt) is heavily client-rendered — no listBlogPosts/fetchBlogPostContent here;
// both regular pages and blog posts go through the shared fetchRenderedHtml (always headless
// for this platform, see headlessFetch.ts) + Readability extraction path in runJob.ts.
export const wixAdapter: PlatformAdapter = {
  platform: SiteImportPlatform.WIX,
  needsHeadlessByDefault: true,
  detectInteractiveFeatures: (html) => detectInteractiveFeatures(html, SiteImportPlatform.WIX),
};
