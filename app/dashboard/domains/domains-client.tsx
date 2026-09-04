"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { getStripePromise } from "@/lib/stripeClientPromise";
import { CustomSelect } from "../../_components/CustomSelect";

// Fallback only — real value comes from GET /api/v1/domains's routingEndpoint (see the
// `routingEndpoint` state below). CloudFront SaaS Manager's connection-group endpoint is
// a real per-environment value (cdk/lib/published-sites-stack.ts), not a fixed platform-
// wide constant the way Vercel's "cname.vercel-dns.com" was — shown only for the instant
// before that fetch resolves.
const DNS_CNAME_TARGET_FALLBACK = "connecting…";

type DomainType = "SUBDOMAIN" | "CUSTOM" | "BUY";

// Present only on a domain bought through Plexo (RegisteredDomain, lib/db/contentEntities.ts)
// — joined onto its PublishedDomain row server-side (page.tsx) and on every client-side
// refresh (GET /api/v1/domains). A manually-connected CUSTOM domain never has this.
type DomainRegistration = {
  status: string;
  renewalDate?: string;
  renewalPriceUsdCents?: number;
  autoRenew?: boolean;
  whoisPrivacyEnabled?: boolean;
  transferLocked?: boolean;
  paymentMethod?: "WALLET" | "STRIPE";
};

type DomainRecord = {
  id: string;
  domain: string;
  type: DomainType;
  templateId: string;
  templateName: string;
  createdAt: string;
  dnsVerified?: boolean;
  dnsVerifiedAt?: string | null;
  // CUSTOM domains only — kept current by lib/lambda/certificateAttachment.ts's scheduled
  // check, not by this page loading (see app/api/v1/domains/route.ts's own GET comment).
  certificateStatus?: "PENDING_VALIDATION" | "ISSUED" | "ATTACHED" | "FAILED";
  certificateValidationName?: string;
  certificateValidationValue?: string;
  noindex?: boolean;
  registration?: DomainRegistration;
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

function IconClose() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function IconSettingsGear() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function IconWarningLarge({ width = 22, height = 22 }: { width?: number; height?: number }) {
  return (
    <svg width={width} height={height} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.5" y2="16.5" />
    </svg>
  );
}

function IconWallet() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" /><path d="M18 12a2 2 0 0 0 0 4h4v-4z" />
    </svg>
  );
}

function IconCard() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="15" rx="2.5" /><line x1="2" y1="10" x2="22" y2="10" />
    </svg>
  );
}

