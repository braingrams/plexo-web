"use client";

import { useEffect, useState } from "react";
import { Laptop, Monitor, Smartphone, Tablet } from "lucide-react";
import {
  getStoredViewport,
  setStoredViewport,
  type ViewportMode,
  VIEWPORT_OPTIONS,
} from "@/lib/dashboardV3/previewViewport";

export type PreviewViewportFrameProps = {
  html: string | null;
  title?: string;
  urlBadge?: string;
  height?: number | string;
  extraControls?: React.ReactNode;
  device?: ViewportMode;
  onDeviceChange?: (mode: ViewportMode) => void;
  showTopBar?: boolean;
  emptyMessage?: string;
};

export function PreviewViewportFrame({
  html,
  title,
  urlBadge,
  height = 560,
  extraControls,
  device: controlledDevice,
  onDeviceChange,
  showTopBar = true,
  emptyMessage = "No preview available yet",
}: PreviewViewportFrameProps) {
  const [internalDevice, setInternalDevice] = useState<ViewportMode>("desktop");

  useEffect(() => {
    setInternalDevice(getStoredViewport());
  }, []);

  const currentDevice = controlledDevice ?? internalDevice;

  const handleDeviceChange = (mode: ViewportMode) => {
    setStoredViewport(mode);
    setInternalDevice(mode);
    onDeviceChange?.(mode);
  };

  return (
    <div
      className="plx-viewport-frame"
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
      {/* Top Browser & Viewport Bar */}
      {showTopBar && (
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
          {/* Left: Window Dots & Title */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ display: "flex", gap: 6 }} aria-hidden>
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--plx-danger)", display: "inline-block" }} />
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--plx-warning)", display: "inline-block" }} />
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--plx-success)", display: "inline-block" }} />
            </div>
            {title && (
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--plx-text)" }}>
                {title}
              </span>
            )}
          </div>

          {/* Center: URL Badge */}
          {urlBadge && (
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
              {urlBadge}
            </div>
          )}

          {/* Right: Viewport Controls & Extra Actions */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {/* Viewport switch: Desktop, Tab, Mobile */}
            <div
              role="radiogroup"
              aria-label="Screen preview size"
              style={{
                display: "flex",
                alignItems: "center",
                background: "var(--plx-surface)",
                borderRadius: 8,
                border: "1px solid var(--plx-border)",
                padding: 2,
                gap: 2,
              }}
            >
              {VIEWPORT_OPTIONS.map((opt) => {
                const isActive = currentDevice === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    onClick={() => handleDeviceChange(opt.id)}
                    title={`${opt.label} view`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "4px 8px",
                      borderRadius: 6,
                      border: 0,
                      background: isActive ? "var(--plx-tint)" : "transparent",
                      color: isActive ? "var(--plx-deep)" : "var(--plx-muted)",
                      fontWeight: isActive ? 700 : 500,
                      fontSize: 12,
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                  >
                    {opt.id === "desktop" ? (
                      <Laptop size={14} />
                    ) : opt.id === "tablet" ? (
                      <Tablet size={14} />
                    ) : (
                      <Smartphone size={14} />
                    )}
                    <span>{opt.label}</span>
                  </button>
                );
              })}
            </div>

            {extraControls}
          </div>
        </div>
      )}

      {/* Main Interactive Canvas */}
      <div
        style={{
          position: "relative",
          width: "100%",
          height: typeof height === "number" ? `${height}px` : height,
          background: currentDevice === "desktop" ? "var(--plx-surface)" : "var(--plx-sunken)",
          display: "flex",
          justifyContent: "center",
          alignItems: "flex-start",
          overflowY: "auto",
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
              fontSize: 14,
              padding: 20,
              textAlign: "center",
            }}
          >
            <span>{emptyMessage}</span>
          </div>
        ) : currentDevice === "desktop" ? (
          <iframe
            key="viewport-desktop"
            title={title || "Desktop preview"}
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
        ) : currentDevice === "tablet" ? (
          /* Tablet (Tab) Frame: 768px */
          <div
            style={{
              width: "min(768px, 94%)",
              height: "calc(100% - 32px)",
              margin: "16px auto",
              borderRadius: 24,
              border: "12px solid var(--plx-border-strong)",
              boxShadow: "var(--plx-shadow-card)",
              overflow: "hidden",
              position: "relative",
              background: "var(--plx-surface)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <iframe
              key="viewport-tablet"
              title={title || "Tablet preview"}
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
          /* Mobile Phone Frame: 375px */
          <div
            style={{
              width: 375,
              height: "calc(100% - 32px)",
              minHeight: 480,
              margin: "16px auto",
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
                width: 90,
                height: 14,
                background: "var(--plx-border-strong)",
                borderBottomLeftRadius: 8,
                borderBottomRightRadius: 8,
                zIndex: 10,
              }}
              aria-hidden
            />
            <iframe
              key="viewport-mobile"
              title={title || "Mobile preview"}
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
    </div>
  );
}
