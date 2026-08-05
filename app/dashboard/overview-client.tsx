"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { TemplateCard, type TemplateSummary } from "./templates/TemplateCard";

type Props = {
  userName: string;
  plan: string;
  hasTemplates: boolean;
  hasDomains: boolean;
  hasApiKeys: boolean;
  hasViews: boolean;
  templatesCount: number;
  domainsCount: number;
  apiKeysCount: number;
  recentTemplates: TemplateSummary[];
};

function IconChevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
      strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  );
}

export function OverviewClient({
  userName,
  plan,
  hasTemplates,
  hasDomains,
  hasApiKeys,
  hasViews,
  templatesCount,
  domainsCount,
  apiKeysCount,
  recentTemplates,
}: Props) {
  // Onboarding steps calculations
  const steps = [
    { id: "templates", label: "Create your first template", done: hasTemplates, link: "/dashboard/templates", linkText: "Create template ➔" },
    { id: "api-keys", label: "Configure an API Key for AI visual tools", done: hasApiKeys, link: "/dashboard/settings", linkText: "Create API Key ➔" },
    { id: "domains", label: "Link a platform subdomain or custom domain", done: hasDomains, link: "/dashboard/domains", linkText: "Configure domains ➔" },
    { id: "views", label: "Get visitors to view your published page", done: hasViews, statusText: hasViews ? "Completed ✓" : "Waiting for views…" },
  ];

  const completedSteps = steps.filter((s) => s.done).length;
  const onboardingPercentage = Math.round((completedSteps / steps.length) * 100);
  const onboardingComplete = onboardingPercentage === 100;

  const [stepsExpanded, setStepsExpanded] = useState(false);

  // Just the "Views (7d)" number for the stat-glance row — Insights (app/dashboard/insights)
  // owns the full filtered/chart/heatmap fetch independently.
  const [totalViews, setTotalViews] = useState(0);

  useEffect(() => {
    fetch("/api/v1/analytics")
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setTotalViews(data.totalViews);
      })
      .catch((err) => console.error("Error loading view count:", err));
  }, []);

  return (
    <>
      {/* Welcome Banner */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.5rem", flexWrap: "wrap", gap: "0.75rem" }}>
        <div>
          <h1 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "clamp(1.35rem, 4vw, 2.1rem)", fontWeight: 800, color: "#f0f2ff", letterSpacing: "-0.025em", lineHeight: 1.2 }}>
            Welcome back, {userName}!
          </h1>
          <p style={{ fontSize: "0.82rem", color: "rgba(240,242,255,0.45)", marginTop: "0.35rem" }}>
            Here is what&apos;s happening on your visual builder platform workspace.
          </p>
        </div>
        <span style={{
          fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.08em",
          textTransform: "uppercase", color: "var(--brand)",
          background: "var(--brand-subtle)", padding: "0.3rem 0.65rem", borderRadius: 8,
          border: "1px solid rgba(139,92,246,0.15)"
        }}>
          {plan} ACCOUNT
        </span>
      </div>

      {/* Compact onboarding strip — only while setup isn't complete. No replacement card
          once it is: the stat-glance row below already covers the same numbers. */}
      {!onboardingComplete && (
        <div style={{
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 12,
          marginBottom: "1.5rem",
          overflow: "hidden",
        }}>
          <button
            type="button"
            onClick={() => setStepsExpanded((v) => !v)}
            style={{
              width: "100%", display: "flex", alignItems: "center", gap: "1rem",
              padding: "0.85rem 1.1rem", background: "none", border: "none", cursor: "pointer",
              fontFamily: "inherit", textAlign: "left",
            }}
          >
            <span style={{ fontSize: "0.82rem", fontWeight: 650, color: "#f0f2ff", whiteSpace: "nowrap" }}>
              Workspace setup — {completedSteps}/{steps.length}
            </span>
            <span style={{ flex: 1, height: 5, background: "rgba(255,255,255,0.05)", borderRadius: 999, overflow: "hidden" }}>
              <span style={{ display: "block", width: `${onboardingPercentage}%`, height: "100%", background: "linear-gradient(90deg, var(--brand), #a78bfa)", borderRadius: 999, transition: "width 0.5s ease" }} />
            </span>
            <span style={{ color: "rgba(240,242,255,0.4)", display: "flex", alignItems: "center", flexShrink: 0 }}>
              <IconChevron open={stepsExpanded} />
            </span>
          </button>

          {stepsExpanded && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", padding: "0 1.1rem 1rem" }}>
              {steps.map((step) => (
                <div key={step.id} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "0.65rem 0.85rem", borderRadius: 10,
                  background: step.done ? "rgba(16,185,129,0.03)" : "rgba(255,255,255,0.01)",
                  border: step.done ? "1px solid rgba(16,185,129,0.1)" : "1px solid rgba(255,255,255,0.04)",
                  fontSize: "0.8rem"
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.65rem" }}>
                    <div style={{
                      width: 18, height: 18, borderRadius: "50%",
                      background: step.done ? "rgba(16,185,129,0.1)" : "rgba(255,255,255,0.03)",
                      border: step.done ? "1px solid rgba(16,185,129,0.15)" : "1px solid rgba(255,255,255,0.06)",
                      display: "grid", placeItems: "center", fontSize: "0.65rem", flexShrink: 0,
                    }}>
                      {step.done ? "✓" : ""}
                    </div>
                    <span style={{ color: step.done ? "rgba(240,242,255,0.75)" : "rgba(240,242,255,0.45)", fontWeight: step.done ? 600 : 400 }}>
                      {step.label}
                    </span>
                  </div>
                  {step.done ? (
                    <span style={{ color: "#34d399", fontWeight: 700, fontSize: "0.72rem" }}>
                      Completed
                    </span>
                  ) : step.link ? (
                    <Link href={step.link} style={{ color: "var(--brand)", textDecoration: "none", fontWeight: 700, fontSize: "0.72rem" }}>
                      {step.linkText}
                    </Link>
                  ) : (
                    <span style={{ color: "rgba(240,242,255,0.25)", fontSize: "0.7rem", fontStyle: "italic" }}>
                      {step.statusText}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Stat-glance row — always visible, not gated behind onboarding completion */}
      <div className="stat-glance-row" style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: "0.85rem",
        marginBottom: "2rem",
      }}>
        {[
          { label: "Templates", value: templatesCount, link: "/dashboard/templates" },
          { label: "Live Domains", value: domainsCount, link: "/dashboard/domains" },
          { label: "API Keys", value: apiKeysCount, link: "/dashboard/settings" },
          { label: "Views (7d)", value: totalViews, link: "/dashboard/insights" },
        ].map((stat) => (
          <Link
            key={stat.label}
            href={stat.link}
            style={{
              background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 12, padding: "1rem 1.1rem", textDecoration: "none",
              display: "flex", flexDirection: "column", gap: "0.3rem",
            }}
          >
            <span style={{ fontSize: "0.66rem", fontWeight: 700, color: "rgba(240,242,255,0.3)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              {stat.label}
            </span>
            <span style={{ fontSize: "1.5rem", fontWeight: 800, color: "#f0f2ff" }}>
              {stat.value}
            </span>
          </Link>
        ))}
      </div>

      {/* Templates — front and center */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", marginBottom: "1.25rem" }}>
        <div>
          <h2 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1.3rem", fontWeight: 800, color: "#f0f2ff", margin: 0 }}>
            Your Templates
          </h2>
          <p style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.4)", margin: "0.25rem 0 0" }}>
            Recently updated email templates and landing pages.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.6rem", flexShrink: 0 }}>
          {recentTemplates.length > 0 && (
            <Link
              href="/dashboard/templates"
              style={{
                display: "inline-flex", alignItems: "center", padding: "0.6rem 1rem",
                borderRadius: 9, fontSize: "0.82rem", fontWeight: 650,
                color: "rgba(240,242,255,0.65)", textDecoration: "none",
                border: "1px solid rgba(255,255,255,0.1)",
              }}
            >
              View all →
            </Link>
          )}
          <Link
            href="/dashboard/templates"
            style={{
              display: "inline-flex", alignItems: "center", gap: "0.5rem",
              padding: "0.6rem 1.1rem", borderRadius: 9, fontWeight: 700, fontSize: "0.82rem",
              background: "linear-gradient(135deg,var(--brand),var(--brand-deep))",
              color: "#fff", textDecoration: "none",
              boxShadow: "0 4px 20px var(--brand-glow)",
            }}
          >
            <IconPlus />
            New Template
          </Link>
        </div>
      </div>

      {recentTemplates.length > 0 ? (
        <div className="overview-templates-grid" style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: "1.25rem",
          marginBottom: "2rem",
        }}>
          {recentTemplates.map((template) => (
            <TemplateCard key={template.id} template={template} />
          ))}
        </div>
      ) : (
        <div style={{
          padding: "3rem 2rem",
          textAlign: "center",
          borderRadius: 16,
          border: "1px dashed rgba(255,255,255,0.1)",
          background: "rgba(255,255,255,0.015)",
          marginBottom: "2rem",
        }}>
          <h3 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1.05rem", color: "#f0f2ff", marginBottom: "0.5rem" }}>
            No templates yet.
          </h3>
          <p style={{ fontSize: "0.85rem", color: "rgba(240,242,255,0.4)", marginBottom: "1.5rem" }}>
            Create your first email template or landing page to get started.
          </p>
          <Link
            href="/dashboard/templates"
            style={{
              display: "inline-flex", alignItems: "center", gap: "0.5rem",
              padding: "0.65rem 1.25rem",
              borderRadius: 10, fontSize: "0.875rem", fontWeight: 700,
              background: "linear-gradient(135deg,var(--brand),var(--brand-deep))",
              color: "#fff", textDecoration: "none",
              boxShadow: "0 4px 20px var(--brand-glow)",
            }}
          >
            <IconPlus />
            Create First Template
          </Link>
        </div>
      )}

      <style jsx>{`
        @media (max-width: 700px) {
          .stat-glance-row {
            grid-template-columns: repeat(2, 1fr) !important;
          }
        }
        @media (max-width: 420px) {
          .overview-templates-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </>
  );
}
