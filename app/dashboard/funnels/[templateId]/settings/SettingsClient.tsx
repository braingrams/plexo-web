"use client";

import { useState } from "react";
import { SUPPORTED_STORE_CURRENCIES } from "@/lib/commerce/currency";

type BuilderLevel = "BEGINNER" | "INTERMEDIATE" | "PROFESSIONAL";
type FunnelSettings = { enabled: boolean; signupMode: "FREE" | "PAID"; signupProductId: string | null; requireName: boolean; collectPhone: boolean };
type Product = { id: string; name: string };

const inputStyle: React.CSSProperties = {
  width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 9, color: "#f0f2ff", padding: "0.55rem 0.7rem", fontSize: "0.85rem", outline: "none", fontFamily: "inherit",
};

const sectionStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: "1.25rem 1.4rem", marginBottom: "1.1rem",
};

/** A segmented choice whose buttons size to their own label instead of stretching to fill
 * whatever width the (now full-width) settings page gives them — same "auto-fill, capped
 * size" instinct as Commerce's own CurrencyGrid, just for a plain choice instead of a grid
 * of currencies. */
function SegmentedChoice<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div style={{ display: "inline-flex", gap: "0.5rem", flexWrap: "wrap" }}>
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            style={{
              padding: "0.55rem 1.1rem", borderRadius: 9, fontSize: "0.82rem", fontWeight: 600, cursor: "pointer",
              background: selected ? "rgba(139,92,246,0.18)" : "rgba(255,255,255,0.03)",
              border: `1px solid ${selected ? "var(--brand, #8b5cf6)" : "rgba(255,255,255,0.09)"}`,
              color: selected ? "#c4b5fd" : "rgba(240,242,255,0.6)",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{
        width: 42, height: 24, borderRadius: 999, border: "none", cursor: "pointer", position: "relative", flexShrink: 0,
        background: checked ? "var(--brand, #8b5cf6)" : "rgba(255,255,255,0.15)", transition: "background 0.15s",
      }}
    >
      <span style={{
        position: "absolute", top: 3, left: checked ? 21 : 3, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "left 0.15s",
      }} />
    </button>
  );
}

