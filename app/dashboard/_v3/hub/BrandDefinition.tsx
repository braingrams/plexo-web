"use client";

import { GateOrError } from "@/app/dashboard/_components/UpgradePrompt";
import { useEffect, useMemo, useRef, useState } from "react";
import { SolGlyph } from "@/app/dashboard/_v3/sol/SolGlyph";
import { useRouter } from "next/navigation";
import { Check, ImagePlus, Palette } from "lucide-react";
import { Button, ButtonLink, Card, CardHeader, Input, useToast } from "../ui";
import { PALETTE } from "@/lib/onboarding/flow";
import { dominantColors } from "@/lib/onboarding/logoColors";
import { displayBrand, normalizeHex, type SiteBrand } from "@/lib/dashboardV3/brandLook";
import { errMsg, hubApi } from "./hubApi";
import { PREVIEW_FALLBACK, readableOn, BRAND_COPY, BRAND_PRESETS, DENSITY, ROUNDNESS, draftFromBrand, sameDraft, tokenRequestFromDraft, type BrandDraft } from "@/lib/dashboardV3/brandDefinition";
import type { ResolvedBrand } from "@/lib/brand/brandModel";
import { FontField, FontPairs } from "./FontPicker";
import { cssFamily, findFont } from "@/lib/fonts/catalogue";
import { loadFontFamily } from "@/lib/fonts/loadClient";
import type { CustomFont } from "@/lib/fonts/customFonts";

type Props = { siteId: string; siteName: string; own: SiteBrand | null; defaults: { colors?: string[]; primaryColor?: string; logoUrl?: string } | null; sourceType: string; /** The brand this site really uses now (colours, fonts, corners), once known. */ resolved?: ResolvedBrand | null; /** Called after a save, so the page can refresh what it shows. */ onSaved?: () => void; /** Tells the page whether there are changes that are not saved yet. */ onDirty?: (dirty: boolean) => void };

const swatchStyle = (hex: string, on: boolean): React.CSSProperties => ({
  width: 36, height: 36, borderRadius: 999, background: hex, cursor: "pointer", display: "grid", placeItems: "center", color: "white",
  border: on ? "3px solid var(--plx-ink)" : "2px solid var(--plx-line)", padding: 0,
});

/** Colour choices: a few nice presets, anything from the picker, or a typed hex code. */
export function ColourPicker({ label, value, onChange, extra, optional }: { label: string; value: string; onChange: (hex: string) => void; extra?: string[]; optional?: boolean }) {
  const [text, setText] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) { setSeen(value); setText(value); }
  const choices = [...(extra ?? []), ...PALETTE.map((p) => p.hex).filter((h) => !(extra ?? []).includes(h))];
  return (
    <div className="plx-form" style={{ gap: 10 }}>
      <span className="plx-field__label">{label}{optional ? <span className="plx-field__optional">(optional)</span> : null}</span>
      <div role="radiogroup" aria-label={label} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        {choices.map((hex) => {
          const on = value === hex;
          return (
            <button key={hex} type="button" role="radio" aria-checked={on} aria-label={hex} title={hex} style={swatchStyle(hex, on)} onClick={() => onChange(hex)}>
              {on ? <Check size={16} aria-hidden /> : null}
            </button>
          );
        })}
        <label style={{ ...swatchStyle("transparent", false), position: "relative", overflow: "hidden", color: "var(--plx-muted)" }} title="Pick any colour">
          <Palette size={18} aria-hidden />
          <span className="plx-sr-only">Pick any other colour</span>
          <input type="color" value={value || PALETTE[1].hex} onChange={(e) => onChange(e.target.value.toUpperCase())} style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }} />
        </label>
      </div>
      <div style={{ maxWidth: 200 }}>
        <Input
          label="Colour code"
          hideLabel
          value={text}
          placeholder={PALETTE[0].hex}
          onChange={(e) => {
            setText(e.target.value);
            const hex = normalizeHex(e.target.value);
            if (hex) onChange(hex);
          }}
          onBlur={() => setText(normalizeHex(text) ?? value)}
        />
      </div>
    </div>
  );
}

const fontFamily = (f: string) => cssFamily(f, findFont(f)?.kind);

