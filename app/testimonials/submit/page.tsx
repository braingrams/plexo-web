"use client";

import { useState } from "react";
import Link from "next/link";
import { Star, Sparkles, Send, CheckCircle2, ArrowLeft, Heart, MessageSquare } from "lucide-react";
import { Mulish } from "next/font/google";

const mulish = Mulish({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800", "900"],
  display: "swap",
});

export default function TestimonialSubmitPage() {
  const [formData, setFormData] = useState({
    name: "",
    role: "",
    company: "",
    rating: 5,
    quote: "",
    avatarUrl: "",
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");

    if (!formData.name.trim() || !formData.role.trim() || !formData.quote.trim()) {
      setErrorMsg("Please fill out all required fields.");
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await fetch("/api/testimonials/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to submit testimonial.");
      }

      setSubmitted(true);
    } catch (err: any) {
      setErrorMsg(err?.message || "Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className={`${mulish.className} min-h-screen bg-[#0b0f19] text-white flex flex-col items-center justify-center p-4 sm:p-8 antialiased font-['Mulish',sans-serif]`}>
      <div className="w-full max-w-xl space-y-6">
        {/* Back Link */}
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-xs font-bold text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Plexo</span>
        </Link>

        {/* Card Container */}
        <div className="bg-[#121724] border border-slate-800 rounded-[36px] p-6 sm:p-10 shadow-2xl space-y-8 relative overflow-hidden">
          {/* Top Decorative Glow */}
          <div className="absolute -top-10 -right-10 w-48 h-48 bg-purple-500/20 rounded-full blur-3xl pointer-events-none" />

          {/* Header */}
          <div className="space-y-2 text-center">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-extrabold bg-purple-500/10 text-purple-400 border border-purple-500/20 mx-auto">
              <Sparkles className="w-3.5 h-3.5" />
              <span>SHARE YOUR EXPERIENCE</span>
            </div>

            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
              Submit Your Review
            </h1>

            <p className="text-sm font-medium text-slate-400 max-w-md mx-auto">
              Tell us how Plexo has helped you build web pages and email templates. Your review will be featured on our landing page.
            </p>
          </div>

          {submitted ? (
            /* Success View */
            <div className="text-center py-8 space-y-5">
              <div className="w-16 h-16 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center mx-auto border border-emerald-500/30">
                <CheckCircle2 className="w-8 h-8" />
              </div>

              <div className="space-y-2">
                <h3 className="text-2xl font-extrabold text-white">Thank You!</h3>
                <p className="text-slate-400 text-sm max-w-sm mx-auto leading-relaxed">
                  Your testimonial has been submitted successfully and sent for review. Once approved, it will be published live on the Plexo landing page.
                </p>
              </div>

              <div className="pt-4">
                <Link
                  href="/"
                  className="bg-[#6b3bf9] hover:bg-[#5b2be6] text-white font-extrabold text-sm px-8 py-3.5 rounded-2xl shadow-lg inline-block transition-all"
                >
                  Return to Home
                </Link>
              </div>
            </div>
          ) : (
            /* Submission Form */
            <form onSubmit={handleSubmit} className="space-y-5">
              {errorMsg && (
                <div className="p-4 rounded-xl bg-red-950/80 border border-red-800 text-red-300 text-xs font-semibold">
                  {errorMsg}
                </div>
              )}

              {/* Rating Star Selector */}
              <div className="space-y-2 text-center">
                <label className="text-xs font-extrabold uppercase tracking-wider text-slate-400 block">
                  Your Rating
                </label>
                <div className="flex items-center justify-center gap-2">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setFormData({ ...formData, rating: star })}
                      className="p-1.5 focus:outline-none transition-transform transform hover:scale-125"
                      aria-label={`Rate ${star} Stars`}
                    >
                      <Star
                        className={`w-7 h-7 ${
                          star <= formData.rating
                            ? "fill-yellow-400 text-yellow-400"
                            : "text-slate-700 hover:text-slate-500"
                        }`}
                      />
                    </button>
                  ))}
                </div>
              </div>

              {/* Quote Area */}
              <div className="space-y-1.5">
                <label className="text-xs font-extrabold uppercase tracking-wider text-slate-300 block">
                  Your Review / Quote <span className="text-purple-400">*</span>
                </label>
                <textarea
                  rows={4}
                  required
                  value={formData.quote}
                  onChange={(e) => setFormData({ ...formData, quote: e.target.value })}
                  placeholder="Tell us what you love about Plexo, its builder, AI MCP integration, or code exports..."
                  className="w-full bg-[#090d16] border border-slate-800 focus:border-purple-500 rounded-2xl p-4 text-sm text-white placeholder-slate-600 focus:outline-none transition-all"
                />
              </div>

              {/* 2-Column Name & Role */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-extrabold uppercase tracking-wider text-slate-300 block">
                    Full Name <span className="text-purple-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g. Alex Morgan"
                    className="w-full bg-[#090d16] border border-slate-800 focus:border-purple-500 rounded-2xl px-4 py-3.5 text-sm text-white placeholder-slate-600 focus:outline-none transition-all"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-extrabold uppercase tracking-wider text-slate-300 block">
                    Job Title / Role <span className="text-purple-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                    placeholder="e.g. Senior Frontend Architect"
                    className="w-full bg-[#090d16] border border-slate-800 focus:border-purple-500 rounded-2xl px-4 py-3.5 text-sm text-white placeholder-slate-600 focus:outline-none transition-all"
                  />
                </div>
              </div>

              {/* 2-Column Company & Avatar URL */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-extrabold uppercase tracking-wider text-slate-400 block">
                    Company Name <span className="text-slate-600">(Optional)</span>
                  </label>
                  <input
                    type="text"
                    value={formData.company}
                    onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                    placeholder="e.g. HyperScale Tech"
                    className="w-full bg-[#090d16] border border-slate-800 focus:border-purple-500 rounded-2xl px-4 py-3.5 text-sm text-white placeholder-slate-600 focus:outline-none transition-all"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-extrabold uppercase tracking-wider text-slate-400 block">
                    Avatar Image URL <span className="text-slate-600">(Optional)</span>
                  </label>
                  <input
                    type="url"
                    value={formData.avatarUrl}
                    onChange={(e) => setFormData({ ...formData, avatarUrl: e.target.value })}
                    placeholder="https://example.com/avatar.jpg"
                    className="w-full bg-[#090d16] border border-slate-800 focus:border-purple-500 rounded-2xl px-4 py-3.5 text-sm text-white placeholder-slate-600 focus:outline-none transition-all"
                  />
                </div>
              </div>

              {/* Submit Button */}
              <div className="pt-3">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-[#6b3bf9] hover:bg-[#5b2be6] text-white font-extrabold text-base py-4 rounded-2xl shadow-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <span>Submitting review...</span>
                  ) : (
                    <>
                      <span>Submit Review</span>
                      <Send className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
