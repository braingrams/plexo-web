"use client";

import { useEffect, useRef, useState } from "react";
import type { DragEvent, FormEvent } from "react";
import Link from "next/link";

type MarketplaceItem = {
  id: string;
  name: string;
  kind: "EMAIL" | "LANDING_PAGE";
  category: string | null;
  priceCents: number;
};

type CreatedTemplate = { id: string; name: string };

const hairline = "rgba(255,255,255,0.09)";
const hairlineSoft = "rgba(255,255,255,0.055)";

const SWATCHES = [
  "linear-gradient(150deg,#312e81,#7c3aed 60%,#c084fc)",
  "linear-gradient(150deg,#0f172a,#0ea5e9 65%,#67e8f9)",
  "linear-gradient(150deg,#134e4a,#10b981 65%,#6ee7b7)",
  "linear-gradient(150deg,#450a0a,#f43f5e 65%,#fda4af)",
];

const SUBDOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function IconCheck() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function IconUpload() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

function IconTemplate() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M3 9h18M9 21V9" />
    </svg>
  );
}

function IconGlobe() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <path d="M12 3a13 13 0 0 1 3.2 9 13 13 0 0 1-3.2 9 13 13 0 0 1-3.2-9A13 13 0 0 1 12 3z" />
    </svg>
  );
}

function IconSparkle() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="8 12.5 11 15.5 16 9" />
    </svg>
  );
}

/** Step indicator badge — filled brand while active or done, a checkmark once done,
 * an outlined faint circle while still upcoming. */
function StepBadge({ n, active, done }: { n: number; active: boolean; done: boolean }) {
  return (
    <div
      style={{
        width: 30,
        height: 30,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        fontFamily: "var(--font-mono)",
        fontSize: "12.5px",
        fontWeight: 700,
        background: active || done ? "var(--brand)" : "rgba(255,255,255,0.05)",
        color: active || done ? "#fff" : "var(--text-faint)",
        border: active || done ? "none" : `1px solid ${hairline}`,
        boxShadow: active ? "0 0 0 4px var(--brand-subtle)" : "none",
        transition: "background 0.2s, box-shadow 0.2s",
      }}
    >
      {done ? <IconCheck /> : n}
    </div>
  );
}

function stepLabelStyle(active: boolean, done: boolean) {
  return {
    fontSize: "12.5px",
    fontWeight: 650,
    color: active || done ? "var(--text-main)" : "var(--text-faint)",
  };
}

function inputStyle() {
  return {
    width: "100%",
    background: "rgba(255,255,255,0.045)",
    border: `1px solid ${hairline}`,
    borderRadius: 9,
    color: "var(--text-main)",
    padding: "11px 13px",
    fontSize: "13.5px",
    fontFamily: "inherit",
  } as const;
}

function ghostButtonStyle() {
  return {
    fontSize: "13px",
    fontWeight: 600,
    color: "var(--text-muted)",
    background: "none",
    border: `1px solid ${hairline}`,
    borderRadius: 9,
    padding: "10px 18px",
    cursor: "pointer",
  } as const;
}

function primaryButtonStyle(enabled: boolean) {
  return {
    fontSize: "13px",
    fontWeight: 650,
    color: "var(--bg)",
    background: enabled ? "var(--text-main)" : "var(--text-faint)",
    padding: "10px 20px",
    borderRadius: 9,
    border: "none",
    cursor: enabled ? "pointer" : "not-allowed",
  } as const;
}

