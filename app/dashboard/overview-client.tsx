"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { TemplateCard, type TemplateSummary } from "./templates/TemplateCard";
import { TrafficChart, type TimelineDay } from "./_components/TrafficChart";
import { ActivityHeatmap, type HeatmapPoint } from "./_components/ActivityHeatmap";

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

function IconPlus() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function IconLayers() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" />
    </svg>
  );
}

function IconKey() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  );
}

function IconEyeSmall() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconArrowRight() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

function IconSparkle() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 2z" />
      <path d="M19 3v3M20.5 4.5H17.5" />
      <path d="M5 17v2.5M6.25 18.25H3.75" />
    </svg>
  );
}

function IconMarketplace() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8l1.5-4h13L20 8" />
      <path d="M4 8h16v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8z" />
      <path d="M9 12a3 3 0 0 0 6 0" />
    </svg>
  );
}

function IconGlobe() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function IconBrain() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z" />
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z" />
    </svg>
  );
}

function IconBook() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
    </svg>
  );
}

function Sparkline({ data }: { data: TimelineDay[] }) {
  const { d, points } = useMemo(() => {
    if (data.length === 0) return { d: "", points: [] as { x: number; y: number }[] };
    const w = 100;
    const h = 28;
    const max = Math.max(1, ...data.map((p) => p.views));
    const pts = data.map((p, i) => ({
      x: (i / Math.max(1, data.length - 1)) * w,
      y: h - (p.views / max) * (h - 4) - 2,
    }));
    return { d: pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" "), points: pts };
  }, [data]);

  if (!d) return null;
  return (
    <svg width="100%" height="28" viewBox="0 0 100 28" preserveAspectRatio="none" style={{ display: "block" }}>
      <path d={d} fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {points.length > 0 && <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r="2.5" fill="#fff" style={{ filter: "drop-shadow(0 0 4px var(--brand))" }} />}
    </svg>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "System online, working late";
  if (hour < 12) return "System online, good morning";
  if (hour < 18) return "System online, good afternoon";
  return "System online, good evening";
}

