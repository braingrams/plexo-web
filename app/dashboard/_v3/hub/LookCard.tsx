"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ImagePlus, MessagesSquare, Palette } from "lucide-react";
import { Button, ButtonLink, Card, CardHeader, Input, useToast } from "../ui";
import { PALETTE } from "@/lib/onboarding/flow";
import { dominantColors } from "@/lib/onboarding/logoColors";
import { displayBrand, normalizeHex, type SiteBrand } from "@/lib/dashboardV3/brandLook";
import { errMsg, hubApi } from "./hubApi";

type Props = { siteId: string; siteName: string; own: SiteBrand | null; defaults: { colors?: string[]; primaryColor?: string; logoUrl?: string } | null; sourceType: string };

const swatchStyle = (hex: string, on: boolean): React.CSSProperties => ({
  width: 36, height: 36, borderRadius: 999, background: hex, cursor: "pointer", display: "grid", placeItems: "center", color: "white",
  border: on ? "3px solid var(--plx-ink)" : "2px solid var(--plx-line)", padding: 0,
});

/** Colour choices: a few nice presets, anything from the picker, or a typed hex code. */
function ColourPicker({ label, value, onChange, extra, optional }: { label: string; value: string; onChange: (hex: string) => void; extra?: string[]; optional?: boolean }) {
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

/** This site's own logo and colours: add or change them, and they go straight into this site's pages. */
export function LookCard({ siteId, siteName, own, defaults, sourceType }: Props) {
  const { show } = useToast();
  const router = useRouter();
  const start = displayBrand(own ?? undefined, defaults ? { colors: defaults.colors ?? (defaults.primaryColor ? [defaults.primaryColor] : undefined), logoUrl: defaults.logoUrl } : undefined);
  const [main, setMain] = useState(start.colors?.[0] ?? "");
  const [second, setSecond] = useState(start.colors?.[1] ?? "");
  const [logoUrl, setLogoUrl] = useState(start.logoUrl ?? "");
  const [noLogo, setNoLogo] = useState(!!start.noLogo);
  const [suggested, setSuggested] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ text: string; askSol: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
    const first = normalizeHex(main);
    if (!first) return setError("Choose a main colour first.");
    setSaving(true);
    setError(null);
    try {
      const colors = [first, normalizeHex(second)].filter((c): c is string => !!c);
      const res = await hubApi<{ text: string; askSol: boolean }>(`/api/v1/sites/${encodeURIComponent(siteId)}/look`, { method: "PUT", json: { colors, logoUrl: logoUrl || null, logoSkipped: !logoUrl && noLogo } }, "We couldn't save your logo and colours. Please try again.");
      setOutcome({ text: res.text, askSol: res.askSol });
      show({ title: "Saved", tone: "success" });
      router.refresh();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  const solHref = `/dashboard/sol?new=1&draft=${encodeURIComponent(`Restyle my existing pages on "${siteName}" with my new logo and colours${main ? ` (main colour ${main}${second ? `, second colour ${second}` : ""})` : ""}. `)}`;
  const canApply = sourceType === "BUILDER";
  return (
    <Card data-tour="hub-brand-look">
      <CardHeader title="Colours and logo" description="Yours alone: other sites you make keep their own. They go straight into this site's pages." />
      <div className="plx-form" style={{ gap: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <span className="plx-row__thumb" style={{ width: 72, height: 72 }}>
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
            <Button variant="secondary" size="sm" onClick={() => { setMain(suggested[0]); setSecond(suggested[1] ?? ""); }}>Use colours from my logo</Button>
            <span style={{ display: "flex", gap: 6 }}>{suggested.slice(0, 2).map((c) => <i key={c} aria-hidden style={{ width: 18, height: 18, borderRadius: 999, background: c, display: "inline-block" }} />)}</span>
          </div>
        ) : null}
        <ColourPicker label="Main colour" value={main} onChange={(h) => { setMain(h); setOutcome(null); }} extra={suggested} />
        <ColourPicker label="Second colour" optional value={second} onChange={(h) => { setSecond(h); setOutcome(null); }} />
        {error ? <p className="plx-field__error" role="alert">{error}</p> : null}
        <div><Button loading={saving} onClick={save} disabled={!main}>Save</Button></div>
        {outcome ? (
          <div className="plx-inlinemsg" role="status" style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
            <span>{outcome.text}</span>
            {outcome.askSol ? <ButtonLink href={solHref} variant="secondary" size="sm" leftIcon={<MessagesSquare size={16} aria-hidden />}>Ask SOL to restyle my pages</ButtonLink> : null}
          </div>
        ) : !canApply ? (
          <p className="plx-small">This site was built another way, so Plexo saves your look and SOL can restyle its pages with it.</p>
        ) : null}
      </div>
    </Card>
  );
}
