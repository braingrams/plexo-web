# Archived marketing & SEO surfaces

Plexo's public marketing and SEO presence moved to **www.plexopages.com**.
`plexo.charisol.io` (this app) is now the product/dashboard only. These files
are archived — **not deleted** — so they can be restored or ported to the
marketing site later. This directory is excluded from `tsconfig.json`, so
nothing here is type-checked or built, and nothing under `app/` routes to it.

## What's here

- `app/page.tsx` — the former root landing page.
- `app/components-v2/` — the landing page's section components (hero, pricing, FAQ, footer, etc.). Was `app/components/v2/`.
- `app/landing-page-client.tsx` — interactive hero/AI-demo client component.
- `app/blog/` — Plexo's own marketing blog (index, post, category/author/tag archives, RSS, OG images). **Not** the multi-tenant blog feature, which lives in `app/pub/[domain]/blog/` and is untouched.
- `app/developers/`, `app/sdk/page.tsx`, `app/mcp/page.tsx` + `mcp-landing-client.tsx`, `app/releases/`, `app/testimonials/` — marketing/content pages.
- `app/sitemap.ts` — old sitemap listing the marketing routes above.
- `app/opengraph-image.tsx` — shared marketing OG image.
- `lib/blog/marketingBlog.ts`, `lib/blog/marketingSeo.ts` — marketing-blog identity + SEO helpers.

## What was deliberately kept live (not archived)

- `app/landing-nav.tsx`, `app/plexo-logo.tsx`, `app/scroll-fx.tsx` — shared by kept pages (auth, `/new`, marketplace, commerce, onboarding).
- `app/mcp/login/` — functional MCP OAuth route (used by dashboard integrations).
- `app/marketplace/` — public product-browse surface.
- `app/legal/acceptable-use/` — the publish/migration/import/MCP flows link to it as the policy users accept; kept reachable but set to `noindex`.
- `lib/sdk/v2-snippets.ts` — moved here from `app/sdk/` because the dashboard SDK page imports it.

## SEO changes made alongside this

- `app/robots.ts` — now disallows the whole app domain.
- `app/layout.tsx` — root metadata stripped of canonical/OG/keywords/verification and Organization/WebSite/SoftwareApplication JSON-LD; set to `noindex`.
- `app/page.tsx` (new) — redirects `/` to `/dashboard`.
