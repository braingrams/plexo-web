import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Developers — SDK, MCP & API",
  description:
    "Build with Plexo: embed the visual builder via the SDK, connect Claude/ChatGPT over MCP, or call the REST API directly. Docs, code samples, and integration guides.",
  alternates: { canonical: "/developers" },
};

export default function DevelopersLayout({ children }: { children: React.ReactNode }) {
  return children;
}