function IconInfo() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
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
  const searchParams = useSearchParams();
  const [domains, setDomains] = useState<DomainRecord[]>(initialDomains);
  // NEXT_PUBLIC_ vars are inlined into the client bundle at build time, so this is
  // correct on first paint with no hardcoded domain guess and no flash of a stale
  // value before the /api/v1/domains fetch below confirms it server-side.
  const [baseDomain, setBaseDomain] = useState<string>(process.env.NEXT_PUBLIC_PAGES_DOMAIN || "localhost");
  const [dnsCnameTarget, setDnsCnameTarget] = useState<string>(DNS_CNAME_TARGET_FALLBACK);
  // Populated from the POST response right after adding a CUSTOM domain — the certificate
  // validation record this app's own ACM certificate request needs (see
  // lib/cloudfrontDomains.ts's own comment on why this replaced CloudFront's built-in
  // ManagedCertificateRequest mechanism). Already-added pending domains show their own
  // stored copy of this straight from the domains list (see DomainRecord's
  // certificateValidationName/Value) instead of this transient form-local state.
  const [justAddedCertValidation, setJustAddedCertValidation] = useState<{ name: string; value: string } | null>(null);
  const [count, setCount] = useState<number>(initialDomains.length);
  const [limit, setLimit] = useState<number>(25);

  const [copiedField, setCopiedField] = useState<string | null>(null);

  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [managingDomain, setManagingDomain] = useState<DomainRecord | null>(null);

  async function refreshDomains(): Promise<void> {
    const res = await fetch("/api/v1/domains");
    const data = await res.json();
    if (data.domains) {
      setDomains(data.domains.map((d: any) => ({
        id: d.id,
        domain: d.domain,
        type: d.type,
        templateId: d.templateId,
        templateName: d.template?.name ?? "Unknown",
        createdAt: d.createdAt,
        dnsVerified: d.dnsVerified,
        dnsVerifiedAt: d.dnsVerifiedAt,
        certificateStatus: d.certificateStatus,
        certificateValidationName: d.certificateValidationName,
        certificateValidationValue: d.certificateValidationValue,
        noindex: d.noindex,
        registration: d.registration,
      })));
    }
    if (data.count !== undefined) setCount(data.count);
  }

  // A returning Stripe embedded-checkout redirect (app/api/v1/domains/purchase/route.ts's
  // return_url) lands back here with these params — reopen the Link Domain drawer straight
  // onto the Buy tab's progress step rather than leaving the purchase's outcome invisible.
  const [resumedPurchase, setResumedPurchase] = useState<{ registeredDomainId: string; templateId: string } | null>(null);
  useEffect(() => {
    const registeredDomainId = searchParams.get("registeredDomainId");
    const templateId = searchParams.get("templateId");
    const sessionId = searchParams.get("session_id");
    if (registeredDomainId && templateId && sessionId) {
      setResumedPurchase({ registeredDomainId, templateId });
      setDomainType("BUY");
      setIsDrawerOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [deleteConfirmInfo, setDeleteConfirmInfo] = useState<{ id: string; domain: string } | null>(null);
  const [customAlertInfo, setCustomAlertInfo] = useState<{ title: string; message: string } | null>(null);

  const canUseCustomDomain = plan === "PRO" || plan === "ULTRA";
  const [upgradeRedirecting, setUpgradeRedirecting] = useState(false);

  // Custom domains are a Pro/Ultra feature — a FREE user clicking this should be offered a
  // seamless path to upgrade rather than just sitting on an inert disabled control. Rather
  // than start embedded Checkout here directly, hand off to the Subscription settings page
  // (?upgrade=PRO triggers the same startCheckout flow there automatically on arrival) —
  // that's the one place already wired for EmbeddedCheckoutProvider's clientSecret flow;
  // this used to call POST /api/billing/checkout directly and expect back a `url` to
  // redirect to, which was the OLDER hosted-Checkout response shape — that route now
  // always creates an embedded-mode session (ui_mode: "embedded_page") and only ever
  // returns `clientSecret`, never `url`, so this unconditionally failed.
  function startUpgradeCheckout(): void {
    setUpgradeRedirecting(true);
    window.location.href = "/dashboard/settings/subscription?upgrade=PRO";
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

  // Deep-linked from a site's own Detail page ("Connect Domain" / "Manage Domain") — pick
  // that site in the connect form, and if it has no domain yet, open the drawer straight to
  // it instead of leaving the visitor to find the right one in the dropdown themselves.
  useEffect(() => {
    const templateId = searchParams.get("templateId");
    if (!templateId || !landingPages.some((lp) => lp.id === templateId)) return;
    setSelectedTemplateId(templateId);
    const alreadyConnected = initialDomains.some((d) => d.templateId === templateId);
    if (!alreadyConnected) setIsDrawerOpen(true);
    // Intentionally run once on mount — this is a one-time deep-link handoff, not a live
    // sync with the URL (the drawer/dropdown are then free to be user-driven as normal).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
        if (data.routingEndpoint) setDnsCnameTarget(data.routingEndpoint);
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
    setJustAddedCertValidation(null);

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

      const isCustom = payload.domain?.type === "CUSTOM";
      setSuccessMsg(
        isCustom
          ? "Domain added — add the DNS records below, then this finishes automatically. No need to resubmit."
          : "Domain published successfully!"
      );
      if (isCustom && payload.domain?.certificateValidationName && payload.domain?.certificateValidationValue) {
        setJustAddedCertValidation({ name: payload.domain.certificateValidationName, value: payload.domain.certificateValidationValue });
      }
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
          certificateStatus: d.certificateStatus,
          certificateValidationName: d.certificateValidationName,
          certificateValidationValue: d.certificateValidationValue,
        })));
      }
      if (updatedData.count !== undefined) setCount(updatedData.count);

      // CUSTOM domains keep the drawer open with the DNS instructions visible — the
      // customer needs to actually copy these, not just glance at a toast before it closes.
      setTimeout(() => {
        setSuccessMsg(null);
        if (!isCustom) setIsDrawerOpen(false);
      }, isCustom ? 6000 : 1500);
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

  async function handleToggleNoindex(domainId: string, nextNoindex: boolean) {
    // Optimistic — this is a cosmetic per-domain toggle, not worth a loading state.
    setDomains((prev) => prev.map((d) => (d.id === domainId ? { ...d, noindex: nextNoindex } : d)));
    try {
      const response = await fetch("/api/v1/domains", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: domainId, noindex: nextNoindex }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? "Failed to update search engine visibility.");
      }
    } catch (error) {
      setDomains((prev) => prev.map((d) => (d.id === domainId ? { ...d, noindex: !nextNoindex } : d)));
      setCustomAlertInfo({
        title: "Update Failed",
        message: error instanceof Error ? error.message : "Failed to update search engine visibility.",
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
                <span style={{ display: "flex" }}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="2" y1="12" x2="22" y2="12" />
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                  </svg>
                </span>
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
                          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                            <span style={{
                              fontSize: "0.72rem", padding: "0.2rem 0.5rem", borderRadius: 999, fontWeight: 700,
                              background: item.type === "SUBDOMAIN" ? "rgba(99,102,241,0.08)" : "rgba(236,72,153,0.08)",
                              color: item.type === "SUBDOMAIN" ? "#818cf8" : "#f472b6",
                              border: `1px solid ${item.type === "SUBDOMAIN" ? "rgba(99,102,241,0.15)" : "rgba(236,72,153,0.15)"}`
                            }}>
                              {item.type}
                            </span>
                            {item.registration && (
                              <span style={{
                                fontSize: "0.72rem", padding: "0.2rem 0.5rem", borderRadius: 999, fontWeight: 700,
                                background: "var(--brand-subtle)", color: "var(--brand)",
                                border: "1px solid var(--brand-glow)",
                              }}>
                                Plexo-managed
                              </span>
                            )}
                          </div>
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
                              {/* Certificate/tenant status — kept current by
                                  lib/lambda/certificateAttachment.ts's scheduled check, not
                                  by this page loading. Separate from the DNS check below,
                                  which only verifies the routing CNAME resolves; a domain
                                  can pass that and still be certificate-pending. */}
                              {item.certificateStatus && item.certificateStatus !== "ATTACHED" && (
                                <div style={{ marginBottom: "0.4rem" }}>
                                  {item.certificateStatus === "PENDING_VALIDATION" || item.certificateStatus === "ISSUED" ? (
                                    <span style={{ color: "#f59e0b", display: "inline-flex", alignItems: "center", gap: "0.3rem", fontWeight: 500, fontSize: "0.75rem" }}>
                                      Certificate pending
                                    </span>
                                  ) : (
                                    <span style={{ color: "#f87171", display: "inline-flex", alignItems: "center", gap: "0.3rem", fontWeight: 500, fontSize: "0.75rem" }}>
                                      <IconAlert /> Certificate failed
                                    </span>
                                  )}
                                  {item.certificateStatus === "PENDING_VALIDATION" && item.certificateValidationName && item.certificateValidationValue && (
                                    <div style={{ fontFamily: "monospace", fontSize: "0.68rem", color: "rgba(240,242,255,0.4)", marginTop: "0.2rem", wordBreak: "break-all" }}>
                                      CNAME {item.certificateValidationName} → {item.certificateValidationValue}
                                    </div>
                                  )}
                                </div>
                              )}
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
                          {item.registration && (
                            <button
                              onClick={() => setManagingDomain(item)}
                              title="Manage domain settings"
                              style={{
                                background: "var(--surface)", border: "1px solid var(--surface-border)",
                                cursor: "pointer", borderRadius: 8, padding: "0.4rem", color: "var(--text-muted)",
                                display: "inline-flex", alignItems: "center", justifyContent: "center", marginRight: "0.5rem",
                              }}
                            >
                              <IconSettingsGear />
                            </button>
                          )}
                          <button
                            onClick={() => void handleToggleNoindex(item.id, !item.noindex)}
                            title={item.noindex ? "Hidden from search engines — click to make indexable" : "Indexable — click to hide from search engines"}
                            style={{
                              background: item.noindex ? "rgba(245,158,11,0.08)" : "rgba(255,255,255,0.03)",
                              border: `1px solid ${item.noindex ? "rgba(245,158,11,0.18)" : "rgba(255,255,255,0.06)"}`,
                              cursor: "pointer", borderRadius: 8, padding: "0.4rem 0.6rem",
                              color: item.noindex ? "#f59e0b" : "rgba(240,242,255,0.4)",
                              fontSize: "0.72rem", fontWeight: 650, marginRight: "0.5rem",
                              display: "inline-flex", alignItems: "center", gap: "0.3rem"
                            }}
                          >
                            {item.noindex ? "Noindex" : "Indexed"}
                          </button>
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
              maxWidth: "620px",
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
                  background: "none", border: "none", cursor: "pointer", color: "rgba(240,242,255,0.35)",
                  padding: "0.25rem", transition: "color 0.15s", lineHeight: 1, display: "flex", alignItems: "center"
                }}
                className="domain-link-hover"
              >
                <IconClose />
              </button>
            </div>

            {/* Linkage Setup Form */}
            <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
              {/* Domain Type Selection */}
              <div>
                <span className="field-label" style={{ display: "block", marginBottom: "0.4rem" }}>Domain Type</span>
                <div style={{ display: "flex", background: "rgba(255,255,255,0.04)", padding: 4, borderRadius: 10, gap: 4, overflowX: "auto" }}>
                  <button
                    type="button"
                    onClick={() => setDomainType("SUBDOMAIN")}
                    style={{
                      flex: "1 1 0", padding: "0.55rem 0.9rem", fontSize: "0.8rem", fontWeight: 600, border: "none", cursor: "pointer", borderRadius: 7,
                      whiteSpace: "nowrap",
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
                      flex: "1 1 0", padding: "0.55rem 0.9rem", fontSize: "0.8rem", fontWeight: 600, border: "none", borderRadius: 7,
                      cursor: upgradeRedirecting ? "default" : "pointer",
                      whiteSpace: "nowrap",
                      background: domainType === "CUSTOM" ? "var(--brand)" : "transparent",
                      color: domainType === "CUSTOM" ? "#fff" : canUseCustomDomain ? "rgba(240,242,255,0.55)" : "rgba(240,242,255,0.3)",
                      transition: "background 0.15s, color 0.15s",
                      display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "0.4rem",
                    }}
                  >
                    {upgradeRedirecting ? "Redirecting…" : "Custom Domain"}
                    {!canUseCustomDomain && (
                      <span style={{
                        fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.05em",
                        textTransform: "uppercase", color: "var(--brand)", background: "var(--brand-subtle)",
                        padding: "0.1rem 0.4rem", borderRadius: 4,
                      }}>
                        Pro
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    aria-disabled={!canUseCustomDomain}
                    onClick={() => {
                      if (!canUseCustomDomain) {
                        void startUpgradeCheckout();
                        return;
                      }
                      setDomainType("BUY");
                    }}
                    style={{
                      flex: "1 1 0", padding: "0.55rem 0.9rem", fontSize: "0.8rem", fontWeight: 600, border: "none", borderRadius: 7,
                      cursor: upgradeRedirecting ? "default" : "pointer",
                      whiteSpace: "nowrap",
                      background: domainType === "BUY" ? "var(--brand)" : "transparent",
                      color: domainType === "BUY" ? "#fff" : canUseCustomDomain ? "rgba(240,242,255,0.55)" : "rgba(240,242,255,0.3)",
                      transition: "background 0.15s, color 0.15s",
                      display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "0.4rem",
                    }}
                  >
                    <IconSearch /> {upgradeRedirecting ? "Redirecting…" : "Buy a Domain"}
                    {!canUseCustomDomain && (
                      <span style={{
                        fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.05em",
                        textTransform: "uppercase", color: "var(--brand)", background: "var(--brand-subtle)",
                        padding: "0.1rem 0.4rem", borderRadius: 4,
                      }}>
                        Pro
                      </span>
                    )}
                  </button>
                </div>
                {!canUseCustomDomain && domainType === "CUSTOM" && (
                  <p style={{ fontSize: "0.72rem", color: "rgba(240,242,255,0.4)", marginTop: "0.4rem" }}>
                    Custom domains require a Pro or Ultra plan — click "Custom Domain" to upgrade.
                  </p>
                )}
                {!canUseCustomDomain && domainType === "BUY" && (
                  <p style={{ fontSize: "0.72rem", color: "rgba(240,242,255,0.4)", marginTop: "0.4rem" }}>
                    Buying a domain requires a Pro or Ultra plan — click "Buy a Domain" to upgrade.
                  </p>
                )}
              </div>

              {/* Which site this domain is for — chosen once here, shared by all three
                  domain types (including Buy) so the purchase flow below never has to ask
                  again. */}
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

              {domainType === "BUY" ? (
                <BuyDomainFlow
                  templateId={selectedTemplateId}
                  resumedPurchase={resumedPurchase}
                  onPurchased={() => void refreshDomains()}
                />
              ) : (
              <form onSubmit={handleAddDomain} style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
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
                    <p style={{ fontWeight: 700, color: "#a5b4fc", marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                      <IconSettingsGear /> DNS Setup Instructions
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
                            {copiedField === 'host' ? <IconCheck /> : <IconCopy />}
                          </button>
                        </span>
                        <span style={{ width: "40%", color: "var(--brand)", fontWeight: 600, textAlign: "right", wordBreak: "break-all", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "0.25rem" }}>
                          {dnsCnameTarget}
                          <button
                            type="button"
                            onClick={() => handleCopy(dnsCnameTarget, 'target')}
                            style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: "rgba(240,242,255,0.35)", display: "inline-flex", alignSelf: "center" }}
                            title="Copy Target"
                          >
                            {copiedField === 'target' ? <IconCheck /> : <IconCopy />}
                          </button>
                        </span>
                      </div>
                    </div>
                    <p style={{ fontSize: "0.68rem", color: "rgba(240,242,255,0.45)", marginTop: "0.6rem", margin: "0.6rem 0 0" }}>
                      After you submit, we'll also give you a certificate validation record to add — that one's unique to your domain, so it isn't shown until then.
                    </p>
                    <p style={{ fontSize: "0.68rem", color: "rgba(240,242,255,0.35)", marginTop: "0.6rem", fontStyle: "italic", margin: "0.6rem 0 0" }}>
                      * DNS changes can take anywhere from a few minutes up to 24 hours to take effect worldwide.
                    </p>
                  </div>

                  {/* Shown right after submitting — the certificate validation record is
                      unique per domain, generated only once the backend actually requests
                      the certificate (see app/api/v1/domains/route.ts's POST handler), so
                      it can't be shown proactively the way the routing CNAME above can. */}
                  {justAddedCertValidation && (
                    <div style={{
                      marginTop: "0.75rem", padding: "0.85rem", background: "rgba(52,211,153,0.05)",
                      border: "1px solid rgba(52,211,153,0.2)", borderRadius: 10, fontSize: "0.75rem",
                      color: "rgba(240,242,255,0.7)", lineHeight: 1.45
                    }}>
                      <p style={{ fontWeight: 700, color: "#34d399", marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                        <IconCheck /> Certificate Validation Record
                      </p>
                      <p style={{ fontSize: "0.72rem", color: "rgba(240, 242, 255, 0.45)", marginBottom: "0.75rem" }}>
                        Add this CNAME too — it proves you own the domain so we can issue its certificate. Needed for every domain, root or subdomain.
                      </p>
                      <div style={{ background: "rgba(0,0,0,0.25)", borderRadius: 8, padding: "0.6rem 0.75rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "monospace", fontSize: "0.72rem", alignItems: "center" }}>
                          <span style={{ width: "25%", color: "#6ee7b7", fontWeight: 600 }}>CNAME</span>
                          <span style={{ width: "35%", color: "#f0f2ff", fontWeight: 600, display: "flex", alignItems: "center", gap: "0.25rem" }}>
                            {justAddedCertValidation.name}
                            <button
                              type="button"
                              onClick={() => handleCopy(justAddedCertValidation.name, 'certHost')}
                              style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: "rgba(240,242,255,0.35)", display: "inline-flex", alignSelf: "center" }}
                              title="Copy Host"
                            >
                              {copiedField === 'certHost' ? <IconCheck /> : <IconCopy />}
                            </button>
                          </span>
                          <span style={{ width: "40%", color: "#34d399", fontWeight: 600, textAlign: "right", wordBreak: "break-all", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "0.25rem" }}>
                            {justAddedCertValidation.value}
                            <button
                              type="button"
                              onClick={() => handleCopy(justAddedCertValidation.value, 'certValue')}
                              style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: "rgba(240,242,255,0.35)", display: "inline-flex", alignSelf: "center" }}
                              title="Copy Value"
                            >
                              {copiedField === 'certValue' ? <IconCheck /> : <IconCopy />}
                            </button>
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Error / Success messages */}
              {errorMsg && (
                <p style={{ fontSize: "0.8rem", color: "#f87171", margin: 0, display: "flex", alignItems: "center", gap: "0.35rem" }}>
                  <IconWarningLarge width={14} height={14} /> {errorMsg}
                </p>
              )}

              {successMsg && (
                <p style={{ fontSize: "0.8rem", color: "#34d399", margin: 0, display: "flex", alignItems: "center", gap: "0.35rem" }}>
                  <IconCheck /> {successMsg}
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
              )}
            </div>
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
              <span style={{ color: "#ef4444", display: "flex" }}><IconWarningLarge /></span>
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
              display: "grid", placeItems: "center", margin: "0 auto",
              color: "var(--brand)",
            }}>
              <IconInfo />
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

      {managingDomain && (
        <DomainSettingsDrawer
          domain={managingDomain}
          onClose={() => setManagingDomain(null)}
          onUpdated={() => {
            void refreshDomains();
          }}
        />
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
        .skeleton-shimmer {
          background-image: linear-gradient(90deg, var(--surface) 0%, var(--surface-border) 50%, var(--surface) 100%);
          background-size: 200% 100%;
          animation: skeleton-shimmer 1.4s ease-in-out infinite;
        }
        @keyframes skeleton-shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </>
  );
}

// ─── Buy a Domain ──────────────────────────────────────────────────────────
// Same slide-in-drawer shell as the Link Domain drawer above, but built with the theme
// CSS custom properties (var(--bg)/var(--surface)/var(--text-main)/...) from app/globals.css
// instead of that drawer's hardcoded dark-only rgba values, so this new flow follows the
// dashboard's light/dark toggle correctly.

type SearchResult = {
  domain: string;
  registrarKind: "ROUTE53" | "MANUAL";
  available: boolean;
  registrationPriceUsdCents: number | null;
  renewalPriceUsdCents: number | null;
  error?: string;
};

type ContactForm = {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  addressLine1: string;
  city: string;
  countryCode: string;
  zipCode: string;
};

const EMPTY_CONTACT: ContactForm = {
  firstName: "", lastName: "", email: "", phoneNumber: "", addressLine1: "", city: "", countryCode: "", zipCode: "",
};

function formatUsd(cents: number | null): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

function drawerPanelStyle(maxWidth = 500): React.CSSProperties {
  return {
    position: "fixed", top: 0, right: 0, bottom: 0, width: "100%", maxWidth,
    background: "var(--bg)", backdropFilter: "blur(20px)",
    borderLeft: "1px solid var(--surface-border)", boxShadow: "-10px 0 40px rgba(0,0,0,0.25)",
    zIndex: 9999, padding: "2.5rem 2.2rem", overflowY: "auto",
    display: "flex", flexDirection: "column", gap: "1.5rem",
    animation: "slide-in-drawer 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
  };
}

function DrawerHeader({ title, subtitle, onClose }: { title: string; subtitle: string; onClose: () => void }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "1px solid var(--surface-border)", paddingBottom: "1rem" }}>
      <div>
        <h3 style={{ fontSize: "1.15rem", fontWeight: 800, color: "var(--text-main)", margin: 0 }}>{title}</h3>
        <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", margin: "0.25rem 0 0" }}>{subtitle}</p>
      </div>
      <button
        type="button"
        onClick={onClose}
        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "0.25rem", lineHeight: 1, display: "flex", alignItems: "center" }}
      >
        <IconClose />
      </button>
    </div>
  );
}

