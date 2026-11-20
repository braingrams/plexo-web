"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { GateOrError } from "@/app/dashboard/_components/UpgradePrompt";
import { Check } from "lucide-react";
import { Button, Card, CardHeader, Input, Skeleton, Textarea, useToast } from "../ui";
import { SolGlyph } from "../sol/SolGlyph";
import { SolWriteDrawer } from "../sol/SolWriteDrawer";
import { errMsg, hubApi } from "./hubApi";
import { FORMALITY, TONES, VOICE_LIMITS, cleanWordList, hasVoice, parseVoiceResult, voiceWriterContext, type BrandVoice, type Formality, type ToneId } from "@/lib/brand/brandVoice";

type VoiceReply = { voice: BrandVoice | null; effective: BrandVoice | null; suggestedMetaDescription?: string };

/** Words typed with commas or Enter become little removable chips. */
export function WordChips({ label, help, value, onChange, placeholder }: { label: string; help: string; value: string[]; onChange: (next: string[]) => void; placeholder: string }) {
  const [text, setText] = useState("");
  const add = (raw: string) => {
    const next = cleanWordList([...value, ...raw.split(/[,;\n]+/)]);
    onChange(next);
    setText("");
  };
  return (
    <div className="plx-form" style={{ gap: 8 }}>
      <span className="plx-field__label">{label}</span>
      <div className="plx-hwchips" role="list" aria-label={label}>
        {value.map((w) => (
          <span className="plx-hwchip" role="listitem" key={w}>
            {w}
            <button type="button" aria-label={`Remove ${w}`} onClick={() => onChange(value.filter((x) => x !== w))}>×</button>
          </span>
        ))}
      </div>
      <Input
        label={label}
        hideLabel
        help={help}
        value={text}
        placeholder={placeholder}
        onChange={(e) => (e.target.value.includes(",") ? add(e.target.value) : setText(e.target.value))}
        onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) { e.preventDefault(); add(text); } }}
        onBlur={() => text.trim() && add(text)}
      />
    </div>
  );
}

/**
 * "Your words": the tagline, a short description of the business and how the brand sounds. SOL, your AI helpers, emails and blog
 * posts all write in this voice; the footer and search results start from it. Saved with one button; "Write it for me" asks SOL.
 */
