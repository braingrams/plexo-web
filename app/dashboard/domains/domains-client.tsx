"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";

// Vercel's generic, stable CNAME target — works for both subdomains and apex/root
// domains via CNAME flattening (registrar-dependent) and is documented as permanently
// supported, unlike the old A-record + static IP recommendation it replaced.
const DNS_CNAME_TARGET = "cname.vercel-dns.com";

type DomainType = "SUBDOMAIN" | "CUSTOM";

type DomainRecord = {
  id: string;
  domain: string;
  type: DomainType;
  templateId: string;
  templateName: string;
  createdAt: string;
  dnsVerified?: boolean;
  dnsVerifiedAt?: string | null;
};

type LandingPage = {
  id: string;
  name: string;
};

type Props = {
  initialDomains: DomainRecord[];
  landingPages: LandingPage[];
  plan: string;
  customLimit: number | null;
};

// --- Icons ---
function IconGlobe() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

function IconExternal() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function IconAlert() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function IconCopy() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function IconChevronDown() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  );
}

export function CustomSelect({
  value,
  options,
  disabled,
  onChange,
}: {
  value: string;
  options: Array<{ label: string; value: string }>;
  disabled?: boolean;
  onChange: (val: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selected = options.find((o) => o.value === value);

  // Positions the menu (portaled to document.body below) from the trigger's live
  // viewport coordinates instead of a CSS-relative offset — the previous
  // position:absolute + a hardcoded per-callsite `openUpwards` prop got silently
  // clipped by any scrollable ancestor (e.g. the domains table's horizontal-scroll
  // wrapper: setting overflowX without overflowY makes the browser compute
  // overflowY as "auto" too per the CSS overflow spec, turning that wrapper into a
  // vertical clipping box). A portal escapes that ancestor entirely, and the flip
  // direction is now decided from actual available space, not a guess baked in at
  // the call site.
  const updatePosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const menuHeight = Math.min(320, options.length * 40 + 16);
    const spaceBelow = window.innerHeight - rect.bottom;
    const shouldOpenUpwards = spaceBelow < menuHeight + 12 && rect.top > spaceBelow;
    setMenuStyle({
      position: "fixed",
      left: rect.left,
      width: rect.width,
      ...(shouldOpenUpwards
        ? { bottom: window.innerHeight - rect.top + 6 }
        : { top: rect.bottom + 6 }),
    });
  }, [options.length]);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    // Capture-phase scroll listener so this also repositions on scroll from any
    // scrollable ancestor (e.g. the table's own horizontal scroll), not just the window.
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open, updatePosition]);

  return (
    <div style={{ position: "relative" }}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.5rem",
          padding: "0.6rem 0.875rem",
          borderRadius: 9,
          border: open ? "1px solid rgba(139,92,246,0.5)" : "1px solid rgba(255,255,255,0.1)",
          background: open ? "rgba(139,92,246,0.08)" : "rgba(255,255,255,0.05)",
          color: disabled ? "rgba(240,242,255,0.3)" : "rgba(240,242,255,0.9)",
          fontFamily: "inherit",
          fontSize: "0.875rem",
          fontWeight: 500,
          cursor: disabled ? "not-allowed" : "pointer",
          transition: "border-color 0.15s, background 0.15s",
          boxShadow: open ? "0 0 0 2px rgba(139,92,246,0.15)" : "none",
        }}
      >
        <span>{selected?.label ?? value}</span>
        <span style={{ color: "rgba(240,242,255,0.4)", transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s", display: "inline-flex" }}>
          <IconChevronDown />
        </span>
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <>
          {/* Backdrop */}
          <div
            // Above every other fixed-position overlay in this file (drawer: 9998/9999,
            // delete/alert dialogs: 10000/10001) — this is portaled to document.body, so
            // it's a stacking-order sibling of those, not nested inside them, and needs
            // to out-rank whichever overlay it's opened from or it renders invisibly
            // behind it (confirmed: this was exactly why the drawer's dropdown didn't
            // visibly appear on click even though it was opening correctly).
            style={{ position: "fixed", inset: 0, zIndex: 10100 }}
            onClick={() => setOpen(false)}
          />
          {/* Dropdown panel */}
          <div
            style={{
              ...menuStyle,
              zIndex: 10101,
              background: "rgba(18,16,36,0.95)",
              backdropFilter: "blur(16px)",
              border: "1px solid rgba(139,92,246,0.3)",
              borderRadius: 10,
              maxHeight: "min(320px, 60vh)",
              overflowY: "auto",
              boxShadow: "0 12px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(139,92,246,0.15)",
            }}
          >
            {options.map((opt) => {
              const isActive = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => { onChange(opt.value); setOpen(false); }}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "0.625rem 0.875rem",
                    background: isActive ? "rgba(139,92,246,0.12)" : "transparent",
                    border: "none",
                    borderBottom: "1px solid rgba(255,255,255,0.05)",
                    color: isActive ? "#c4b5fd" : "rgba(240,242,255,0.75)",
                    fontFamily: "inherit",
                    fontSize: "0.875rem",
                    fontWeight: isActive ? 600 : 400,
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "background 0.15s, color 0.15s",
                  }}
                >
                  <span>{opt.label}</span>
                  {isActive && <span style={{ color: "#a78bfa" }}>✓</span>}
                </button>
              );
            })}
          </div>
        </>,
        document.body
      )}
    </div>
  );
}

