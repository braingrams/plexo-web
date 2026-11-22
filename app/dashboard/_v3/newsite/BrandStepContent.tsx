"use client";

import { useState } from "react";
import { Check, Upload, X } from "lucide-react";
import { StrataBrandPicker, type PickedBrand, type StrataPickerClient } from "../brand/StrataBrandPicker";
import { NO_SELECTION, type PickerSelection } from "@/lib/dashboardV3/strataPicker";
import { PALETTE_PRESETS, type PalettePreset } from "@/lib/onboarding/palettes";

export type BrandStepContentProps = {
  client?: StrataPickerClient;
  siteName: string;
  initialColors?: string[];
  initialLogoUrl?: string | null;
  onBrandChange: (brand: { colors: string[]; logoUrl: string | null; strataSelection: PickerSelection }) => void;
};

export function BrandStepContent({
  client,
  siteName,
  initialColors,
  initialLogoUrl,
  onBrandChange,
}: BrandStepContentProps) {
  const defaultColors = PALETTE_PRESETS[0].colors;
  const [selectedPaletteId, setSelectedPaletteId] = useState<string>(PALETTE_PRESETS[0].id);
  const [colors, setColors] = useState<string[]>(initialColors && initialColors.length ? initialColors : defaultColors);
  const [logoUrl, setLogoUrl] = useState<string | null>(initialLogoUrl ?? null);
  const [showSavedBrands, setShowSavedBrands] = useState(false);
  const [strataPick, setStrataPick] = useState<PickerSelection>(NO_SELECTION);

  const initialLetter = (siteName.trim()[0] || "P").toUpperCase();

  const handleSelectPalette = (preset: PalettePreset) => {
    setSelectedPaletteId(preset.id);
    setColors(preset.colors);
    setStrataPick({ kind: "create" });
    onBrandChange({ colors: preset.colors, logoUrl, strataSelection: { kind: "create" } });
  };

  const handleCustomColorChange = (index: number, val: string) => {
    const updated = [...colors];
    updated[index] = val;
    setColors(updated);
    setSelectedPaletteId("custom");
    setStrataPick({ kind: "create" });
    onBrandChange({ colors: updated, logoUrl, strataSelection: { kind: "create" } });
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setLogoUrl(dataUrl);
      setStrataPick({ kind: "create" });
      onBrandChange({ colors, logoUrl: dataUrl, strataSelection: { kind: "create" } });
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveLogo = () => {
    setLogoUrl(null);
    onBrandChange({ colors, logoUrl: null, strataSelection: strataPick });
  };

  const handleStrataPick = (v: PickerSelection, p?: PickedBrand | null) => {
    setStrataPick(v);
    if (p && (p.colors.length || p.logoUrl)) {
      if (p.colors.length) setColors(p.colors);
      if (p.logoUrl) setLogoUrl(p.logoUrl);
      onBrandChange({ colors: p.colors.length ? p.colors : colors, logoUrl: p.logoUrl ?? logoUrl, strataSelection: v });
    } else {
      onBrandChange({ colors, logoUrl, strataSelection: v });
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28, maxWidth: 780 }}>
      {/* 1. Palette Selection */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "var(--plx-text)" }}>
            1. Choose a colour palette
          </h2>
          <span style={{ fontSize: 13, color: "var(--plx-muted)" }}>
            Preset palettes curated for high contrast
          </span>
        </div>

        <div
          role="radiogroup"
          aria-label="Colour palettes"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))",
            gap: 12,
          }}
        >
          {PALETTE_PRESETS.map((preset) => {
            const isSelected = selectedPaletteId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => handleSelectPalette(preset)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: 10,
                  padding: 12,
                  borderRadius: 12,
                  background: isSelected ? "var(--plx-tint)" : "var(--plx-surface)",
                  border: isSelected ? "2px solid var(--plx-deep, var(--plx-brand))" : "1px solid var(--plx-border)",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "all 0.15s ease",
                  boxShadow: isSelected ? "0 0 0 3px color-mix(in srgb, var(--plx-brand) 25%, transparent)" : "none",
                }}
              >
                <div style={{ display: "flex", gap: 4, width: "100%" }}>
                  {preset.colors.map((c, i) => (
                    <span
                      key={i}
                      style={{
                        flex: 1,
                        height: 24,
                        borderRadius: 6,
                        background: c,
                        border: "1px solid var(--plx-border)",
                      }}
                    />
                  ))}
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--plx-text)" }}>{preset.name}</span>
                  {isSelected && <Check size={14} style={{ color: "var(--plx-deep, var(--plx-brand))" }} />}
                </div>
              </button>
            );
          })}
        </div>

        {/* Custom Fine-tuning */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            padding: "12px 16px",
            background: "var(--plx-sunken)",
            borderRadius: 10,
            border: "1px solid var(--plx-border)",
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--plx-muted)" }}>Fine-tune colours:</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label style={{ fontSize: 12, fontWeight: 600 }}>Brand:</label>
            <input
              type="color"
              value={colors[0] || defaultColors[0]}
              onChange={(e) => handleCustomColorChange(0, e.target.value)}
              style={{ width: 32, height: 28, borderRadius: 6, border: "1px solid var(--plx-border)", cursor: "pointer", background: "none", padding: 1 }}
              title="Change brand primary colour"
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label style={{ fontSize: 12, fontWeight: 600 }}>Accent:</label>
            <input
              type="color"
              value={colors[1] || defaultColors[1]}
              onChange={(e) => handleCustomColorChange(1, e.target.value)}
              style={{ width: 32, height: 28, borderRadius: 6, border: "1px solid var(--plx-border)", cursor: "pointer", background: "none", padding: 1 }}
              title="Change accent colour"
            />
          </div>
        </div>
      </div>

      {/* 2. Logo Upload */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "var(--plx-text)" }}>
          2. Add your logo (optional)
        </h2>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 20,
            padding: "16px 20px",
            background: "var(--plx-surface)",
            borderRadius: 12,
            border: "1px solid var(--plx-border)",
            flexWrap: "wrap",
          }}
        >
          {/* Logo preview badge */}
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 12,
              background: colors[0] || "var(--plx-tint)",
              color: "var(--plx-on-brand, var(--plx-surface))",
              display: "grid",
              placeItems: "center",
              overflow: "hidden",
              border: "1px solid var(--plx-border)",
              fontWeight: 800,
              fontSize: 22,
              flexShrink: 0,
            }}
          >
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt={`${siteName} logo`} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            ) : (
              <span>{initialLetter}</span>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 200 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--plx-text)" }}>
              {logoUrl ? "Custom logo uploaded" : `Default initial "${initialLetter}"`}
            </span>
            <span style={{ fontSize: 13, color: "var(--plx-muted)" }}>
              {logoUrl ? "Your logo will appear in your site header and footer." : "Upload an image (PNG, SVG, or JPG) or use the initial badge."}
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 16px",
                borderRadius: 9,
                background: "var(--plx-surface)",
                border: "1px solid var(--plx-border)",
                fontSize: 13,
                fontWeight: 700,
                color: "var(--plx-text)",
                cursor: "pointer",
                transition: "background 0.15s ease",
              }}
            >
              <Upload size={14} />
              {logoUrl ? "Change logo" : "Upload logo"}
              <input type="file" accept="image/*" onChange={handleLogoUpload} style={{ display: "none" }} />
            </label>

            {logoUrl && (
              <button
                type="button"
                onClick={handleRemoveLogo}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "8px 12px",
                  borderRadius: 9,
                  background: "none",
                  border: "none",
                  fontSize: 13,
                  color: "var(--plx-muted)",
                  cursor: "pointer",
                }}
              >
                <X size={14} /> Remove
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 3. Subtle Saved Brand / Design System Account Disclosure */}
      <div style={{ borderTop: "1px solid var(--plx-border)", paddingTop: 16 }}>
        {!showSavedBrands ? (
          <button
            type="button"
            onClick={() => setShowSavedBrands(true)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: "none",
              border: "none",
              padding: 0,
              fontSize: 13,
              fontWeight: 600,
              color: "var(--plx-deep, var(--plx-brand))",
              cursor: "pointer",
            }}
          >
            Already have a saved design system? Choose from your account →
          </button>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: "var(--plx-text)" }}>
                Saved Design Systems &amp; Brands
              </span>
              <button
                type="button"
                onClick={() => setShowSavedBrands(false)}
                style={{ background: "none", border: "none", fontSize: 13, color: "var(--plx-muted)", cursor: "pointer" }}
              >
                Hide saved brands
              </button>
            </div>
            <StrataBrandPicker
              mode="draft"
              client={client}
              value={strataPick}
              allowSkip
              canCreate={true}
              createHint="Your chosen palette and logo will be automatically saved and synced to your brand in the background."
              onChange={handleStrataPick}
            />
          </div>
        )}
      </div>
    </div>
  );
}
