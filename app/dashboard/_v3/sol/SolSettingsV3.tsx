"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Brain, Check, ChevronRight } from "lucide-react";
import type { SolModelTier, SolPreferencesData, SolResponseLength, SolTonePreset } from "../../sol/settings/page";
import { AsideCard, AsideStats, Notice, Panel, SaveBar, SettingRow, SettingsPageShell, ToggleRow } from "../settings/bits";
import { ButtonLink, SegmentedControl, Textarea } from "../ui";
import { WhatsAppV3 } from "./WhatsAppV3";
import "./sol.css";

const TONES: { value: SolTonePreset; label: string }[] = [
  { value: "FRIENDLY", label: "Friendly" },
  { value: "PROFESSIONAL", label: "Professional" },
  { value: "CONCISE", label: "Brief" },
  { value: "DETAILED", label: "Detailed" },
];
const SPEEDS: { value: SolModelTier; label: string; help: string }[] = [
  { value: "BASIC", label: "Quick", help: "Fast answers. Great for everyday jobs like changing a headline or writing a short bit of text." },
  { value: "MEDIUM", label: "Smarter", help: "Thinks things through more, and is still quick. A good choice for building pages." },
  { value: "HIGH", label: "Smartest", help: "Takes longer and costs more credits. Best for big or tricky jobs." },
];
const LENGTHS: { value: SolResponseLength; label: string }[] = [
  { value: "CONCISE", label: "Short" },
  { value: "BALANCED", label: "Normal" },
  { value: "THOROUGH", label: "Thorough" },
];

type Draft = Pick<SolPreferencesData, "customInstructions" | "memoryEnabled" | "defaultModelTier" | "responseLength"> & { tonePreset: SolTonePreset };

function useCredits(): number | null {
  const [credits, setCredits] = useState<number | null>(null);
  useEffect(() => {
    let off = false;
    fetch("/api/v1/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !off && d?.user && setCredits(d.user.totalCredits ?? null))
      .catch(() => {});
    return () => {
      off = true;
    };
  }, []);
  return credits;
}

/** SOL's settings in the new look: plain-words groups, one Save. Same preferences API as the classic page. */
export function SolSettingsV3({ initialPreferences }: { initialPreferences: SolPreferencesData }) {
  const start: Draft = {
    tonePreset: initialPreferences.tonePreset ?? "FRIENDLY",
    customInstructions: initialPreferences.customInstructions,
    defaultModelTier: initialPreferences.defaultModelTier,
    memoryEnabled: initialPreferences.memoryEnabled,
    responseLength: initialPreferences.responseLength,
  };
  const [saved, setSaved] = useState<Draft>(start);
  const [draft, setDraft] = useState<Draft>(start);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const credits = useCredits();
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setJustSaved(false);
    setDraft((d) => ({ ...d, [key]: value }));
  };

  useEffect(() => {
    if (!justSaved) return;
    const t = window.setTimeout(() => setJustSaved(false), 4000);
    return () => window.clearTimeout(t);
  }, [justSaved]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/sol/preferences", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "We couldn't save your settings. Please try again.");
      }
      setSaved(draft);
      setJustSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't save your settings. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const speed = SPEEDS.find((s) => s.value === draft.defaultModelTier) ?? SPEEDS[0];

  return (
    <div className="sol3-sub">
      <SettingsPageShell
        title="SOL settings"
        purpose="Tell SOL how you like to work. These apply to every new chat."
        action={
          <div className="sol3-sub__actions">
            {justSaved && !dirty ? (
              <span className="sol3-saved" role="status">
                <Check size={16} aria-hidden /> Saved
              </span>
            ) : null}
            <ButtonLink href="/dashboard/sol" variant="secondary" leftIcon={<ArrowLeft size={17} aria-hidden />}>
              Back to chats
            </ButtonLink>
          </div>
        }
        aside={
          <>
            <AsideCard title="Your credits">
              <AsideStats items={[{ label: "credits left", value: credits === null ? "–" : credits.toLocaleString(), tone: credits !== null && credits < 50 ? "warn" : undefined }]} />
              <p>Every chat with SOL uses a few credits. The longer and bigger the job, the more it uses.</p>
              <ButtonLink href="/dashboard/settings/subscription" variant="secondary" size="sm">
                Add credits
              </ButtonLink>
            </AsideCard>
            <AsideCard title="You stay in control">
              <p>SOL always asks you first before it deletes something, takes a payment or does anything that can&apos;t be undone. That is a promise, not a setting, so it can&apos;t be switched off.</p>
            </AsideCard>
          </>
        }
        bar={<SaveBar dirty={dirty} saving={saving} onSave={save} onDiscard={() => setDraft(saved)} />}
      >
        {error ? <Notice tone="bad">{error}</Notice> : null}

        <Panel title="How SOL talks to you" description="The voice and amount of detail you'd like.">
          <SettingRow title="Tone" description="The voice SOL writes in.">
            <SegmentedControl label="Tone" options={TONES} value={draft.tonePreset} onChange={(v) => set("tonePreset", v)} />
          </SettingRow>
          <SettingRow title="Length of answers" description="How much SOL says each time.">
            <SegmentedControl label="Length of answers" options={LENGTHS} value={draft.responseLength} onChange={(v) => set("responseLength", v)} />
          </SettingRow>
        </Panel>

        <Panel title="About you and your business" description="Anything SOL should always know. It reads this at the start of every chat.">
          <Textarea
            label="Your instructions for SOL"
            hideLabel
            rows={5}
            maxLength={2000}
            value={draft.customInstructions}
            placeholder="For example: I run a bakery in Accra. My customers are mostly young families. Keep things warm and simple, and never use the word “delicious”."
            help={`${draft.customInstructions.length} of 2000 characters`}
            onChange={(e) => set("customInstructions", e.target.value)}
          />
        </Panel>

        <Panel title="Speed and smartness" description="What SOL uses when you start a new chat. You can change it for one chat from the chat box.">
          <SettingRow title="Starting choice" description={speed.help}>
            <SegmentedControl label="Speed and smartness" options={SPEEDS} value={draft.defaultModelTier} onChange={(v) => set("defaultModelTier", v)} />
          </SettingRow>
        </Panel>

        <Panel title="Memory">
          <ToggleRow title="Remember things about me" description="SOL keeps in mind your preferences and facts between chats, so you don't repeat yourself." checked={draft.memoryEnabled} onChange={(v) => set("memoryEnabled", v)} />
          <SettingRow title="See what SOL remembers" description="Look through it, change it or remove anything you like.">
            <ButtonLink href="/dashboard/sol/memory" variant="secondary" leftIcon={<Brain size={17} aria-hidden />} rightIcon={<ChevronRight size={17} aria-hidden />}>
              Open memory
            </ButtonLink>
          </SettingRow>
        </Panel>

        <Panel title="Chat with SOL on WhatsApp" description="Message SOL from your phone. It works on your account and replies right in the chat. Anything risky still asks you first.">
          <WhatsAppV3 />
        </Panel>
      </SettingsPageShell>
    </div>
  );
}
