"use client";

import { useState } from "react";
import { Mulish } from "next/font/google";
import { ScrollFxProvider } from "@/app/scroll-fx";
import { V2Nav } from "./components/v2/v2-nav";
import { V2Hero } from "./components/v2/v2-hero";
import { V2TrustAndHeader } from "./components/v2/v2-trust-and-header";
import { V2FeatureCards } from "./components/v2/v2-feature-cards";
import { V2DarkFeatureSection } from "./components/v2/v2-dark-feature-section";
import { V2StrataSection } from "./components/v2/v2-strata-section";
import { V2CommunitySection } from "./components/v2/v2-community-section";
import { V2CarouselSection } from "./components/v2/v2-carousel-section";
import { V2TestimonialSection } from "./components/v2/v2-testimonial-section";
import { V2PricingSection } from "./components/v2/v2-pricing-section";
import { V2FaqSection } from "./components/v2/v2-faq-section";
import { V2Footer } from "./components/v2/v2-footer";

const mulish = Mulish({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800", "900"],
  display: "swap",
});

export default function RootHomePage() {
  const [isDark, setIsDark] = useState(true);

  const toggleTheme = () => setIsDark((prev) => !prev);

  return (
    <ScrollFxProvider>
      <main className={`${mulish.className} min-h-screen antialiased selection:bg-purple-600 selection:text-white transition-colors duration-500 ${
        isDark ? "bg-[#0b0f19] text-white" : "bg-white text-slate-950"
      }`}>
        <V2Nav isDark={isDark} onToggleTheme={toggleTheme} />
        <V2Hero isDark={isDark} />
        <V2TrustAndHeader isDark={isDark} />
        <V2FeatureCards isDark={isDark} />
        <V2DarkFeatureSection isDark={isDark} />
        <V2StrataSection isDark={isDark} />
        <V2CommunitySection isDark={isDark} />
        <V2CarouselSection isDark={isDark} />
        <V2TestimonialSection isDark={isDark} />
        <V2PricingSection isDark={isDark} />
        <V2FaqSection isDark={isDark} />
        <V2Footer isDark={isDark} />
      </main>
    </ScrollFxProvider>
  );
}