/** Loads the two chosen fonts (at the weights chosen) so the preview shows them for real; the page itself has them once saved. */
function useFontLinks(fonts: Array<{ family: string; weight: number }>) {
  const key = fonts.map((f) => `${f.family}:${f.weight}`).join("|");
  useEffect(() => {
    for (const f of fonts) if (f.family) loadFontFamily(f.family, [f.weight, 400, 700]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

/** A live picture of the brand: logo, headline, text, card and buttons, in the colours, fonts and corners chosen. */
export function BrandLivePreview({ draft, logoUrl, siteName }: { draft: BrandDraft; logoUrl: string; siteName: string }) {
  useFontLinks([{ family: draft.headingFont, weight: draft.headingWeight }, { family: draft.bodyFont, weight: draft.bodyWeight }]);
  const radius = ROUNDNESS.find((r) => r.id === draft.roundness)?.px ?? 8;
  const gap = DENSITY.find((d) => d.id === draft.density)?.steps["4"] ?? 16;
  const second = normalizeHex(draft.secondary) ?? PREVIEW_FALLBACK.page;
  const accent = normalizeHex(draft.accent);
  const on = readableOn;
  const primary = normalizeHex(draft.primary) ?? PREVIEW_FALLBACK.primary;
  return (
    <div className="plx-bprev" style={{ background: second, borderRadius: radius + 6, gap, fontFamily: fontFamily(draft.bodyFont), color: PREVIEW_FALLBACK.ink }} aria-label="Live preview of your brand" data-testid="brand-preview">
      <div className="plx-bprev__top">{logoUrl ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={logoUrl} alt={`${siteName} logo`} /> : <span className="plx-bprev__logo" style={{ fontFamily: fontFamily(draft.headingFont), color: primary }}>{siteName}</span>}</div>
      <h4 style={{ fontFamily: fontFamily(draft.headingFont), fontWeight: draft.headingWeight }}>Welcome to {siteName}</h4>
      <p>This is how your words will look: easy to read, in your own fonts.</p>
      <div className="plx-bprev__card" style={{ borderRadius: radius, gap: Math.round(gap / 2) }}>
        <b style={{ fontFamily: fontFamily(draft.headingFont) }}>A card on your site</b>
        <span style={{ fontSize: 14 }}>Cards, boxes and pictures share your corners.</span>
        <span style={{ color: accent ?? primary, fontWeight: 700, fontSize: 14 }}>A link looks like this</span>
      </div>
      <div className="plx-bprev__btns">
        <button type="button" tabIndex={-1} className="plx-bprev__btn" style={{ background: primary, color: on(primary), borderRadius: radius }}>Get started</button>
        {accent ? <button type="button" tabIndex={-1} className="plx-bprev__btn" style={{ background: accent, color: on(accent), borderRadius: radius }}>Learn more</button> : null}
      </div>
    </div>
  );
}

/** Your brand definition: colours, fonts, logo and the small details, with a live preview. Saved with one button; it goes into every page. */
export function BrandDefinition({ siteId, siteName, own, defaults, sourceType, resolved, onSaved, onDirty }: Props) {
  const { show } = useToast();
  const router = useRouter();
  const start = displayBrand(own ?? undefined, defaults ? { colors: defaults.colors ?? (defaults.primaryColor ? [defaults.primaryColor] : undefined), logoUrl: defaults.logoUrl } : undefined);
  const initial = useMemo<BrandDraft>(() => {
    const d = draftFromBrand(resolved);
    // Without a resolved brand yet, fall back to what the site itself holds.
    if (!resolved?.colours?.length) { d.primary = start.colors?.[0] ?? d.primary; d.secondary = start.colors?.[1] ?? d.secondary; }
    return d;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved]);
  const [draft, setDraft] = useState<BrandDraft>(initial);
  const [saved, setSaved] = useState<BrandDraft>(initial);
  const [seen, setSeen] = useState(initial);
  // The brand changed underneath (a switch, a refresh): show it, unless there are unsaved edits to protect.
  if (seen !== initial) { setSeen(initial); if (sameDraft(draft, saved)) { setDraft(initial); setSaved(initial); } }
  const [logoUrl, setLogoUrl] = useState(resolved?.logoUrl ?? start.logoUrl ?? "");
  const [savedLogo, setSavedLogo] = useState(logoUrl);
  const [noLogo, setNoLogo] = useState(!!start.noLogo);
  const [suggested, setSuggested] = useState<string[]>([]);
  const [customFonts, setCustomFonts] = useState<CustomFont[]>(resolved?.customFonts ?? []);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ text: string; askSol: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirty = !sameDraft(draft, saved) || logoUrl !== savedLogo;
  useEffect(() => { onDirty?.(dirty); }, [dirty, onDirty]);
  const set = (patch: Partial<BrandDraft>) => { setDraft((d) => ({ ...d, ...patch })); setOutcome(null); };

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    setOutcome(null);
    try {
      const bmp = await createImageBitmap(file).catch(() => null);
      if (bmp) {
        const c = document.createElement("canvas");
        c.width = c.height = 64;
        const ctx = c.getContext("2d");
        ctx?.drawImage(bmp, 0, 0, 64, 64);
        setSuggested(ctx ? dominantColors(ctx.getImageData(0, 0, 64, 64).data) : []);
      }
      const body = new FormData();
      body.append("file", file);
      const { url } = await hubApi<{ url: string }>("/api/v1/media/upload", { method: "POST", body }, "We couldn't upload that logo. Try a PNG, JPG, SVG or WebP under 8 MB.");
      setLogoUrl(url);
      setNoLogo(false);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    const first = normalizeHex(draft.primary);
    if (!first) return setError("Choose a main colour first.");
    setSaving(true);
    setError(null);
    try {
      const colors = [first, normalizeHex(draft.secondary)].filter((c): c is string => !!c);
      const res = await hubApi<{ text: string; askSol: boolean }>(`/api/v1/sites/${encodeURIComponent(siteId)}/look`, { method: "PUT", json: { colors, logoUrl: logoUrl || null, logoSkipped: !logoUrl && noLogo } }, "We couldn't save your logo and colours. Please try again.");
      // Fonts, corners, spacing and the accent colour go with them. A brand that isn't set up yet keeps them for next time.
      await hubApi(`/api/v1/sites/${encodeURIComponent(siteId)}/brand`, { method: "PATCH", json: { brandTokens: tokenRequestFromDraft(draft) } }, "Your colours are saved, but we couldn't save your fonts and shapes. Please try again.");
      setSaved(draft);
      setSavedLogo(logoUrl);
      setOutcome({ text: res.text, askSol: res.askSol });
      show({ title: BRAND_COPY.saved, tone: "success" });
      router.refresh();
      onSaved?.();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  const solHref = `/dashboard/sol?new=1&draft=${encodeURIComponent(`Restyle my existing pages on "${siteName}" with my new logo and colours (main colour ${draft.primary}${draft.secondary ? `, second colour ${draft.secondary}` : ""}). `)}`;
  const canApply = sourceType === "BUILDER";
  return (
    <div className="plx-hub__split plx-bdef__layout" data-tour="hub-brand-look">
      <Card className="plx-bdef__card">
        <CardHeader title={BRAND_COPY.definitionTitle} description={BRAND_COPY.definitionSub} />
        <div className="plx-bdef" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <div className="plx-bdef__scroll">
            <div className="plx-bdef__group">
              <h3>{BRAND_COPY.presetsTitle}</h3>
              <p className="plx-small" style={{ margin: 0 }}>{BRAND_COPY.presetsSub}</p>
              <div className="plx-bdef__presets">
                {BRAND_PRESETS.map((p) => (
                  <button key={p.id} type="button" className="plx-bdef__preset" onClick={() => { setDraft(p.draft); setOutcome(null); }}>
                    <span className="plx-bdef__dots" aria-hidden>{[p.draft.primary, p.draft.secondary, p.draft.accent].map((c) => <i key={c} style={{ background: c }} />)}</span>
                    <b>{p.name}</b>
                    <span className="plx-small">{p.blurb}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="plx-bdef__group">
              <h3>Logo</h3>
              <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                <span className="plx-hrow__thumb" style={{ width: 72, height: 72 }}>
                  {logoUrl ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={logoUrl} alt={`${siteName} logo`} style={{ objectFit: "contain" }} /> : <ImagePlus size={26} aria-hidden />}
                </span>
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <Button variant="secondary" loading={uploading} onClick={() => fileRef.current?.click()}>{logoUrl ? "Change logo" : "Add my logo"}</Button>
                  {logoUrl ? <Button variant="ghost" onClick={() => { setLogoUrl(""); setNoLogo(false); setOutcome(null); }}>Remove</Button> : null}
                </div>
                {!logoUrl ? (
                  noLogo ? (
                    <span className="plx-small" style={{ flexBasis: "100%" }}>No logo: we&apos;ll make a simple one from your site&apos;s name. <Button variant="link" onClick={() => setNoLogo(false)}>Undo</Button></span>
                  ) : (
                    <span className="plx-small" style={{ flexBasis: "100%" }}><Button variant="link" onClick={() => { setNoLogo(true); setOutcome(null); }}>I don&apos;t have a logo</Button> and that&apos;s fine, we&apos;ll make one from your name.</span>
                  )
                ) : null}
              </div>
              {suggested.length ? (
                <div className="plx-small" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <Button variant="secondary" size="sm" onClick={() => set({ primary: suggested[0], secondary: suggested[1] ?? "" })}>Use colours from my logo</Button>
                  <span style={{ display: "flex", gap: 6 }}>{suggested.slice(0, 2).map((c) => <i key={c} aria-hidden style={{ width: 18, height: 18, borderRadius: 999, background: c, display: "inline-block" }} />)}</span>
                </div>
              ) : null}
            </div>

            <div className="plx-bdef__group">
              <h3>Colours</h3>
              <ColourPicker label="Main colour" value={draft.primary} onChange={(h) => set({ primary: h })} extra={suggested} />
              <ColourPicker label="Second colour" optional value={draft.secondary} onChange={(h) => set({ secondary: h })} />
              <ColourPicker label="Accent colour" optional value={draft.accent} onChange={(h) => set({ accent: h })} />
            </div>

            <div className="plx-bdef__group">
              <h3>Fonts</h3>
              <div className="plx-fp__fields">
                <FontField label="Headings" hint="Titles and big words" value={draft.headingFont} weight={draft.headingWeight} customFonts={customFonts} siteId={siteId} onCustomFonts={setCustomFonts} onChange={(headingFont, headingWeight) => set({ headingFont, headingWeight })} />
                <FontField label="Text" hint="Paragraphs and buttons" value={draft.bodyFont} weight={draft.bodyWeight} customFonts={customFonts} siteId={siteId} onCustomFonts={setCustomFonts} onChange={(bodyFont, bodyWeight) => set({ bodyFont, bodyWeight })} />
              </div>
              <FontPairs heading={draft.headingFont} body={draft.bodyFont} onPair={(p) => set({ headingFont: p.heading, bodyFont: p.body, headingWeight: 700, bodyWeight: 400 })} />
            </div>

            <div className="plx-bdef__group">
              <h3>Buttons and corners</h3>
              <div role="radiogroup" aria-label="How round your buttons and cards are" className="plx-bdef__choices">
                {ROUNDNESS.map((r) => <button key={r.id} type="button" role="radio" aria-checked={draft.roundness === r.id} className="plx-bdef__choice" onClick={() => set({ roundness: r.id })}>{r.label}</button>)}
              </div>
            </div>

            <div className="plx-bdef__group">
              <h3>Spacing</h3>
              <div role="radiogroup" aria-label="How much space there is between things" className="plx-bdef__choices">
                {DENSITY.map((d) => <button key={d.id} type="button" role="radio" aria-checked={draft.density === d.id} className="plx-bdef__choice" title={d.hint} onClick={() => set({ density: d.id })}>{d.label}</button>)}
              </div>
            </div>
          </div>

          <div className="plx-bdef__footer">
            {error ? <GateOrError error={error}><p className="plx-field__error" role="alert">{error}</p></GateOrError> : null}
            <div className="plx-bdef__savebar">
              <Button loading={saving} onClick={save} disabled={!draft.primary || (!dirty && !saving)}>{BRAND_COPY.save}</Button>
              <span className="plx-small" role="status">{dirty ? BRAND_COPY.unsaved : BRAND_COPY.upToDate}</span>
            </div>
            {outcome ? (
              <div className="plx-inlinemsg" role="status" style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
                <span>{outcome.text}</span>
                {outcome.askSol ? <ButtonLink href={solHref} variant="secondary" size="sm" leftIcon={<SolGlyph size={16} />}>Restyle my pages with SOL</ButtonLink> : null}
              </div>
            ) : !canApply ? (
              <p className="plx-small">This site was built another way, so Plexo saves your look and SOL can restyle its pages with it.</p>
            ) : null}
          </div>
        </div>
      </Card>
      <BrandLivePreview draft={draft} logoUrl={logoUrl} siteName={siteName} />
    </div>
  );
}
