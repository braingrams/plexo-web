"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SUPPORTED_STORE_CURRENCIES } from "@/lib/commerce/currency";
import type { CommerceButtonRadius, CommerceTheme } from "@/lib/commerce/deriveCommerceTheme";
import { ColorSwatchPicker } from "@/app/dashboard/templates/[id]/ColorSwatchPicker";
import { SettingsActionBar } from "../_components/SettingsActionBar";

type LayoutInfo = { templateId: string; ready: boolean } | null;
type LayoutCandidate = { layoutTemplateId: string; layoutName: string; siteName: string; updatedAt: string };

type InitialGeneralSettings = {
  enabled: boolean;
  currency: string;
  productDetailLayout: LayoutInfo;
  themeAccentColor: string | null;
  themeButtonRadius: CommerceButtonRadius | null;
  autoDetectedTheme: CommerceTheme | null;
};

const RADIUS_OPTIONS: { value: CommerceButtonRadius; label: string; preview: string }[] = [
  { value: "sharp", label: "Sharp", preview: "2px" },
  { value: "rounded", label: "Rounded", preview: "10px" },
  { value: "pill", label: "Pill", preview: "100px" },
];

const inputStyle: React.CSSProperties = {
  width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 9, color: "#f0f2ff", padding: "0.6rem 0.8rem", fontSize: "0.85rem",
  outline: "none", fontFamily: "inherit",
};

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: "1.4rem", marginBottom: "1.25rem" }}>
      <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "#f0f2ff", margin: 0 }}>{title}</h2>
      {description && <p style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.45)", margin: "0.3rem 0 1rem" }}>{description}</p>}
      <div style={{ display: "grid", gap: "0.9rem", marginTop: description ? 0 : "1rem" }}>{children}</div>
    </div>
  );
}

