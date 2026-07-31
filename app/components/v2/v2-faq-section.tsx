"use client";

import { useState } from "react";
import { ChevronDown, HelpCircle, Sparkles } from "lucide-react";
import { Reveal } from "@/app/scroll-fx";

type FaqItem = {
  question: string;
  answer: string;
};

const FAQS: FaqItem[] = [
  {
    question: "What makes Plexo different from traditional website builders?",
    answer: "Plexo combines a visual drag-and-drop builder with a native MCP AI server and embeddable SDK. You can prompt AI agents in Cursor or Claude to build pages, eject to raw code editing, or link custom domains seamlessly.",
  },
  {
    question: "How does the MCP (Model Context Protocol) AI server work?",
    answer: "Our open MCP server connects AI assistants like Claude, Cursor, and Antigravity directly to your Plexo workspace. Your AI assistant can create, duplicate, publish, and delete landing pages using natural language commands.",
  },
  {
    question: "Can I connect my own custom domain to published pages?",
    answer: "Yes! On supported plans, you can link custom domains (e.g., yourdomain.com) with automated DNS routing and SSL certificate provisioning. On the free tier, pages are published immediately on isolated subdomains (site.plexopages.com).",
  },
  {
    question: "What happens when I eject a page or export clean code?",
    answer: "Plexo guarantees zero vendor lock-in. At any point, you can export production-ready HTML5/CSS3 for websites or standard MJML for email campaigns. You can also 'eject' a visual builder page to switch it to raw HTML/CSS editing in-place.",
  },
  {
    question: "Is there a free plan available for new builders?",
    answer: "Yes! Plexo provides a generous Free tier that includes full drag-and-drop builder features, subdomain hosting on plexopages.com, and clean code export options so you can start building immediately.",
  },
];

export function V2FaqSection({ isDark }: { isDark: boolean }) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const toggleFaq = (idx: number) => {
    setOpenIndex(openIndex === idx ? null : idx);
  };

  return (
    <section id="faq" className={`py-20 md:py-28 px-4 sm:px-8 md:px-16 transition-colors duration-500 font-['Mulish',sans-serif] ${
      isDark ? "bg-[#0b0f19] text-white" : "bg-white text-slate-950"
    }`}>
      <div className="max-w-4xl mx-auto space-y-12">
        {/* Section Header */}
        <Reveal>
          <div className="text-center space-y-4">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-bold bg-purple-500/10 text-purple-400 border border-purple-500/20">
              <HelpCircle className="w-4 h-4 text-purple-400" />
              <span>FREQUENTLY ASKED QUESTIONS</span>
            </div>

            <h2 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight">
              Got questions? We&apos;ve got answers
            </h2>

            <p className={`text-base font-medium max-w-xl mx-auto ${
              isDark ? "text-slate-400" : "text-slate-600"
            }`}>
              Everything you need to know about building, publishing, and automating pages with Plexo.
            </p>
          </div>
        </Reveal>

        {/* Compact Accordion Items */}
        <div className="space-y-4">
          {FAQS.map((faq, idx) => {
            const isOpen = openIndex === idx;
            return (
              <Reveal key={idx} delay={idx * 0.05}>
                <div
                  className={`rounded-2xl border transition-all duration-300 overflow-hidden ${
                    isDark
                      ? isOpen
                        ? "bg-[#141927] border-purple-500/60 shadow-lg shadow-purple-950/40"
                        : "bg-[#0e1320] border-slate-800/80 hover:border-slate-700"
                      : isOpen
                      ? "bg-white border-purple-300 shadow-md"
                      : "bg-slate-50 border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <button
                    onClick={() => toggleFaq(idx)}
                    className="w-full p-6 text-left flex items-center justify-between gap-4 focus:outline-none"
                    aria-expanded={isOpen}
                  >
                    <span className="text-base sm:text-lg font-bold tracking-tight">
                      {faq.question}
                    </span>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-transform duration-300 ${
                      isOpen
                        ? "bg-purple-600 text-white rotate-180"
                        : isDark
                        ? "bg-slate-800 text-slate-400"
                        : "bg-slate-200 text-slate-700"
                    }`}>
                      <ChevronDown className="w-4 h-4" />
                    </div>
                  </button>

                  {isOpen && (
                    <div className="px-6 pb-6 pt-0 border-t border-slate-800/40">
                      <p className={`text-sm sm:text-base leading-relaxed pt-4 font-medium ${
                        isDark ? "text-slate-300" : "text-slate-600"
                      }`}>
                        {faq.answer}
                      </p>
                    </div>
                  )}
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
