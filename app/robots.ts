import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL?.startsWith("http")
  ? process.env.NEXT_PUBLIC_APP_URL
  : "https://plexo.charisol.io";

// Paths with no public/indexable content: auth flows, the signed-in dashboard,
// API routes, and the org-invite/onboarding steps.
const DISALLOW = [
  "/api/",
  "/dashboard",
  "/auth/",
  "/choose-org",
  "/accept-invite",
  "/mcp/login",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: DISALLOW,
      },
      // Explicitly welcome AI answer-engine/crawler agents onto the marketing
      // and docs surface — the default `*` rule already allows them, but
      // naming them keeps intent obvious as these bots proliferate.
      { userAgent: "GPTBot", allow: "/", disallow: DISALLOW },
      { userAgent: "ChatGPT-User", allow: "/", disallow: DISALLOW },
      { userAgent: "OAI-SearchBot", allow: "/", disallow: DISALLOW },
      { userAgent: "ClaudeBot", allow: "/", disallow: DISALLOW },
      { userAgent: "Claude-User", allow: "/", disallow: DISALLOW },
      { userAgent: "anthropic-ai", allow: "/", disallow: DISALLOW },
      { userAgent: "Google-Extended", allow: "/", disallow: DISALLOW },
      { userAgent: "PerplexityBot", allow: "/", disallow: DISALLOW },
      { userAgent: "Applebot-Extended", allow: "/", disallow: DISALLOW },
      { userAgent: "CCBot", allow: "/", disallow: DISALLOW },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
