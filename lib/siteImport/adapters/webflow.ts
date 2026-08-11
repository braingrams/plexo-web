import { SiteImportPlatform } from "@prisma/client";
import type { PlatformAdapter } from "../types";
import { detectInteractiveFeatures } from "../interactiveFeatureDetect";

// Webflow-published sites are static-export-like (server-rendered HTML, no client hydration
// needed to see real content) — no platform content API, so both pages and blog posts (CMS
// collection items) go through the shared fetchRenderedHtml (static fetch, not headless by
// default) + Readability extraction path in runJob.ts.
export const webflowAdapter: PlatformAdapter = {
  platform: SiteImportPlatform.WEBFLOW,
  needsHeadlessByDefault: false,
  detectInteractiveFeatures: (html) => detectInteractiveFeatures(html, SiteImportPlatform.WEBFLOW),
};
