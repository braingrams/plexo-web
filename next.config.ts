import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // playwright-core: even connectOverCDP (no local browser launch) touches its coreBundle,
  // which does a relative-path require of browsers.json — bundling it (Turbopack's default)
  // drops that non-JS asset from the serverless function, so it must load from a real,
  // complete node_modules/playwright-core at runtime instead. See lib/siteImport/browserbaseClient.ts.
  serverExternalPackages: ["mjml", "playwright-core"],
  // serverExternalPackages alone stops Next from bundling it, but Vercel's own build-output
  // file tracer (@vercel/nft) still didn't pick up browsers.json on its own — confirmed
  // against a real deployment, still 500ing with the exact same "Cannot find module
  // .../playwright-core/browsers.json" after adding serverExternalPackages alone. Forcing the
  // whole package directory into every route's traced output closes that gap.
  outputFileTracingIncludes: {
    "/api/v1/site-import/**/*": ["./node_modules/playwright-core/**"],
    "/api/internal/site-import/**/*": ["./node_modules/playwright-core/**"],
  },
  transpilePackages: ["@charisol/plexo-sdk"],
  // Only our own uploads bucket (lib/storage.ts's publicUrlFor — bucket name/region vary per
  // environment, hence the wildcard) is allowlisted for /_next/image optimization. Published
  // pages can also embed an arbitrary externally-hosted image URL (an author pasting a direct
  // link, or the Unsplash placeholder) — those are left as plain <img> tags rather than routed
  // through the optimizer, since remotePatterns can't practically allowlist "the whole web".
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**.amazonaws.com" }],
  },
};

export default nextConfig;