// Reusable Holographic Card with Mouse Tracking
function HolographicCard({ children, className, style, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const [mousePos, setMousePos] = useState({ x: 50, y: 50 });
  const ref = useRef<HTMLDivElement>(null);

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setMousePos({ x, y });

    // Subtle 3D tilt effect
    const rotateY = ((e.clientX - rect.left) / rect.width - 0.5) * 10;
    const rotateX = ((e.clientY - rect.top) / rect.height - 0.5) * -10;
    ref.current.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02, 1.02, 1.02)`;
  };

  const handleMouseLeave = () => {
    if (!ref.current) return;
    ref.current.style.transform = "perspective(1000px) rotateX(0) rotateY(0) scale3d(1, 1, 1)";
  };

  return (
    <div
      ref={ref}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={`holographic-card ${className || ""}`}
      style={{
        "--mouse-x": `${mousePos.x}%`,
        "--mouse-y": `${mousePos.y}%`,
        ...style,
      } as React.CSSProperties}
      {...props}
    >
      {children}
    </div>
  );
}

// Very Concise & Slim Action Pill for Launchpad
function ActionPill({ title, icon, colorStart, colorEnd, href, delayClass }: { title: string, icon: React.ReactNode, colorStart: string, colorEnd: string, href: string, delayClass: string }) {
  return (
    <Link
      href={href}
      className={`bento-enter ${delayClass}`}
      style={{
        textDecoration: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.5rem",
        padding: "0.4rem 0.75rem",
        borderRadius: "12px",
        background: `linear-gradient(135deg, ${colorStart} 0%, ${colorEnd} 100%)`,
        border: "1px solid transparent",
        boxShadow: `0 4px 12px ${colorStart}20`,
        transition: "all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
        color: "#fff",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.boxShadow = `0 8px 20px ${colorStart}50`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = `0 4px 12px ${colorStart}20`;
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 16, height: 16, opacity: 0.95 }}>
        {icon}
      </div>
      <span style={{ fontSize: "0.75rem", fontWeight: 700, letterSpacing: "0.02em" }}>{title}</span>
    </Link>
  );
}

function getAiContext(props: Props, totalViews: number, chartData: TimelineDay[]): string {
  if (!props.hasTemplates) {
    return "I noticed you haven't initialized any blueprints yet. Recommend navigating to the Marketplace to discover our top-performing layouts.";
  }
  if (!props.hasDomains) {
    return `Your workspace holds ${props.templatesCount} templates, but no custom domains are active. Connect a domain to establish brand authority.`;
  }
  if (totalViews > 0 && !props.hasApiKeys) {
    return `Traffic detected (${totalViews.toLocaleString()} views). Unlock programmatic access and advanced endpoints by generating an API Key.`;
  }
  if (totalViews > 1000) {
    return `Incredible velocity. Views have exceeded ${totalViews.toLocaleString()}. Recommend deploying edge caching optimizations on active domains.`;
  }
  if (chartData.length > 0 && chartData[chartData.length - 1].views > 100) {
    return "Recent surge in traffic detected. The energy matrix indicates high engagement periods. Maintain your current trajectory.";
  }
  return `All systems operational. ${props.templatesCount} templates deployed, endpoints responding within optimal latency.`;
}

// AI Terminal Co-Pilot Widget (Context Aware)
function AiTerminal({ contextText }: { contextText: string }) {
  const [displayed, setDisplayed] = useState("");

  useEffect(() => {
    setDisplayed("");
    let i = 0;
    const interval = setInterval(() => {
      setDisplayed(contextText.slice(0, i));
      i++;
      if (i > contextText.length) clearInterval(interval);
    }, 35);
    return () => clearInterval(interval);
  }, [contextText]);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--brand)" }}>
        <IconSparkle />
        <span style={{ fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase" }}>Co-Pilot Active</span>
      </div>
      <div className="typing-cursor" style={{ fontFamily: "var(--font-mono)", fontSize: "0.85rem", color: "#e2e8f0", lineHeight: 1.5, marginTop: "0.75rem", flex: 1 }}>
        {displayed}
      </div>
      {displayed.length === contextText.length && (
        <button style={{
          background: "rgba(139, 92, 246, 0.15)", border: "1px solid rgba(139, 92, 246, 0.3)",
          color: "#a78bfa", padding: "0.4rem 0.75rem", borderRadius: 8, fontSize: "0.75rem", fontWeight: 600,
          cursor: "pointer", display: "inline-block", width: "fit-content", marginTop: "1rem", transition: "background 0.2s"
        }}>
          Apply tokens
        </button>
      )}
    </div>
  );
}

export function OverviewClient(props: Props) {
  const { userName, plan, hasTemplates, hasDomains, hasApiKeys, hasViews, templatesCount, domainsCount, apiKeysCount, recentTemplates } = props;

  const [totalViews, setTotalViews] = useState(0);
  const [chartData, setChartData] = useState<TimelineDay[]>([]);
  const [heatmapData, setHeatmapData] = useState<HeatmapPoint[]>([]);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/v1/analytics")
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setTotalViews(data.totalViews);
          setChartData(data.chartData ?? []);
          setHeatmapData(data.heatmap ?? []);
        }
      })
      .catch((err) => console.error("Error loading analytics:", err))
      .finally(() => setAnalyticsLoading(false));
  }, []);

  const hasAnyViews = chartData.some((d) => d.views > 0);
  const aiContextText = useMemo(() => getAiContext(props, totalViews, chartData), [props, totalViews, chartData]);

  return (
    <div style={{ paddingBottom: "2rem" }}>
      <div className="bento-grid">

        {/* Row 1: Hero (Span 3) + AI Co-Pilot (Span 1) */}
        <HolographicCard className="bento-col-span-3 bento-enter" style={{ background: "linear-gradient(135deg, rgba(139,92,246,0.1), rgba(15,20,34,0.6) 80%)" }}>
          <div style={{ position: "absolute", top: -100, right: -100, width: 400, height: 400, background: "radial-gradient(circle, rgba(139,92,246,0.2) 0%, transparent 70%)", filter: "blur(40px)", zIndex: -1 }} />

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", height: "100%", flexDirection: "column" }}>
            <div>
              <span style={{
                fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase",
                color: "var(--brand)", display: "flex", alignItems: "center", gap: "0.4rem"
              }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#10b981", boxShadow: "0 0 10px #10b981" }} />
                {greeting()}
              </span>
              <h1 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "clamp(1.8rem, 4vw, 2.6rem)", fontWeight: 800, color: "#fff", letterSpacing: "-0.03em", lineHeight: 1.1, margin: "0.75rem 0 0.5rem" }}>
                Welcome back, {userName}
              </h1>
              <p style={{ fontSize: "0.9rem", color: "rgba(255,255,255,0.6)", maxWidth: 500, margin: 0 }}>
                All systems nominal. Your {plan} workspace is operating at peak efficiency.
              </p>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "2rem" }}>
              <Link
                href="/dashboard/templates"
                style={{
                  display: "inline-flex", alignItems: "center", gap: "0.5rem",
                  padding: "0.75rem 1.4rem", borderRadius: 12, fontWeight: 700, fontSize: "0.85rem",
                  background: "linear-gradient(135deg, var(--brand), var(--brand-deep))",
                  color: "#fff", textDecoration: "none",
                  boxShadow: "0 10px 30px var(--brand-glow), inset 0 1px 0 rgba(255,255,255,0.2)",
                  transition: "transform 0.2s, box-shadow 0.2s"
                }}
              >
                <IconPlus />
                Initialize New Template
              </Link>
            </div>
          </div>
        </HolographicCard>

        {/* AI Co-Pilot Terminal */}
        <HolographicCard className="bento-enter delay-100" style={{ background: "rgba(10, 11, 16, 0.6)", border: "1px solid rgba(139, 92, 246, 0.2)" }}>
          <AiTerminal contextText={aiContextText} />
        </HolographicCard>

        {/* Restored KPIs Row */}
        <HolographicCard className="bento-enter delay-200">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <span style={{ fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(255,255,255,0.4)" }}>Templates</span>
            <span style={{ color: "var(--brand)" }}><IconLayers /></span>
          </div>
          <span style={{ fontSize: "2rem", fontWeight: 800, color: "#fff", display: "block" }}>{templatesCount}</span>
          <Link href="/dashboard/templates" style={{ fontSize: "0.75rem", color: "var(--brand)", marginTop: "auto", display: "inline-flex", alignItems: "center", gap: "0.3rem", textDecoration: "none", fontWeight: 600 }}>
            Manage <IconArrowRight />
          </Link>
        </HolographicCard>

        <HolographicCard className="bento-enter delay-300">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <span style={{ fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(255,255,255,0.4)" }}>Live Domains</span>
            <span style={{ color: "#38bdf8" }}><IconGlobe /></span>
          </div>
          <span style={{ fontSize: "2rem", fontWeight: 800, color: "#fff", display: "block" }}>{domainsCount}</span>
          <Link href="/dashboard/domains" style={{ fontSize: "0.75rem", color: "#38bdf8", marginTop: "auto", display: "inline-flex", alignItems: "center", gap: "0.3rem", textDecoration: "none", fontWeight: 600 }}>
            Configure <IconArrowRight />
          </Link>
        </HolographicCard>

        <HolographicCard className="bento-enter delay-400">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <span style={{ fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(255,255,255,0.4)" }}>API Keys</span>
            <span style={{ color: "#f59e0b" }}><IconKey /></span>
          </div>
          <span style={{ fontSize: "2rem", fontWeight: 800, color: "#fff", display: "block" }}>{apiKeysCount}</span>
          <Link href="/dashboard/settings" style={{ fontSize: "0.75rem", color: "#f59e0b", marginTop: "auto", display: "inline-flex", alignItems: "center", gap: "0.3rem", textDecoration: "none", fontWeight: 600 }}>
            View Tokens <IconArrowRight />
          </Link>
        </HolographicCard>

        <HolographicCard className="bento-enter delay-400">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
            <span style={{ fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(255,255,255,0.4)" }}>Views (7d)</span>
            <span style={{ color: "#10b981" }}><IconEyeSmall /></span>
          </div>
          <span style={{ fontSize: "2rem", fontWeight: 800, color: "#fff", display: "block", marginBottom: "0.5rem" }}>{totalViews.toLocaleString()}</span>
          <Sparkline data={chartData} />
        </HolographicCard>



        {/* Row 3: Traffic Pulse & Heatmap */}
        <HolographicCard className="bento-col-span-2 bento-enter delay-500" style={{ minHeight: 300, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem", zIndex: 1 }}>
            <div>
              <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#fff", margin: 0, display: "flex", alignItems: "center", gap: "0.5rem" }}>
                Traffic Pulse <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--brand)", boxShadow: "0 0 10px var(--brand)" }} />
              </h2>
              <p style={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.5)", margin: "0.25rem 0 0" }}>Live global activity across your assets.</p>
            </div>
            <Link href="/dashboard/insights" style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--brand)", textDecoration: "none" }}>Open Scanner</Link>
          </div>

          <div style={{ flex: 1, position: "relative", display: "flex", alignItems: "flex-end", paddingBottom: "1rem" }}>
            {/* Ambient Pulse Effect in Background */}
            <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", opacity: 0.2, zIndex: 0 }}>
              <div style={{ position: "relative", width: 100, height: 100 }}>
                <div className="radar-pulse" />
                <div className="radar-pulse" style={{ animationDelay: "1s" }} />
              </div>
            </div>
            <div style={{ width: "100%", zIndex: 1 }}>
              {analyticsLoading ? (
                <div style={{ height: 150, display: "grid", placeItems: "center", color: "rgba(255,255,255,0.3)" }}>Calibrating sensors…</div>
              ) : hasAnyViews ? (
                <TrafficChart chartData={chartData} height={180} />
              ) : (
                <div style={{ height: 150, display: "grid", placeItems: "center", color: "rgba(255,255,255,0.3)" }}>No signatures detected.</div>
              )}
            </div>
          </div>
        </HolographicCard>

        <HolographicCard className="bento-col-span-2 bento-enter delay-500" style={{ minHeight: 300 }}>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#fff", margin: 0 }}>Energy Matrix</h2>
          <p style={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.5)", margin: "0.25rem 0 1.5rem" }}>Temporal visitor density.</p>
          <div style={{ flex: 1 }}>
            <ActivityHeatmap data={heatmapData} />
          </div>
        </HolographicCard>
      </div>

      {/* Launchpad Quick Actions (Exactly 5rem tall) */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.5rem", margin: "1.25rem 0", height: "4rem" }}>
        <ActionPill title="Explore Marketplace" icon={<IconMarketplace />} colorStart="#ec4899" colorEnd="#f43f5e" href="/dashboard/marketplace" delayClass="delay-500" />
        <ActionPill title="Configure Domains" icon={<IconGlobe />} colorStart="#0ea5e9" colorEnd="#3b82f6" href="/dashboard/domains" delayClass="delay-600" />
        <ActionPill title="AI Integrations" icon={<IconBrain />} colorStart="#8b5cf6" colorEnd="#6366f1" href="/dashboard/integrations" delayClass="delay-600" />
        <ActionPill title="Read the Blog" icon={<IconBook />} colorStart="#10b981" colorEnd="#14b8a6" href="/dashboard/blog" delayClass="delay-700" />
      </div>

      <div className="bento-grid">
        {/* Row 4: Restored Templates Grid (Dense Layout inside Bento) */}
        <HolographicCard className="bento-col-span-4 bento-enter delay-600">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
            <h2 style={{ fontSize: "1.2rem", fontWeight: 700, color: "#fff", margin: 0 }}>Active Blueprints</h2>
            {recentTemplates.length > 0 && (
              <Link href="/dashboard/templates" style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--brand)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
                View Database <IconArrowRight />
              </Link>
            )}
          </div>

          {recentTemplates.length > 0 ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1rem" }}>
              {recentTemplates.map((template) => (
                <TemplateCard key={template.id} template={template} />
              ))}
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: "4rem 2rem", border: "1px dashed rgba(255,255,255,0.1)", borderRadius: 16 }}>
              <h3 style={{ fontSize: "1.1rem", color: "#fff", margin: "0 0 0.5rem" }}>No blueprints found.</h3>
              <p style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.5)", marginBottom: "1.5rem" }}>Initialize your first template to populate this sector.</p>
              <Link href="/dashboard/templates" style={{
                display: "inline-flex", alignItems: "center", gap: "0.5rem", padding: "0.7rem 1.4rem",
                borderRadius: 10, fontSize: "0.85rem", fontWeight: 700,
                background: "rgba(139,92,246,0.2)", color: "#a78bfa", textDecoration: "none",
                border: "1px solid rgba(139,92,246,0.3)", transition: "background 0.2s"
              }}>
                <IconPlus /> Initialize Template
              </Link>
            </div>
          )}
        </HolographicCard>

      </div>
    </div>
  );
}
