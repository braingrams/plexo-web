import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/theme";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Plexo — Visual Template Builder",
    short_name: "Plexo",
    description:
      "Drag-and-drop visual builder for email campaigns and landing pages, with AI generation, an SDK, and MCP support.",
    start_url: "/",
    display: "standalone",
    background_color: "#0b0f19",
    theme_color: BRAND.primary,
    icons: [
      { src: "/icon", sizes: "32x32", type: "image/png" },
    ],
  };
}
