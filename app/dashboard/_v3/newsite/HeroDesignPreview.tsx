"use client";

import { useState } from "react";
import { Laptop, Smartphone, Sparkles, RefreshCw } from "lucide-react";
import { SolGlyph } from "../sol/SolGlyph";
import { Button } from "../ui";

export type HeroDesignPreviewProps = {
  html: string | null;
  designName: string;
  designDescription?: string;
  siteName: string;
  onPersonalize?: () => void;
  isPersonalizing?: boolean;
  personalized?: boolean;
  onSeeAll?: () => void;
  totalDesigns?: number;
};

export function HeroDesignPreview({
  html,
  designName,
  designDescription,
  siteName,
  onPersonalize,
  isPersonalizing,
  personalized,
  onSeeAll,
  totalDesigns = 0,
}: HeroDesignPreviewProps) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const displayUrl = `${(siteName || "mysite").toLowerCase().replace(/[^a-z0-9]/g, "")}.plexo.site`;

  return (
    <div
      className="plx-hero-preview-container"
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        borderRadius: "var(--plx-radius-card-lg, 16px)",
        border: "1px solid var(--plx-border)",
        background: "var(--plx-surface)",
        overflow: "hidden",
        boxShadow: "var(--plx-shadow-card)",
      }}
    >
      {/* Top Browser Bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 16px",
          background: "var(--plx-sunken)",
          borderBottom: "1px solid var(--plx-border)",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        {/* Left: Window Dots & Template Name */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", gap: 6 }} aria-hidden>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--plx-danger)", display: "inline-block" }} />
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--plx-warning)", display: "inline-block" }} />
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--plx-success)", display: "inline-block" }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--plx-text)" }}>
              {designName || "Selected Design"}
            </span>
            {personalized && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "2px 8px",
                  borderRadius: 999,
                  background: "color-mix(in srgb, var(--plx-brand) 20%, transparent)",
                  color: "var(--plx-deep, var(--plx-brand))",
                  border: "1px solid color-mix(in srgb, var(--plx-brand) 30%, transparent)",
                }}
              >
                <Sparkles size={11} /> Personalized by SOL
              </span>
            )}
          </div>
        </div>

        {/* Center: URL pill */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: "var(--plx-surface)",
            padding: "4px 14px",
            borderRadius: 8,
            border: "1px solid var(--plx-border)",
            fontSize: 12,
            color: "var(--plx-muted)",
            maxWidth: 280,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ color: "var(--plx-text)", fontWeight: 600 }}>https://</span>
          {displayUrl}
        </div>

        {/* Right: Device switch + Personalize button */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* Device toggle */}
          <div
            role="radiogroup"
            aria-label="Device viewport"
            style={{
              display: "flex",
              alignItems: "center",
              background: "var(--plx-surface)",
              borderRadius: 8,
              border: "1px solid var(--plx-border)",
              padding: 2,
            }}
          >
            <button
              type="button"
              role="radio"
              aria-checked={device === "desktop"}
              onClick={() => setDevice("desktop")}
              title="Desktop view"
              style={{
                display: "grid",
                placeItems: "center",
                width: 30,
                height: 26,
                borderRadius: 6,
                border: 0,
                background: device === "desktop" ? "var(--plx-tint)" : "transparent",
                color: device === "desktop" ? "var(--plx-deep)" : "var(--plx-muted)",
                cursor: "pointer",
              }}
            >
              <Laptop size={15} />
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={device === "mobile"}
              onClick={() => setDevice("mobile")}
              title="Mobile phone view"
              style={{
                display: "grid",
                placeItems: "center",
                width: 30,
                height: 26,
                borderRadius: 6,
                border: 0,
                background: device === "mobile" ? "var(--plx-tint)" : "transparent",
                color: device === "mobile" ? "var(--plx-deep)" : "var(--plx-muted)",
                cursor: "pointer",
              }}
            >
              <Smartphone size={15} />
            </button>
          </div>

          {/* Personalize with SOL */}
          {onPersonalize && (
            <Button
              size="sm"
              variant={personalized ? "secondary" : "primary"}
              loading={isPersonalizing}
              loadingLabel="Personalizing…"
              leftIcon={<SolGlyph size={14} />}
              onClick={onPersonalize}
            >
              {personalized ? "Re-personalize with SOL" : "Personalize this template with SOL"}
            </Button>
          )}

          {onSeeAll && (
            <Button size="sm" variant="ghost" onClick={onSeeAll}>
              {totalDesigns > 1 ? `Change design (${totalDesigns})` : "Change design"}
            </Button>
          )}
        </div>
      </div>

      {/* Main Interactive Scrollable Preview Canvas */}
      <div
        style={{
          position: "relative",
          width: "100%",
          height: 600,
          background: device === "mobile" ? "var(--plx-sunken)" : "var(--plx-surface)",
          display: "flex",
          justifyContent: "center",
          alignItems: "flex-start",
          overflowY: "hidden",
          transition: "background 0.2s ease",
        }}
      >
        {!html ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              color: "var(--plx-muted)",
              fontSize: 15,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
              <RefreshCw size={24} className="plx-spin" />
              <span>Preparing high-resolution design preview…</span>
            </div>
          </div>
        ) : device === "desktop" ? (
          <iframe
            key="desktop-frame"
            title={`${designName} preview`}
            srcDoc={html}
            sandbox="allow-same-origin allow-scripts"
            style={{
              width: "100%",
              height: "100%",
              border: 0,
              background: "var(--plx-surface)",
              display: "block",
            }}
          />
        ) : (
          <div
            style={{
              width: 375,
              height: 560,
              margin: "20px auto",
              borderRadius: 36,
              border: "10px solid var(--plx-border-strong)",
              boxShadow: "var(--plx-shadow-card)",
              overflow: "hidden",
              position: "relative",
              background: "var(--plx-surface)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* Mobile notch pill */}
            <div
              style={{
                position: "absolute",
                top: 0,
                left: "50%",
                transform: "translateX(-50%)",
                width: 100,
                height: 16,
                background: "var(--plx-border-strong)",
                borderBottomLeftRadius: 10,
                borderBottomRightRadius: 10,
                zIndex: 10,
              }}
              aria-hidden
            />
            <iframe
              key="mobile-frame"
              title={`${designName} mobile preview`}
              srcDoc={html}
              sandbox="allow-same-origin allow-scripts"
              style={{
                width: "100%",
                height: "100%",
                border: 0,
                background: "var(--plx-surface)",
                display: "block",
                paddingTop: 8,
              }}
            />
          </div>
        )}
      </div>

      {designDescription && (
        <div
          style={{
            padding: "10px 18px",
            background: "var(--plx-surface)",
            borderTop: "1px solid var(--plx-border)",
            fontSize: 13,
            color: "var(--plx-muted)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span>{designDescription}</span>
          <span style={{ fontSize: 12, fontWeight: 600 }}>Scroll inside to inspect entire page</span>
        </div>
      )}
    </div>
  );
}
