"use client";

import { useState } from "react";
import { ScrollFxProvider } from "@/app/scroll-fx";
import { V2Nav } from "@/app/components/v2/v2-nav";
import { V2Footer } from "@/app/components/v2/v2-footer";
import { DevHero } from "./components/dev-hero";
import { DevSdkSection } from "./components/dev-sdk-section";
import { DevMcpSection } from "./components/dev-mcp-section";
import { DevCodePlayground } from "./components/dev-code-playground";

export default function DevelopersPage() {
  const [isDark, setIsDark] = useState(true);

  const toggleTheme = () => setIsDark((prev) => !prev);

  return (
    <ScrollFxProvider>
      <main className={`min-h-screen antialiased selection:bg-purple-600 selection:text-white transition-colors duration-500 font-sans ${
        isDark ? "bg-[#0b0f19] text-white" : "bg-white text-slate-950"
      }`}>
        <V2Nav isDark={isDark} onToggleTheme={toggleTheme} />
        <DevHero isDark={isDark} />
        <DevSdkSection isDark={isDark} />
        <DevMcpSection isDark={isDark} />
        <DevCodePlayground isDark={isDark} />
        <V2Footer isDark={isDark} />
      </main>
    </ScrollFxProvider>
  );
}