function initialDnsStatus(records: DomainRecord[]): Record<string, { checking: boolean; valid?: boolean; error?: string }> {
  const status: Record<string, { checking: boolean; valid?: boolean; error?: string }> = {};
  for (const d of records) {
    if (d.type === "CUSTOM" && d.dnsVerified) {
      status[d.domain] = { checking: false, valid: true };
    }
  }
  return status;
}

export function DomainsClient({ initialDomains, landingPages, plan, customLimit }: Props) {
  const [domains, setDomains] = useState<DomainRecord[]>(initialDomains);
  // NEXT_PUBLIC_ vars are inlined into the client bundle at build time, so this is
  // correct on first paint with no hardcoded domain guess and no flash of a stale
  // value before the /api/v1/domains fetch below confirms it server-side.
  const [baseDomain, setBaseDomain] = useState<string>(process.env.NEXT_PUBLIC_PAGES_DOMAIN || "localhost");
  const [count, setCount] = useState<number>(initialDomains.length);
  const [limit, setLimit] = useState<number>(25);

  const [copiedField, setCopiedField] = useState<string | null>(null);

  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const [deleteConfirmInfo, setDeleteConfirmInfo] = useState<{ id: string; domain: string } | null>(null);
  const [customAlertInfo, setCustomAlertInfo] = useState<{ title: string; message: string } | null>(null);

  const canUseCustomDomain = plan === "PRO" || plan === "ULTRA";
  const [upgradeRedirecting, setUpgradeRedirecting] = useState(false);

  // Custom domains are a Pro/Ultra feature — a FREE user clicking this should be offered a
  // seamless path to upgrade rather than just sitting on an inert disabled control, so this
  // reuses the same checkout pattern as billing-section.tsx's startCheckout instead of a plain
  // native `disabled` attribute (which would swallow the click entirely).
  async function startUpgradeCheckout(): Promise<void> {
    setUpgradeRedirecting(true);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "subscription", plan: "PRO" }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? "Could not start checkout.");
      window.location.href = data.url;
    } catch (err) {
      setUpgradeRedirecting(false);
      setCustomAlertInfo({
        title: "Could not start checkout",
        message: err instanceof Error ? err.message : "Could not start checkout.",
      });
    }
  }

  const handleCopy = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  // Form states
  const [domainType, setDomainType] = useState<DomainType>("SUBDOMAIN");
  const [subdomainPrefix, setSubdomainPrefix] = useState<string>("");
  const [customDomainInput, setCustomDomainInput] = useState<string>("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(landingPages[0]?.id ?? "");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const dnsHostLabel = useMemo(() => {
    if (!customDomainInput) return "subdomain";
    const parts = customDomainInput.split(".");
    return parts.length > 2 ? parts[0] : "@";
  }, [customDomainInput]);

  const templateOptions = useMemo(() => {
    if (landingPages.length === 0) {
      return [{ label: "No landing pages available", value: "" }];
    }
    return landingPages.map((lp) => ({ label: lp.name, value: lp.id }));
  }, [landingPages]);

  // DNS Verification status map — seeded from the persisted dnsVerified flag so a
  // reload doesn't lose a domain that was already confirmed as verified.
  const [dnsStatus, setDnsStatus] = useState<Record<string, { checking: boolean; valid?: boolean; error?: string }>>(
    () => initialDnsStatus(initialDomains)
  );

  // Relink state mapping: domainId -> boolean (isEditing)
  const [editingDomainId, setEditingDomainId] = useState<string | null>(null);
  const [relinkTemplateId, setRelinkTemplateId] = useState<string>("");

  useEffect(() => {
    // Fetch limits and config from API to get the pages domain (returned as
    // `baseDomain` for backward compatibility with this component's naming) correctly
    fetch("/api/v1/domains")
      .then((res) => res.json())
      .then((data) => {
        if (data.baseDomain) setBaseDomain(data.baseDomain);
        if (data.limit) setLimit(data.limit);
        if (data.count !== undefined) setCount(data.count);
      })
      .catch((err) => console.error("Error loading domain settings:", err));
  }, [domains]);

  // Check link helper for development support
  function getClickUrl(domainName: string): string {
    const isDev = baseDomain === "localhost";
    if (isDev) {
      if (domainName.endsWith(`.${baseDomain}`)) {
        const sub = domainName.replace(`.${baseDomain}`, "");
        return `http://${sub}.localhost:3000`;
      }
      return `http://${domainName}:3000`;
    }
    return `https://${domainName}`;
  }

  async function handleVerifyDns(domainName: string) {
    setDnsStatus((prev) => ({ ...prev, [domainName]: { checking: true } }));
    try {
      const res = await fetch(`/api/v1/domains/verify?domain=${encodeURIComponent(domainName)}`);
      const data = await res.json();
      setDnsStatus((prev) => ({
        ...prev,
        [domainName]: { checking: false, valid: !!data.valid, error: data.error },
      }));
    } catch (err) {
      setDnsStatus((prev) => ({
        ...prev,
        [domainName]: { checking: false, valid: false, error: "DNS lookup failed." },
      }));
    }
  }

  async function handleAddDomain(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    const inputDomain = domainType === "SUBDOMAIN" ? subdomainPrefix : customDomainInput;
    if (!inputDomain.trim()) {
      setErrorMsg("Please provide a domain name.");
      return;
    }

    if (!selectedTemplateId) {
      setErrorMsg("Please select a landing page template to link.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/v1/domains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId: selectedTemplateId,
          type: domainType,
          domain: inputDomain,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to publish domain.");
      }

      setSuccessMsg("Domain published successfully!");
      setSubdomainPrefix("");
      setCustomDomainInput("");

      // Refresh list
      const updatedRes = await fetch("/api/v1/domains");
      const updatedData = await updatedRes.json();
      if (updatedData.domains) {
        setDomains(updatedData.domains.map((d: any) => ({
          id: d.id,
          domain: d.domain,
          type: d.type,
          templateId: d.templateId,
          templateName: d.template?.name ?? "Unknown",
          createdAt: d.createdAt,
        })));
      }
      if (updatedData.count !== undefined) setCount(updatedData.count);

      setTimeout(() => {
        setSuccessMsg(null);
        setIsDrawerOpen(false);
      }, 1500);
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : "An unexpected error occurred.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleDeleteDomain(domainId: string, domainName: string) {
    setDeleteConfirmInfo({ id: domainId, domain: domainName });
  }

  async function executeDeleteDomain() {
    if (!deleteConfirmInfo) return;
    const { id: domainId, domain: domainName } = deleteConfirmInfo;
    setDeleteConfirmInfo(null);

    try {
      const response = await fetch(`/api/v1/domains?id=${domainId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error ?? "Failed to delete domain.");
      }

      setDomains((prev) => prev.filter((d) => d.id !== domainId));
      setCount((c) => Math.max(0, c - 1));
    } catch (error) {
      setCustomAlertInfo({
        title: "Delete Failed",
        message: error instanceof Error ? error.message : "Failed to unpublish domain."
      });
    }
  }

  async function handleRelinkDomain(domainId: string, currentDomain: string) {
    if (!relinkTemplateId) return;

    try {
      const response = await fetch("/api/v1/domains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          relink: true,
          templateId: relinkTemplateId,
          type: domains.find((d) => d.id === domainId)?.type ?? "SUBDOMAIN",
          domain: domains.find((d) => d.id === domainId)?.type === "SUBDOMAIN"
            ? currentDomain.split(".")[0] // Subdomain prefix only
            : currentDomain,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to re-link domain.");
      }

      // Update state
      setDomains((prev) =>
        prev.map((d) =>
          d.id === domainId
            ? {
                ...d,
                templateId: relinkTemplateId,
                templateName: landingPages.find((p) => p.id === relinkTemplateId)?.name ?? "Linked Page",
              }
            : d
        )
      );
      setEditingDomainId(null);
    } catch (error) {
      setCustomAlertInfo({
        title: "Update Failed",
        message: error instanceof Error ? error.message : "Failed to re-link domain."
      });
    }
  }

  const percentage = Math.min(100, Math.max(0, (count / limit) * 100));
  const radius = 24;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  return (
    <>
      {/* Header and Limits */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "2.5rem", flexWrap: "wrap", gap: "1.25rem" }}>
        <div>
          <p style={{ fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--brand)", marginBottom: "0.35rem" }}>
            Domains &amp; Publishing
          </p>
          <h1 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "2.1rem", fontWeight: 800, color: "#f0f2ff", letterSpacing: "-0.025em" }}>
            Domain Management
          </h1>
          <p style={{ fontSize: "0.875rem", color: "rgba(240,242,255,0.45)", marginTop: "0.35rem" }}>
            Host your responsive landing pages on custom domains or platform subdomains.
          </p>
        </div>

        {/* Limit badge with progress donut */}
        <div style={{
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 16,
          padding: "0.85rem 1.5rem",
          display: "flex",
          alignItems: "center",
          gap: "1.25rem",
          boxShadow: "0 4px 20px rgba(0,0,0,0.15)"
        }}>
          {/* SVG Donut */}
          <div style={{ position: "relative", width: 60, height: 60, display: "grid", placeItems: "center" }}>
            <svg width="60" height="60" style={{ transform: "rotate(-90deg)" }}>
              {/* Background circle */}
              <circle
                cx="30"
                cy="30"
                r={radius}
                fill="transparent"
                stroke="rgba(255,255,255,0.04)"
                strokeWidth="4"
              />
              {/* Foreground circle */}
              <circle
                cx="30"
                cy="30"
                r={radius}
                fill="transparent"
                stroke="var(--brand)"
                strokeWidth="4"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                style={{ transition: "stroke-dashoffset 0.35s ease-in-out" }}
              />
            </svg>
            <div style={{ position: "absolute", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.78rem" }}>
              <span style={{ fontWeight: 850, color: "#f0f2ff" }}>{count}</span>
              <span style={{ color: "rgba(240,242,255,0.25)", margin: "0 0.05rem" }}>/</span>
              <span style={{ fontWeight: 700, color: "rgba(240,242,255,0.4)" }}>{limit}</span>
            </div>
          </div>

          <div style={{ textAlign: "left" }}>
            <span style={{ fontSize: "0.68rem", fontWeight: 700, color: "rgba(240,242,255,0.35)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Usage Limit
            </span>
            <div style={{ marginTop: "0.2rem" }}>
              <span style={{
                fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.05em",
                textTransform: "uppercase", color: "var(--brand)",
                background: "var(--brand-subtle)", padding: "0.2rem 0.5rem", borderRadius: 5
              }}>
                {plan} PLAN
              </span>
            </div>
          </div>
        </div>
      </div>

      <div style={{ width: "100%" }}>
        {/* Active Published Domains List */}
        <div style={{
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 16, overflow: "visible",
          boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
          marginBottom: "2rem"
        }}>
          <div style={{
            padding: "1rem 1.25rem",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "0.75rem",
          }}>
            <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "#f0f2ff" }}>
              Active Published Domains
            </h2>
            {domains.length > 0 && (
              <div style={{ display: "flex", gap: "0.6rem", marginLeft: "auto" }}>
                <Link
                  href="/dashboard/templates/upload"
                  style={{
                    padding: "0.5rem 1rem", borderRadius: 8, fontSize: "0.8rem", fontWeight: 700,
                    background: "none", border: "1px solid rgba(255,255,255,0.1)",
                    color: "rgba(240,242,255,0.75)", whiteSpace: "nowrap", textDecoration: "none",
                    display: "inline-flex", alignItems: "center",
                  }}
                >
                  Upload HTML Site
                </Link>
                <button
                  type="button"
                  onClick={() => setIsDrawerOpen(true)}
                  className="btn-primary"
                  style={{
                    padding: "0.5rem 1rem", borderRadius: 8, fontSize: "0.8rem", fontWeight: 700,
                    background: "linear-gradient(135deg,var(--brand),var(--brand-deep))",
                    border: "none", color: "#fff", cursor: "pointer",
                    boxShadow: "0 4px 14px var(--brand-glow)",
                    whiteSpace: "nowrap",
                  }}
                >
                  + Link Domain
                </button>
              </div>
            )}
          </div>

          {domains.length === 0 ? (
            <div style={{
              padding: "6rem 2rem",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
            }}>
              <div style={{
                width: 64, height: 64, borderRadius: "50%",
                background: "rgba(139,92,246,0.05)",
                display: "grid", placeItems: "center",
                marginBottom: "1.5rem",
                border: "1px solid rgba(139,92,246,0.15)",
                boxShadow: "0 0 30px rgba(139,92,246,0.06)"
              }}>
                <span style={{ fontSize: "1.9rem" }}>🌐</span>
              </div>
              <h3 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#f0f2ff", marginBottom: "0.5rem" }}>
                No active domains linked
              </h3>
              <p style={{ color: "rgba(240,242,255,0.45)", fontSize: "0.85rem", maxWidth: 380, lineHeight: 1.5, marginBottom: "1.75rem", margin: "0.25rem auto 1.5rem" }}>
                Host your responsive landing pages on custom subdomains or external domains. Get started by linking your first domain!
              </p>
              <div style={{ display: "flex", gap: "0.75rem" }}>
                <button
                  type="button"
                  onClick={() => setIsDrawerOpen(true)}
                  className="btn-primary"
                  style={{
                    padding: "0.65rem 1.75rem", borderRadius: 10, fontWeight: 700, fontSize: "0.85rem",
                    background: "linear-gradient(135deg,var(--brand),var(--brand-deep))",
                    color: "#fff", border: "none", cursor: "pointer",
                    boxShadow: "0 4px 20px var(--brand-glow)",
                    transition: "opacity 0.15s, box-shadow 0.15s",
                    fontFamily: "inherit"
                  }}
                >
                  Link a Domain
                </button>
                <Link
                  href="/dashboard/templates/upload"
                  style={{
                    padding: "0.65rem 1.75rem", borderRadius: 10, fontWeight: 700, fontSize: "0.85rem",
                    background: "none", border: "1px solid rgba(255,255,255,0.1)",
                    color: "rgba(240,242,255,0.75)", textDecoration: "none",
                    display: "inline-flex", alignItems: "center", fontFamily: "inherit"
                  }}
                >
                  Upload HTML Site
                </Link>
              </div>
            </div>
          ) : (
            <div style={{ width: "100%", overflowX: "auto" }}>
              <table style={{ width: "100%", minWidth: 720, borderCollapse: "collapse", textAlign: "left", fontSize: "0.875rem" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", color: "rgba(240,242,255,0.35)", fontWeight: 650 }}>
                    <th style={{ padding: "1rem 1.5rem", borderTopLeftRadius: 16 }}>Domain</th>
                    <th style={{ padding: "1rem 1.5rem" }}>Type</th>
                    <th style={{ padding: "1rem 1.5rem" }}>Linked Landing Page</th>
                    <th style={{ padding: "1rem 1.5rem" }}>Status</th>
                    <th style={{ padding: "1rem 1.5rem", textAlign: "right", borderTopRightRadius: 16 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {domains.map((item) => {
                    const dns = dnsStatus[item.domain];
                    const isEditing = editingDomainId === item.id;

                    return (
                      <tr key={item.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)", verticalAlign: "middle" }}>
                        <td style={{ padding: "1.1rem 1.5rem" }}>
                          <a
                            href={getClickUrl(item.domain)}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              display: "inline-flex",
                              alignItems: "center", gap: "0.4rem", fontWeight: 600, transition: "color 0.15s"
                            }}
                            className="domain-link-hover"
                          >
                            {item.domain}
                            <span style={{ color: "rgba(240,242,255,0.25)" }}><IconExternal /></span>
                          </a>
                        </td>
                        <td style={{ padding: "1.1rem 1.5rem" }}>
                          <span style={{
                            fontSize: "0.72rem", padding: "0.2rem 0.5rem", borderRadius: 999, fontWeight: 700,
                            background: item.type === "SUBDOMAIN" ? "rgba(99,102,241,0.08)" : "rgba(236,72,153,0.08)",
                            color: item.type === "SUBDOMAIN" ? "#818cf8" : "#f472b6",
                            border: `1px solid ${item.type === "SUBDOMAIN" ? "rgba(99,102,241,0.15)" : "rgba(236,72,153,0.15)"}`
                          }}>
                            {item.type}
                          </span>
                        </td>
                        <td style={{ padding: "1.1rem 1.5rem" }}>
                          {isEditing ? (
                            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                              <div style={{ width: 185 }}>
                                <CustomSelect
                                  value={relinkTemplateId}
                                  onChange={(val) => setRelinkTemplateId(val)}
                                  options={templateOptions}
                                />
                              </div>
                              <button
                                onClick={() => void handleRelinkDomain(item.id, item.domain)}
                                className="btn-primary"
                                style={{ padding: "0.3rem 0.6rem", fontSize: "0.78rem" }}
                              >
                                Save
                              </button>
                              <button
                                onClick={() => setEditingDomainId(null)}
                                className="btn-secondary"
                                style={{ padding: "0.3rem 0.6rem", fontSize: "0.78rem", background: "none" }}
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                              <span style={{ color: "rgba(240,242,255,0.7)" }}>{item.templateName}</span>
                              <button
                                onClick={() => {
                                  setEditingDomainId(item.id);
                                  setRelinkTemplateId(item.templateId);
                                }}
                                style={{
                                  background: "none", border: "none", cursor: "pointer",
                                  fontSize: "0.75rem", color: "var(--brand)", fontWeight: 600, padding: 0
                                }}
                              >
                                Change
                              </button>
                            </div>
                          )}
                        </td>
                        <td style={{ padding: "1.1rem 1.5rem" }}>
                          {item.type === "SUBDOMAIN" ? (
                            <span style={{ color: "#10b981", display: "inline-flex", alignItems: "center", gap: "0.3rem", fontWeight: 500 }}>
                              <IconCheck /> Active
                            </span>
                          ) : (
                            <div>
                              {dns === undefined ? (
                                <button
                                  onClick={() => void handleVerifyDns(item.domain)}
                                  className="btn-secondary"
                                  style={{ padding: "0.25rem 0.6rem", fontSize: "0.75rem", borderRadius: 6 }}
                                >
                                  Check DNS
                                </button>
                              ) : dns.checking ? (
                                <span style={{ color: "rgba(240,242,255,0.35)", fontSize: "0.75rem" }}>Verifying…</span>
                              ) : dns.valid ? (
                                <span style={{ color: "#10b981", display: "inline-flex", alignItems: "center", gap: "0.3rem", fontWeight: 500 }}>
                                  <IconCheck /> Verified
                                </span>
                              ) : (
                                <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
                                  <span style={{ color: "#f59e0b", display: "inline-flex", alignItems: "center", gap: "0.3rem", fontWeight: 500 }}>
                                    <IconAlert /> DNS Warning
                                  </span>
                                  <button
                                    onClick={() => void handleVerifyDns(item.domain)}
                                    style={{
                                      background: "none", border: "none", cursor: "pointer",
                                      fontSize: "0.75rem", color: "var(--brand)", textDecoration: "underline", padding: 0, textAlign: "left"
                                    }}
                                  >
                                    Re-verify
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: "1.1rem 1.5rem", textAlign: "right" }}>
                          <button
                            onClick={() => void handleDeleteDomain(item.id, item.domain)}
                            title="Unpublish Domain"
                            style={{
                              background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.12)",
                              cursor: "pointer", borderRadius: 8, padding: "0.4rem", color: "#f87171",
                              transition: "background 0.15s, border-color 0.15s",
                              display: "inline-flex", alignItems: "center", justifyContent: "center"
                            }}
                            className="unpublish-btn"
                          >
                            <IconTrash />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ─── LINK DOMAIN RIGHT-SIDE DRAWER ────────────────────────── */}
      {isDrawerOpen && (
        <>
          {/* Backdrop Overlay */}
          <div
            onClick={() => setIsDrawerOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0, 0, 0, 0.4)",
              backdropFilter: "blur(4px)",
              zIndex: 9998,
              animation: "fade-in 0.25s ease"
            }}
          />
          {/* Drawer Panel */}
          <div
            style={{
              position: "fixed",
              top: 0,
              right: 0,
              bottom: 0,
              width: "100%",
              maxWidth: "500px",
              background: "rgba(18,16,36,0.98)",
              backdropFilter: "blur(20px)",
              borderLeft: "1px solid rgba(255,255,255,0.08)",
              boxShadow: "-10px 0 40px rgba(0,0,0,0.5)",
              zIndex: 9999,
              padding: "2.5rem 2.2rem",
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: "1.5rem",
              animation: "slide-in-drawer 0.25s cubic-bezier(0.16, 1, 0.3, 1)"
            }}
          >
            {/* Drawer Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: "1rem" }}>
              <div>
                <h3 style={{ fontSize: "1.15rem", fontWeight: 800, color: "#f0f2ff", margin: 0 }}>
                  Link Subdomain or Domain
                </h3>
                <p style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.4)", margin: "0.25rem 0 0" }}>
                  Map subdomains or custom domains to your landing pages.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsDrawerOpen(false)}
                style={{
                  background: "none", border: "none", cursor: "pointer", fontSize: "1.3rem", color: "rgba(240,242,255,0.35)",
                  padding: "0.25rem", transition: "color 0.15s", lineHeight: 1
                }}
                className="domain-link-hover"
              >
                ✕
              </button>
            </div>

            {/* Linkage Setup Form */}
            <form onSubmit={handleAddDomain} style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
              {/* Domain Type Selection */}
              <div>
                <span className="field-label" style={{ display: "block", marginBottom: "0.4rem" }}>Domain Type</span>
                <div style={{ display: "flex", background: "rgba(255,255,255,0.04)", padding: 3, borderRadius: 8, gap: 2, maxWidth: 300 }}>
                  <button
                    type="button"
                    onClick={() => setDomainType("SUBDOMAIN")}
                    style={{
                      flex: 1, padding: "0.4rem", fontSize: "0.8rem", fontWeight: 600, border: "none", cursor: "pointer", borderRadius: 6,
                      background: domainType === "SUBDOMAIN" ? "var(--brand)" : "transparent",
                      color: domainType === "SUBDOMAIN" ? "#fff" : "rgba(240,242,255,0.55)",
                      transition: "background 0.15s, color 0.15s"
                    }}
                  >
                    Subdomain
                  </button>
                  <button
                    type="button"
                    aria-disabled={!canUseCustomDomain}
                    onClick={() => {
                      if (!canUseCustomDomain) {
                        void startUpgradeCheckout();
                        return;
                      }
                      setDomainType("CUSTOM");
                    }}
                    style={{
                      flex: 1, padding: "0.4rem", fontSize: "0.8rem", fontWeight: 600, border: "none", borderRadius: 6,
                      cursor: upgradeRedirecting ? "default" : "pointer",
                      background: domainType === "CUSTOM" ? "var(--brand)" : "transparent",
                      color: domainType === "CUSTOM" ? "#fff" : canUseCustomDomain ? "rgba(240,242,255,0.55)" : "rgba(240,242,255,0.3)",
                      transition: "background 0.15s, color 0.15s"
                    }}
                  >
                    {upgradeRedirecting ? "Redirecting…" : "Custom Domain"}
                    {!canUseCustomDomain && (
                      <span style={{
                        marginLeft: 6, fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.05em",
                        textTransform: "uppercase", color: "var(--brand)", background: "var(--brand-subtle)",
                        padding: "0.1rem 0.4rem", borderRadius: 4,
                      }}>
                        Pro
                      </span>
                    )}
                  </button>
                </div>
                {!canUseCustomDomain && (
                  <p style={{ fontSize: "0.72rem", color: "rgba(240,242,255,0.4)", marginTop: "0.4rem" }}>
                    Custom domains require a Pro or Ultra plan — click "Custom Domain" to upgrade.
                  </p>
                )}
              </div>

              {/* Input fields based on type */}
              {domainType === "SUBDOMAIN" ? (
                <div>
                  <label htmlFor="subdomain-input" className="field-label">Configure Subdomain</label>
                  <div style={{ display: "flex", alignItems: "stretch", marginTop: "0.35rem" }}>
                    <input
                      id="subdomain-input"
                      type="text"
                      placeholder="my-company"
                      value={subdomainPrefix}
                      onChange={(e) => setSubdomainPrefix(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                      className="field-input"
                      style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0, flex: 1 }}
                    />
                    <span style={{
                      background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                      borderLeft: "none", borderTopRightRadius: 8, borderBottomRightRadius: 8,
                      display: "flex", alignItems: "center", padding: "0 0.75rem", fontSize: "0.8rem",
                      color: "rgba(240,242,255,0.45)", fontWeight: 550
                    }}>
                      .{baseDomain === "localhost" ? "localhost" : baseDomain}
                    </span>
                  </div>
                  <p style={{ fontSize: "0.72rem", color: "rgba(240,242,255,0.3)", marginTop: "0.35rem" }}>
                    Only letters, numbers, and hyphens.
                  </p>
                </div>
              ) : (
                <div>
                  <label htmlFor="custom-domain-input" className="field-label">Custom Domain Name</label>
                  <input
                    id="custom-domain-input"
                    type="text"
                    placeholder="landing.mycompany.com"
                    value={customDomainInput}
                    onChange={(e) => setCustomDomainInput(e.target.value.toLowerCase().trim())}
                    className="field-input"
                    style={{ marginTop: "0.35rem" }}
                  />
                  {/* DNS Info */}
                  <div style={{
                    marginTop: "0.75rem", padding: "0.85rem", background: "rgba(139,92,246,0.03)",
                    border: "1px solid rgba(139,92,246,0.12)", borderRadius: 10, fontSize: "0.75rem",
                    color: "rgba(240,242,255,0.7)", lineHeight: 1.45
                  }}>
                    <p style={{ fontWeight: 700, color: "#a5b4fc", marginBottom: "0.5rem" }}>
                      ⚙️ DNS Setup Instructions
                    </p>
                    <p style={{ fontSize: "0.72rem", color: "rgba(240, 242, 255, 0.45)", marginBottom: "0.75rem" }}>
                      Log into your domain registrar (GoDaddy, Namecheap, Cloudflare, etc.) and add this record to your DNS settings:
                    </p>
                    
                    <div style={{ background: "rgba(0,0,0,0.25)", borderRadius: 8, padding: "0.6rem 0.75rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: "0.35rem", fontSize: "0.68rem", fontWeight: 700, textTransform: "uppercase", color: "rgba(240,242,255,0.3)" }}>
                        <span style={{ width: "25%" }}>Record Type</span>
                        <span style={{ width: "35%" }}>Name / Host</span>
                        <span style={{ width: "40%", textAlign: "right" }}>Target / Value</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "monospace", fontSize: "0.72rem", alignItems: "center" }}>
                        <span style={{ width: "25%", color: "#c4b5fd", fontWeight: 600 }}>
                          CNAME
                        </span>
                        <span style={{ width: "35%", color: "#f0f2ff", fontWeight: 600, display: "flex", alignItems: "center", gap: "0.25rem" }}>
                          {dnsHostLabel}
                          <button
                            type="button"
                            onClick={() => handleCopy(dnsHostLabel, 'host')}
                            style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: "rgba(240,242,255,0.35)", display: "inline-flex", alignSelf: "center" }}
                            title="Copy Host"
                          >
                            {copiedField === 'host' ? "✓" : <IconCopy />}
                          </button>
                        </span>
                        <span style={{ width: "40%", color: "var(--brand)", fontWeight: 600, textAlign: "right", wordBreak: "break-all", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "0.25rem" }}>
                          {DNS_CNAME_TARGET}
                          <button
                            type="button"
                            onClick={() => handleCopy(DNS_CNAME_TARGET, 'target')}
                            style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: "rgba(240,242,255,0.35)", display: "inline-flex", alignSelf: "center" }}
                            title="Copy Target"
                          >
                            {copiedField === 'target' ? "✓" : <IconCopy />}
                          </button>
                        </span>
                      </div>
                    </div>
                    <p style={{ fontSize: "0.68rem", color: "rgba(240,242,255,0.35)", marginTop: "0.6rem", fontStyle: "italic", margin: "0.6rem 0 0" }}>
                      * DNS changes can take anywhere from a few minutes up to 24 hours to take effect worldwide.
                    </p>
                  </div>
                </div>
              )}

              {/* Template select dropdown */}
              <div>
                <label htmlFor="template-select" className="field-label">Link to Landing Page</label>
                <div style={{ marginTop: "0.35rem" }}>
                  <CustomSelect
                    value={selectedTemplateId}
                    onChange={(val) => setSelectedTemplateId(val)}
                    options={templateOptions}
                  />
                </div>
              </div>

              {/* Error / Success messages */}
              {errorMsg && (
                <p style={{ fontSize: "0.8rem", color: "#f87171", margin: 0 }}>
                  ⚠️ {errorMsg}
                </p>
              )}

              {successMsg && (
                <p style={{ fontSize: "0.8rem", color: "#34d399", margin: 0 }}>
                  ✓ {successMsg}
                </p>
              )}

              <button
                type="submit"
                disabled={isSubmitting || landingPages.length === 0 || count >= limit}
                className="btn-primary"
                style={{
                  width: "100%", padding: "0.65rem", display: "inline-flex", alignItems: "center",
                  justifyContent: "center", gap: "0.4rem", marginTop: "0.5rem", borderRadius: 9,
                  background: "linear-gradient(135deg,var(--brand),var(--brand-deep))", border: "none",
                  fontWeight: 700, fontSize: "0.875rem", color: "#fff", cursor: "pointer"
                }}
              >
                {isSubmitting ? (
                  <span className="spinner" style={{ width: 13, height: 13 }} />
                ) : (
                  <IconPlus />
                )}
                {isSubmitting ? "Linking..." : count >= limit ? "Domain Limit Reached" : "Link Domain"}
              </button>
            </form>
          </div>
        </>
      )}

      {/* ─── CUSTOM DELETE CONFIRMATION MODAL ───────────────────── */}
      {deleteConfirmInfo && (
        <>
          <div
            onClick={() => setDeleteConfirmInfo(null)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0, 0, 0, 0.6)",
              backdropFilter: "blur(6px)",
              zIndex: 10000,
              animation: "fade-in 0.2s ease"
            }}
          />
          <div
            style={{
              position: "fixed",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: "100%",
              maxWidth: "420px",
              background: "rgba(22, 20, 44, 0.95)",
              backdropFilter: "blur(20px)",
              border: "1px solid rgba(239, 68, 68, 0.25)",
              borderRadius: 16,
              padding: "2rem",
              boxShadow: "0 20px 50px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(239, 68, 68, 0.1)",
              zIndex: 10001,
              animation: "scale-up 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              textAlign: "center",
              gap: "1.5rem"
            }}
          >
            <div style={{
              width: 48, height: 48, borderRadius: "50%",
              background: "rgba(239, 68, 68, 0.1)",
              display: "grid", placeItems: "center", flexShrink: 0
            }}>
              <span style={{ color: "#ef4444", fontSize: "1.3rem", fontWeight: 700 }}>⚠️</span>
            </div>

            <div>
              <h3 style={{ fontSize: "1.15rem", fontWeight: 800, color: "#f0f2ff", margin: 0 }}>
                Unpublish Domain?
              </h3>
              <p style={{ fontSize: "0.85rem", color: "rgba(240, 242, 255, 0.6)", margin: "0.6rem 0 0", lineHeight: 1.5 }}>
                Are you sure you want to unpublish and delete mapping for <code style={{ color: "#f87171", background: "rgba(239, 68, 68, 0.1)", padding: "0.1rem 0.3rem", borderRadius: 4, fontFamily: "monospace" }}>{deleteConfirmInfo.domain}</code>? Visitors will no longer be able to access the linked landing page through this domain.
              </p>
            </div>

            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", width: "100%", marginTop: "0.25rem" }}>
              <button
                type="button"
                onClick={() => setDeleteConfirmInfo(null)}
                style={{
                  flex: 1, padding: "0.6rem", borderRadius: 9, fontSize: "0.85rem", fontWeight: 600,
                  background: "none", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(240,242,255,0.7)", cursor: "pointer",
                  fontFamily: "inherit"
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void executeDeleteDomain()}
                style={{
                  flex: 1, padding: "0.6rem", borderRadius: 9, fontSize: "0.85rem", fontWeight: 700,
                  background: "linear-gradient(135deg, #ef4444, #b91c1c)",
                  color: "#fff", border: "none", cursor: "pointer",
                  boxShadow: "0 4px 14px rgba(239, 68, 68, 0.3)",
                  fontFamily: "inherit"
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </>
      )}

      {/* ─── CUSTOM ALERT DIALOG ────────────────────────────────── */}
      {customAlertInfo && (
        <>
          <div
            onClick={() => setCustomAlertInfo(null)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0, 0, 0, 0.6)",
              backdropFilter: "blur(6px)",
              zIndex: 10000,
              animation: "fade-in 0.2s ease"
            }}
          />
          <div
            style={{
              position: "fixed",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: "100%",
              maxWidth: "400px",
              background: "rgba(22, 20, 44, 0.95)",
              backdropFilter: "blur(20px)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: 16,
              padding: "2rem",
              boxShadow: "0 20px 50px rgba(0, 0, 0, 0.6)",
              zIndex: 10001,
              animation: "scale-up 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "1.25rem",
              textAlign: "center"
            }}
          >
            <div style={{
              width: 48, height: 48, borderRadius: "50%",
              background: "rgba(139, 92, 246, 0.1)",
              display: "grid", placeItems: "center", margin: "0 auto"
            }}>
              <span style={{ fontSize: "1.3rem" }}>ℹ️</span>
            </div>
            <div>
              <h3 style={{ fontSize: "1.1rem", fontWeight: 800, color: "#f0f2ff", margin: 0 }}>
                {customAlertInfo.title}
              </h3>
              <p style={{ fontSize: "0.85rem", color: "rgba(240, 242, 255, 0.6)", margin: "0.5rem 0 0", lineHeight: 1.5 }}>
                {customAlertInfo.message}
              </p>
            </div>

            <button
              type="button"
              onClick={() => setCustomAlertInfo(null)}
              style={{
                width: "100%", padding: "0.6rem", borderRadius: 9, fontWeight: 700, fontSize: "0.85rem",
                background: "linear-gradient(135deg,var(--brand),var(--brand-deep))",
                color: "#fff", border: "none", cursor: "pointer", marginTop: "0.25rem",
                fontFamily: "inherit"
              }}
            >
              OK
            </button>
          </div>
        </>
      )}

      <style jsx global>{`
        .domain-link-hover:hover {
          color: var(--brand) !important;
        }
        .spinner {
          border: 2px solid rgba(255,255,255,0.3);
          border-top-color: #fff;
          border-radius: 50%;
          width: 12px;
          height: 12px;
          animation: spin-anim 0.65s linear infinite;
        }
        @keyframes spin-anim {
          to { transform: rotate(360deg); }
        }
        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes scale-up {
          from { transform: translate(-50%, -45%) scale(0.95); opacity: 0; }
          to { transform: translate(-50%, -50%) scale(1); opacity: 1; }
        }
        @keyframes slide-in-drawer {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </>
  );
}