function BuyDomainFlow({
  templateId,
  resumedPurchase,
  onPurchased,
}: {
  templateId: string;
  resumedPurchase: { registeredDomainId: string; templateId: string } | null;
  onPurchased: () => void;
}) {
  const [step, setStep] = useState<"search" | "review" | "checkout" | "progress">(resumedPurchase ? "progress" : "search");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [contact, setContact] = useState<ContactForm>(EMPTY_CONTACT);
  const [paymentMethod, setPaymentMethod] = useState<"STRIPE" | "WALLET">("STRIPE");
  const [wallet, setWallet] = useState<{ balanceCents: number; currency: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [purchase, setPurchase] = useState<{ registeredDomainId: string; templateId: string; domain: string } | null>(
    resumedPurchase ? { ...resumedPurchase, domain: "" } : null,
  );
  const [progressStatus, setProgressStatus] = useState<string>("PENDING_PAYMENT");
  const [progressDomain, setProgressDomain] = useState<string>("");

  async function handleSearch(e?: React.FormEvent) {
    e?.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/domains/search?q=${encodeURIComponent(query.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Search failed.");
      setResults(data.results ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed.");
    } finally {
      setSearching(false);
    }
  }

  function pickResult(result: SearchResult) {
    setSelected(result);
    setError(null);
    setStep("review");
  }

  // Wallet balance/currency for the payment-method picker below — fetched per selected
  // landing page (Commerce wallets are site-scoped, or org-pooled — see
  // lib/commerce/walletDynamo.ts's resolveCommerceWallet). Silently unavailable (leaves
  // `wallet` null, hiding the option) if the current user lacks Commerce access for this
  // site rather than erroring the whole buy flow over an unrelated permission boundary.
  useEffect(() => {
    if (step !== "review" || !templateId) return;
    let cancelled = false;
    fetch(`/api/v1/commerce/${templateId}/wallet`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.wallet) setWallet({ balanceCents: data.wallet.balanceCents, currency: data.wallet.currency });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [step, templateId]);

  const walletEligible = wallet?.currency === "USD";
  const walletSufficient = walletEligible && selected?.registrationPriceUsdCents != null && wallet!.balanceCents >= selected.registrationPriceUsdCents;

  const contactField = (label: string, key: keyof ContactForm, placeholder = "") => (
    <div>
      <label className="field-label">{label}</label>
      <input
        className="field-input"
        value={contact[key]}
        placeholder={placeholder}
        onChange={(e) => setContact((c) => ({ ...c, [key]: e.target.value }))}
      />
    </div>
  );

  async function handleReviewSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !templateId) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/domains/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId, domain: selected.domain, contact, paymentMethod }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not complete purchase.");
      setPurchase({ registeredDomainId: data.registeredDomainId, templateId, domain: selected.domain });
      if (data.clientSecret) {
        setClientSecret(data.clientSecret);
        setStep("checkout");
      } else {
        // Wallet payment — already debited and activated server-side, no checkout needed.
        setStep("progress");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not complete purchase.");
    } finally {
      setSubmitting(false);
    }
  }

  // Polls the lightweight status endpoint once the drawer reaches "progress" — either right
  // after embedded checkout completes in-page, or on a resumed Stripe return_url redirect
  // (see DomainsClient's own resumedPurchase handling above).
  useEffect(() => {
    if (step !== "progress" || !purchase) return;
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch(`/api/v1/domains/purchase/status?registeredDomainId=${purchase!.registeredDomainId}&templateId=${purchase!.templateId}`);
        const data = await res.json();
        if (cancelled || !res.ok) return;
        setProgressStatus(data.status);
        setProgressDomain(data.domain);
        if (data.status === "ACTIVE" || data.status === "MANUAL_PENDING") {
          onPurchased();
        }
      } catch {
        // transient — try again next tick
      }
    }
    void poll();
    const interval = setInterval(poll, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [step, purchase, onPurchased]);

  const PROGRESS_STEPS: Array<{ statuses: string[]; label: string }> = [
    { statuses: ["PENDING_PAYMENT", "REGISTERING"], label: "Registering your domain" },
    { statuses: ["DNS_PROVISIONING"], label: "Setting up DNS" },
    { statuses: ["CERT_PENDING", "CERT_ISSUED"], label: "Issuing SSL certificate" },
    { statuses: ["TENANT_ATTACHING", "ACTIVE"], label: "Connecting to your site" },
  ];
  const progressIndex = (() => {
    if (progressStatus === "ACTIVE") return PROGRESS_STEPS.length;
    const idx = PROGRESS_STEPS.findIndex((s) => s.statuses.includes(progressStatus));
    return idx === -1 ? 0 : idx;
  })();

  if (!templateId) {
    return (
      <p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
        Create a landing page first — a purchased domain needs somewhere to point.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
      <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", margin: 0 }}>
        Search, buy, and go live — Plexo handles DNS and SSL automatically.
      </p>

        {error && (
          <div style={{ padding: "0.6rem 0.8rem", borderRadius: 8, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#f87171", fontSize: "0.8rem" }}>
            {error}
          </div>
        )}

        {step === "search" && (
          <>
            <form onSubmit={handleSearch} style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <label htmlFor="buy-domain-search" className="field-label">Search for a domain</label>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <input
                  id="buy-domain-search"
                  className="field-input"
                  placeholder="e.g. acmestudio"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  autoFocus
                />
                <button type="submit" className="btn-primary" disabled={searching || !query.trim()} style={{ flexShrink: 0 }}>
                  {searching ? <span className="spinner" /> : <IconSearch />}
                  {searching ? "Searching…" : "Search"}
                </button>
              </div>
              <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", margin: 0 }}>
                We'll check it against popular TLDs (.com, .co, .io, and more) — or type a full domain like "acmestudio.io" to check that one specifically.
              </p>
            </form>

            {searching && (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="skeleton-shimmer"
                    style={{ height: 58, borderRadius: 10, border: "1px solid var(--surface-border)", background: "var(--surface)" }}
                  />
                ))}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {!searching && results.map((r) => (
                <div
                  key={r.domain}
                  style={{
                    display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.75rem 1rem",
                    borderRadius: 10, border: "1px solid var(--surface-border)",
                    background: r.registrarKind === "MANUAL" ? "rgba(245,158,11,0.05)" : "var(--surface)",
                    opacity: r.available ? 1 : 0.5,
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: "0.9rem", color: "var(--text-main)" }}>{r.domain}</div>
                    <div style={{ fontSize: "0.72rem", color: r.registrarKind === "MANUAL" ? "#f59e0b" : "var(--text-muted)" }}>
                      {!r.available ? "Taken" : r.registrarKind === "MANUAL" ? "Not instantly available — registered within 1 business day" : "Available now — instant setup"}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", fontSize: "0.85rem", fontWeight: 700, color: "var(--text-main)" }}>
                    {formatUsd(r.registrationPriceUsdCents)}
                  </div>
                  <button
                    type="button"
                    disabled={!r.available}
                    onClick={() => pickResult(r)}
                    className="btn-primary"
                    style={{ padding: "0.4rem 0.8rem", fontSize: "0.78rem" }}
                  >
                    {r.registrarKind === "MANUAL" ? "Request" : "Choose"}
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {step === "review" && selected && (
          <form onSubmit={handleReviewSubmit} style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
            <div style={{ padding: "0.9rem 1rem", borderRadius: 10, border: "1px solid var(--surface-border)", background: "var(--surface)" }}>
              <div style={{ fontWeight: 700, color: "var(--text-main)" }}>{selected.domain}</div>
              <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>
                {formatUsd(selected.registrationPriceUsdCents)} first year · renews at {formatUsd(selected.renewalPriceUsdCents)}/year
              </div>
            </div>

            <div>
              <span className="field-label" style={{ display: "block", marginBottom: "0.5rem" }}>Registrant Contact</span>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                {contactField("First name", "firstName")}
                {contactField("Last name", "lastName")}
                {contactField("Email", "email")}
                {contactField("Phone (+1.2025551234)", "phoneNumber")}
              </div>
              <div style={{ marginTop: "0.75rem" }}>{contactField("Address", "addressLine1")}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem", marginTop: "0.75rem" }}>
                {contactField("City", "city")}
                {contactField("Country (ISO-2)", "countryCode", "US")}
                {contactField("ZIP / postal", "zipCode")}
              </div>
              <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>
                Used only for the domain's WHOIS record — free privacy protection hides it from public lookup.
              </p>
            </div>

            <div>
              <span className="field-label" style={{ display: "block", marginBottom: "0.5rem" }}>How would you like to pay?</span>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <button
                  type="button"
                  onClick={() => walletSufficient && setPaymentMethod("WALLET")}
                  disabled={!walletSufficient}
                  style={{
                    display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.7rem 0.9rem", borderRadius: 10, textAlign: "left",
                    border: `1.5px solid ${paymentMethod === "WALLET" ? "var(--brand)" : "var(--surface-border)"}`,
                    background: paymentMethod === "WALLET" ? "var(--brand-subtle)" : "var(--surface)",
                    opacity: walletSufficient ? 1 : 0.5, cursor: walletSufficient ? "pointer" : "not-allowed",
                  }}
                >
                  <IconWallet />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: "0.82rem", color: "var(--text-main)" }}>Wallet balance</div>
                    <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
                      {wallet == null
                        ? "Checking…"
                        : !walletEligible
                          ? "Only available for USD wallets"
                          : `${formatUsd(wallet.balanceCents)} available`}
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod("STRIPE")}
                  style={{
                    display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.7rem 0.9rem", borderRadius: 10, textAlign: "left", cursor: "pointer",
                    border: `1.5px solid ${paymentMethod === "STRIPE" ? "var(--brand)" : "var(--surface-border)"}`,
                    background: paymentMethod === "STRIPE" ? "var(--brand-subtle)" : "var(--surface)",
                  }}
                >
                  <IconCard />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: "0.82rem", color: "var(--text-main)" }}>Card via Stripe</div>
                    <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>Pay with any debit or credit card</div>
                  </div>
                </button>
              </div>
            </div>

            <button type="submit" className="btn-primary" disabled={submitting} style={{ padding: "0.65rem", fontSize: "0.875rem" }}>
              {submitting ? <span className="spinner" /> : `Continue — ${formatUsd(selected.registrationPriceUsdCents)}`}
            </button>
          </form>
        )}

        {step === "checkout" && clientSecret && (
          <div style={{ borderRadius: 12, overflow: "hidden", background: "#fff" }}>
            <EmbeddedCheckoutProvider
              stripe={getStripePromise()}
              options={{
                clientSecret,
                onComplete: () => {
                  setStep("progress");
                },
              }}
            >
              <EmbeddedCheckout />
            </EmbeddedCheckoutProvider>
          </div>
        )}

        {step === "progress" && purchase && (
          <div>
            <div style={{ fontWeight: 700, color: "var(--text-main)", marginBottom: "0.25rem" }}>
              Setting up {progressDomain || purchase.domain || "your domain"}
            </div>
            <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "1.25rem" }}>
              This usually takes about a minute. No action needed from you.
            </p>
            {progressStatus === "REGISTRATION_FAILED" ? (
              <div style={{ color: "#f87171", fontSize: "0.85rem" }}>
                Registration failed — you've been automatically refunded. Try a different domain.
              </div>
            ) : progressStatus === "MANUAL_PENDING" ? (
              <div style={{ color: "var(--text-main)", fontSize: "0.85rem" }}>
                Payment received — we'll register this domain within 1 business day and email you once it's live.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {PROGRESS_STEPS.map((s, i) => {
                  const done = i < progressIndex || progressStatus === "ACTIVE";
                  const active = i === progressIndex && progressStatus !== "ACTIVE";
                  return (
                    <div key={s.label} style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                      <div style={{
                        width: 22, height: 22, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center",
                        background: done ? "rgba(16,185,129,0.12)" : active ? "var(--brand-subtle)" : "var(--surface)",
                        color: done ? "#10b981" : "var(--text-muted)",
                      }}>
                        {done ? <IconCheck /> : active ? <span className="spinner" /> : null}
                      </div>
                      <span style={{ fontSize: "0.85rem", color: done || active ? "var(--text-main)" : "var(--text-muted)", fontWeight: active ? 700 : 500 }}>
                        {s.label}
                      </span>
                    </div>
                  );
                })}
                {progressStatus === "ACTIVE" && (
                  <div style={{ marginTop: "0.5rem", color: "#10b981", fontWeight: 700, fontSize: "0.85rem" }}>
                    Your domain is live!
                  </div>
                )}
              </div>
            )}
          </div>
        )}
    </div>
  );
}

// ─── Domain Settings ───────────────────────────────────────────────────────

function DomainSettingsDrawer({ domain, onClose, onUpdated }: { domain: DomainRecord; onClose: () => void; onUpdated: () => void }) {
  const reg = domain.registration;
  const [autoRenew, setAutoRenew] = useState(reg?.autoRenew ?? true);
  const [updating, setUpdating] = useState(false);
  const [confirmingUnlock, setConfirmingUnlock] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [unlockResult, setUnlockResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggleAutoRenew() {
    const next = !autoRenew;
    setUpdating(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/domains/auto-renew", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: domain.domain, autoRenew: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not update auto-renew.");
      setAutoRenew(next);
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update auto-renew.");
    } finally {
      setUpdating(false);
    }
  }

  async function handleUnlock() {
    setUnlocking(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/domains/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: domain.domain }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not unlock this domain.");
      setUnlockResult("We've unlocked this domain and emailed you its transfer code.");
      setConfirmingUnlock(false);
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not unlock this domain.");
    } finally {
      setUnlocking(false);
    }
  }

  const infoField = (label: string, value: React.ReactNode) => (
    <div>
      <div style={{ fontSize: "0.68rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-muted)" }}>{label}</div>
      <div style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--text-main)", marginTop: "0.2rem" }}>{value}</div>
    </div>
  );

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)", zIndex: 9998, animation: "fade-in 0.25s ease" }} />
      <div style={drawerPanelStyle()}>
        <DrawerHeader title={domain.domain} subtitle="Plexo-managed domain settings" onClose={onClose} />

        {error && (
          <div style={{ padding: "0.6rem 0.8rem", borderRadius: 8, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#f87171", fontSize: "0.8rem" }}>
            {error}
          </div>
        )}
        {unlockResult && (
          <div style={{ padding: "0.6rem 0.8rem", borderRadius: 8, background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)", color: "#10b981", fontSize: "0.8rem" }}>
            {unlockResult}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", padding: "1rem", borderRadius: 12, border: "1px solid var(--surface-border)" }}>
          {infoField("Renews on", reg?.renewalDate ? new Date(reg.renewalDate).toLocaleDateString() : "—")}
          {infoField("Renewal price", reg?.renewalPriceUsdCents != null ? `${formatUsd(reg.renewalPriceUsdCents)} / year` : "—")}
          {infoField("Payment method", reg?.paymentMethod === "WALLET" ? "Wallet balance" : "Card via Stripe")}
          {infoField("WHOIS privacy", reg?.whoisPrivacyEnabled ? <span style={{ color: "#10b981" }}>Enabled</span> : "—")}
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1rem", borderRadius: 12, border: "1px solid var(--surface-border)" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: "0.85rem", color: "var(--text-main)" }}>Auto-renew</div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.15rem" }}>Renews automatically each year using the payment method above.</div>
          </div>
          <button
            type="button"
            onClick={() => void toggleAutoRenew()}
            disabled={updating}
            style={{
              width: 40, height: 22, borderRadius: 999, border: "none", cursor: "pointer", position: "relative", flexShrink: 0,
              background: autoRenew ? "var(--brand)" : "var(--surface-border)",
            }}
          >
            <span style={{
              position: "absolute", top: 2, left: autoRenew ? 20 : 2, width: 18, height: 18, borderRadius: 999,
              background: "#fff", transition: "left 0.15s", boxShadow: "0 1px 2px rgba(0,0,0,0.3)",
            }} />
          </button>
        </div>

        {reg?.status === "ACTIVE" && (
          <div style={{ padding: "1rem", borderRadius: 12, border: "1px solid rgba(220,38,38,0.25)" }}>
            <div style={{ fontWeight: 700, fontSize: "0.8rem", color: "#f87171", marginBottom: "0.5rem" }}>Danger zone</div>
            <div style={{ fontWeight: 700, fontSize: "0.85rem", color: "var(--text-main)", marginBottom: "0.35rem" }}>
              Stop Plexo from managing this domain
            </div>
            <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", lineHeight: 1.5, marginBottom: "0.75rem" }}>
              Take full control of {domain.domain} at any registrar you choose. We'll unlock it and email you a transfer code.
            </p>
            {!confirmingUnlock ? (
              <button
                type="button"
                onClick={() => setConfirmingUnlock(true)}
                style={{ background: "none", border: "1px solid rgba(220,38,38,0.3)", color: "#f87171", borderRadius: 8, padding: "0.5rem 1rem", fontSize: "0.8rem", fontWeight: 700, cursor: "pointer" }}
              >
                Stop managing
              </button>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", lineHeight: 1.5 }}>
                  We'll unlock the domain and email your transfer (EPP) code. Registries can't transfer a domain within 60 days of registration, but you can request the code now regardless. Plexo keeps billing and serving this domain until a transfer actually completes elsewhere.
                </div>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button type="button" onClick={() => setConfirmingUnlock(false)} className="btn-secondary" style={{ padding: "0.5rem 1rem", fontSize: "0.8rem" }}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleUnlock()}
                    disabled={unlocking}
                    style={{ background: "#dc2626", border: "none", color: "#fff", borderRadius: 8, padding: "0.5rem 1rem", fontSize: "0.8rem", fontWeight: 700, cursor: "pointer" }}
                  >
                    {unlocking ? <span className="spinner" /> : "Unlock & email code"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