export function BrandWords({ siteId, siteName, preview, previewVoice, onSaved, onDirty }: { siteId: string; siteName: string; preview?: boolean; previewVoice?: BrandVoice | null; onSaved?: (v: BrandVoice) => void; /** Tells the page whether there are changes that are not saved yet. */ onDirty?: (dirty: boolean) => void }) {
  const { show } = useToast();
  const path = `/api/v1/sites/${encodeURIComponent(siteId)}/voice`;
  const [loaded, setLoaded] = useState(!!preview);
  const [saved, setSaved] = useState<BrandVoice>(previewVoice ?? {});
  const [draft, setDraft] = useState<BrandVoice>(previewVoice ?? {});
  const [starter, setStarter] = useState<BrandVoice>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);

  useEffect(() => {
    if (preview) return;
    let off = false;
    hubApi<VoiceReply>(path).then((r) => {
      if (off) return;
      const mine = r.voice ?? {};
      setSaved(mine);
      setDraft(mine);
      setStarter(r.effective ?? {});
      setLoaded(true);
    }, (e) => { if (!off) { setError(errMsg(e, "We couldn't load your words.")); setLoaded(true); } });
    return () => { off = true; };
  }, [path, preview]);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);
  useEffect(() => { onDirty?.(dirty); }, [dirty, onDirty]);
  const set = (patch: Partial<BrandVoice>) => setDraft((d) => ({ ...d, ...patch }));

  const persist = useCallback(async (next: BrandVoice) => {
    setSaving(true);
    setError(null);
    try {
      // Every field is sent so a cleared one is cleared.
      const body = { tagline: next.tagline ?? "", aboutLine: next.aboutLine ?? "", tones: next.tones ?? [], formality: next.formality ?? "", audience: next.audience ?? "", wordsLike: next.wordsLike ?? [], wordsAvoid: next.wordsAvoid ?? [] };
      const r = preview ? { voice: next, message: "Saved." } : await hubApi<{ voice: BrandVoice; message: string }>(path, { method: "PUT", json: body }, "We couldn't save your words. Please try again.");
      setSaved(r.voice);
      setDraft(r.voice);
      show({ title: r.message, tone: "success" });
      onSaved?.(r.voice);
    } catch (e) {
      setError(errMsg(e));
      throw e;
    } finally {
      setSaving(false);
    }
  }, [path, preview, show, onSaved]);

  const toggleTone = (id: ToneId) => {
    const on = draft.tones?.includes(id);
    if (on) return set({ tones: draft.tones!.filter((t) => t !== id) });
    if ((draft.tones?.length ?? 0) >= VOICE_LIMITS.tones) return setError(`Pick up to ${VOICE_LIMITS.tones} tones. A voice with too many sounds like no voice at all.`);
    setError(null);
    set({ tones: [...(draft.tones ?? []), id] });
  };

  if (!loaded) return <Card><Skeleton height={20} width="40%" style={{ marginBottom: 14 }} /><Skeleton height={120} /></Card>;
  const hint = !hasVoice(saved) && hasVoice(starter);

  return (
    <Card data-tour="hub-brand-words">
      <CardHeader
        title="Your words"
        description="How your business sounds. SOL and your AI helpers write your pages, emails and blog posts in this voice, and your footer and search results start from it."
        action={<Button variant="secondary" leftIcon={<SolGlyph size={16} />} onClick={() => setWriting(true)}>Write it for me</Button>}
      />
      <div className="plx-bdef">
        {hint ? (
          <div className="plx-inlinemsg" role="status">
            We started from what you told us when you signed up.{" "}
            <Button variant="link" onClick={() => setDraft(starter)}>Use it</Button>
          </div>
        ) : null}
        <div className="plx-bdef__group">
          <Input label="Tagline" help={`A short line that goes with your name, like "Fresh bread, baked slow." (${(draft.tagline ?? "").length}/${VOICE_LIMITS.tagline})`} value={draft.tagline ?? ""} maxLength={VOICE_LIMITS.tagline} placeholder="e.g. Fresh bread, baked slow." onChange={(e) => set({ tagline: e.target.value })} />
          <Textarea label="About you, in a sentence or two" help="Shown in your footer and when your site is found online." value={draft.aboutLine ?? ""} maxLength={VOICE_LIMITS.aboutLine} placeholder="e.g. A family bakery in Lagos making sourdough and pastries every morning." style={{ minHeight: 88 }} onChange={(e) => set({ aboutLine: e.target.value })} />
        </div>

        <div className="plx-bdef__group">
          <h3>How do you sound?</h3>
          <p className="plx-small" style={{ margin: 0 }}>Pick up to {VOICE_LIMITS.tones}. Each one shows how it reads.</p>
          <div className="plx-bdef__choices" role="group" aria-label="How you sound">
            {TONES.map((t) => {
              const on = !!draft.tones?.includes(t.id);
              return <button key={t.id} type="button" aria-pressed={on} className="plx-bdef__choice plx-bdef__choice--tone" title={`“${t.example}”`} onClick={() => toggleTone(t.id)}>{on ? <Check size={14} aria-hidden /> : null} {t.label}</button>;
            })}
          </div>
          {draft.tones?.length ? <p className="plx-small" style={{ margin: 0, fontStyle: "italic" }}>{draft.tones.map((id) => `“${TONES.find((t) => t.id === id)?.example}”`).join("  ")}</p> : null}
        </div>

        <div className="plx-bdef__group">
          <h3>How formal?</h3>
          <div role="radiogroup" aria-label="How formal you are" className="plx-bdef__choices">
            {FORMALITY.map((f) => <button key={f.id} type="button" role="radio" aria-checked={draft.formality === f.id} className="plx-bdef__choice" title={`“${f.example}”`} onClick={() => set({ formality: draft.formality === f.id ? undefined : (f.id as Formality) })}>{f.label}</button>)}
          </div>
          {draft.formality ? <p className="plx-small" style={{ margin: 0, fontStyle: "italic" }}>“{FORMALITY.find((f) => f.id === draft.formality)?.example}”</p> : null}
        </div>

        <div className="plx-bdef__group">
          <Input label="Who are you talking to?" help="A few words is enough." value={draft.audience ?? ""} maxLength={VOICE_LIMITS.audience} placeholder="e.g. busy parents who want dinner sorted" onChange={(e) => set({ audience: e.target.value })} />
          <div className="plx-bdef__selects">
            <WordChips label="Words we like" help="Type a word and press Enter." value={draft.wordsLike ?? []} placeholder="e.g. handmade, fresh, neighbourhood" onChange={(wordsLike) => set({ wordsLike })} />
            <WordChips label="Words we avoid" help="Words SOL should never use for you." value={draft.wordsAvoid ?? []} placeholder="e.g. cheap, synergy, leverage" onChange={(wordsAvoid) => set({ wordsAvoid })} />
          </div>
        </div>

        {error ? <GateOrError error={error}><p className="plx-field__error" role="alert">{error}</p></GateOrError> : null}
        <div className="plx-bdef__savebar">
          <Button loading={saving} disabled={!dirty && !saving} onClick={() => void persist(draft).catch(() => undefined)}>Save my words</Button>
          <span className="plx-small" role="status">{dirty ? "You have changes to save." : hasVoice(saved) ? "Saved." : "Nothing saved yet."}</span>
        </div>
      </div>

      <SolWriteDrawer<BrandVoice>
        open={writing}
        onClose={() => setWriting(false)}
        title="Write my words with SOL"
        intro="Tell SOL about your business in a sentence or two. It suggests a tagline, a short description and a voice. Nothing changes until you press Use."
        placeholder="e.g. We're a family bakery in Lagos. We make sourdough and pastries every morning for neighbours and offices."
        initialPrompt={draft.aboutLine ?? starter.aboutLine}
        buildRequest={(prompt) => ({ mode: "write_brand_voice", templateKind: "LANDING_PAGE", prompt, siteId, context: voiceWriterContext({ siteId, siteName, current: hasVoice(draft) ? draft : undefined }) })}
        parseResult={(raw) => parseVoiceResult(raw)}
        useLabel="Use these words"
        onUse={async (r) => { await persist({ ...draft, ...r }); }}
        renderResult={(r) => (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {r.tagline ? <h3 className="plx-h3" style={{ margin: 0 }}>{r.tagline}</h3> : null}
            {r.aboutLine ? <p style={{ margin: 0 }}>{r.aboutLine}</p> : null}
            <p className="plx-small" style={{ margin: 0 }}>
              {[r.tones?.map((id) => TONES.find((t) => t.id === id)?.label).filter(Boolean).join(", "), r.formality ? FORMALITY.find((f) => f.id === r.formality)?.label : "", r.audience ? `for ${r.audience}` : ""].filter(Boolean).join("  ·  ")}
            </p>
            {r.wordsLike?.length ? <p className="plx-small" style={{ margin: 0 }}>We like: {r.wordsLike.join(", ")}</p> : null}
            {r.wordsAvoid?.length ? <p className="plx-small" style={{ margin: 0 }}>We avoid: {r.wordsAvoid.join(", ")}</p> : null}
          </div>
        )}
      />
    </Card>
  );
}
