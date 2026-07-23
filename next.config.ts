import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // jsdom (a transitive dependency of isomorphic-dompurify, used to give DOMPurify a DOM
  // implementation server-side) fails to load under Turbopack: html-encoding-sniffer's
  // require() of an ESM dependency breaks when Turbopack's own external-require shim
  // handles it (ERR_REQUIRE_ESM). Excluding it from bundling lets Node's runtime require
  // resolve it directly instead, the same fix already applied to mjml below.
  serverExternalPackages: ["mjml", "isomorphic-dompurify", "jsdom"],
  transpilePackages: ["@charisol/plexo-sdk"],
};

export default nextConfig;
