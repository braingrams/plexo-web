import { ImageResponse } from "next/og";
import { getPlexoLogo } from "@/lib/brand/plexoLogos";
import { BrandMarkTile } from "./_brandMark";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";
// Read live from Strata (the app icon tile), so it can't be prerendered at build time.
export const dynamic = "force-dynamic";

/**
 * The browser-tab icon: the app icon tile published in Strata (role SOCIAL_AVATAR, a dark tile
 * that reads on light and dark tabs). Falls back to the generated Plexo "p" mark when Strata
 * has nothing usable (or PLEXO_BRAND_STRATA=off).
 */
export default async function Icon() {
  const logo = await getPlexoLogo("app-icon");
  if (logo.source === "strata" && logo.contentType === "image/png") {
    return new Response(logo.bytes as BodyInit, { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=86400" } });
  }
  return new ImageResponse(<BrandMarkTile size={32} radius={8} padding={5} />, { ...size });
}
