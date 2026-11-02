"use client";

import { useState, useEffect } from "react";
import { ArrowLeft, ArrowRight, Terminal, Star, MessageSquareQuote } from "lucide-react";

type TestimonialItem = {
  id: string;
  quote: string;
  name: string;
  role: string;
  company?: string | null;
  avatarUrl?: string | null;
  rating?: number;
};

export function V2TestimonialSection({ isDark }: { isDark: boolean }) {
  const [testimonials, setTestimonials] = useState<TestimonialItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadTestimonials() {
      try {
        const res = await fetch("/api/testimonials");
        const data = await res.json();
        if (data?.success && Array.isArray(data.testimonials)) {
          setTestimonials(data.testimonials);
        }
      } catch (err) {
        console.error("Failed to load testimonials", err);
      } finally {
        setLoading(false);
      }
    }
    loadTestimonials();
  }, []);

  const nextTestimonial = () => setCurrentIndex((prev) => (prev + 1) % testimonials.length);
  const prevTestimonial = () => setCurrentIndex((prev) => (prev === 0 ? testimonials.length - 1 : prev - 1));

  const current = testimonials[currentIndex];

  return (
    <section className={`py-10 md:py-14 px-4 sm:px-8 md:px-16 overflow-hidden relative transition-colors duration-500 font-['Mulish',sans-serif] ${
      isDark ? "bg-[#0b0f19] text-white" : "bg-white text-slate-950"
    }`}>
      {/* Background Watermark Marquee */}
      <div className="w-full overflow-hidden select-none pointer-events-none opacity-[0.08] mb-10">
        <div className="animate-marquee whitespace-nowrap text-6xl sm:text-8xl md:text-9xl font-extrabold uppercase tracking-tighter">
          <span>DEVELOPER QUALITY &amp; AI POWER • DEVELOPER QUALITY &amp; AI POWER • </span>
          <span>DEVELOPER QUALITY &amp; AI POWER • DEVELOPER QUALITY &amp; AI POWER • </span>
        </div>
      </div>

      <div className="max-w-7xl mx-auto space-y-12">
        {/* Center Header */}
        <div className="text-center max-w-xl mx-auto space-y-2">
          <h3 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            Loved by creators &amp; engineers
          </h3>
          <p className={`text-sm font-medium ${isDark ? "text-slate-400" : "text-slate-600"}`}>
            See how Plexo powers multi-page sites and AI builder workflows.
          </p>
        </div>

        {/* Blank State (When No Approved Testimonials Exist) */}
        {!loading && testimonials.length === 0 ? (
          <div className="bg-[#0e1320] text-white rounded-[40px] md:rounded-[56px] p-12 sm:p-16 text-center relative overflow-hidden shadow-2xl border border-slate-800/80 max-w-4xl mx-auto space-y-4">
            <div className="w-16 h-16 rounded-full bg-purple-500/10 text-purple-400 flex items-center justify-center mx-auto border border-purple-500/20">
              <MessageSquareQuote className="w-8 h-8" />
            </div>
            <div className="space-y-1">
              <h4 className="text-xl font-extrabold text-white">No reviews published yet</h4>
              <p className="text-sm font-medium text-slate-400 max-w-md mx-auto">
                Verified creator and developer reviews will be displayed here once submitted and approved by admin.
              </p>
            </div>
          </div>
        ) : current ? (
          /* Main Testimonial Card */
          <div className="bg-[#0e1320] text-white rounded-[40px] md:rounded-[56px] p-8 sm:p-12 md:p-16 relative overflow-hidden shadow-2xl border border-slate-800/80">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
              {/* Left Developer Showcase Card */}
              <div className="lg:col-span-5 flex justify-center">
                <div className="relative w-full max-w-[340px] bg-slate-950 rounded-[32px] p-6 shadow-2xl border border-purple-800/40 space-y-4 font-mono text-xs">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3 text-purple-300">
                    <span className="flex items-center gap-2">
                      <Terminal className="w-4 h-4 text-purple-400" />
                      <span>verified-review.ts</span>
                    </span>
                    <span className="text-emerald-400 font-bold">VERIFIED</span>
                  </div>

                  <div className="space-y-2 bg-slate-900/90 p-4 rounded-2xl border border-slate-800 text-slate-300">
                    <p className="text-purple-400">&gt; reviewer: &quot;{current.name}&quot;</p>
                    <p className="text-slate-400">&gt; role: &quot;{current.role}{current.company ? ` at ${current.company}` : ''}&quot;</p>
                    <div className="flex items-center gap-1 text-yellow-400 pt-1">
                      {Array.from({ length: current.rating || 5 }).map((_, i) => (
                        <Star key={i} className="w-3.5 h-3.5 fill-yellow-400" />
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Quote Column */}
              <div className="lg:col-span-7 flex flex-col justify-between space-y-6">
                <blockquote className="text-base sm:text-lg md:text-xl font-semibold tracking-tight leading-relaxed text-slate-200">
                  &ldquo;{current.quote}&rdquo;
                </blockquote>

                <div className="flex items-center justify-between border-t border-slate-800 pt-6">
                  <div className="flex items-center gap-4">
                    {current.avatarUrl && (
                      <img
                        src={current.avatarUrl}
                        alt={current.name}
                        className="w-12 h-12 rounded-full object-cover border-2 border-purple-500/50"
                      />
                    )}
                    <div>
                      <h4 className="text-lg font-bold text-white">{current.name}</h4>
                      <p className="text-xs font-medium text-purple-300">
                        {current.role}{current.company ? ` • ${current.company}` : ''}
                      </p>
                    </div>
                  </div>

                  {/* Arrow Navigation */}
                  {testimonials.length > 1 && (
                    <div className="flex items-center gap-3">
                      <button
                        onClick={prevTestimonial}
                        aria-label="Previous Testimonial"
                        className="w-11 h-11 rounded-full bg-slate-900 hover:bg-slate-800 border border-slate-700 text-white flex items-center justify-center transition-colors"
                      >
                        <ArrowLeft className="w-4 h-4" />
                      </button>
                      <button
                        onClick={nextTestimonial}
                        aria-label="Next Testimonial"
                        className="w-11 h-11 rounded-full bg-slate-900 hover:bg-slate-800 border border-slate-700 text-white flex items-center justify-center transition-colors"
                      >
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
