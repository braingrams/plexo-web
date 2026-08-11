import { SiteImportPlatform } from "@prisma/client";
import type { PlatformAdapter } from "../types";

// Fallback for a site that isn't recognized as one of the four named platforms — plain
// static-HTML handling, no platform-specific signatures (there's nothing reliable to key off).
export const genericAdapter: PlatformAdapter = {
  platform: SiteImportPlatform.UNKNOWN,
  needsHeadlessByDefault: false,
  detectInteractiveFeatures: () => [],
};
