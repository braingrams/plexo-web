"use client";

import { useRef } from "react";
import { ChevronLeft, ChevronRight, Mail, Infinity as InfinityIcon, BarChart3, Rocket, type LucideIcon } from "lucide-react";
import { Reveal } from "../scroll-fx";

const CARDS: { icon: LucideIcon; title: string; desc: string; from: string }[] = [
  {
    icon: Mail,
    title: "A real email builder",
    desc: "Not a bolt-on — the same drag-and-drop canvas, purpose-built for inbox-safe, table-based email HTML.",
    from: "from-sky-500/15 to-transparent",
  },
  {
    icon: InfinityIcon,
    title: "Free, forever",
    desc: "A generous free tier that never expires. Start building today, upgrade only when you outgrow it.",
    from: "from-emerald-500/15 to-transparent",
  },
  {
    icon: BarChart3,
    title: "Built-in analytics",
    desc: "Every published page and domain reports real-time visits — no extra script tag to install.",
    from: "from-amber-500/15 to-transparent",
  },
  {
    icon: Rocket,
    title: "One-click publish",
    desc: "From draft to a live, custom-domain URL in a single click — no build step, no deploy pipeline.",
    from: "from-brand-500/15 to-transparent",
  },
];

export function MoreThanBuilderSection() {
  const trackRef = useRef<HTMLDivElement>(null);

  function scrollByCard(dir: 1 | -1) {
    trackRef.current?.scrollBy({ left: dir * 360, behavior: "smooth" });
  }

  return (
    <section className="landing-section">
      <div className="landing-container">
        <Reveal className="mb-10 flex items-end justify-between gap-6">
          <h2 className="font-heading text-[clamp(1.8rem,3.5vw,2.6rem)] font-extrabold tracking-[-0.025em] text-[var(--text-main)]">
            More than just a builder.
          </h2>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              aria-label="Scroll left"
              onClick={() => scrollByCard(-1)}
              className="grid h-10 w-10 place-items-center rounded-full border border-[var(--surface-border)] bg-[var(--surface)] text-[var(--text-main)] transition-colors hover:border-[var(--brand-glow)]"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              type="button"
              aria-label="Scroll right"
              onClick={() => scrollByCard(1)}
              className="grid h-10 w-10 place-items-center rounded-full border border-[var(--surface-border)] bg-[var(--surface)] text-[var(--text-main)] transition-colors hover:border-[var(--brand-glow)]"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <div ref={trackRef} className="flex snap-x snap-mandatory gap-6 overflow-x-auto pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {CARDS.map(({ icon: Icon, title, desc, from }) => (
              <div
                key={title}
                className={`w-[300px] shrink-0 snap-start rounded-[28px] border border-[var(--surface-border)] bg-gradient-to-br ${from} bg-[var(--surface)] p-7 shadow-[var(--shadow-card)] sm:w-[340px]`}
              >
                <div className="mb-6 grid h-11 w-11 place-items-center rounded-2xl bg-[var(--bg-1)]">
                  <Icon size={20} className="text-brand-600 dark:text-brand-400" />
                </div>
                <h3 className="mb-2 text-lg font-bold text-[var(--text-main)]">{title}</h3>
                <p className="text-[0.87rem] leading-relaxed text-[var(--text-muted)]">{desc}</p>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
