"use client";

import React, { useState } from "react";
import Link from "next/link";

export function UploadRawClient() {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<{ templateId: string; name: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);

    if (!file) {
      setErrorMsg("Choose a .html, .htm, or .zip file to upload.");
      return;
    }
    if (!agreed) {
      setErrorMsg("You must agree to the Acceptable Use Policy to publish unsanitized HTML.");
      return;
    }

    setIsSubmitting(true);
    try {
      const form = new FormData();
      form.append("file", file);
      if (name.trim()) form.append("name", name.trim());
      form.append("acceptAup", "true");

      const res = await fetch("/api/v1/templates/upload-raw", { method: "POST", body: form });
      const payload = await res.json();

      if (!res.ok) {
        throw new Error(payload.error ?? "Upload failed.");
      }

      setResult({ templateId: payload.templateId, name: payload.name });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Unexpected error during upload.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div>
      <p style={{ fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--brand)", marginBottom: "0.35rem" }}>
        Domains &amp; Publishing
      </p>
      <h1 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "2.1rem", fontWeight: 800, color: "#f0f2ff", letterSpacing: "-0.025em", marginBottom: "0.5rem" }}>
        Upload a Site
      </h1>
      <p style={{ fontSize: "0.875rem", color: "rgba(240,242,255,0.45)", marginBottom: "2rem", lineHeight: 1.6 }}>
        Publish a self-contained site outside the builder — a single .html file, or a .zip with
        an index.html at its root plus any css/js/images/fonts it references. Content is
        published exactly as uploaded, with no modification.
      </p>

      {result ? (
        <div style={{
          background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.2)",
          borderRadius: 12, padding: "1.5rem",
        }}>
          <p style={{ color: "#34d399", fontWeight: 700, marginBottom: "0.5rem" }}>✓ "{result.name}" uploaded</p>
          <p style={{ color: "rgba(240,242,255,0.6)", fontSize: "0.85rem", marginBottom: "1rem" }}>
            It's saved but not live yet — link it to a subdomain or custom domain to publish it.
          </p>
          <div style={{ display: "flex", gap: "0.6rem" }}>
            <Link href={`/dashboard/templates/${result.templateId}`} className="btn-primary" style={{
              display: "inline-flex", padding: "0.55rem 1.25rem", borderRadius: 9, fontWeight: 700,
              fontSize: "0.85rem", background: "linear-gradient(135deg,var(--brand),var(--brand-deep))",
              color: "#fff", textDecoration: "none",
            }}>
              Edit Files
            </Link>
            <Link href="/dashboard/domains" style={{
              display: "inline-flex", padding: "0.55rem 1.25rem", borderRadius: 9, fontWeight: 700,
              fontSize: "0.85rem", background: "none", border: "1px solid rgba(255,255,255,0.15)",
              color: "rgba(240,242,255,0.8)", textDecoration: "none",
            }}>
              Go to Domain Management
            </Link>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          <div>
            <label htmlFor="site-name" className="field-label">Name (optional)</label>
            <input
              id="site-name"
              type="text"
              placeholder="My uploaded site"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="field-input"
              style={{ marginTop: "0.35rem" }}
            />
          </div>

          <div>
            <label htmlFor="site-file" className="field-label">HTML file or .zip</label>
            <input
              id="site-file"
              type="file"
              accept=".html,.htm,.zip"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="field-input"
              style={{ marginTop: "0.35rem", padding: "0.5rem" }}
            />
            <p style={{ fontSize: "0.72rem", color: "rgba(240,242,255,0.3)", marginTop: "0.35rem" }}>
              Max 25MB total, 1MB per individual file. Zips must contain an index.html at the root.
            </p>
          </div>

          <label style={{ display: "flex", alignItems: "flex-start", gap: "0.6rem", fontSize: "0.8rem", color: "rgba(240,242,255,0.65)", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              style={{ marginTop: "0.15rem" }}
            />
            <span>
              I have read and agree to the{" "}
              <a href="/legal/acceptable-use" target="_blank" rel="noopener noreferrer" style={{ color: "var(--brand)" }}>
                Acceptable Use Policy
              </a>{" "}
              — I am responsible for the content of what I upload, including any script it runs.
            </span>
          </label>

          {errorMsg && (
            <p style={{ fontSize: "0.8rem", color: "#f87171", margin: 0 }}>⚠️ {errorMsg}</p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="btn-primary"
            style={{
              padding: "0.65rem", borderRadius: 9, fontWeight: 700, fontSize: "0.875rem",
              background: "linear-gradient(135deg,var(--brand),var(--brand-deep))",
              border: "none", color: "#fff", cursor: isSubmitting ? "default" : "pointer",
            }}
          >
            {isSubmitting ? "Uploading…" : "Upload Site"}
          </button>
        </form>
      )}
    </div>
  );
}
