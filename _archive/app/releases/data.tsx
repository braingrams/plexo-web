import type { SnapshotImage } from "./mockups";

export type ReleaseSection = {
  heading: string;
  body: string[];
  // Each row renders as one screenshot spanning full width, or two side by side.
  snapshots?: SnapshotImage[][];
};

export type Release = {
  slug: string;
  date: string; // ISO date
  title: string;
  tagline: string;
  summary: string;
  sections: ReleaseSection[];
  fixes?: string[];
};

// Newest first. Add a new entry here to publish a release — the index and
// detail page at /releases/[slug] pick it up automatically. Drop each
// section's screenshot(s) at /public/releases/<slug>/<file> and reference
// them below.
export const RELEASES: Release[] = [
  {
    slug: "blogging-marketplace-payouts",
    date: "2026-08-07",
    title: "Blogging, marketplace payouts, and a refreshed dashboard",
    tagline: "The biggest update yet",
    summary:
      "A full blogging platform with WordPress migration, payouts for marketplace template sellers, and a visual refresh across the dashboard and editor.",
    sections: [
      {
        heading: "A refreshed dashboard",
        body: [
          "The overview page now surfaces the numbers that matter — templates, live domains, API keys, and 7-day views — at a glance, alongside a general visual refresh across the template dashboard and editor.",
        ],
        snapshots: [
          [{ src: "/releases/blogging-marketplace-payouts/dashboard-overview.png", alt: "The redesigned dashboard overview with key stats", label: "plexo.app/dashboard" }],
          [{ src: "/releases/blogging-marketplace-payouts/templates-grid.png", alt: "The templates grid in the dashboard", label: "plexo.app/dashboard/templates" }],
        ],
      },
      {
        heading: "Introducing blogging",
        body: [
          "Every site now has a Blog tab of its own. Start from a blank blog or migrate an existing WordPress site straight in.",
          "Write in a rich editor with AI-assisted drafting, set a featured image (AI-generated or pasted from a URL), and tag posts as you go. A built-in SEO checklist guides you toward a stronger title, description, and content while you write.",
          "Once published, the post goes live on your domain styled to match your site's theme automatically.",
        ],
        snapshots: [
          [{ src: "/releases/blogging-marketplace-payouts/blog-dashboard-list.png", alt: "Every site with blogging turned on, listed in one place", label: "plexo.app/dashboard/blog" }],
          [{ src: "/releases/blogging-marketplace-payouts/blog-empty-state.png", alt: "A blog with no posts yet, with an option to import from WordPress", label: "plexo.app/dashboard/.../blog" }],
          [
            { src: "/releases/blogging-marketplace-payouts/blog-editor.png", alt: "Writing a new blog post with AI Write for Me and a featured image field", label: "plexo.app/dashboard/.../blog/new" },
            { src: "/releases/blogging-marketplace-payouts/blog-seo-checklist.png", alt: "The SEO checklist reviewing title, description, and content as you write", label: "plexo.app/dashboard/.../blog/new" },
          ],
          [{ src: "/releases/blogging-marketplace-payouts/blog-published-post.png", alt: "A published blog post live on a custom domain", label: "gistbuster.plexopages.com/blog/…" }],
        ],
      },
      {
        heading: "Marketplace: templates now pay creators",
        body: [
          "Browse and filter a growing library of templates by category, price, and type. Sellers can now manage listings and withdraw earnings directly from Payouts, with bank details held under their own dedicated encryption.",
        ],
        snapshots: [
          [{ src: "/releases/blogging-marketplace-payouts/marketplace-browse.png", alt: "The template marketplace with category filters and a Payouts entry point", label: "plexo.app/dashboard/marketplace" }],
        ],
      },
      {
        heading: "Team roles & permissions",
        body: [
          "Invite teammates into your workspace and control exactly what they can do — Admin, Editor, Commenter, or Viewer — so collaborators get the right level of access from day one.",
        ],
        snapshots: [
          [{ src: "/releases/blogging-marketplace-payouts/team-settings.png", alt: "Inviting a teammate to a workspace", label: "plexo.app/dashboard/settings/team" }],
          [{ src: "/releases/blogging-marketplace-payouts/team-settings-roles.png", alt: "Choosing a role for an invited teammate — Admin, Editor, Commenter, or Viewer", label: "plexo.app/dashboard/settings/team" }],
        ],
      },
    ],
    fixes: [
      "Comment form no longer overflows on mobile",
      "Fixed blank featured images/post lists on certain layouts",
      "Cleaned up error messages when AI image generation fails",
    ],
  },
];

export function getRelease(slug: string): Release | undefined {
  return RELEASES.find((r) => r.slug === slug);
}
