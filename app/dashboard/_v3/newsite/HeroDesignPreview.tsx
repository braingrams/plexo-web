"use client";

import { useEffect, useRef, useState } from "react";
import { Laptop, Smartphone, Tablet, RefreshCw } from "lucide-react";
import { SolGlyph } from "../sol/SolGlyph";
import { Button } from "../ui";
import { getStoredViewport, setStoredViewport, type ViewportMode } from "@/lib/dashboardV3/previewViewport";

export type HeroDesignPreviewProps = {
  html: string | null;
  designName: string;
  designDescription?: string;
  siteName: string;
  /** "Personalize with SOL" was pressed (the screen decides what happens: confirm, then open the studio). */
  onPersonalize?: () => void;
  /** While set, SOL Studio replaces the preview and the personalize button waits. */
  studio?: React.ReactNode;
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
  studio,
  personalized,
  onSeeAll,
  totalDesigns = 0,
}: HeroDesignPreviewProps) {
  const [device, setDevice] = useState<ViewportMode>("desktop");
  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number }>({ width: 0, height: 600 });

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const update = () => {
      if (el.clientWidth > 0 && el.clientHeight > 0) {
        setCanvasSize({ width: el.clientWidth, height: el.clientHeight });
      }
    };
    update();
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setCanvasSize({ width, height });
        }
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    setDevice(getStoredViewport());
  }, []);

  function handleSetDevice(m: ViewportMode) {
    setDevice(m);
    setStoredViewport(m);
  }

  const displayUrl = `${(siteName || "mysite").toLowerCase().replace(/[^a-z0-9]/g, "")}.plexopages.com`;

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
          gap: 8,
          flexWrap: "wrap",
          minWidth: 0,
        }}
      >
        <style>{`@media (max-width: 720px){.plx-hero-url{display:none !important}.plx-hero-bar-actions{width:100%;justify-content:space-between}}`}</style>
        {/* Left: Window Dots & Template Name */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flexShrink: 1 }}>
          <div style={{ display: "flex", gap: 6 }} aria-hidden>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--plx-danger)", display: "inline-block" }} />
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--plx-warning)", display: "inline-block" }} />
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--plx-success)", display: "inline-block" }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--plx-text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
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
                  whiteSpace: "nowrap",
                }}
              >
                <SolGlyph size={12} /> Personalized
              </span>
            )}
          </div>
        </div>

        {/* Center: URL pill */}
        <div
          className="plx-hero-url"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: "var(--plx-surface)",
            padding: "4px 12px",
            borderRadius: 8,
            border: "1px solid var(--plx-border)",
            fontSize: 12,
            color: "var(--plx-muted)",
            maxWidth: 240,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flexShrink: 1,
          }}
        >
          <span style={{ color: "var(--plx-text)", fontWeight: 600 }}>https://</span>
          {displayUrl}
        </div>

        {/* Right: Device switch + Personalize button */}
        <div className="plx-hero-bar-actions" style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, marginLeft: "auto" }}>
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
              onClick={() => handleSetDevice("desktop")}
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
              aria-checked={device === "tablet"}
              onClick={() => handleSetDevice("tablet")}
              title="Tablet view"
              style={{
                display: "grid",
                placeItems: "center",
                width: 30,
                height: 26,
                borderRadius: 6,
                border: 0,
                background: device === "tablet" ? "var(--plx-tint)" : "transparent",
                color: device === "tablet" ? "var(--plx-deep)" : "var(--plx-muted)",
                cursor: "pointer",
              }}
            >
              <Tablet size={15} />
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={device === "mobile"}
              onClick={() => handleSetDevice("mobile")}
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
              leftIcon={<SolGlyph size={14} />}
              onClick={onPersonalize}
              disabled={!!studio || !html}
              title="SOL rewrites this design's words for your business and adds your logo"
            >
              {personalized ? "Re-personalize with SOL" : "Personalize with SOL"}
            </Button>
          )}
        </div>
      </div>

      {/* Main Interactive Scrollable Preview Canvas */}
      <div
        ref={canvasRef}
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
        {studio ? (
          <div style={{ position: "absolute", inset: 0, display: "flex" }}>{studio}</div>
        ) : !html ? (
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
        ) : device === "desktop" ? (() => {
          const targetW = 1280;
          const availW = canvasSize.width || targetW;
          const availH = canvasSize.height || 600;
          const scale = availW < targetW ? availW / targetW : 1;
          const visualW = Math.round(targetW * scale);
          const frameH = scale > 0 ? Math.round(availH / scale) : availH;
          return (
            <div
              style={{
                position: "relative",
                width: `${visualW}px`,
                height: "100%",
                overflow: "hidden",
                margin: "0 auto",
              }}
            >
              <iframe
                key="desktop-frame"
                title={`${designName} preview`}
                srcDoc={html}
                sandbox="allow-same-origin allow-scripts"
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: `${targetW}px`,
                  height: `${frameH}px`,
                  transform: scale < 1 ? `scale(${scale})` : undefined,
                  transformOrigin: "top left",
                  border: 0,
                  background: "var(--plx-surface)",
                  display: "block",
                }}
              />
            </div>
          );
        })() : device === "tablet" ? (
          <div
            style={{
              width: "100%",
              maxWidth: 768,
              height: "100%",
              minHeight: 560,
              margin: "12px auto",
              borderRadius: 20,
              border: "8px solid var(--plx-border-strong)",
              boxShadow: "var(--plx-shadow-card)",
              overflow: "hidden",
              background: "var(--plx-surface)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <iframe
              key="tablet-frame"
              title={`${designName} tablet preview`}
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
          </div>
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
