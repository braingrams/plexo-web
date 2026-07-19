import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["mjml"],
  transpilePackages: ["@plexobuilder/sdk"],
};

export default nextConfig;