async function api(input: string, init?: RequestInit) {
  const res = await fetch(input, { headers: { "Content-Type": "application/json" }, ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Something went wrong.");
  return body;
}

export function SettingsClient({
  templateId, initialFunnel, initialBuilderLevel, products: initialProducts, currency: initialCurrency, embedSnippet,
}: { templateId: string; initialFunnel: FunnelSettings; initialBuilderLevel: BuilderLevel; products: Product[]; currency: string; embedSnippet: string }) {
  const [funnel, setFunnel] = useState(initialFunnel);
  const [products, setProducts] = useState(initialProducts);
  const [currency, setCurrency] = useState(initialCurrency);
  const [builderLevel, setBuilderLevel] = useState(initialBuilderLevel);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patchFunnel(patch: Partial<FunnelSettings>) {
    setFunnel((prev) => ({ ...prev, ...patch }));
    setSaving(true);
    setError(null);
    try {
      await api(`/api/v1/lms/funnels/${templateId}`, { method: "PATCH", body: JSON.stringify(patch) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  async function changeBuilderLevel(level: BuilderLevel) {
    setBuilderLevel(level);
    await api("/api/profile", { method: "PATCH", body: JSON.stringify({ funnelBuilderLevel: level }) }).catch(() => {});
  }

  return (
    <div>
      <div style={sectionStyle}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" }}>
          <div>
            <div style={{ fontSize: "0.92rem", fontWeight: 600, color: "#f0f2ff" }}>Publish this funnel</div>
            <div style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.5)", marginTop: 2 }}>
              While off, nothing here is visible to visitors.
            </div>
          </div>
          <Toggle checked={funnel.enabled} onChange={(v) => patchFunnel({ enabled: v })} />
        </div>
      </div>

      <div style={sectionStyle}>
        <div style={{ fontSize: "0.92rem", fontWeight: 600, color: "#f0f2ff", marginBottom: "0.9rem" }}>How visitors sign up</div>

        <div style={{ marginBottom: "1rem" }}>
          <SegmentedChoice
            value={funnel.signupMode}
            onChange={(mode) => patchFunnel({ signupMode: mode })}
            options={[{ value: "FREE", label: "Free" }, { value: "PAID", label: "Paid" }]}
          />
        </div>

        {funnel.signupMode === "PAID" && (
          <PaidSignupPicker
            templateId={templateId}
            currency={currency}
            onCurrencyChange={setCurrency}
            products={products}
            selectedProductId={funnel.signupProductId}
            onProductCreated={(product) => setProducts((prev) => [...prev, product])}
            onSelect={(productId) => patchFunnel({ signupProductId: productId })}
          />
        )}

        <label style={{ display: "flex", alignItems: "center", gap: "0.6rem", fontSize: "0.85rem", color: "#f0f2ff", cursor: "pointer", marginBottom: "0.6rem" }}>
          <input type="checkbox" checked={funnel.collectPhone} onChange={(e) => patchFunnel({ collectPhone: e.target.checked })} />
          Also collect phone number
        </label>
      </div>

      <div style={sectionStyle}>
        <div style={{ fontSize: "0.92rem", fontWeight: 600, color: "#f0f2ff", marginBottom: "0.4rem" }}>Embed your signup form</div>
        <div style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.5)", marginBottom: "0.9rem" }}>
          Your funnel's page already has this — a new funnel starts pre-built with it. Removed it, redesigning from scratch, or hand-writing raw HTML instead of using the drag-and-drop builder? Paste this anywhere and it becomes a real, working signup form the moment the page loads.
        </div>
        <EmbedSnippetBox snippet={embedSnippet} />
      </div>

      <div style={sectionStyle}>
        <div style={{ fontSize: "0.92rem", fontWeight: 600, color: "#f0f2ff", marginBottom: "0.4rem" }}>Builder experience</div>
        <div style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.5)", marginBottom: "0.9rem" }}>
          Changes how much guidance the page builder shows you — never affects what visitors see.
        </div>
        <SegmentedChoice
          value={builderLevel}
          onChange={(level) => changeBuilderLevel(level)}
          options={[
            { value: "BEGINNER", label: "Guided" },
            { value: "INTERMEDIATE", label: "Checklist" },
            { value: "PROFESSIONAL", label: "Everything visible" },
          ]}
        />
      </div>

      {error && <div style={{ fontSize: "0.8rem", color: "#f87171" }}>{error}</div>}
      {saving && <div style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.4)" }}>Saving…</div>}
    </div>
  );
}

/**
 * The one copyable snippet — same string funnelStarterDesign.ts pre-seeds a new funnel's
 * page with (lib/lms/embedSnippet.ts is the single source for both). Works identically
 * pasted into a raw HTML upload or an 'html' block on the visual canvas — no plexo-sdk
 * change either way, see public/lms-signup.js's own doc comment for why.
 */
function EmbedSnippetBox({ snippet }: { snippet: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <pre style={{
        margin: 0, padding: "0.85rem 1rem", borderRadius: 10, background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.1)", color: "#c4b5fd", fontSize: "0.78rem", fontFamily: "ui-monospace, monospace",
        overflowX: "auto", whiteSpace: "pre",
      }}>
        {snippet}
      </pre>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(snippet).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }, () => {});
        }}
        style={{ marginTop: "0.6rem", padding: "0.5rem 0.9rem", borderRadius: 8, fontSize: "0.8rem", fontWeight: 700, background: "var(--brand, #8b5cf6)", color: "#fff", border: "none", cursor: "pointer" }}
      >
        {copied ? "Copied!" : "Copy snippet"}
      </button>
    </div>
  );
}

