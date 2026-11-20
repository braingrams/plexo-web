"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, CheckCircle2, ChevronDown, ChevronUp, Heart, Send, Sparkles, Star } from "lucide-react";
import { Avatar } from "@/app/dashboard/_v3/ui/Avatar";

export type TestimonialSubmitClientProps = {
  user: {
    name: string;
    email: string;
    avatarUrl?: string;
    company?: string;
    role?: string;
  };
};

const RATING_HINTS: Record<number, string> = {
  5: "Outstanding! Loved building with Plexo ⭐⭐⭐⭐⭐",
  4: "Great experience, very satisfied ⭐⭐⭐⭐",
  3: "Good product with solid potential ⭐⭐⭐",
  2: "It was okay, has room to improve ⭐⭐",
  1: "Needs significant improvement ⭐",
};

export function TestimonialSubmitClient({ user }: TestimonialSubmitClientProps) {
  const [rating, setRating] = useState<number>(5);
  const [hoverRating, setHoverRating] = useState<number>(0);
  const [quote, setQuote] = useState<string>("");

  // Prepopulated profile details — only shown for edits if the user chooses
  const [name, setName] = useState<string>(user.name || "");
  const [role, setRole] = useState<string>(user.role || (user.company ? `Founder, ${user.company}` : "Plexo Creator"));
  const [company, setCompany] = useState<string>(user.company || "");
  const [avatarUrl, setAvatarUrl] = useState<string>(user.avatarUrl || "");
  const [showEditDetails, setShowEditDetails] = useState<boolean>(!user.name);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const activeRating = hoverRating || rating;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");

    const finalName = name.trim() || user.name.trim() || "Plexo Creator";
    const finalRole = role.trim() || (company.trim() ? `Founder, ${company.trim()}` : "Plexo Creator");
    const finalQuote = quote.trim();

    if (finalQuote.length < 10) {
      setErrorMsg("Please write at least 10 characters for your review.");
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await fetch("/api/testimonials/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: finalName,
          role: finalRole,
          company: company.trim() || undefined,
          avatarUrl: avatarUrl.trim() || undefined,
          rating,
          quote: finalQuote,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to submit testimonial.");
      }

      setSubmitted(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Something went wrong. Please try again.";
      setErrorMsg(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "28px 16px 80px" }}>
      {/* Back button */}
      <div style={{ marginBottom: 20 }}>
        <Link href="/dashboard" className="plx-btn plx-btn--ghost plx-btn--sm">
          <ArrowLeft size={16} aria-hidden />
          <span>Back to dashboard</span>
        </Link>
      </div>

      {submitted ? (
        /* Celebratory Success View */
        <div className="plx-card plx-card--pad-lg" style={{ textAlign: "center", padding: "48px 24px" }}>
          <div
            style={{
              width: 68,
              height: 68,
              borderRadius: "50%",
              background: "var(--plx-tint)",
              color: "var(--plx-brand)",
              display: "grid",
              placeItems: "center",
              margin: "0 auto 20px",
              boxShadow: "var(--plx-shadow-card)",
            }}
          >
            <CheckCircle2 size={38} aria-hidden />
          </div>

          <div className="plx-badge plx-badge--success" style={{ marginBottom: 12 }}>
            <Check size={12} aria-hidden />
            <span>SUBMITTED SUCCESSFULLY</span>
          </div>

          <h2 className="plx-h1" style={{ marginBottom: 12 }}>
            Thank You for Sharing the Love!
          </h2>

          <p className="plx-body" style={{ maxWidth: 460, margin: "0 auto 28px" }}>
            Your review has been submitted and queued for moderation. Once approved, it will be proudly featured on the Plexo showcase and homepage!
          </p>

          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <Link href="/dashboard" className="plx-btn plx-btn--primary">
              Return to Dashboard
            </Link>
            <a href="https://www.plexopages.com" target="_blank" rel="noopener noreferrer" className="plx-btn plx-btn--secondary">
              View Plexo Showcase
            </a>
          </div>
        </div>
      ) : (
        /* Testimonial Submission Form */
        <div className="plx-card plx-card--pad-lg" style={{ position: "relative" }}>
          {/* Header */}
          <div style={{ marginBottom: 24, textAlign: "center" }}>
            <div className="plx-badge plx-badge--brand" style={{ marginBottom: 12 }}>
              <Sparkles size={13} aria-hidden />
              <span>SHARE YOUR EXPERIENCE</span>
            </div>

            <h1 className="plx-h1" style={{ marginBottom: 8 }}>
              Drop a Testimonial
            </h1>

            <p className="plx-body" style={{ maxWidth: 480, margin: "0 auto" }}>
              Tell fellow creators how Plexo has helped you design, launch, and grow your pages.
            </p>
          </div>

          {/* User Profile Identity Bar (No redundant asking) */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "14px 16px",
              borderRadius: "var(--plx-radius)",
              background: "var(--plx-tint)",
              border: "1px solid var(--plx-border)",
              marginBottom: 24,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
              <Avatar name={name || user.email} src={avatarUrl || null} size={42} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 15, color: "var(--plx-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {name || "Plexo Creator"}
                </div>
                <div className="plx-small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {role || (company ? `Founder, ${company}` : "Verified Member")}
                </div>
              </div>
            </div>

            <button
              type="button"
              className="plx-btn plx-btn--ghost plx-btn--sm"
              onClick={() => setShowEditDetails(!showEditDetails)}
              aria-expanded={showEditDetails}
              title="Customize author details"
            >
              <span className="plx-btn__label">
                <span>{showEditDetails ? "Hide details" : "Edit details"}</span>
                {showEditDetails ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
              </span>
            </button>
          </div>

          {/* Optional Profile Overrides (Collapsed by default so user is not asked again) */}
          {showEditDetails ? (
            <div
              className="plx-form"
              style={{
                marginBottom: 24,
                padding: "16px",
                borderRadius: "var(--plx-radius)",
                background: "var(--plx-elevated)",
                border: "1px solid var(--plx-border)",
              }}
            >
              <div className="plx-form__two">
                <div className="plx-field">
                  <label htmlFor="plx-test-name" className="plx-field__label">Full Name</label>
                  <input
                    id="plx-test-name"
                    type="text"
                    className="plx-input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your Name"
                  />
                </div>
                <div className="plx-field">
                  <label htmlFor="plx-test-role" className="plx-field__label">Role / Job Title</label>
                  <input
                    id="plx-test-role"
                    type="text"
                    className="plx-input"
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    placeholder="e.g. Founder, Designer"
                  />
                </div>
              </div>

              <div className="plx-form__two">
                <div className="plx-field">
                  <label htmlFor="plx-test-comp" className="plx-field__label">
                    Company Name <span className="plx-field__optional">(Optional)</span>
                  </label>
                  <input
                    id="plx-test-comp"
                    type="text"
                    className="plx-input"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    placeholder="e.g. Acme Studio"
                  />
                </div>
                <div className="plx-field">
                  <label htmlFor="plx-test-avatar" className="plx-field__label">
                    Avatar URL <span className="plx-field__optional">(Optional)</span>
                  </label>
                  <input
                    id="plx-test-avatar"
                    type="url"
                    className="plx-input"
                    value={avatarUrl}
                    onChange={(e) => setAvatarUrl(e.target.value)}
                    placeholder="https://example.com/avatar.jpg"
                  />
                </div>
              </div>
            </div>
          ) : null}

          <form onSubmit={handleSubmit} className="plx-form">
            {errorMsg ? (
              <div
                style={{
                  padding: "12px 14px",
                  borderRadius: "var(--plx-radius)",
                  background: "var(--plx-danger-subtle)",
                  color: "var(--plx-danger)",
                  fontSize: 14,
                  fontWeight: 600,
                }}
                role="alert"
              >
                {errorMsg}
              </div>
            ) : null}

            {/* Star Rating */}
            <div className="plx-field" style={{ alignItems: "center", textAlign: "center" }}>
              <label className="plx-field__label">HOW WOULD YOU RATE PLEXO?</label>
              <div style={{ display: "flex", gap: 8, margin: "6px 0 4px" }}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setRating(star)}
                    onMouseEnter={() => setHoverRating(star)}
                    onMouseLeave={() => setHoverRating(0)}
                    style={{
                      background: "none",
                      border: "none",
                      padding: 6,
                      cursor: "pointer",
                      borderRadius: 8,
                      lineHeight: 1,
                      transition: "transform 0.12s ease",
                    }}
                    aria-label={`Rate ${star} Stars`}
                  >
                    <Star
                      size={34}
                      style={{
                        color: star <= activeRating ? "var(--plx-accent)" : "var(--plx-border-strong)",
                        fill: star <= activeRating ? "currentColor" : "none",
                        transition: "color 0.15s ease, fill 0.15s ease",
                      }}
                      aria-hidden
                    />
                  </button>
                ))}
              </div>
              <span className="plx-small" style={{ fontWeight: 700, minHeight: 20 }}>
                {RATING_HINTS[activeRating]}
              </span>
            </div>

            {/* Review / Quote Area */}
            <div className="plx-field">
              <label htmlFor="plx-test-quote" className="plx-field__label">
                Your Review <span style={{ color: "var(--plx-brand)" }}>*</span>
              </label>
              <textarea
                id="plx-test-quote"
                required
                rows={5}
                className="plx-input"
                value={quote}
                onChange={(e) => setQuote(e.target.value)}
                placeholder="Tell us what you love about Plexo — your favorite builder features, speed, or how it helped your project succeed..."
              />
              <p className="plx-field__help">
                {quote.trim().length >= 10
                  ? `${quote.trim().length} characters`
                  : `${quote.trim().length}/10 characters minimum`}
              </p>
            </div>

            {/* Submit Button */}
            <div style={{ paddingTop: 8 }}>
              <button
                type="submit"
                disabled={isSubmitting || quote.trim().length < 10}
                className="plx-btn plx-btn--primary plx-btn--lg"
                style={{ width: "100%" }}
              >
                <span className="plx-btn__label">
                  {isSubmitting ? (
                    <span>Submitting review...</span>
                  ) : (
                    <>
                      <Send size={16} aria-hidden />
                      <span>Submit Review to Showcase</span>
                    </>
                  )}
                </span>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
