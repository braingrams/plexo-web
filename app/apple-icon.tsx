import { ImageResponse } from "next/og";
import { getPlexoLogo } from "@/lib/brand/plexoLogos";
import { BrandMarkTile } from "./_brandMark";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";

/** The home-screen icon on iPhone/iPad: the live Strata app icon tile, else the generated mark. iOS rounds the corners itself. */
export default async function AppleIcon() {
  const logo = await getPlexoLogo("app-icon");
  if (logo.source === "strata" && logo.contentType === "image/png") {
    return new Response(logo.bytes as BodyInit, { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=86400" } });
  }
  return new ImageResponse(<BrandMarkTile size={180} radius={0} padding={36} />, { ...size });
}
