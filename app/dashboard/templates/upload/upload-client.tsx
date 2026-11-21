"use client";

import React, { useState, useRef } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, ExternalLink, FileArchive, FileCode, ShieldCheck, UploadCloud, X } from "lucide-react";
import { Button, ButtonLink, Card, Input, Notice } from "../../_v3/ui";

export function UploadRawClient() {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<{ templateId: string; name: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) validateAndSetFile(dropped);
  }

  function validateAndSetFile(f: File) {
    const ext = f.name.toLowerCase();
    if (!ext.endsWith(".html") && !ext.endsWith(".htm") && !ext.endsWith(".zip")) {
      setErrorMsg("Please choose a valid .html, .htm, or .zip archive.");
      return;
    }
    if (f.size > 25 * 1024 * 1024) {
      setErrorMsg("File is too large. Maximum size is 25MB.");
      return;
    }
    setErrorMsg(null);
    setFile(f);
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);

    if (!file) {
      setErrorMsg("Please choose a .html, .htm, or .zip file to upload.");
      return;
    }
    if (!agreed) {
      setErrorMsg("Please review and agree to the Acceptable Use Policy before uploading.");
      return;
    }

    setIsSubmitting(true);
    try {
      const form = new FormData();
      form.append("file", file);
      if (name.trim()) form.append("name", name.trim());
      form.append("acceptAup", "true");

      const res = await fetch("/api/v1/templates/upload-raw", { method: "POST", body: form });
      const payload = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(payload.error ?? "Upload failed. Please check the archive format and try again.");
      }

      setResult({ templateId: payload.templateId, name: payload.name });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Unexpected error during upload.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "16px 0 64px" }}>
      {/* Header */}
      <div style={{ marginBottom: 28, display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: "var(--plx-deep, var(--plx-brand))",
            }}
          >
            Websites &amp; Publishing
          </span>
        </div>
        <h1
          style={{
            fontSize: 28,
            fontWeight: 800,
            letterSpacing: "-0.02em",
            color: "var(--plx-text)",
            margin: 0,
          }}
        >
          Upload your own website files
        </h1>
        <p style={{ fontSize: 15, lineHeight: 1.5, color: "var(--plx-muted)", margin: 0 }}>
          Bring a site you already built. Upload an individual <code>.html</code> file or a <code>.zip</code> containing
          an <code>index.html</code> at its root along with any linked CSS, JS, fonts, and images.
        </p>
      </div>

      {result ? (
        <Card padding="lg">
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: "50%",
                  background: "color-mix(in srgb, #10b981 18%, transparent)",
                  color: "#10b981",
                  display: "grid",
                  placeItems: "center",
                  flexShrink: 0,
                }}
              >
                <CheckCircle2 size={24} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0, color: "var(--plx-text)" }}>
                  &ldquo;{result.name}&rdquo; uploaded successfully!
                </h2>
                <p style={{ fontSize: 14, lineHeight: 1.5, color: "var(--plx-muted)", margin: 0 }}>
                  Your website files have been parsed and safely stored in your dashboard. You can now view your site,
                  connect a custom domain, or edit the files directly.
                </p>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", paddingTop: 8 }}>
              <ButtonLink
                href={`/dashboard/sites/${result.templateId}`}
                variant="primary"
                rightIcon={<ArrowRight size={16} />}
              >
                Go to Website Hub
              </ButtonLink>
              <ButtonLink
                href={`/dashboard/templates/${result.templateId}`}
                variant="secondary"
                rightIcon={<ExternalLink size={14} />}
              >
                Edit Files
              </ButtonLink>
            </div>
          </div>
        </Card>
      ) : (
        <Card padding="lg">
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 22 }} noValidate>
            <Input
              label="Website name (optional)"
              placeholder="e.g. My Portfolio, Acme Co."
              help="If left empty, we'll use your file's name."
              value={name}
              onChange={(e) => setName(e.target.value)}
            />

            {/* Drag & Drop Zone */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label style={{ fontSize: 14, fontWeight: 700, color: "var(--plx-text)" }}>
                HTML file or .ZIP archive
              </label>

              {!file ? (
                <div
                  onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                  onDragLeave={() => setIsDragOver(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    border: `2px dashed ${isDragOver ? "var(--plx-deep, var(--plx-brand))" : "var(--plx-border)"}`,
                    borderRadius: "var(--plx-radius-card, 12px)",
                    background: isDragOver ? "var(--plx-tint)" : "var(--plx-sunken)",
                    padding: "36px 20px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 12,
                    cursor: "pointer",
                    textAlign: "center",
                    transition: "all 0.15s ease",
                  }}
                >
                  <div
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: 14,
                      background: "var(--plx-surface)",
                      border: "1px solid var(--plx-border)",
                      color: "var(--plx-deep, var(--plx-brand))",
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    <UploadCloud size={26} />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "var(--plx-text)" }}>
                      Click to choose a file or drag and drop here
                    </span>
                    <span style={{ fontSize: 13, color: "var(--plx-muted)" }}>
                      Accepts <code>.html</code>, <code>.htm</code>, or <code>.zip</code> (max 25MB total)
                    </span>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".html,.htm,.zip"
                    onChange={(e) => {
                      const selected = e.target.files?.[0];
                      if (selected) validateAndSetFile(selected);
                    }}
                    style={{ display: "none" }}
                  />
                </div>
              ) : (
                /* Selected File Card */
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "14px 18px",
                    borderRadius: 12,
                    background: "var(--plx-surface)",
                    border: "1px solid var(--plx-border)",
                    boxShadow: "var(--plx-shadow-card)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 10,
                        background: "var(--plx-tint)",
                        color: "var(--plx-deep)",
                        display: "grid",
                        placeItems: "center",
                      }}
                    >
                      {file.name.endsWith(".zip") ? <FileArchive size={20} /> : <FileCode size={20} />}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: "var(--plx-text)" }}>{file.name}</span>
                      <span style={{ fontSize: 12, color: "var(--plx-muted)" }}>{formatBytes(file.size)}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFile(null)}
                    style={{
                      border: "none",
                      background: "none",
                      color: "var(--plx-muted)",
                      cursor: "pointer",
                      padding: 6,
                      borderRadius: 8,
                    }}
                    title="Remove file"
                  >
                    <X size={18} />
                  </button>
                </div>
              )}
            </div>

            {/* AUP Agreement */}
            <label
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                cursor: "pointer",
                fontSize: 13,
                lineHeight: 1.5,
                color: "var(--plx-text)",
              }}
            >
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                style={{
                  marginTop: 2,
                  width: 16,
                  height: 16,
                  accentColor: "var(--plx-deep, var(--plx-brand))",
                  cursor: "pointer",
                }}
              />
              <span>
                I agree to the{" "}
                <Link
                  href="/legal/acceptable-use"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--plx-deep, var(--plx-brand))", textDecoration: "underline" }}
                >
                  Acceptable Use Policy
                </Link>{" "}
                and confirm that this site does not contain malicious code, phishing content, or unauthorized materials.
              </span>
            </label>

            {errorMsg && (
              <Notice kind="error" title="Check your upload">
                {errorMsg}
              </Notice>
            )}

            <div>
              <Button
                type="submit"
                size="lg"
                disabled={!file || !agreed || isSubmitting}
                loading={isSubmitting}
                loadingLabel="Uploading and validating files…"
                leftIcon={<UploadCloud size={16} />}
              >
                Upload Website
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
