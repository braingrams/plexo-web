"use client";

import { GateOrError } from "@/app/dashboard/_components/UpgradePrompt";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Check, KeyRound, LayoutDashboard, LifeBuoy, PlayCircle, RotateCcw } from "lucide-react";
import { Avatar, Button, ButtonLink, Input, useToast } from "../ui";
import { ThemeSwitch } from "../theme/ThemeContext";
import { useOptionalTour } from "../tour/TourProvider";
import { errMsg, hubApi } from "../hub/hubApi";
import type { Experience } from "@/lib/dashboardV3/nav";
import { AsideCard, Notice, Panel, SaveBar, SettingRow, SettingsPageShell } from "./bits";
import { isDirty } from "@/lib/dashboardV3/settingsSaveBar";
import { switchLabel, useVersionSwitch } from "../../_versions/VersionUi";
import { CountrySelect } from "@/app/_components/country/CountrySelect";

const FEELS: { id: Experience; title: string; body: string }[] = [
  { id: "beginner", title: "Guided", body: "Fewer buttons. Plexo walks you through each step in plain words." },
  { id: "intermediate", title: "A bit more", body: "Everything for running your sites, with the explanations kept short." },
  { id: "pro", title: "Everything", body: "All the tools in one place, and a tighter layout. For people who build a lot." },
];

