"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ImagePlus } from "lucide-react";
import { Button, ButtonLink, Input, useToast } from "../ui";
import { errMsg, hubApi } from "../hub/hubApi";
import { BRAND } from "@/lib/theme";
import { isDirty } from "@/lib/dashboardV3/settingsSaveBar";
import { AsideCard, Notice, Panel, SaveBar, SettingsPageShell, ToggleRow } from "./bits";

export type BrandDisplayMode = "LOGO_ONLY" | "NAME_ONLY" | "BOTH";
export type BrandingValues = { name: string; logo: string; color: string; mode: BrandDisplayMode; on: boolean };

const MODES: { value: BrandDisplayMode; label: string; body: string }[] = [
  { value: "BOTH", label: "Logo and name", body: "Show both together." },
  { value: "LOGO_ONLY", label: "Logo only", body: "Hide the name wherever the logo shows." },
  { value: "NAME_ONLY", label: "Name only", body: "Hide the logo wherever the name shows." },
];

/** Replace Plexo's name, logo and colour with your own (white-label). Same API as before. */
export function BrandingSection({ organizationId, canManage, planAllowsWhiteLabel, initial, mock = false }: { organizationId: string; canManage: boolean; planAllowsWhiteLabel: boolean; initial: BrandingValues; mock?: boolean }) {
  const router = useRouter();
  const { show } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [saved, setSaved] = useState<BrandingValues>({ ...initial, color: initial.color || BRAND.primary });
  const [v, setV] = useState<BrandingValues>(saved);
  const [busy, setBusy] = useState<"save" | "logo" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const locked = !canManage || !planAllowsWhiteLabel;
  const dirty = isDirty(saved, v);
  const set = <K extends keyof BrandingValues>(k: K, val: BrandingValues[K]) => setV((p) => ({ ...p, [k]: val }));

  async function upload(file: File) {
    setBusy("logo");
    setError(null);
    try {
      if (mock) set("logo", URL.createObjectURL(file));
      else {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/v1/media/upload", { method: "POST", body: form });
        const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
        if (!res.ok || !data.url) throw new Error(data.error ?? "We couldn't upload that logo. Try a PNG or JPG under 8 MB.");
        set("logo", data.url);
      }
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    setError(null);
    try {
      if (!mock) {
        await hubApi(`/api/organizations/${organizationId}/branding`, { method: "PATCH", json: { name: v.name, logo: v.logo.trim() || null, brandColor: v.color.trim() || null, brandDisplayMode: v.mode, whiteLabelEnabled: v.on } }, "We couldn't save your branding. Please try again.");
        router.refresh();
      }
      setSaved(v);
      show({ title: "Branding saved", tone: "success" });
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const showLogo = v.logo && v.mode !== "NAME_ONLY";
  const showName = v.mode !== "LOGO_ONLY";
  return (
    <SettingsPageShell
      title="Branding"
      purpose="Replace the Plexo name, logo and colour with your own across your dashboard, published pages and emails."
      bar={<SaveBar dirty={dirty && !locked} saving={busy === "save"} valid={!!v.name.trim()} onSave={save} onDiscard={() => { setV(saved); setError(null); }} />}
      aside={
        <>
          <AsideCard title="Preview">
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 16, borderRadius: 14, background: "var(--plx-surface)", border: "1px solid var(--plx-border)" }}>
              {showLogo ? <img src={v.logo} alt="" style={{ width: 40, height: 40, objectFit: "contain", borderRadius: 8 }} /> : <span className="plx-tile" style={{ background: v.color, color: "var(--plx-on-brand)" }}><Check size={18} aria-hidden /></span>}
              {showName ? <b style={{ fontSize: 17 }}>{v.name || "Your name"}</b> : null}
            </div>
            <p>This is how your brand appears where Plexo&apos;s own would.</p>
          </AsideCard>
          <AsideCard title="Good to know">
            <ul>
              <li><Check size={16} aria-hidden /> <span>Your own branding is part of the Enterprise plan.</span></li>
              <li><Check size={16} aria-hidden /> <span>It is off until you switch it on, even on Enterprise.</span></li>
              <li><Check size={16} aria-hidden /> <span>Only the owner of the account can change it.</span></li>
            </ul>
          </AsideCard>
        </>
      }
    >
      {error ? <Notice tone="bad">{error}</Notice> : null}
      {!planAllowsWhiteLabel ? (
        <Notice tone="warn"><span>Your own branding comes with the Enterprise plan. <a href="/dashboard/settings/plan" style={{ fontWeight: 700 }}>See plans</a></span></Notice>
      ) : !canManage ? (
        <Notice>Only the owner of the account can change branding.</Notice>
      ) : null}

      <Panel title="Use my own brand" description="Off by default, even on Enterprise.">
        <ToggleRow title="Show my brand instead of Plexo's" description="Your name, logo and colour replace Plexo's in the dashboard, emails and published pages." checked={v.on} disabled={locked} onChange={(x) => set("on", x)} />
      </Panel>

      <Panel title="Your name and logo" description="What people see.">
        <div className="plx-sform">
          <Input label="Brand name" value={v.name} disabled={locked} onChange={(e) => set("name", e.target.value)} help="Your business or organisation name." error={!v.name.trim() && dirty ? "Please type a name." : undefined} />
          <div className="plx-photo">
            {v.logo ? <img src={v.logo} alt="Your logo" style={{ width: 72, height: 72, objectFit: "contain", borderRadius: 14, border: "1px solid var(--plx-border)", background: "var(--plx-elevated)" }} /> : <span className="plx-tile" style={{ width: 72, height: 72, borderRadius: 14 }}><ImagePlus size={26} aria-hidden /></span>}
            <div className="plx-photo__actions">
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/avif" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
              <Button variant="secondary" size="sm" disabled={locked} loading={busy === "logo"} onClick={() => fileRef.current?.click()}>{v.logo ? "Change logo" : "Upload a logo"}</Button>
              {v.logo ? <Button variant="ghost" size="sm" disabled={locked} onClick={() => set("logo", "")}>Remove</Button> : null}
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="How it shows" description="Choose what appears wherever your brand is shown.">
        <div className="plx-choice" role="radiogroup" aria-label="Brand display">
          {MODES.map((m) => (
            <button key={m.value} type="button" role="radio" aria-checked={v.mode === m.value} disabled={locked} className="plx-choice__opt" onClick={() => set("mode", m.value)}>
              <b>{m.label}{v.mode === m.value ? <Check size={18} aria-hidden style={{ color: "var(--plx-deep)" }} /> : null}</b>
              <span>{m.body}</span>
            </button>
          ))}
        </div>
      </Panel>

      <Panel title="Your colour" description="Used for buttons and highlights.">
        <div className="plx-sform">
          <div className="plx-srow" style={{ padding: 0, border: 0 }}>
            <div className="plx-srow__text"><b>Main colour</b><span>{v.color}</span></div>
            <input type="color" aria-label="Main colour" value={/^#[0-9a-fA-F]{6}$/.test(v.color) ? v.color : BRAND.primary} disabled={locked} onChange={(e) => set("color", e.target.value)} style={{ width: 64, height: 44, border: "1px solid var(--plx-border)", borderRadius: 12, background: "var(--plx-surface)", padding: 4, cursor: locked ? "default" : "pointer" }} />
          </div>
        </div>
      </Panel>
    </SettingsPageShell>
  );
}
