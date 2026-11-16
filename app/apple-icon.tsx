import { ImageResponse } from "next/og";
import { BrandMarkTile } from "./_brandMark";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** The home-screen icon on iPhone/iPad. iOS rounds the corners itself, so the tile is square. */
export default function AppleIcon() {
  return new ImageResponse(<BrandMarkTile size={180} radius={0} padding={36} />, { ...size });
}
