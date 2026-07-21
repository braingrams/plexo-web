import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["mjml"],
  transpilePackages: ["@charisol/plexo-sdk"],
};

export default nextConfig;