function Dropzone({ file, onFile }: { file: File | null; onFile: (f: File | null) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) onFile(dropped);
  }

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={handleDrop}
      role="button"
      tabIndex={0}
      style={{
        cursor: "pointer",
        borderRadius: 14,
        border: `1.5px dashed ${dragActive ? "var(--brand)" : file ? "var(--success)" : hairline}`,
        background: dragActive ? "var(--brand-subtle)" : "rgba(255,255,255,0.02)",
        padding: "36px 20px",
        textAlign: "center",
        transition: "border-color 0.15s, background 0.15s",
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".html,.htm,.zip"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        style={{ display: "none" }}
      />
      <div
        style={{
          width: 44,
          height: 44,
          margin: "0 auto 14px",
          borderRadius: 12,
          background: "var(--brand-subtle)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <IconUpload />
      </div>
      {file ? (
        <>
          <div style={{ fontSize: "13.5px", fontWeight: 650, color: "var(--text-main)" }}>{file.name}</div>
          <div style={{ fontSize: "11.5px", color: "var(--text-faint)", marginTop: 4 }}>
            {(file.size / 1024).toFixed(0)} KB &middot; click or drop to replace
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: "13.5px", fontWeight: 650, color: "var(--text-main)" }}>Click to upload, or drag and drop</div>
          <div style={{ fontSize: "11.5px", color: "var(--text-faint)", marginTop: 4 }}>.html, .htm, or .zip</div>
        </>
      )}
    </div>
  );
}

