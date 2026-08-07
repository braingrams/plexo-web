"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/app/dashboard/_components/Card";
import { CustomSelect } from "@/app/_components/CustomSelect";

type TemplateOption = {
  id: string;
  name: string;
  kind: "EMAIL" | "LANDING_PAGE";
  hasContent: boolean;
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 10,
  color: "#f0f2ff",
  padding: "0.7rem 0.9rem",
  fontSize: "0.9rem",
  outline: "none",
  fontFamily: "inherit",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.8rem",
  fontWeight: 600,
  color: "#c5cbe8",
  marginBottom: "0.4rem",
};

export function SellTemplateForm({ templates, autoPublish }: { templates: TemplateOption[]; autoPublish: boolean }) {
  const router = useRouter();
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!templateId) {
      setError("Choose a template to list.");
      return;
    }
    setSubmitting(true);
    try {
      const priceCents = price.trim() ? Math.round(Number(price) * 100) : 0;
      const res = await fetch("/api/v1/marketplace/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId,
          priceCents,
          category: category.trim() || null,
          description: description.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error ?? "Unable to submit listing.");
      }
      router.push("/dashboard/marketplace/listings");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to submit listing.");
    } finally {
      setSubmitting(false);
    }
  }

  if (templates.length === 0) {
    return (
      <Card>
        <p style={{ fontSize: "0.875rem", color: "rgba(240,242,255,0.6)" }}>
          You don&apos;t have any templates yet. Create one first, then come back here to list it for sale.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} style={{ display: "grid", gap: "1.25rem" }}>
        <label style={{ display: "block" }}>
          <span style={labelStyle}>Template</span>
          <CustomSelect
            value={templateId}
            onChange={setTemplateId}
            options={templates.map((t) => ({
              value: t.id,
              label: `${t.name} (${t.kind === "EMAIL" ? "Email" : "Landing Page"})${!t.hasContent ? " — no content yet" : ""}`,
              disabled: !t.hasContent,
            }))}
          />
        </label>

        <label style={{ display: "block" }}>
          <span style={labelStyle}>Price (USD, blank/0 = free)</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="0.00"
            style={inputStyle}
          />
        </label>

        <label style={{ display: "block" }}>
          <span style={labelStyle}>Category (optional)</span>
          <input
            type="text"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="e.g. Portfolio, SaaS, E-commerce"
            style={inputStyle}
          />
        </label>

        <label style={{ display: "block" }}>
          <span style={labelStyle}>Description (optional)</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            style={inputStyle}
          />
        </label>

        {error && <p style={{ color: "#f87171", fontSize: "0.85rem", margin: 0 }}>{error}</p>}

        <div>
          <button
            type="submit"
            disabled={submitting}
            style={{
              background: submitting ? "rgba(255,255,255,0.08)" : "linear-gradient(135deg, var(--brand), var(--brand-deep))",
              color: "#fff",
              border: "none",
              borderRadius: 10,
              padding: "0.75rem 1.5rem",
              fontSize: "0.9rem",
              fontWeight: 700,
              cursor: submitting ? "not-allowed" : "pointer",
            }}
          >
            {submitting ? "Submitting…" : autoPublish ? "List now" : "Submit for review"}
          </button>
        </div>
      </form>
    </Card>
  );
}