function CurrencyGrid({ value, onChange, disabled }: { value: string; onChange: (code: string) => void; disabled?: boolean }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(64px, 1fr))", gap: "0.5rem", maxWidth: 480 }}>
      {SUPPORTED_STORE_CURRENCIES.map((c) => {
        const selected = c.code === value;
        return (
          <button
            key={c.code}
            type="button"
            disabled={disabled}
            onClick={() => onChange(c.code)}
            style={{
              position: "relative", borderRadius: 10, padding: "0.55rem", textAlign: "center", fontFamily: "inherit",
              cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.6 : 1,
              border: selected ? "1.5px solid var(--brand, #8b5cf6)" : "1px solid rgba(255,255,255,0.1)",
              background: selected ? "rgba(139,92,246,0.15)" : "rgba(255,255,255,0.03)",
            }}
          >
            <div style={{ fontSize: "1rem", fontWeight: 700, color: "#f0f2ff" }}>{c.symbol}</div>
            <div style={{ fontSize: "0.62rem", fontWeight: 600, color: "rgba(240,242,255,0.55)", marginTop: 1 }}>{c.code}</div>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Charging for signup used to require leaving Settings, creating a product under Commerce,
 * then coming back to link it — a real context switch for what's conceptually one step
 * ("how much, in what currency, and what do they get"). This creates the product inline
 * instead: pick (or confirm) the site's currency using the exact same currency-grid pattern
 * Commerce's own General settings uses, then a minimal digital product (ACCESS_LIST
 * delivery, since gating is actually via LmsEnrollment, not Commerce's own digital-delivery
 * token — see lib/lms/enrollment.ts) with just a name and price, created and linked in one
 * click. Existing products still show in the dropdown for anyone who already has one to reuse.
 */
function PaidSignupPicker({
  templateId, currency, onCurrencyChange, products, selectedProductId, onProductCreated, onSelect,
}: {
  templateId: string;
  currency: string;
  onCurrencyChange: (currency: string) => void;
  products: Product[];
  selectedProductId: string | null;
  onProductCreated: (product: Product) => void;
  onSelect: (productId: string | null) => void;
}) {
  const [creating, setCreating] = useState(products.length === 0);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [pendingCurrency, setPendingCurrency] = useState(currency);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const symbol = SUPPORTED_STORE_CURRENCIES.find((c) => c.code === pendingCurrency)?.symbol ?? pendingCurrency;

  async function createAndLink() {
    setBusy(true);
    setError(null);
    try {
      const priceMinor = Math.round(Number(amount) * 100);
      if (!name.trim() || !Number.isFinite(priceMinor) || priceMinor <= 0) {
        throw new Error("Enter a name and a price greater than zero.");
      }

      if (pendingCurrency !== currency) {
        const settingsRes = await fetch(`/api/v1/commerce/${templateId}/settings`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ currency: pendingCurrency }),
        });
        const settingsBody = await settingsRes.json().catch(() => ({}));
        if (!settingsRes.ok) throw new Error(settingsBody.error || "Could not set the currency.");
        onCurrencyChange(pendingCurrency);
      }

      const res = await fetch(`/api/v1/commerce/${templateId}/products`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          kind: "DIGITAL",
          priceMinor,
          digitalDeliveryMethod: "ACCESS_LIST",
          digitalAccessInstructions: "You'll get access automatically by email as soon as payment goes through.",
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not create the product.");
      onProductCreated({ id: body.product.id, name: body.product.name });
      onSelect(body.product.id);
      setCreating(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (!creating) {
    return (
      <div style={{ marginBottom: "1rem", maxWidth: 420 }}>
        <div style={{ fontSize: "0.78rem", fontWeight: 600, color: "#c5cbe8", marginBottom: "0.35rem" }}>Charge for signup using</div>
        <select value={selectedProductId ?? ""} onChange={(e) => (e.target.value === "__new__" ? setCreating(true) : onSelect(e.target.value || null))} style={inputStyle}>
          <option value="">Select a product…</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          <option value="__new__">+ Create a new product…</option>
        </select>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: "1rem", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "0.9rem 1rem", maxWidth: 560 }}>
      <div style={{ fontSize: "0.78rem", fontWeight: 600, color: "#c5cbe8", marginBottom: "0.5rem" }}>Currency</div>
      <CurrencyGrid value={pendingCurrency} onChange={setPendingCurrency} />

      <div style={{ fontSize: "0.82rem", fontWeight: 600, color: "#f0f2ff", margin: "1rem 0 0.6rem" }}>What are visitors paying for?</div>
      <div style={{ display: "flex", gap: "0.6rem", marginBottom: "0.7rem" }}>
        <input style={{ ...inputStyle, flex: 2 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Full course access" />
        <input style={{ ...inputStyle, flex: 1 }} type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={`${symbol}0`} />
      </div>
      {error && <div style={{ fontSize: "0.78rem", color: "#f87171", marginBottom: "0.6rem" }}>{error}</div>}
      <div style={{ display: "flex", gap: "0.6rem" }}>
        <button
          type="button"
          onClick={createAndLink}
          disabled={busy}
          style={{ padding: "0.5rem 0.9rem", borderRadius: 8, fontSize: "0.8rem", fontWeight: 700, background: "var(--brand, #8b5cf6)", color: "#fff", border: "none", cursor: "pointer", opacity: busy ? 0.6 : 1 }}
        >
          {busy ? "Creating…" : "Create & use for signup"}
        </button>
        {products.length > 0 && (
          <button type="button" onClick={() => setCreating(false)} disabled={busy} style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.5)", background: "none", border: "none", cursor: "pointer" }}>
            Use an existing product instead
          </button>
        )}
      </div>
    </div>
  );
}
