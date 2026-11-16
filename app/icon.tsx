import { ImageResponse } from "next/og";
import { BrandMarkTile } from "./_brandMark";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

/** The browser-tab icon: the Plexo "p" mark (docs/redesign/logo-*.svg). */
export default function Icon() {
  return new ImageResponse(<BrandMarkTile size={32} radius={8} padding={5} />, { ...size });
}
