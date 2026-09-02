// Local replacement for the Prisma-generated SiteImportPlatform enum — matches
// lib/db/importEntities.ts's SiteImportJob.platform attribute exactly (the real,
// DynamoDB-backed source of truth), used here purely as an enum-like value the same way
// Prisma's generated enum was (SiteImportPlatform.WORDPRESS, etc.), not because either
// entity requires this specific shape.
export const SiteImportPlatform = {
  WORDPRESS: "WORDPRESS",
  SQUARESPACE: "SQUARESPACE",
  WIX: "WIX",
  WEBFLOW: "WEBFLOW",
  UNKNOWN: "UNKNOWN",
} as const;

export type SiteImportPlatform = (typeof SiteImportPlatform)[keyof typeof SiteImportPlatform];
