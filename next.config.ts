import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // playwright-core: even connectOverCDP (no local browser launch) touches its coreBundle,
  // which does a relative-path require of browsers.json — bundling it (Turbopack's default)
  // drops that non-JS asset from the serverless function, so it must load from a real,
  // complete node_modules/playwright-core at runtime instead. See lib/siteImport/browserbaseClient.ts.
  serverExternalPackages: ["mjml", "playwright-core"],
  transpilePackages: ["@charisol/plexo-sdk"],
};

export default nextConfig;
