import Link from "next/link";
import {
  Bot,
  Sparkles,
  Zap,
  Globe,
  Terminal,
  Code2,
  BarChart3,
  Copy,
  Check,
  CheckCircle2,
  ArrowRight,
  ShieldCheck,
  Layers,
  FileCode2,
  ExternalLink,
  Laptop,
  Cpu,
} from "lucide-react";
import McpLandingClient from "./mcp-landing-client";

export const metadata = {
  title: "Plexo MCP & AI Integration - Connect Claude, ChatGPT & Cursor",
  description:
    "Prompt your AI assistant to generate, compile, publish, and manage landing pages and email templates on Plexo in seconds using Model Context Protocol (MCP) and OpenAPI Custom Actions.",
  alternates: { canonical: "/mcp" },
};

export default function McpLandingPage() {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://plexo.charisol.io";

  return <McpLandingClient baseUrl={baseUrl} />;
}
