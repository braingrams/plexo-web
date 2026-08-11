import { SiteImportPlatform } from "@prisma/client";
import type { PlatformAdapter } from "../types";
import { wordpressAdapter } from "./wordpress";
import { squarespaceAdapter } from "./squarespace";
import { wixAdapter } from "./wix";
import { webflowAdapter } from "./webflow";
import { genericAdapter } from "./generic";

const ADAPTERS: Record<SiteImportPlatform, PlatformAdapter> = {
  [SiteImportPlatform.WORDPRESS]: wordpressAdapter,
  [SiteImportPlatform.SQUARESPACE]: squarespaceAdapter,
  [SiteImportPlatform.WIX]: wixAdapter,
  [SiteImportPlatform.WEBFLOW]: webflowAdapter,
  [SiteImportPlatform.UNKNOWN]: genericAdapter,
};

export function getAdapter(platform: SiteImportPlatform): PlatformAdapter {
  return ADAPTERS[platform] ?? genericAdapter;
}
