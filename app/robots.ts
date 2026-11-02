import type { MetadataRoute } from "next";

// plexo.charisol.io is now the product/dashboard only — all public marketing and
// SEO lives on www.plexopages.com. We disallow the entire app domain so search
// engines index the marketing site instead of duplicating/competing with it here.
// (The former allow-list robots config is preserved in git history / _archive.)
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        disallow: "/",
      },
    ],
  };
}