function ProductDetailLayoutSection({ templateId, layout }: { templateId: string; layout: LayoutInfo }) {
  const router = useRouter();
  const [showPicker, setShowPicker] = useState(false);
  const [candidates, setCandidates] = useState<LayoutCandidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The common path never calls this — ensureProductDetailLayout (server-side, in the
  // settings PUT route) already creates a working starter page the moment Commerce is
  // enabled and saved. This is only a defensive fallback for the rare case that somehow
  // didn't happen yet (e.g. enabled locally but not saved yet).
  async function handleCreateNow() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/commerce/${templateId}/product-detail-layout`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't create a layout. Try again.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create a layout. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleShowPicker() {
    setShowPicker(true);
    if (candidates === null) {
      const res = await fetch(`/api/v1/commerce/${templateId}/product-detail-layout`);
      const data = await res.json();
      setCandidates(res.ok ? data.candidates : []);
    }
  }

  async function handleUseExisting(sourceLayoutTemplateId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/commerce/${templateId}/product-detail-layout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceLayoutTemplateId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't use that layout. Try again.");
      router.push(`/dashboard/templates/${data.layoutTemplateId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't use that layout. Try again.");
      setBusy(false);
    }
  }

  async function handleDetach() {
    if (!confirm("Turn off product pages? Products will 404 until you attach a layout again. Your design stays saved and can be re-attached later.")) return;
    setBusy(true);
    try {
      await fetch(`/api/v1/commerce/${templateId}/product-detail-layout`, { method: "DELETE" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="Product page"
      description="One reusable page design serves every product's own URL (e.g. /shop/your-product) — created automatically with a working default the moment Commerce is enabled. Customize it any time, or reuse a design from another site."
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" }}>
        <div>
          <p style={{ fontSize: "0.75rem", color: layout ? (layout.ready ? "#4ade80" : "#f59e0b") : "rgba(240,242,255,0.4)", margin: 0 }}>
            {!layout ? "Will be created automatically once you enable and save Commerce." : layout.ready ? "Product page is live — using the default design." : "Draft — the required block was removed, re-add it to go live."}
          </p>
        </div>
        {layout ? (
          <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
            <a
              href={`/dashboard/templates/${layout.templateId}`}
              style={{ padding: "0.5rem 0.9rem", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "#f0f2ff", fontSize: "0.8rem", fontWeight: 600, textDecoration: "none" }}
            >
              Edit design
            </a>
            <button type="button" onClick={() => void handleDetach()} disabled={busy} style={{ padding: "0.5rem 0.9rem", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "rgba(240,242,255,0.5)", fontSize: "0.8rem", cursor: busy ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
              Turn off
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
            <button type="button" onClick={() => void handleShowPicker()} disabled={busy} style={{ padding: "0.5rem 0.9rem", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "rgba(240,242,255,0.6)", fontSize: "0.8rem", cursor: busy ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
              Use a design from another site
            </button>
            <button type="button" onClick={() => void handleCreateNow()} disabled={busy} style={{ padding: "0.5rem 0.9rem", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.03)", color: "rgba(240,242,255,0.7)", fontSize: "0.8rem", cursor: busy ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
              {busy ? "Creating…" : "Create it now"}
            </button>
          </div>
        )}
      </div>

      {error && <p style={{ fontSize: "0.78rem", color: "#f87171", margin: 0 }}>{error}</p>}

      {showPicker && !layout && (
        <div style={{ marginTop: "0.25rem" }}>
          {candidates === null ? (
            <p style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.4)" }}>Loading…</p>
          ) : candidates.length === 0 ? (
            <p style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.4)" }}>No other product pages to reuse yet — it'll be created automatically instead.</p>
          ) : (
            <div style={{ display: "grid", gap: "0.5rem" }}>
              {candidates.map((c) => (
                <div key={c.layoutTemplateId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" }}>
                  <span style={{ fontSize: "0.8rem", color: "#f0f2ff" }}>
                    {c.layoutName} <span style={{ color: "rgba(240,242,255,0.4)" }}>— from {c.siteName} · updated {new Date(c.updatedAt).toLocaleDateString()}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleUseExisting(c.layoutTemplateId)}
                    disabled={busy}
                    style={{ padding: "0.35rem 0.7rem", borderRadius: 7, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "#f0f2ff", fontSize: "0.75rem", cursor: busy ? "not-allowed" : "pointer", fontFamily: "inherit", flexShrink: 0 }}
                  >
                    Use this
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

function CurrencyGrid({ value, onChange, disabled }: { value: string; onChange: (code: string) => void; disabled: boolean }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))", gap: "0.6rem" }}>
      {SUPPORTED_STORE_CURRENCIES.map((c) => {
        const selected = c.code === value;
        return (
          <button
            key={c.code}
            type="button"
            disabled={disabled}
            onClick={() => onChange(c.code)}
            style={{
              position: "relative",
              borderRadius: 11,
              padding: "0.7rem",
              textAlign: "center",
              cursor: disabled ? "not-allowed" : "pointer",
              fontFamily: "inherit",
              border: selected ? "1.5px solid var(--brand)" : "1px solid rgba(255,255,255,0.1)",
              background: selected ? "var(--brand-subtle)" : "rgba(255,255,255,0.03)",
              opacity: disabled ? 0.6 : 1,
            }}
          >
            {selected && (
              <span style={{ position: "absolute", top: 6, right: 6, width: 14, height: 14, borderRadius: "50%", background: "var(--brand)", display: "grid", placeItems: "center" }}>
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
            )}
            <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "#f0f2ff" }}>{c.symbol}</div>
            <div style={{ fontSize: "0.7rem", fontWeight: 600, color: "rgba(240,242,255,0.55)", marginTop: 2 }}>{c.code}</div>
          </button>
        );
      })}
    </div>
  );
}

/** The shop grid, cart/checkout controls, and newsletter signup button (public/commerce.js)
 * default to matching this site's own dominant button color/shape automatically — see
 * lib/commerce/deriveCommerceTheme.ts. Overriding here is optional; "Automatic" always
 * shows what that auto-detection currently resolves to, so the merchant can see it before
 * deciding whether to override it. */
function AppearanceSection({
  accentColor, onAccentColorChange, buttonRadius, onButtonRadiusChange, autoDetected, disabled,
}: {
  accentColor: string | null;
  onAccentColorChange: (value: string | null) => void;
  buttonRadius: CommerceButtonRadius | null;
  onButtonRadiusChange: (value: CommerceButtonRadius | null) => void;
  autoDetected: CommerceTheme | null;
  disabled: boolean;
}) {
  const effectiveColor = accentColor ?? autoDetected?.accentColor ?? "#16233F";
  const effectiveRadius = buttonRadius ?? autoDetected?.buttonRadius ?? "sharp";

  return (
    <Section
      title="Commerce widget appearance"
      description="The shop grid, cart, checkout, and newsletter signup button match your site's own colors automatically. Override below only if you want something different."
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "#f0f2ff" }}>Accent color</span>
        <div style={{ display: "flex", alignItems: "center", gap: "0.7rem" }}>
          <div style={{ pointerEvents: disabled ? "none" : undefined, opacity: disabled ? 0.5 : 1 }}>
            <ColorSwatchPicker value={effectiveColor} onChange={(v) => onAccentColorChange(v)} />
          </div>
          <span style={{ fontSize: "0.75rem", color: "rgba(240,242,255,0.45)" }}>
            {accentColor ? "Custom" : `Automatic — detected ${autoDetected?.accentColor ?? "no signal yet, using default"}`}
          </span>
          {accentColor && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onAccentColorChange(null)}
              style={{ padding: "0.3rem 0.6rem", borderRadius: 7, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "#f0f2ff", fontSize: "0.72rem", cursor: disabled ? "not-allowed" : "pointer", fontFamily: "inherit" }}
            >
              Reset to automatic
            </button>
          )}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "#f0f2ff" }}>Button shape</span>
        <div style={{ display: "flex", gap: "0.6rem" }}>
          {RADIUS_OPTIONS.map((opt) => {
            const selected = effectiveRadius === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                disabled={disabled}
                onClick={() => onButtonRadiusChange(opt.value)}
                style={{
                  padding: "0.5rem 0.9rem",
                  fontSize: "0.78rem",
                  fontFamily: "inherit",
                  cursor: disabled ? "not-allowed" : "pointer",
                  color: "#f0f2ff",
                  border: selected ? "1.5px solid var(--brand)" : "1px solid rgba(255,255,255,0.1)",
                  background: selected ? "var(--brand-subtle)" : "rgba(255,255,255,0.03)",
                  borderRadius: opt.preview,
                }}
              >
                {opt.label}
              </button>
            );
          })}
          {buttonRadius && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onButtonRadiusChange(null)}
              style={{ padding: "0.3rem 0.6rem", borderRadius: 7, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "#f0f2ff", fontSize: "0.72rem", cursor: disabled ? "not-allowed" : "pointer", fontFamily: "inherit" }}
            >
              Reset to automatic
            </button>
          )}
        </div>
        {!buttonRadius && (
          <span style={{ fontSize: "0.75rem", color: "rgba(240,242,255,0.45)" }}>
            Automatic — currently {autoDetected?.buttonRadius ?? "sharp (default, no signal yet)"}
          </span>
        )}
      </div>
    </Section>
  );
}

/** Wraps a section that only makes sense once Commerce is enabled — dimmed and
 * non-interactive with a one-line explanation instead of the real controls, so the page
 * reads as a sequence (enable, then configure) rather than a pile of independent choices. */
function Locked({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ opacity: 0.45, pointerEvents: "none", userSelect: "none" }} aria-disabled="true">
      {children}
    </div>
  );
}