export function ProfileSection({ name: initialName, email, phone, image: initialImage, experience: initialExperience, country = null, countryGuess = null, mock = false }: { name: string; email: string; phone?: string | null; image?: string | null; experience: Experience; country?: string | null; countryGuess?: string | null; mock?: boolean }) {
  const router = useRouter();
  const { show } = useToast();
  const tour = useOptionalTour();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initialName);
  const [saved, setSaved] = useState(initialName);
  const [image, setImage] = useState(initialImage ?? null);
  const [experience, setExperience] = useState(initialExperience);
  const [selectedCountry, setSelectedCountry] = useState<string | null>(country ?? countryGuess ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleCountryChange(code: string) {
    setSelectedCountry(code);
    try {
      const res = await fetch("/api/profile/country", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ country: code }),
      });
      if (res.ok) {
        show({ title: "Country saved", tone: "success" });
        window.dispatchEvent(new Event("plexo:country-saved"));
        router.refresh();
      }
    } catch {
      // Keep optimistic value
    }
  }

  const patch = (json: Record<string, unknown>) => (mock ? Promise.resolve({}) : hubApi("/api/profile", { method: "PATCH", json }, "We couldn't save that. Please try again."));

  async function saveName() {
    const next = name.trim();
    if (!next) return setError("Please type the name you'd like us to use.");
    setBusy("name");
    setError(null);
    try {
      await patch({ name: next });
      setSaved(next);
      show({ title: "Saved", tone: "success" });
      router.refresh();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function upload(file: File) {
    setBusy("photo");
    setError(null);
    try {
      if (mock) {
        setImage(URL.createObjectURL(file));
      } else {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/v1/media/upload", { method: "POST", body: form });
        const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
        if (!res.ok || !data.url) throw new Error(data.error ?? "We couldn't upload that photo. Try a PNG or JPG under 8 MB.");
        await patch({ image: data.url });
        setImage(data.url);
        router.refresh();
      }
      show({ title: "Photo updated", tone: "success" });
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function removePhoto() {
    setBusy("photo");
    try {
      await patch({ image: null });
      setImage(null);
      router.refresh();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function chooseFeel(next: Experience) {
    if (next === experience) return;
    const before = experience;
    setExperience(next);
    try {
      await patch({ experience: next });
      show({ title: "Done. Plexo now feels different", description: "The menu and pages have changed to match.", tone: "success" });
      router.refresh();
    } catch (e) {
      setExperience(before);
      setError(errMsg(e));
    }
  }

  const versions = useVersionSwitch();
  const dirty = isDirty({ name: saved }, { name: name.trim() });
  return (
    <SettingsPageShell
      title="Profile & appearance"
      purpose="Who you are in Plexo, how it looks, and how much help it gives you."
      bar={<SaveBar dirty={dirty} saving={busy === "name"} valid={!!name.trim()} onSave={saveName} onDiscard={() => { setName(saved); setError(null); }} />}
      aside={
        <>
          <AsideCard title="Need a hand?" icon={LifeBuoy}>
            <p>You can walk around Plexo again, or answer the setup questions to change your goal and style. Nothing you&apos;ve made is touched.</p>
            <Button variant="secondary" leftIcon={<PlayCircle size={18} aria-hidden />} disabled={!tour} onClick={() => tour?.openOffer()}>Show me around</Button>
            <ButtonLink href="/welcome/setup?again=1" variant="secondary" leftIcon={<RotateCcw size={18} aria-hidden />}>Personalise again</ButtonLink>
          </AsideCard>
          {versions.targets.length > 0 ? (
            <AsideCard title="Your dashboard" icon={LayoutDashboard}>
              <p>Change how Plexo looks. Everything you&apos;ve made stays exactly as it is.</p>
              {versions.targets.map((t) => (
                <Button key={t.id} variant="secondary" onClick={() => versions.request(t.id)}>{switchLabel(t)}</Button>
              ))}
            </AsideCard>
          ) : null}
        </>
      }
    >
      {error ? <GateOrError error={error}><Notice tone="bad">{error}</Notice></GateOrError> : null}

      <Panel title="Your profile" description="This is how you appear to the people you work with.">
        <div className="plx-sform plx-sform--wide" style={{ maxWidth: 760 }}>
          <div className="plx-photo">
            <Avatar name={saved || email} src={image} size={80} />
            <div className="plx-photo__actions">
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
              <Button variant="secondary" size="sm" loading={busy === "photo"} leftIcon={<Camera size={16} aria-hidden />} onClick={() => fileRef.current?.click()}>
                {image ? "Change photo" : "Add a photo"}
              </Button>
              {image ? <Button variant="ghost" size="sm" onClick={removePhoto}>Remove</Button> : null}
            </div>
          </div>
          <div className="plx-sform__two">
            <Input label="Your name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" help="What your team and customers see." error={!name.trim() && dirty ? "Please type the name you'd like us to use." : undefined} onKeyDown={(e) => e.key === "Enter" && dirty && name.trim() && void saveName()} />
            <Input label="Your email" value={email} readOnly help="This is what you sign in with." />
          </div>
          <div className="plx-sform__two">
            <div className="plx-field">
              <label className="plx-field__label" htmlFor="profile-country">Country</label>
              <CountrySelect id="profile-country" value={selectedCountry} onChange={handleCountryChange} />
            </div>
            {phone ? <Input label="Your phone number" value={phone} readOnly help="Saved when you connected WhatsApp." /> : null}
          </div>
        </div>
      </Panel>

      <Panel title="Sign-in" description="Keep your account safe.">
        <SettingRow title="Password" description="We'll email you a link to choose a new one.">
          <ButtonLink href="/auth/forgot-password" variant="secondary" leftIcon={<KeyRound size={16} aria-hidden />}>Change password</ButtonLink>
        </SettingRow>
      </Panel>

      <Panel title="Appearance" description="System follows your phone or computer.">
        <ThemeSwitch />
      </Panel>

      <Panel title="How should Plexo feel for you?" description="You can change this any time. The menu and pages change to match." data-tour="settings-feel">
        <div className="plx-choice" role="radiogroup" aria-label="How Plexo feels">
          {FEELS.map((f) => (
            <button key={f.id} type="button" role="radio" aria-checked={experience === f.id} className="plx-choice__opt" onClick={() => chooseFeel(f.id)}>
              <b>{f.title}{experience === f.id ? <Check size={18} aria-hidden style={{ color: "var(--plx-deep)" }} /> : null}</b>
              <span>{f.body}</span>
            </button>
          ))}
        </div>
      </Panel>
    </SettingsPageShell>
  );
}
