"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";

export type CommerceSiteInfo = {
  id: string;
  name: string;
  domain: string | null;
  enabled: boolean;
  storefrontSlug: string | null;
};

// A small, fixed palette so each site gets a stable, distinct avatar color across
// sessions (hashed off the site id, not randomized) — the same idea as Avatar.tsx's
// initials-based identity, but per-site rather than per-user, since "which site am I
// looking at" is the thing this header exists to make unmistakable at a glance.
const AVATAR_COLORS = ["#f472b6", "#34d399", "#60a5fa", "#fbbf24", "var(--brand-light)", "#f87171", "#2dd4bf"];

function colorForSite(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function initialFor(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

function SiteAvatar({ site, size }: { site: CommerceSiteInfo; size: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size >= 36 ? 10 : 8,
        flexShrink: 0,
        display: "grid",
        placeItems: "center",
        fontSize: size >= 36 ? "1rem" : "0.8rem",
        fontWeight: 700,
        color: "#fff",
        background: colorForSite(site.id),
      }}
    >
      {initialFor(site.name)}
    </div>
  );
}

function StatusPill({ enabled }: { enabled: boolean }) {
  const color = enabled ? "#34d399" : "#fbbf24";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.3rem",
        padding: "0.12rem 0.5rem",
        borderRadius: 999,
        fontSize: "0.66rem",
        fontWeight: 700,
        letterSpacing: "0.03em",
        textTransform: "uppercase",
        background: enabled ? "rgba(52,211,153,0.14)" : "rgba(251,191,36,0.14)",
        color,
      }}
    >
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: color }} />
      {enabled ? "Live" : "Draft"}
    </span>
  );
}

/** Site identity + switcher for the Commerce module — replaces CommerceSiteSwitcher's
 * plain native <select>. The site name IS the switcher (click it to change sites); no
 * separate control bolted on beside it. Reuses the exact path-segment-swap navigation
 * CommerceSiteSwitcher already used, just triggered from a dropdown row instead of a
 * <select> change handler. Renders identically regardless of which dashboard shell
 * (Modern topbar, Classic sidebar) wraps it — this is plain page content, not new chrome. */
export function CommerceSiteHeader({
  currentSite,
  otherSites,
  currentTemplateId,
}: {
  currentSite: CommerceSiteInfo;
  otherSites: CommerceSiteInfo[];
  currentTemplateId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [switchingTo, setSwitchingTo] = useState<CommerceSiteInfo | null>(null);
  const [isPending, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  function handleSwitch(site: CommerceSiteInfo) {
    setOpen(false);
    if (site.id === currentTemplateId) return;
    const nextPath = pathname.replace(`/dashboard/commerce/${currentTemplateId}`, `/dashboard/commerce/${site.id}`);
    setSwitchingTo(site);
    startTransition(() => {
      router.push(nextPath);
    });
  }

  const allSites = [currentSite, ...otherSites];
  const storefrontUrl = currentSite.domain ? `https://${currentSite.domain}/${currentSite.storefrontSlug ?? "store"}` : null;

  return (
    <div
      className="flex flex-col sm:flex-row sm:items-center"
      style={{ justifyContent: "space-between", gap: "1rem", marginBottom: "1.4rem", flexWrap: "wrap" }}
    >
      <div ref={containerRef} style={{ position: "relative" }}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="menu"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.7rem",
            padding: "0.3rem",
            margin: "-0.3rem",
            borderRadius: 12,
            border: "none",
            background: "none",
            textAlign: "left",
            cursor: "pointer",
          }}
        >
          <SiteAvatar site={currentSite} size={40} />
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ fontSize: "1.05rem", fontWeight: 700, color: "#f0f2ff" }}>{currentSite.name}</span>
              <StatusPill enabled={currentSite.enabled} />
              {otherSites.length > 0 && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(240,242,255,0.4)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              )}
            </div>
            {currentSite.domain && (
              <div style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.45)", marginTop: 2 }}>{currentSite.domain}</div>
            )}
          </div>
        </button>

        {open && otherSites.length > 0 && (
          <div
            role="menu"
            style={{
              position: "absolute",
              top: "calc(100% + 8px)",
              left: 0,
              width: 340,
              zIndex: 20,
              background: "rgba(15,17,28,0.98)",
              border: "1px solid rgba(255,255,255,0.09)",
              borderRadius: 16,
              boxShadow: "0 24px 60px -12px rgba(0,0,0,0.6)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              padding: "0.5rem",
            }}
          >
            <div
              style={{
                padding: "0.5rem 0.6rem 0.6rem",
                fontSize: "0.68rem",
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "rgba(240,242,255,0.35)",
              }}
            >
              Switch site
            </div>
            {allSites.map((site) => {
              const isActive = site.id === currentTemplateId;
              return (
                <button
                  key={site.id}
                  type="button"
                  role="menuitem"
                  onClick={() => handleSwitch(site)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.65rem",
                    padding: "0.55rem 0.6rem",
                    borderRadius: 10,
                    background: isActive ? "var(--brand-subtle, rgba(var(--brand-rgb),0.1))" : "transparent",
                    border: "none",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                  onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
                  onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
                >
                  <SiteAvatar site={site} size={30} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "#f0f2ff" }}>{site.name}</div>
                    {site.domain && <div style={{ fontSize: "0.72rem", color: "rgba(240,242,255,0.4)" }}>{site.domain}</div>}
                  </div>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: site.enabled ? "#34d399" : "#fbbf24", flexShrink: 0 }} />
                  {isActive && (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--brand, var(--brand))" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {storefrontUrl ? (
        <a
          href={storefrontUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.4rem",
            padding: "0.5rem 0.85rem",
            borderRadius: 9,
            fontSize: "0.8rem",
            fontWeight: 600,
            color: "rgba(240,242,255,0.7)",
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.08)",
            textDecoration: "none",
            flexShrink: 0,
          }}
        >
          Visit storefront
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <path d="M15 3h6v6" />
            <path d="M10 14L21 3" />
          </svg>
        </a>
      ) : (
        <span
          style={{
            fontSize: "0.8rem",
            color: "rgba(240,242,255,0.35)",
            flexShrink: 0,
          }}
        >
          No live domain yet
        </span>
      )}

      {isPending && switchingTo && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 200,
            display: "grid",
            placeItems: "center",
            background: "rgba(8,9,15,0.75)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
          }}
        >
          <style dangerouslySetInnerHTML={{ __html: "@keyframes commerce-switch-spin { to { transform: rotate(360deg); } }" }} />
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem" }}>
            <div style={{ position: "relative", width: 56, height: 56 }}>
              <SiteAvatar site={switchingTo} size={56} />
              <div
                style={{
                  position: "absolute",
                  inset: -6,
                  borderRadius: 14,
                  border: "2.5px solid rgba(255,255,255,0.12)",
                  borderTopColor: "var(--brand, var(--brand))",
                  animation: "commerce-switch-spin 0.7s linear infinite",
                }}
              />
            </div>
            <div style={{ fontSize: "0.95rem", fontWeight: 600, color: "#f0f2ff" }}>Switching to {switchingTo.name}…</div>
          </div>
        </div>
      )}
    </div>
  );
}