export function GeneralSettingsClient({ templateId, initial }: { templateId: string; initial: InitialGeneralSettings }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [currency, setCurrency] = useState(initial.currency);
  const [themeAccentColor, setThemeAccentColor] = useState(initial.themeAccentColor);
  const [themeButtonRadius, setThemeButtonRadius] = useState(initial.themeButtonRadius);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error" | "warning"; text: string } | null>(null);

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/commerce/${templateId}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // Empty string is this route's existing convention for "clear it" (see paystackTestPublicKey
        // etc. in the PUT handler) — null here means "no override," so it round-trips to "".
        body: JSON.stringify({ enabled, currency, themeAccentColor: themeAccentColor ?? "", themeButtonRadius: themeButtonRadius ?? "" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save settings.");
      setMessage(data.warning ? { kind: "warning", text: data.warning } : { kind: "success", text: "Settings saved." });
      // Enabling just triggered ensureProductDetailLayout server-side — re-fetch so the
      // Product page section below picks up the newly-attached layout without a manual reload.
      router.refresh();
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Failed to save settings." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <Section title="Enable Commerce" description="Turns on the storefront script and unlocks the rest of this page — do this first.">
        <label style={{ display: "flex", alignItems: "center", gap: "0.7rem", cursor: "pointer" }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} style={{ width: 18, height: 18 }} />
          <span style={{ fontSize: "0.85rem", color: "#f0f2ff" }}>
            {enabled ? "Commerce is live on this site." : "Commerce is off — the storefront script won't load."}
          </span>
        </label>
      </Section>

      {enabled ? (
        <>
          <Section title="Store currency" description="Every price, the storefront, checkout and your wallet all follow this. Changing it later doesn't convert existing prices, and isn't allowed once this site has any orders.">
            <CurrencyGrid value={currency} onChange={setCurrency} disabled={saving} />
          </Section>
          <ProductDetailLayoutSection templateId={templateId} layout={initial.productDetailLayout} />
          <AppearanceSection
            accentColor={themeAccentColor}
            onAccentColorChange={setThemeAccentColor}
            buttonRadius={themeButtonRadius}
            onButtonRadiusChange={setThemeButtonRadius}
            autoDetected={initial.autoDetectedTheme}
            disabled={saving}
          />
        </>
      ) : (
        <Locked>
          <Section title="Store currency" description="Every price, the storefront, checkout and your wallet all follow this. Changing it later doesn't convert existing prices, and isn't allowed once this site has any orders.">
            <CurrencyGrid value={currency} onChange={() => {}} disabled />
          </Section>
          <Section title="Product page" description="Created automatically with a working default the moment Commerce is enabled.">
            <p style={{ fontSize: "0.75rem", color: "rgba(240,242,255,0.4)", margin: 0 }}>Enable Commerce above to set this up.</p>
          </Section>
        </Locked>
      )}

      <SettingsActionBar saving={saving} message={message} onSave={() => void handleSave()} />
    </div>
  );
}