export function NewSiteWizard() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [startTab, setStartTab] = useState<"marketplace" | "upload">("marketplace");

  const [items, setItems] = useState<MarketplaceItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [uploadName, setUploadName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [template, setTemplate] = useState<CreatedTemplate | null>(null);

  const [baseDomain, setBaseDomain] = useState("plexo.site");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  const [publishing, setPublishing] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/marketplace/templates?sort=popular&free=true")
      .then((res) => res.json())
      .then((data) => setItems(data.templates ?? []))
      .catch(() => setItems([]))
      .finally(() => setLoadingItems(false));

    fetch("/api/v1/domains")
      .then((res) => res.json())
      .then((data) => {
        if (data.baseDomain) setBaseDomain(data.baseDomain);
      })
      .catch(() => { });
  }, []);

  function advanceToConnect(created: CreatedTemplate) {
    setTemplate(created);
    if (!slugTouched) setSlug(slugify(created.name));
    setStep(2);
  }

  async function handleUseMarketplace(item: MarketplaceItem) {
    setError(null);
    setBusyId(item.id);
    try {
      const res = await fetch(`/api/v1/marketplace/templates/${item.id}/use`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to use this template.");
        return;
      }
      advanceToConnect(data.template);
    } finally {
      setBusyId(null);
    }
  }

  async function handleUpload(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!file) {
      setError("Choose a .html, .htm, or .zip file to upload.");
      return;
    }
    if (!agreed) {
      setError("You must agree to the Acceptable Use Policy to publish unsanitized HTML.");
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      if (uploadName.trim()) form.append("name", uploadName.trim());
      form.append("acceptAup", "true");
      const res = await fetch("/api/v1/templates/upload-raw", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Upload failed.");
        return;
      }
      advanceToConnect({ id: data.templateId, name: data.name });
    } finally {
      setUploading(false);
    }
  }

  const slugValid = slug.length > 0 && SUBDOMAIN_REGEX.test(slug);

  async function handlePublish() {
    if (!template || !slugValid) return;
    setError(null);
    setPublishing(true);
    try {
      const res = await fetch("/api/v1/domains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: template.id, type: "SUBDOMAIN", domain: slug }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to publish.");
        return;
      }
      setPublishedUrl(`https://${data.domain.domain}`);
    } finally {
      setPublishing(false);
    }
  }

  const cardWidth = step === 1 ? 1080 : 1080;

  return (
    <div style={{ color: "var(--text-main)", minHeight: "calc(100vh - 180px)", display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ width: "100%", maxWidth: cardWidth, transition: "max-width 0.25s ease" }}>
        <Link href="/dashboard" style={{ fontSize: "12.5px", fontWeight: 600, color: "var(--text-muted)", textDecoration: "none" }}>
          &larr; Overview
        </Link>

        <div style={{ margin: "18px 0 2.5rem" }}>
          <h1 style={{ margin: "0 0 8px", fontSize: "30px", fontWeight: 700, letterSpacing: "-0.02em" }}>Host a site</h1>
          <p style={{ margin: 0, fontSize: "14px", color: "var(--text-muted)" }}>
            Pick a starting point, choose a web address, and publish — no experience needed.
          </p>
        </div>

        {/* Stepper */}
        <div style={{ display: "flex", alignItems: "center", marginBottom: 32 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <StepBadge n={1} active={step === 1} done={step > 1} />
            <span style={stepLabelStyle(step === 1, step > 1)}>Start</span>
          </div>
          <div style={{ flex: 1, height: 2, borderRadius: 2, background: step > 1 ? "var(--brand)" : hairline, margin: "0 16px", transition: "background 0.2s" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <StepBadge n={2} active={step === 2} done={step > 2} />
            <span style={stepLabelStyle(step === 2, step > 2)}>Connect</span>
          </div>
          <div style={{ flex: 1, height: 2, borderRadius: 2, background: step > 2 ? "var(--brand)" : hairline, margin: "0 16px", transition: "background 0.2s" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <StepBadge n={3} active={step === 3} done={false} />
            <span style={stepLabelStyle(step === 3, false)}>Publish</span>
          </div>
        </div>

        {/* Card */}
        <div
          style={{
            background: "var(--surface)",
            border: `1px solid var(--surface-border)`,
            borderRadius: 20,
            padding: step === 1 ? "36px 40px" : "40px 44px",
            boxShadow: "0 24px 60px -30px rgba(0,0,0,0.6)",
          }}
        >
          {error && (
            <p style={{ fontSize: "12.5px", color: "var(--danger)", margin: "0 0 18px" }} role="alert">
              {error}
            </p>
          )}

          {/* Step 1 — Start */}
          {step === 1 && (
            <div>
              <h2 style={{ margin: "0 0 4px", fontSize: "17px", fontWeight: 700 }}>Choose a starting point</h2>
              <p style={{ margin: "0 0 20px", fontSize: "13px", color: "var(--text-muted)" }}>
                Start from a ready-made template, or bring a site you already have.
              </p>

              <div
                style={{
                  display: "flex",
                  gap: 4,
                  marginBottom: 24,
                  padding: 3,
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.04)",
                  border: `1px solid ${hairline}`,
                  width: "fit-content",
                }}
              >
                <button
                  type="button"
                  onClick={() => setStartTab("marketplace")}
                  style={{
                    fontSize: "12.5px",
                    fontWeight: 650,
                    padding: "7px 14px",
                    borderRadius: 999,
                    border: "none",
                    cursor: "pointer",
                    background: startTab === "marketplace" ? "var(--brand)" : "transparent",
                    color: startTab === "marketplace" ? "#fff" : "var(--text-muted)",
                    transition: "background 0.15s, color 0.15s",
                  }}
                >
                  From a template
                </button>
                <button
                  type="button"
                  onClick={() => setStartTab("upload")}
                  style={{
                    fontSize: "12.5px",
                    fontWeight: 650,
                    padding: "7px 14px",
                    borderRadius: 999,
                    border: "none",
                    cursor: "pointer",
                    background: startTab === "upload" ? "var(--brand)" : "transparent",
                    color: startTab === "upload" ? "#fff" : "var(--text-muted)",
                    transition: "background 0.15s, color 0.15s",
                  }}
                >
                  Upload your own
                </button>
              </div>

              {startTab === "marketplace" ? (
                loadingItems ? (
                  <p style={{ fontSize: "12.5px", color: "var(--text-faint)" }}>Loading templates…</p>
                ) : items.length === 0 ? (
                  <p style={{ fontSize: "12.5px", color: "var(--text-faint)" }}>
                    No free templates available right now — try{" "}
                    <button
                      type="button"
                      onClick={() => setStartTab("upload")}
                      style={{ color: "var(--brand)", fontWeight: 650, background: "none", border: "none", padding: 0, cursor: "pointer", font: "inherit" }}
                    >
                      uploading your own
                    </button>
                    .
                  </p>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 18 }}>
                    {items.slice(0, 8).map((item, i) => {
                      const busy = busyId === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => void handleUseMarketplace(item)}
                          disabled={busy}
                          style={{
                            textAlign: "left",
                            background: "rgba(255,255,255,0.02)",
                            border: `1px solid ${hairline}`,
                            borderRadius: 12,
                            padding: 10,
                            cursor: busy ? "wait" : "pointer",
                            fontFamily: "inherit",
                            color: "inherit",
                            transition: "border-color 0.15s, transform 0.15s",
                          }}
                        >
                          <div style={{ height: 72, borderRadius: 8, background: SWATCHES[i % SWATCHES.length], marginBottom: 10 }} />
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6 }}>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: "12.5px", fontWeight: 650, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {item.name}
                              </div>
                              <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>{item.category ?? (item.kind === "LANDING_PAGE" ? "Landing Page" : "Email")}</div>
                            </div>
                            <span style={{ fontSize: "11px", fontWeight: 650, color: "var(--success)", flexShrink: 0 }}>{busy ? "…" : "Use →"}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )
              ) : (
                <form onSubmit={handleUpload} style={{ maxWidth: 680, display: "flex", flexDirection: "column", gap: 22 }}>
                  <Dropzone file={file} onFile={setFile} />
                  <div>
                    <label style={{ fontSize: "11.5px", fontWeight: 650, color: "var(--text-muted)", display: "block", marginBottom: 8 }}>Site name (optional)</label>
                    <input type="text" value={uploadName} onChange={(e) => setUploadName(e.target.value)} placeholder="My site" style={inputStyle()} />
                  </div>
                  <label style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: "12.5px", color: "var(--text-muted)", lineHeight: 1.7, cursor: "pointer" }}>
                    <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ marginTop: 3, width: 15, height: 15, flexShrink: 0 }} />
                    <span>
                      I agree to the{" "}
                      <Link href="/legal/acceptable-use" target="_blank" style={{ color: "var(--brand)" }}>
                        Acceptable Use Policy
                      </Link>
                      . Content is published exactly as uploaded, with no modification.
                    </span>
                  </label>
                  <button type="submit" disabled={uploading} style={{ ...primaryButtonStyle(true), alignSelf: "flex-start", cursor: uploading ? "wait" : "pointer" }}>
                    {uploading ? "Uploading…" : "Upload & continue"}
                  </button>
                </form>
              )}
            </div>
          )}

          {/* Step 2 — Connect */}
          {step === 2 && template && (
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "10px 14px",
                  marginBottom: 24,
                  borderRadius: 10,
                  background: "rgba(52,211,153,0.08)",
                  border: "1px solid rgba(52,211,153,0.2)",
                }}
              >
                <span style={{ fontSize: "12.5px", color: "var(--success)" }}>
                  <strong>&ldquo;{template.name}&rdquo;</strong> is ready
                </span>
                <Link href={`/dashboard/templates/${template.id}`} target="_blank" style={{ fontSize: "12px", fontWeight: 650, color: "var(--brand)", textDecoration: "none", whiteSpace: "nowrap" }}>
                  Open editor &rarr;
                </Link>
              </div>

              <h2 style={{ margin: "0 0 4px", fontSize: "17px", fontWeight: 700 }}>Give your site an address</h2>
              <p style={{ margin: "0 0 20px", fontSize: "13px", color: "var(--text-muted)" }}>
                This is the web address people will use to find your site. You can change it later.
              </p>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  background: "rgba(255,255,255,0.045)",
                  border: `1px solid ${slugValid || slug.length === 0 ? hairline : "var(--warning)"}`,
                  borderRadius: 10,
                  padding: "4px 4px 4px 14px",
                }}
              >
                <input
                  type="text"
                  value={slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setSlug(slugify(e.target.value));
                  }}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    background: "none",
                    border: "none",
                    outline: "none",
                    color: "var(--brand)",
                    padding: "9px 0",
                    fontSize: "15px",
                    fontWeight: 650,
                    fontFamily: "var(--font-mono)",
                  }}
                />
                <span style={{ fontSize: "15px", color: "var(--text-faint)", fontFamily: "var(--font-mono)", paddingRight: 10, whiteSpace: "nowrap" }}>.{baseDomain}</span>
              </div>
              {!slugValid && slug.length > 0 && (
                <p style={{ fontSize: "11.5px", color: "var(--warning)", marginTop: 8 }}>Lowercase letters, numbers, and hyphens only.</p>
              )}
              <p style={{ fontSize: "12px", color: "var(--text-faint)", marginTop: 14, lineHeight: 1.6 }}>
                Have your own domain? Connect it any time from{" "}
                <Link href="/dashboard/domains" style={{ color: "var(--brand)" }}>
                  Domains
                </Link>{" "}
                after publishing — this subdomain works instantly in the meantime.
              </p>

              <div style={{ display: "flex", gap: 10, marginTop: 28 }}>
                <button type="button" onClick={() => setStep(1)} style={ghostButtonStyle()}>
                  Back
                </button>
                <button type="button" disabled={!slugValid} onClick={() => setStep(3)} style={primaryButtonStyle(slugValid)}>
                  Continue to publish
                </button>
              </div>
            </div>
          )}

          {/* Step 3 — Publish */}
          {step === 3 && template && (
            <div>
              {publishedUrl ? (
                <div style={{ textAlign: "center", padding: "12px 0" }}>
                  <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
                    <IconSparkle />
                  </div>
                  <h2 style={{ margin: "0 0 8px", fontSize: "19px", fontWeight: 700 }}>Your site is live</h2>
                  <Link href={publishedUrl} target="_blank" style={{ fontFamily: "var(--font-mono)", fontSize: "15px", fontWeight: 650, color: "var(--brand)" }}>
                    {publishedUrl.replace("https://", "")}
                  </Link>
                  <p style={{ fontSize: "12.5px", color: "var(--text-muted)", margin: "10px 0 0" }}>
                    You can keep customizing any time — publishing doesn&rsquo;t lock anything in.
                  </p>
                  <div style={{ display: "flex", justifyContent: "center", gap: 10, marginTop: 26 }}>
                    <Link href={`/dashboard/templates/${template.id}`} style={{ ...ghostButtonStyle(), textDecoration: "none", display: "inline-block" }}>
                      Open editor
                    </Link>
                    <Link href="/dashboard" style={{ ...primaryButtonStyle(true), textDecoration: "none", display: "inline-block" }}>
                      Back to Overview
                    </Link>
                  </div>
                </div>
              ) : (
                <div>
                  <h2 style={{ margin: "0 0 4px", fontSize: "17px", fontWeight: 700 }}>Review and publish</h2>
                  <p style={{ margin: "0 0 22px", fontSize: "13px", color: "var(--text-muted)" }}>
                    Here&rsquo;s what&rsquo;s about to go live. You can always change it later.
                  </p>

                  <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 0", borderTop: `1px solid ${hairlineSoft}`, borderBottom: `1px solid ${hairlineSoft}` }}>
                    <IconTemplate />
                    <span style={{ fontSize: "12.5px", color: "var(--text-muted)", flexShrink: 0 }}>Template</span>
                    <span style={{ fontSize: "13px", fontWeight: 650, marginLeft: "auto" }}>{template.name}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 0", borderBottom: `1px solid ${hairlineSoft}` }}>
                    <IconGlobe />
                    <span style={{ fontSize: "12.5px", color: "var(--text-muted)", flexShrink: 0 }}>Address</span>
                    <span style={{ fontSize: "13px", fontWeight: 650, fontFamily: "var(--font-mono)", marginLeft: "auto" }}>
                      {slug}.{baseDomain}
                    </span>
                  </div>

                  <p style={{ fontSize: "12px", color: "var(--text-faint)", margin: "16px 0 0", lineHeight: 1.6 }}>
                    Publishing makes this address live immediately. Nothing else changes — you can keep editing whenever you like.
                  </p>

                  <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
                    <button type="button" onClick={() => setStep(2)} style={ghostButtonStyle()}>
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={() => void handlePublish()}
                      disabled={publishing}
                      style={{
                        fontSize: "13px",
                        fontWeight: 650,
                        color: "#fff",
                        background: "linear-gradient(135deg, var(--brand), var(--brand-deep))",
                        padding: "10px 22px",
                        borderRadius: 9,
                        border: "none",
                        cursor: publishing ? "wait" : "pointer",
                        boxShadow: "0 12px 28px -10px var(--brand-glow)",
                      }}
                    >
                      {publishing ? "Publishing…" : "Publish now"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
