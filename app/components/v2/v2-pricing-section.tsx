"use client";

import Link from "next/link";
import { Check, Sparkles, Zap } from "lucide-react";
import { Reveal } from "@/app/scroll-fx";

type Plan = {
  name: string;
  planKey: "FREE" | "PRO" | "ULTRA";
  price: string;
  period: string;
  description: string;
  popular?: boolean;
  features: string[];
  ctaText: string;
  ctaHref: string;
};

const PLANS: Plan[] = [
  {
    name: "Free",
    planKey: "FREE",
    price: "$0",
    period: "forever",
    description: "Essential page & email builder features for creators and personal projects.",
    features: [
      "Up to 3 Templates",
      "10 Monthly AI Credits",
      "Subdomain publishing (plexopages.com)",
      "Visual Drag & Drop Builder",
      "Standard HTML5 & MJML Export",
      "Community Support",
    ],
    ctaText: "Start Free",
    ctaHref: "/auth/register?plan=FREE",
  },
  {
    name: "Pro",
    planKey: "PRO",
    price: "$19",
    period: "per month",
    description: "Designed for professional creators and growing brands building high-converting sites.",
    popular: true,
    features: [
      "Up to 20 Templates",
      "2,000 Monthly AI Credits",
      "Custom Domain Linking (yourdomain.com)",
      "Branding Removal (Hide 'Hosted with Plexo')",
      "Visual & Raw HTML Eject Mode",
      "Fast Edge Hosting & Auto SSL",
      "Priority Email Support",
    ],
    ctaText: "Get Pro Plan",
    ctaHref: "/auth/register?plan=PRO",
  },
  {
    name: "Ultra",
    planKey: "ULTRA",
    price: "$49",
    period: "per month",
    description: "Maximum power for power users, teams, and platforms needing AI automation.",
    features: [
      "Unlimited Templates",
      "5,000 Monthly AI Credits",
      "Multi-Page Sites Enabled",
      "Host-Managed AI Enabled",
      "MCP Server Agent Access",
      "Custom Domain Linking",
      "Branding Removal",
      "Dedicated 24/7 Support",
    ],
    ctaText: "Get Ultra Plan",
    ctaHref: "/auth/register?plan=ULTRA",
  },
];

export function V2PricingSection({ isDark }: { isDark: boolean }) {
  return (
    <section id="pricing" className={`py-16 md:py-24 px-4 sm:px-8 md:px-16 transition-colors duration-500 font-['Mulish',sans-serif] ${
      isDark ? "bg-[#0b0f19] text-white" : "bg-slate-50 text-slate-950"
    }`}>
      <div className="max-w-7xl mx-auto space-y-12">
        {/* Section Header */}
        <Reveal>
          <div className="text-center max-w-2xl mx-auto space-y-4">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-bold bg-purple-500/10 text-purple-400 border border-purple-500/20">
              <Sparkles className="w-4 h-4 text-purple-400" />
              <span>TRANSPARENT PRICING</span>
            </div>

            <h2 className="text-4xl sm:text-5xl font-extrabold tracking-tight">
              Simple, predictable plans for everyone
            </h2>

            <p className={`text-base sm:text-lg font-medium ${
              isDark ? "text-slate-400" : "text-slate-600"
            }`}>
              Choose the perfect tier for your workflow. Switch or upgrade at any time with no lock-in.
            </p>
          </div>
        </Reveal>

        {/* 3 Plan Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-stretch">
          {PLANS.map((plan, index) => (
            <Reveal key={plan.name} delay={index * 0.1}>
              <div
                className={`rounded-[36px] p-8 flex flex-col justify-between relative transition-all duration-300 border shadow-xl h-full ${
                  plan.popular
                    ? isDark
                      ? "bg-[#16122c] border-purple-500 shadow-purple-900/30 scale-105"
                      : "bg-white border-purple-600 shadow-purple-100 scale-105"
                    : isDark
                    ? "bg-[#0f1422] border-slate-800 hover:border-slate-700"
                    : "bg-white border-slate-200 hover:border-slate-300"
                }`}
              >
                {/* Popular Badge */}
                {plan.popular && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white text-xs font-extrabold px-4 py-1.5 rounded-full shadow-md flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 fill-white" />
                    <span>MOST POPULAR</span>
                  </div>
                )}

                <div className="space-y-6">
                  <div>
                    <h3 className="text-2xl font-extrabold mb-1">{plan.name}</h3>
                    <p className={`text-xs font-medium ${
                      isDark ? "text-slate-400" : "text-slate-600"
                    }`}>
                      {plan.description}
                    </p>
                  </div>

                  <div className="flex items-baseline gap-1.5 border-b pb-6 border-slate-800/60">
                    <span className="text-4xl sm:text-5xl font-extrabold tracking-tight">{plan.price}</span>
                    <span className={`text-xs font-bold ${
                      isDark ? "text-slate-400" : "text-slate-500"
                    }`}>
                      / {plan.period}
                    </span>
                  </div>

                  <ul className="space-y-3 text-xs sm:text-sm font-semibold">
                    {plan.features.map((feature, idx) => (
                      <li key={idx} className="flex items-center gap-3">
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                          plan.popular
                            ? "bg-purple-600 text-white"
                            : isDark
                            ? "bg-slate-800 text-purple-400"
                            : "bg-purple-50 text-purple-600"
                        }`}>
                          <Check className="w-3 h-3 stroke-[3]" />
                        </div>
                        <span className={isDark ? "text-slate-200" : "text-slate-800"}>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="pt-8">
                  <Link
                    href={plan.ctaHref}
                    className={`w-full py-4 rounded-2xl font-extrabold text-sm text-center block transition-all shadow-md ${
                      plan.popular
                        ? "bg-[#6b3bf9] hover:bg-[#5b2be6] text-white shadow-purple-600/30"
                        : isDark
                        ? "bg-slate-800 hover:bg-slate-700 text-white border border-slate-700"
                        : "bg-slate-900 hover:bg-slate-800 text-white"
                    }`}
                  >
                    {plan.ctaText}
                  </Link>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
