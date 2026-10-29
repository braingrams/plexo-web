import {
  Globe2, Code2, Type, Mail, ArrowUpRight,
  Palette, Image as ImageIcon, Shapes, Wand2, Layers, Component,
  Smile, Star, Heart, Bell, Camera, Music, Cloud, Gift, Coffee, Rocket,
} from "lucide-react";
import { Reveal } from "../scroll-fx";
import { Kicker, BentoCard } from "./ui";

const ICON_SAMPLE = [Smile, Star, Heart, Bell, Camera, Music, Cloud, Gift, Coffee, Rocket, Wand2, Layers];
const FONT_SAMPLE = ["Inter", "Sora", "Fraunces", "Space Grotesk"];

export function FeatureGrid() {
  return (
    <section className="landing-section pt-0">
      <div className="landing-container">
        <Reveal className="mx-auto mb-14 max-w-[640px] text-center">
          <Kicker>Everything Included</Kicker>
          <h2 className="font-heading text-[clamp(1.8rem,3.5vw,2.6rem)] font-extrabold tracking-[-0.025em] text-[var(--text-main)]">
            Built to fit exactly how you build
          </h2>
        </Reveal>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-12 md:auto-rows-[minmax(260px,auto)]">
          {/* Card 1 — tall, left */}
          <Reveal className="md:col-span-5 md:row-span-2">
            <BentoCard className="flex flex-col justify-between bg-gradient-to-br from-brand-500/10 to-transparent p-8">
              <div>
                <div className="mb-5 grid h-11 w-11 place-items-center rounded-2xl bg-brand-500/15">
                  <Globe2 size={20} className="text-brand-600 dark:text-brand-400" />
                </div>
                <h3 className="mb-3 text-xl font-bold text-[var(--text-main)]">Multi-page &amp; custom domains</h3>
                <p className="text-[0.9rem] leading-relaxed text-[var(--text-muted)]">
                  Build entire multi-page sites — not just single templates — and connect your own domain in a few
                  clicks. Every page publishes independently, with instant rollbacks.
                </p>
              </div>
              <div className="mt-8 flex flex-col items-center gap-2 rounded-2xl border border-[var(--surface-border)] bg-[var(--bg-1)] p-5">
                <div className="rounded-lg bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--text-main)]">yourbrand.com</div>
                <div className="h-4 w-px bg-[var(--surface-border)]" />
                <div className="flex gap-2">
                  {["Home", "Pricing", "Blog", "Contact"].map((p) => (
                    <span key={p} className="rounded-md border border-[var(--surface-border)] px-2 py-1 text-[0.68rem] text-[var(--text-muted)]">
                      /{p.toLowerCase()}
                    </span>
                  ))}
                </div>
              </div>
            </BentoCard>
          </Reveal>

          {/* Card 2 — wide, top right */}
          <Reveal delay={0.05} className="md:col-span-7">
            <BentoCard className="flex flex-col justify-between bg-gradient-to-br from-indigo-500/10 to-transparent p-8 sm:flex-row sm:items-center sm:gap-8">
              <div className="sm:max-w-[55%]">
                <div className="mb-5 grid h-11 w-11 place-items-center rounded-2xl bg-indigo-500/15">
                  <Code2 size={20} className="text-indigo-600 dark:text-indigo-400" />
                </div>
                <h3 className="mb-3 text-xl font-bold text-[var(--text-main)]">Feature-rich &amp; embeddable</h3>
                <p className="text-[0.9rem] leading-relaxed text-[var(--text-muted)]">
                  Drop the whole builder into your own product with the SDK — a single component, fully embeddable,
                  on any platform.
                </p>
              </div>
              <div className="mt-6 w-full rounded-xl bg-[#0d0f1a] p-4 font-mono text-[0.72rem] leading-relaxed text-[#a5b4fc] sm:mt-0 sm:w-auto">
                <span className="text-[#f0f2ff]">{`<PlexoBuilder`}</span>
                <br />
                &nbsp;&nbsp;mode=<span className="text-[#34d399]">&quot;landing_page&quot;</span>
                <br />
                <span className="text-[#f0f2ff]">{`/>`}</span>
              </div>
            </BentoCard>
          </Reveal>

          {/* Card 3 — wide, bottom right */}
          <Reveal delay={0.1} className="md:col-span-7">
            <BentoCard className="flex flex-col justify-between bg-gradient-to-br from-fuchsia-500/10 to-transparent p-8 sm:flex-row sm:items-center sm:gap-8">
              <div className="sm:max-w-[45%]">
                <div className="mb-5 grid h-11 w-11 place-items-center rounded-2xl bg-fuchsia-500/15">
                  <Palette size={20} className="text-fuchsia-600 dark:text-fuchsia-400" />
                </div>
                <h3 className="mb-3 text-xl font-bold text-[var(--text-main)]">80+ fonts &amp; 2000+ icons</h3>
                <p className="text-[0.9rem] leading-relaxed text-[var(--text-muted)]">
                  A full type and icon library, plus thousands of stock images — ready out of the box, no hunting
                  for assets.
                </p>
              </div>
              <div className="mt-6 flex-1 sm:mt-0">
                <div className="mb-3 grid grid-cols-6 gap-2">
                  {ICON_SAMPLE.map((Icon, i) => (
                    <div key={i} className="grid aspect-square place-items-center rounded-lg bg-[var(--bg-1)] text-[var(--text-muted)]">
                      <Icon size={14} />
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  {FONT_SAMPLE.map((f) => (
                    <span key={f} className="rounded-md border border-[var(--surface-border)] px-2 py-1 text-[0.68rem] text-[var(--text-muted)]">
                      Aa <span className="opacity-60">{f}</span>
                    </span>
                  ))}
                </div>
              </div>
            </BentoCard>
          </Reveal>

          {/* Card 4 — full width, email builder */}
          <Reveal delay={0.15} className="md:col-span-12">
            <BentoCard className="grid grid-cols-1 items-center gap-8 bg-gradient-to-br from-cyan-500/10 to-transparent p-8 md:grid-cols-2 md:p-10">
              <div>
                <div className="mb-5 grid h-11 w-11 place-items-center rounded-2xl bg-cyan-500/15">
                  <Mail size={20} className="text-cyan-600 dark:text-cyan-400" />
                </div>
                <h3 className="mb-3 text-xl font-bold text-[var(--text-main)]">Drag-and-drop perfection</h3>
                <p className="mb-5 text-[0.9rem] leading-relaxed text-[var(--text-muted)]">
                  The same visual editor powers both web pages and email campaigns — snap blocks into place, tweak
                  every pixel, and export clean, inbox-safe HTML.
                </p>
                <div className="inline-flex items-center gap-1.5 text-[0.85rem] font-semibold text-cyan-600 dark:text-cyan-400">
                  Try the email builder <ArrowUpRight size={15} />
                </div>
              </div>
              <div className="overflow-hidden rounded-2xl border border-[var(--surface-border)] bg-[var(--bg-1)]">
                <div className="flex">
                  <div className="hidden w-32 shrink-0 flex-col gap-2 border-r border-[var(--surface-border)] p-3 sm:flex">
                    {[Component, ImageIcon, Type, Shapes].map((Icon, i) => (
                      <div key={i} className="flex items-center gap-2 rounded-lg bg-[var(--surface)] px-2 py-1.5 text-[0.68rem] text-[var(--text-muted)]">
                        <Icon size={13} /> Block
                      </div>
                    ))}
                  </div>
                  <div className="flex-1 space-y-2.5 p-5">
                    <div className="h-3 w-2/3 rounded bg-[var(--brand-subtle)]" />
                    <div className="h-2 w-full rounded bg-[var(--surface-border)]" />
                    <div className="h-2 w-4/5 rounded bg-[var(--surface-border)]" />
                    <div className="h-8 w-28 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700" />
                  </div>
                </div>
              </div>
            </BentoCard>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
